import json
import multiprocessing
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
import zipfile
from io import BytesIO
from pathlib import Path
from unittest import mock

from flask import Flask


LIVE2D_ROOT = Path(__file__).resolve().parent.parent
if str(LIVE2D_ROOT) not in sys.path:
    sys.path.insert(0, str(LIVE2D_ROOT))

from webui import log_monitor
from webui import marketplace
from webui import marketplace_updater
from webui import plugin_manager
from webui import service_controller
from webui import state_io
from webui import tool_manager


def _cross_process_lock_worker(lock_root, state_root, barrier, results):
    state_io._LOCK_ROOT = Path(lock_root)
    state_io._STATE_ROOT = Path(state_root)
    for index in range(10):
        try:
            barrier.wait(timeout=10)
            with state_io.resource_lock(f"initialization-race-{index}"):
                results.put(("acquired", os.getpid(), index))
                time.sleep(0.02)
        except Exception as exc:
            results.put(("error", type(exc).__name__, str(exc)))
        finally:
            try:
                barrier.wait(timeout=10)
            except threading.BrokenBarrierError:
                return


def make_app(name, blueprint):
    app = Flask(name)
    app.config.update(TESTING=True)
    app.register_blueprint(blueprint)
    return app


def archive_bytes(files):
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return output.getvalue()


def run_two_requests(app, path, payloads):
    barrier = threading.Barrier(3)
    responses = [None, None]
    errors = []

    def worker(index):
        try:
            barrier.wait(timeout=3)
            response = app.test_client().post(path, json=payloads[index])
            responses[index] = (response.status_code, response.get_json())
        except Exception as exc:
            errors.append(exc)

    threads = [
        threading.Thread(target=worker, args=(index,))
        for index in range(2)
    ]
    for thread in threads:
        thread.start()
    barrier.wait(timeout=3)
    for thread in threads:
        thread.join(timeout=5)

    if errors:
        raise errors[0]
    if any(thread.is_alive() for thread in threads):
        raise AssertionError("concurrent request did not finish")
    return responses


class IsolatedStateTestCase(unittest.TestCase):
    def setUp(self):
        self.state_temp = tempfile.TemporaryDirectory()
        root = Path(self.state_temp.name)
        self.state_patch = mock.patch.multiple(
            state_io,
            _LOCK_ROOT=root / "locks",
            _STATE_ROOT=root / "state",
        )
        self.state_patch.start()
        marketplace.installing_tasks.clear()
        service_controller.service_processes.clear()
        service_controller.service_pids.clear()

    def tearDown(self):
        marketplace.installing_tasks.clear()
        service_controller.service_processes.clear()
        service_controller.service_pids.clear()
        self.state_patch.stop()
        self.state_temp.cleanup()


