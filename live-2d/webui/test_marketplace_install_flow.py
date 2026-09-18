"""插件广场安装接口的流程测试：不联网，注入假下载器 / 假依赖安装器。"""

import json
import tempfile
import time
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from webui.test_marketplace_updater import make_archive, plugin_archive


class MarketplaceInstallFlowTests(unittest.TestCase):
    def setUp(self):
        from webui import marketplace, marketplace_updater
        from webui.main_app import create_app

        self.marketplace = marketplace
        self.updater = marketplace_updater

        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.community = self.root / "plugins" / "community"
        self.builtin = self.root / "plugins" / "built-in"
        self.community.mkdir(parents=True)
        (self.builtin / "sfx").mkdir(parents=True)
        self.enabled_path = self.root / "plugins" / "enabled_plugins.json"
        self.enabled_path.write_text(
            json.dumps({"plugins": ["built-in/sfx", "community/existing"]}),
            encoding="utf-8",
        )
        settings_path = self.root / ".runtime" / "plugin_market_settings.json"

        self.enterContext(patch("webui.marketplace.PROJECT_ROOT", self.root))
        self.enterContext(patch("webui.plugin_manager.PROJECT_ROOT", self.root))
        self.enterContext(patch("webui.market_settings.SETTINGS_PATH", settings_path))
        self.enterContext(patch("webui.marketplace._live2d_running", lambda: False))
        self.enterContext(patch("webui.marketplace_stats.increment_download", lambda name: None))
        self.dependency_calls = []
        self.enterContext(patch(
            "webui.marketplace.install_dependencies",
            lambda plugin_dir, settings=None, report=None, **kwargs: self._fake_dependencies(plugin_dir, report),
        ))
        self.dependency_warnings = []

        app = create_app()
        app.config["TESTING"] = True
        self.client = app.test_client()

    def tearDown(self):
        self._tmp.cleanup()

    def _fake_dependencies(self, plugin_dir, report):
        self.dependency_calls.append(Path(plugin_dir))
        if report:
            report("installing_deps", None)
        return list(self.dependency_warnings)

    def _wait_for_task(self, name, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            task = self.marketplace._get_install_task(name)
            if task and task.get("status") in self.marketplace.TERMINAL_INSTALL_STATUSES:
                return task
            time.sleep(0.05)
        self.fail(f"install task {name} did not finish: {self.marketplace._get_install_task(name)}")

    def _enabled_list(self):
        return json.loads(self.enabled_path.read_text(encoding="utf-8"))["plugins"]

    # ---------- 市场安装 ----------

    def test_market_download_installs_and_enables_plugin(self):
        archive = plugin_archive(name="demo", version="1.0.0")
        with patch("webui.marketplace.download_archive", lambda repo_url, settings=None: (archive, "ghfast.top")):
            response = self.client.post(
                "/api/market/plugins/download",
                json={"plugin_name": "demo", "repo": "https://github.com/example/demo"},
            )
            self.assertEqual(response.status_code, 200, response.get_json())
            task = self._wait_for_task("demo")

        self.assertEqual(task["status"], "completed", task)
        self.assertTrue(task["enabled"])
        self.assertEqual(task["source_used"], "ghfast.top")
        self.assertEqual(task["warnings"], [])
        self.assertTrue((self.community / "demo" / "index.js").is_file())
        self.assertEqual(self._enabled_list(), ["built-in/sfx", "community/existing", "community/demo"])
        self.assertEqual(self.dependency_calls[0].name.startswith(".demo.install-"), True)

        status = self.client.get("/api/market/plugins/install-status/demo").get_json()
        self.assertTrue(status["installed"])
        self.assertTrue(status["enabled"])
        self.assertFalse(status["installing"])
        self.assertEqual(status["live2d_running"], False)
        self.assertEqual(status["source_used"], "ghfast.top")

    def test_market_download_reports_name_mismatch_as_warning(self):
        archive = plugin_archive(name="real-name", version="1.0.0")
        with patch("webui.marketplace.download_archive", lambda repo_url, settings=None: (archive, "direct")):
            self.client.post(
                "/api/market/plugins/download",
                json={"plugin_name": "hub-key", "repo": "https://github.com/example/demo"},
            )
            task = self._wait_for_task("hub-key")
        self.assertEqual(task["status"], "completed")
        self.assertTrue(task["enabled"])
        self.assertEqual(len(task["warnings"]), 1)
        self.assertIn("metadata.name", task["warnings"][0])
        self.assertIn("community/hub-key", self._enabled_list())

    def test_download_failure_marks_task_failed_without_directory(self):
        def failing(repo_url, settings=None):
            raise self.updater.DownloadError("所有下载来源均失败")

        with patch("webui.marketplace.download_archive", failing):
            self.client.post(
                "/api/market/plugins/download",
                json={"plugin_name": "demo", "repo": "https://github.com/example/demo"},
            )
            task = self._wait_for_task("demo")
        self.assertEqual(task["status"], "failed")
        self.assertIn("所有下载来源均失败", task["error"])
        self.assertFalse((self.community / "demo").exists())
        self.assertNotIn("community/demo", self._enabled_list())

    def test_dependency_failure_removes_partial_install(self):
        archive = plugin_archive(name="demo")

        def failing_dependencies(plugin_dir, settings=None, report=None, **kwargs):
            raise self.updater.DependencyInstallError("Node 依赖（npm）安装失败：ECONNRESET")

        with patch("webui.marketplace.download_archive", lambda repo_url, settings=None: (archive, "direct")), \
                patch("webui.marketplace.install_dependencies", failing_dependencies):
            self.client.post(
                "/api/market/plugins/download",
                json={"plugin_name": "demo", "repo": "https://github.com/example/demo"},
            )
            task = self._wait_for_task("demo")
        self.assertEqual(task["status"], "failed")
        self.assertIn("ECONNRESET", task["error"])
        self.assertFalse((self.community / "demo").exists())
        self.assertEqual([p.name for p in self.community.iterdir()], [])

    def test_enable_failure_is_reported_as_warning_not_failure(self):
        archive = plugin_archive(name="demo")

        def broken_enable(plugin_path):
            raise PermissionError("enabled_plugins.json is read-only")

        with patch("webui.marketplace.download_archive", lambda repo_url, settings=None: (archive, "direct")), \
                patch("webui.marketplace.enable_plugin_path", broken_enable):
            self.client.post(
                "/api/market/plugins/download",
                json={"plugin_name": "demo", "repo": "https://github.com/example/demo"},
            )
            task = self._wait_for_task("demo")
        self.assertEqual(task["status"], "completed")
        self.assertFalse(task["enabled"])
        self.assertTrue(any("自动启用失败" in item for item in task["warnings"]))
        self.assertTrue((self.community / "demo" / "metadata.json").is_file())
        self.assertNotIn("community/demo", self._enabled_list())

    # ---------- 仓库地址安装 ----------

    def test_inspect_and_install_from_url_use_metadata_name_and_compat_gate(self):
        remote_metadata = {
            "name": "url-plugin",
            "displayName": "地址安装插件",
            "version": "2.0.0",
            "author": "tester",
            "description": "from url",
            "framework_version": ">=99.0.0",
        }
        archive = plugin_archive(name="url-plugin", version="2.0.0", root="repo-main",
                                 metadata_extra={"framework_version": ">=99.0.0"})

        with patch("webui.marketplace.fetch_remote_metadata_with_source",
                   lambda repo_url, settings=None, **kw: (remote_metadata, "gh-proxy.com")), \
                patch("webui.marketplace.download_archive", lambda repo_url, settings=None: (archive, "gh-proxy.com")):
            inspect = self.client.post("/api/market/plugins/inspect", json={"repo": "https://github.com/example/repo"})
            body = inspect.get_json()
            self.assertEqual(inspect.status_code, 200, body)
            self.assertEqual(body["dir_name"], "url-plugin")
            self.assertEqual(body["metadata"]["displayName"], "地址安装插件")
            self.assertFalse(body["compatible"])
            self.assertEqual(body["source_used"], "gh-proxy.com")
            self.assertFalse(body["already_installed"])

            blocked = self.client.post("/api/market/plugins/install-from-url", json={"repo": "https://github.com/example/repo"})
            self.assertEqual(blocked.status_code, 409)
            self.assertTrue(blocked.get_json()["compatibility_error"])
            self.assertFalse((self.community / "url-plugin").exists())

            started = self.client.post(
                "/api/market/plugins/install-from-url",
                json={"repo": "https://github.com/example/repo", "ignore_compat": True},
            )
            self.assertEqual(started.status_code, 200, started.get_json())
            self.assertEqual(started.get_json()["plugin_name"], "url-plugin")
            task = self._wait_for_task("url-plugin")

        self.assertEqual(task["status"], "completed")
        self.assertTrue(task["enabled"])
        self.assertTrue((self.community / "url-plugin" / "index.js").is_file())
        self.assertIn("community/url-plugin", self._enabled_list())

    def test_inspect_rejects_non_github_and_invalid_metadata(self):
        response = self.client.post("/api/market/plugins/inspect", json={"repo": "https://gitee.com/x/y"})
        self.assertEqual(response.status_code, 400)

        with patch("webui.marketplace.fetch_remote_metadata_with_source",
                   lambda repo_url, settings=None, **kw: ({"version": "1.0.0"}, "direct")):
            response = self.client.post("/api/market/plugins/inspect", json={"repo": "https://github.com/example/repo"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.get_json()["error"])

    def test_install_from_url_refuses_conflicts_with_installed_or_builtin(self):
        (self.community / "existing").mkdir()
        (self.community / "existing" / "metadata.json").write_text("{}", encoding="utf-8")
        for name, expected in (("existing", "已安装"), ("sfx", "内置插件")):
            with patch("webui.marketplace.fetch_remote_metadata_with_source",
                       lambda repo_url, settings=None, _n=name, **kw: ({"name": _n, "version": "1.0.0"}, "direct")):
                response = self.client.post("/api/market/plugins/install-from-url", json={"repo": "https://github.com/example/repo"})
            self.assertEqual(response.status_code, 409, response.get_json())
            self.assertIn(expected, response.get_json()["error"])

    # ---------- 上传 zip 安装 ----------

    def test_upload_rejects_non_plugin_zip_and_leaves_no_files(self):
        bad_zip = make_archive({"whatever/readme.md": "not a plugin"})
        response = self.client.post(
            "/api/market/plugins/install-upload",
            data={"file": (BytesIO(bad_zip), "bad.zip")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("metadata.json", response.get_json()["error"])
        uploads = self.community / self.marketplace.UPLOAD_DIR_NAME
        self.assertEqual([p.name for p in self.community.iterdir() if p.name != uploads.name], [])
        if uploads.exists():
            self.assertEqual(list(uploads.iterdir()), [])

    def test_upload_installs_valid_zip_and_cleans_temp_file(self):
        good_zip = plugin_archive(name="uploaded-plugin", version="0.1.0", root="uploaded-plugin")
        response = self.client.post(
            "/api/market/plugins/install-upload",
            data={"file": (BytesIO(good_zip), "uploaded-plugin.zip")},
            content_type="multipart/form-data",
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 200, body)
        self.assertEqual(body["plugin_name"], "uploaded-plugin")
        self.assertEqual(body["version"], "0.1.0")

        task = self._wait_for_task("uploaded-plugin")
        self.assertEqual(task["status"], "completed")
        self.assertTrue(task["enabled"])
        self.assertEqual(task["source_used"], "upload")
        self.assertTrue((self.community / "uploaded-plugin" / "index.js").is_file())
        self.assertIn("community/uploaded-plugin", self._enabled_list())
        uploads = self.community / self.marketplace.UPLOAD_DIR_NAME
        self.assertEqual(list(uploads.iterdir()), [])

    def test_upload_requires_file(self):
        response = self.client.post("/api/market/plugins/install-upload", data={}, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 400)

    # ---------- 设置接口 ----------

    def test_settings_roundtrip_and_validation(self):
        response = self.client.get("/api/market/settings")
        body = response.get_json()
        self.assertTrue(body["success"])
        self.assertEqual(body["settings"]["github_mirror_mode"], "auto")
        self.assertIn("https://ghfast.top", body["builtin_mirrors"])
        self.assertIn("python_path", body["tools"])

        bad = self.client.post("/api/market/settings", json={"github_mirror_mode": "fixed"})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("github_mirror", bad.get_json()["error"])

        good = self.client.post(
            "/api/market/settings",
            json={"github_mirror_mode": "fixed", "github_mirror": "https://ghfast.top/",
                  "pip_index_url": "https://pypi.tuna.tsinghua.edu.cn/simple"},
        )
        self.assertEqual(good.status_code, 200, good.get_json())
        saved = good.get_json()["settings"]
        self.assertEqual(saved["github_mirror"], "https://ghfast.top")

        again = self.client.get("/api/market/settings").get_json()["settings"]
        self.assertEqual(again["pip_index_url"], "https://pypi.tuna.tsinghua.edu.cn/simple")


if __name__ == "__main__":
    unittest.main()