class StateIoCrossProcessTests(unittest.TestCase):
    def test_first_lock_file_creation_is_race_safe(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            context = multiprocessing.get_context("spawn")
            barrier = context.Barrier(2)
            results = context.Queue()
            processes = [
                context.Process(
                    target=_cross_process_lock_worker,
                    args=(
                        str(root / "locks"),
                        str(root / "state"),
                        barrier,
                        results,
                    ),
                )
                for _ in range(2)
            ]
            for process in processes:
                process.start()
            for process in processes:
                process.join(timeout=20)

            self.assertTrue(all(not process.is_alive() for process in processes))
            self.assertEqual([process.exitcode for process in processes], [0, 0])
            messages = [results.get(timeout=3) for _ in range(20)]
            self.assertTrue(
                all(message[0] == "acquired" for message in messages),
                messages,
            )


class MarketplaceStateSafetyTests(IsolatedStateTestCase):
    def test_update_preserves_state_and_retains_external_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_root = Path(tmp) / "live-2d"
            plugin_dir = (
                project_root / "plugins" / "community" / "demo"
            )
            (plugin_dir / "data").mkdir(parents=True)
            (plugin_dir / "custom-state").mkdir()
            (plugin_dir / "metadata.json").write_text(
                json.dumps({"name": "demo", "version": "1.0.0"}),
                encoding="utf-8",
            )
            (plugin_dir / "plugin_persistence.json").write_text(
                json.dumps({"paths": ["custom-state"]}),
                encoding="utf-8",
            )
            (plugin_dir / "plugin_config.json").write_text(
                json.dumps({"token": {"value": "keep"}}),
                encoding="utf-8",
            )
            (plugin_dir / "data" / "state.json").write_text(
                '{"counter":42}',
                encoding="utf-8",
            )
            (plugin_dir / "custom-state" / "user.json").write_text(
                '{"name":"local"}',
                encoding="utf-8",
            )
            (plugin_dir / "watch_history.json").write_text(
                '["episode-1"]',
                encoding="utf-8",
            )
            (plugin_dir / "user-cache.db").write_bytes(b"db-state")
            (plugin_dir / "old-code.txt").write_text(
                "stale",
                encoding="utf-8",
            )

            new_archive = archive_bytes({
                "demo-main/metadata.json": json.dumps(
                    {"name": "demo", "version": "2.0.0"}
                ),
                "demo-main/plugin_persistence.json": json.dumps(
                    {"paths": ["custom-state", "future-state"]}
                ),
                "demo-main/index.js": "module.exports = {};",
            })
            result = marketplace_updater.update_plugin_safe(
                plugin_dir,
                "demo",
                "https://example.invalid/demo",
                archive_downloader=lambda _url: new_archive,
                requirements_installer=lambda _path: None,
            )

            self.assertEqual(
                json.loads(
                    (plugin_dir / "plugin_config.json").read_text(
                        encoding="utf-8"
                    )
                ),
                {"token": {"value": "keep"}},
            )
            self.assertEqual(
                (plugin_dir / "data" / "state.json").read_text(
                    encoding="utf-8"
                ),
                '{"counter":42}',
            )
            self.assertTrue(
                (plugin_dir / "custom-state" / "user.json").is_file()
            )
            self.assertTrue((plugin_dir / "watch_history.json").is_file())
            self.assertEqual(
                (plugin_dir / "user-cache.db").read_bytes(),
                b"db-state",
            )
            self.assertFalse((plugin_dir / "old-code.txt").exists())
            self.assertTrue((plugin_dir / "index.js").is_file())
            self.assertEqual(
                json.loads(
                    (plugin_dir / "plugin_persistence.json").read_text(
                        encoding="utf-8"
                    )
                )["paths"],
                ["custom-state", "future-state"],
            )

            backup_path = Path(result["backup_path"])
            self.assertTrue(backup_path.is_dir())
            self.assertIn(".plugin-update-backups", backup_path.parts)
            self.assertNotEqual(backup_path.parent, plugin_dir.parent)

            latest_backup = backup_path
            for _ in range(3):
                result = marketplace_updater.update_plugin_safe(
                    plugin_dir,
                    "demo",
                    "https://example.invalid/demo",
                    archive_downloader=lambda _url: new_archive,
                    requirements_installer=lambda _path: None,
                )
                latest_backup = Path(result["backup_path"])

            retained = list(latest_backup.parent.glob("backup-*"))
            self.assertEqual(len(retained), 3)
            self.assertTrue(latest_backup.is_dir())

    def test_duplicate_install_is_reserved_before_worker_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "live-2d"
            (root / "plugins" / "community").mkdir(parents=True)
            deferred = []

            class DeferredThread:
                def __init__(self, target, args, daemon=True, **_kwargs):
                    self.target = target
                    self.args = args
                    self.daemon = daemon

                def start(self):
                    deferred.append(self.args)

            app = make_app("install-admission", marketplace.market_bp)
            with mock.patch.object(marketplace, "PROJECT_ROOT", root), \
                    mock.patch.object(
                        marketplace.threading,
                        "Thread",
                        DeferredThread,
                    ):
                client = app.test_client()
                payload = {
                    "plugin_name": "demo",
                    "repo": "https://example.invalid/demo",
                }
                first = client.post(
                    "/api/market/plugins/download",
                    json=payload,
                )
                second = client.post(
                    "/api/market/plugins/download",
                    json=payload,
                )
                task = marketplace._get_install_task("demo")

            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 409)
            self.assertEqual(len(deferred), 1)
            self.assertEqual(task["status"], "queued")

    def test_install_failure_remains_queryable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "live-2d"
            plugin_dir = root / "plugins" / "community" / "demo"
            plugin_dir.parent.mkdir(parents=True)
            app = make_app("install-failure", marketplace.market_bp)

            def fail_install(*_args, **_kwargs):
                raise RuntimeError("synthetic install failure")

            with mock.patch.object(marketplace, "PROJECT_ROOT", root), \
                    mock.patch.object(
                        marketplace,
                        "install_plugin_from_archive",
                        fail_install,
                    ):
                marketplace._install_plugin_worker(
                    "demo",
                    "https://example.invalid/demo",
                    plugin_dir,
                )
                response = app.test_client().get(
                    "/api/market/plugins/install-status/demo"
                )

            payload = response.get_json()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(payload["status"], "failed")
            self.assertTrue(payload["terminal"])
            self.assertEqual(
                payload["error"],
                "synthetic install failure",
            )

            source = (
                LIVE2D_ROOT / "webui" / "static" / "js" / "app.js"
            ).read_text(encoding="utf-8")
            start = source.index("async function pollPluginInstalled")
            end = source.index("\nasync function", start + 1)
            polling_source = source[start:end]
            self.assertIn(
                "/api/market/plugins/install-status/",
                polling_source,
            )
            self.assertNotIn(
                "/api/market/plugins/check-installed/",
                polling_source,
            )
            self.assertIn("data.status === 'failed'", polling_source)


class ConcurrentJsonSafetyTests(IsolatedStateTestCase):
    def test_non_conflicting_concurrent_updates_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "live-2d"
            for name in ("alpha", "beta"):
                (root / "plugins" / "built-in" / name).mkdir(parents=True)
            enabled_path = root / "plugins" / "enabled_plugins.json"
            enabled_path.write_text('{"plugins":[]}', encoding="utf-8")
            app = make_app("plugin-toggle", plugin_manager.plugin_bp)

            with mock.patch.object(plugin_manager, "PROJECT_ROOT", root):
                responses = run_two_requests(
                    app,
                    "/api/plugins/toggle",
                    [
                        {"plugin_path": "built-in/alpha"},
                        {"plugin_path": "built-in/beta"},
                    ],
                )

            self.assertTrue(all(status == 200 for status, _ in responses))
            self.assertEqual(
                set(json.loads(enabled_path.read_text())["plugins"]),
                {"built-in/alpha", "built-in/beta"},
            )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "live-2d"
            config_path = root / "mcp" / "mcp_config.json"
            config_path.parent.mkdir(parents=True)
            config_path.write_text(
                json.dumps({
                    "alpha": {"command": "node"},
                    "beta": {"command": "node"},
                }),
                encoding="utf-8",
            )
            app = make_app("mcp-toggle", tool_manager.tool_bp)

            with mock.patch.object(tool_manager, "PROJECT_ROOT", root):
                responses = run_two_requests(
                    app,
                    "/api/tools/toggle",
                    [
                        {
                            "name": "alpha",
                            "type": "mcp",
                            "is_external": True,
                        },
                        {
                            "name": "beta",
                            "type": "mcp",
                            "is_external": True,
                        },
                    ],
                )

            self.assertTrue(all(status == 200 for status, _ in responses))
            self.assertEqual(
                set(json.loads(config_path.read_text()).keys()),
                {"alpha_disabled", "beta_disabled"},
            )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "live-2d"
            plugin_dir = root / "plugins" / "community" / "demo"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "metadata.json").write_text(
                json.dumps({"name": "Demo", "displayName": "Demo"}),
                encoding="utf-8",
            )
            config_path = plugin_dir / "plugin_config.json"
            config_path.write_text(
                json.dumps({
                    "alpha": {"type": "string", "value": "base-a"},
                    "beta": {"type": "string", "value": "base-b"},
                }),
                encoding="utf-8",
            )
            app = make_app("plugin-config", plugin_manager.plugin_bp)

            with mock.patch.object(plugin_manager, "PROJECT_ROOT", root):
                responses = run_two_requests(
                    app,
                    "/api/plugins/Demo/config",
                    [{"alpha": "new-a"}, {"beta": "new-b"}],
                )

            self.assertTrue(all(status == 200 for status, _ in responses))
            saved = json.loads(config_path.read_text())
            self.assertEqual(saved["alpha"]["value"], "new-a")
            self.assertEqual(saved["beta"]["value"], "new-b")


class IncrementalLogTests(IsolatedStateTestCase):
    def test_runtime_endpoint_returns_only_appended_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "live-2d"
            root.mkdir()
            log_path = root / "runtime.log"
            with log_path.open("w", encoding="utf-8") as stream:
                for index in range(5000):
                    prefix = "[TOOL] " if index % 2 else ""
                    stream.write(f"{prefix}line-{index}\n")

            app = make_app("runtime-logs", log_monitor.log_bp)
            with mock.patch.object(log_monitor, "PROJECT_ROOT", root):
                client = app.test_client()
                initial = client.get("/api/logs/runtime")
                initial_payload = initial.get_json()
                with log_path.open("a", encoding="utf-8") as stream:
                    stream.write("appended pet\n")
                    stream.write("[TOOL] appended tool\n")
                query = urllib.parse.urlencode({
                    "offset": initial_payload["offset"],
                    "cursor": initial_payload["cursor"],
                })
                incremental = client.get(f"/api/logs/runtime?{query}")

            payload = incremental.get_json()
            self.assertEqual(initial.status_code, 200)
            self.assertLessEqual(
                len(initial_payload["logs"]["pet"])
                + len(initial_payload["logs"]["tool"]),
                log_monitor.RUNTIME_INITIAL_LINES,
            )
            self.assertFalse(payload["reset"])
            self.assertEqual(payload["logs"]["pet"], ["appended pet"])
            self.assertEqual(
                payload["logs"]["tool"],
                ["[TOOL] appended tool"],
            )

            source = (
                LIVE2D_ROOT / "webui" / "static" / "js" / "app.js"
            ).read_text(encoding="utf-8")
            self.assertIn("/api/logs/runtime", source)
            self.assertIn("const LOG_POLL_INTERVAL_MS = 1000", source)
            self.assertIn("document.hidden", source)
            self.assertNotIn("loadLogs('pet')", source)
            self.assertNotIn("loadLogs('tool')", source)


class SharedServiceOwnershipTests(IsolatedStateTestCase):
    def test_second_webui_observes_shared_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "live-2d"
            root.mkdir()
            (root / "go.bat").write_text("@echo off\n", encoding="utf-8")
            app_one = make_app("service-one", service_controller.service_bp)
            app_two = make_app("service-two", service_controller.service_bp)
            launches = []

            class FakeProcess:
                pid = 4242

                def poll(self):
                    return None

                def terminate(self):
                    return None

            def fake_popen(*args, **kwargs):
                launches.append((args, kwargs))
                return FakeProcess()

            with mock.patch.object(
                service_controller,
                "PROJECT_ROOT",
                root,
            ), mock.patch.object(
                service_controller.subprocess,
                "Popen",
                side_effect=fake_popen,
            ), mock.patch.object(
                service_controller.time,
                "sleep",
                return_value=None,
            ), mock.patch.object(
                service_controller,
                "_pid_is_running",
                side_effect=lambda pid: int(pid) == 4242,
            ):
                first = app_one.test_client().post("/api/start/live2d")
                service_controller.service_processes.clear()
                service_controller.service_pids.clear()
                second = app_two.test_client().post("/api/start/live2d")
                status = app_two.test_client().get("/api/status")

            self.assertTrue(first.get_json()["success"])
            self.assertFalse(second.get_json()["success"])
            self.assertTrue(second.get_json()["already_running"])
            self.assertEqual(second.get_json()["pid"], 4242)
            self.assertEqual(len(launches), 1)
            self.assertEqual(status.get_json()["live2d"], "running")

            source = (
                LIVE2D_ROOT / "webui" / "static" / "js" / "app.js"
            ).read_text(encoding="utf-8")
            self.assertIn("result.already_running", source)


if __name__ == "__main__":
    unittest.main()
