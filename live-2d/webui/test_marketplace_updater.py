import json
import subprocess
import tempfile
import unittest
import urllib.error
import zipfile
from io import BytesIO
from pathlib import Path


def make_archive(files):
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return buffer.getvalue()


def plugin_archive(name="demo", version="1.2.0", root="demo-main", extra=None, metadata_extra=None):
    metadata = {"name": name, "version": version}
    if metadata_extra:
        metadata.update(metadata_extra)
    files = {
        f"{root}/metadata.json": json.dumps(metadata),
        f"{root}/index.js": "module.exports = class Demo {};",
    }
    if extra:
        files.update({f"{root}/{path}": content for path, content in extra.items()})
    return make_archive(files)


class FakeResponse:
    def __init__(self, body=b"", status=200, headers=None):
        self._body = body
        self.status = status
        self.headers = headers or {}
        self._offset = 0

    def read(self, size=-1):
        if size is None or size < 0:
            chunk = self._body[self._offset:]
            self._offset = len(self._body)
            return chunk
        chunk = self._body[self._offset:self._offset + size]
        self._offset += len(chunk)
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    """按 URL 规则回应的假 HTTP 层，记录每一次请求。"""

    def __init__(self, rules):
        self.rules = rules
        self.calls = []

    def __call__(self, request, timeout):
        url = request.full_url
        method = request.get_method()
        self.calls.append((method, url, timeout))
        for predicate, handler in self.rules:
            if predicate(url):
                result = handler(method, url)
                if isinstance(result, Exception):
                    raise result
                return result
        raise urllib.error.URLError("no rule for " + url)


class MarketplaceUpdaterTests(unittest.TestCase):
    def setUp(self):
        try:
            from webui import marketplace_updater
        except ImportError as exc:
            self.fail(f"marketplace_updater module missing: {exc}")
        self.updater = marketplace_updater

    def _archive_bytes(self, files):
        return make_archive(files)

    # ---------- 地址解析与来源计划 ----------

    def test_parse_github_repo_accepts_common_repo_urls(self):
        cases = [
            ("https://github.com/example/my-plugin", ("example", "my-plugin")),
            ("https://github.com/example/my-plugin.git", ("example", "my-plugin")),
            ("https://github.com/example/my-plugin/tree/dev", ("example", "my-plugin")),
            ("https://github.com/example/my-plugin/", ("example", "my-plugin")),
        ]

        for url, expected in cases:
            with self.subTest(url=url):
                self.assertEqual(self.updater.parse_github_repo(url), expected)

    def test_archive_candidates_prefer_head_zip_and_respect_branch(self):
        self.assertEqual(
            self.updater.archive_candidates("https://github.com/example/demo"),
            [
                "https://github.com/example/demo/archive/HEAD.zip",
                "https://github.com/example/demo/archive/refs/heads/main.zip",
                "https://github.com/example/demo/archive/refs/heads/master.zip",
            ],
        )
        self.assertEqual(
            self.updater.archive_candidates("https://github.com/example/demo/tree/dev"),
            ["https://github.com/example/demo/archive/refs/heads/dev.zip"],
        )

    def test_github_source_plan_modes(self):
        from webui.market_settings import BUILTIN_GITHUB_MIRRORS

        self.assertEqual(self.updater.github_source_plan({"github_mirror_mode": "direct"}), [None])
        self.assertEqual(
            self.updater.github_source_plan(
                {"github_mirror_mode": "fixed", "github_mirror": "https://mirror.example/"}
            ),
            ["https://mirror.example", None],
        )
        self.assertEqual(
            self.updater.github_source_plan({"github_mirror_mode": "auto"}),
            [None, *BUILTIN_GITHUB_MIRRORS],
        )

    def test_apply_mirror_only_touches_github_hosts(self):
        mirror = "https://ghfast.top"
        self.assertEqual(
            self.updater.apply_mirror("https://github.com/a/b/archive/HEAD.zip", mirror),
            "https://ghfast.top/https://github.com/a/b/archive/HEAD.zip",
        )
        self.assertEqual(
            self.updater.apply_mirror("https://raw.githubusercontent.com/a/b/HEAD/metadata.json", mirror),
            "https://ghfast.top/https://raw.githubusercontent.com/a/b/HEAD/metadata.json",
        )
        self.assertEqual(
            self.updater.apply_mirror("https://api.github.com/repos/a/b", mirror),
            "https://api.github.com/repos/a/b",
        )
        self.assertEqual(
            self.updater.apply_mirror("https://my-hub.example/index.json", mirror),
            "https://my-hub.example/index.json",
        )

    # ---------- 下载：探测与镜像回退 ----------

    def test_download_archive_falls_back_to_mirror_when_direct_is_unreachable(self):
        archive = plugin_archive()
        opener = FakeOpener([
            (lambda url: url.startswith("https://ghfast.top/"), lambda method, url: FakeResponse(archive)),
            (lambda url: True, lambda method, url: urllib.error.URLError("timed out")),
        ])

        data, source = self.updater.download_archive(
            "https://github.com/example/demo",
            settings={"github_mirror_mode": "auto"},
            opener=opener,
        )

        self.assertEqual(data, archive)
        self.assertEqual(source, "ghfast.top")
        urls = [url for _method, url, _timeout in opener.calls]
        self.assertFalse(any("api.github.com" in url for url in urls))
        # 直连的三个候选都只做过一次短超时探测，没有拖到长超时下载
        direct_calls = [call for call in opener.calls if call[1].startswith("https://github.com/")]
        self.assertEqual(len(direct_calls), 3)
        self.assertTrue(all(call[0] == "HEAD" and call[2] == self.updater.PROBE_TIMEOUT for call in direct_calls))
        # 镜像：先探测再正式下载，正式下载用长超时
        mirror_calls = [call for call in opener.calls if call[1].startswith("https://ghfast.top/")]
        self.assertEqual([call[0] for call in mirror_calls], ["HEAD", "GET"])
        self.assertEqual(mirror_calls[-1][2], self.updater.DOWNLOAD_TIMEOUT)

    def test_download_archive_direct_mode_never_uses_mirrors(self):
        opener = FakeOpener([(lambda url: True, lambda method, url: urllib.error.URLError("down"))])
        with self.assertRaises(self.updater.DownloadError):
            self.updater.download_archive(
                "https://github.com/example/demo",
                settings={"github_mirror_mode": "direct"},
                opener=opener,
            )
        self.assertTrue(all(url.startswith("https://github.com/") for _m, url, _t in opener.calls))

    def test_download_archive_fixed_mode_falls_back_to_direct(self):
        archive = plugin_archive()
        opener = FakeOpener([
            (lambda url: url.startswith("https://mirror.example/"), lambda method, url: urllib.error.URLError("mirror down")),
            (lambda url: True, lambda method, url: FakeResponse(archive)),
        ])
        data, source = self.updater.download_archive(
            "https://github.com/example/demo",
            settings={"github_mirror_mode": "fixed", "github_mirror": "https://mirror.example"},
            opener=opener,
        )
        self.assertEqual(data, archive)
        self.assertEqual(source, "direct")
        self.assertTrue(opener.calls[0][1].startswith("https://mirror.example/"))

    def test_probe_url_falls_back_to_range_get_when_head_rejected(self):
        def handler(method, url):
            if method == "HEAD":
                return urllib.error.HTTPError(url, 405, "Method Not Allowed", None, None)
            return FakeResponse(b"x", status=206)

        opener = FakeOpener([(lambda url: True, handler)])
        self.assertTrue(self.updater.probe_url("https://github.com/a/b/archive/HEAD.zip", opener=opener))
        self.assertEqual([call[0] for call in opener.calls], ["HEAD", "GET"])
        self.assertEqual(opener.calls[1][2], self.updater.PROBE_TIMEOUT)

    def test_download_archive_rejects_oversized_content_length(self):
        opener = FakeOpener([
            (lambda url: True, lambda method, url: FakeResponse(b"zip", headers={"Content-Length": str(10 ** 9)})),
        ])
        with self.assertRaises(self.updater.ArchiveTooLargeError):
            self.updater.download_archive(
                "https://github.com/example/demo",
                settings={"github_mirror_mode": "direct"},
                opener=opener,
            )

    def test_fetch_remote_metadata_with_source_uses_mirror_after_direct_failure(self):
        metadata = json.dumps({"name": "demo", "version": "2.0.0"}).encode("utf-8")
        opener = FakeOpener([
            (lambda url: url.startswith("https://gh-proxy.com/"), lambda method, url: FakeResponse(metadata)),
            (lambda url: True, lambda method, url: urllib.error.URLError("blocked")),
        ])
        result, source = self.updater.fetch_remote_metadata_with_source(
            "https://github.com/example/demo",
            settings={"github_mirror_mode": "auto"},
            opener=opener,
        )
        self.assertEqual(result["version"], "2.0.0")
        self.assertEqual(source, "gh-proxy.com")
        self.assertFalse(any("api.github.com" in url for _m, url, _t in opener.calls))

    # ---------- 更新检查 ----------

    def test_check_updates_compares_local_and_remote_metadata_versions(self):
        plugins = [
            {
                "name": "demo",
                "repo": "https://github.com/example/demo",
                "version": "1.0.0",
                "installed": True,
            },
            {
                "name": "fresh",
                "repo": "https://github.com/example/fresh",
                "version": "2.0.0",
                "installed": True,
            },
        ]

        def fake_fetch(repo_url):
            if repo_url.endswith("/demo"):
                return {"version": "1.2.0"}
            return {"version": "2.0.0"}

        result = self.updater.check_updates_for_plugins(
            plugins,
            fetch_metadata=fake_fetch,
            max_workers=1,
        )

        self.assertTrue(result["demo"]["has_update"])
        self.assertEqual(result["demo"]["latest_version"], "1.2.0")
        self.assertFalse(result["fresh"]["has_update"])
        self.assertEqual(result["fresh"]["latest_version"], "2.0.0")

    # ---------- 插件包校验 ----------

    def test_validate_plugin_metadata_rules(self):
        validate = self.updater.validate_plugin_metadata
        info = validate({"name": "my-plugin", "version": "1.0.0", "lang": "python"})
        self.assertEqual(info["entry"], "index.py")
        self.assertEqual(validate({"name": "x", "version": "1", "main": "src/main.js"})["entry"], "src/main.js")

        for bad in (
            {"version": "1.0.0"},
            {"name": "", "version": "1.0.0"},
            {"name": "bad name", "version": "1.0.0"},
            {"name": "-lead", "version": "1.0.0"},
            {"name": "ok", "version": ""},
            {"name": "ok", "version": "1.0.0", "lang": "ruby"},
            {"name": "ok", "version": "1.0.0", "main": "../evil.js"},
        ):
            with self.subTest(bad=bad):
                with self.assertRaises(self.updater.PluginValidationError):
                    validate(bad)

    def test_inspect_plugin_archive_bytes_rejects_bad_packages(self):
        inspect = self.updater.inspect_plugin_archive_bytes
        with self.assertRaisesRegex(self.updater.PluginValidationError, "metadata.json"):
            inspect(make_archive({"demo-main/index.js": "x"}))
        with self.assertRaisesRegex(self.updater.PluginValidationError, "入口文件"):
            inspect(make_archive({"demo-main/metadata.json": json.dumps({"name": "demo", "version": "1"})}))
        with self.assertRaises(self.updater.PluginValidationError):
            inspect(b"not a zip at all")
        with self.assertRaises(self.updater.ArchiveTooLargeError):
            inspect(b"x", max_bytes=0)

        result = inspect(plugin_archive(name="demo", version="3.0.0"))
        self.assertEqual(result["info"]["name"], "demo")
        self.assertEqual(result["root"], "demo-main")

    # ---------- 依赖：pip 预检 ----------

    def test_plan_requirements_install_modes(self):
        plan = self.updater.plan_requirements_install
        with tempfile.TemporaryDirectory() as tmp:
            req = Path(tmp) / "requirements.txt"

            req.write_text("requests>=2.0\n# comment\npackaging\n", encoding="utf-8")
            installed = {"requests": "2.31.0", "packaging": "25.0"}
            self.assertEqual(plan(req, installed)["mode"], "skip")

            result = plan(req, {"packaging": "25.0"})
            self.assertEqual(result["mode"], "partial")
            self.assertEqual(result["missing"], ["requests>=2.0"])

            result = plan(req, {"requests": "1.0.0", "packaging": "25.0"})
            self.assertEqual(result["mode"], "partial")
            self.assertEqual(result["missing"], ["requests>=2.0"])

            self.assertEqual(plan(req, None)["mode"], "full")

            req.write_text("-e git+https://example/repo.git#egg=x\nrequests\n", encoding="utf-8")
            self.assertEqual(plan(req, installed)["mode"], "full")

            req.write_text("requests[socks]\n", encoding="utf-8")
            self.assertEqual(plan(req, installed)["mode"], "full")

            req.write_text('requests; python_version < "2.0"\n', encoding="utf-8")
            self.assertEqual(plan(req, {})["mode"], "skip")
            self.assertEqual(plan(req, {}, python_is_current=False)["mode"], "full")

    def test_pip_cmd_uses_target_python_index_url_and_vendor_wheels(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            (plugin_dir / "requirements.txt").write_text("requests\n", encoding="utf-8")

            cmd = self.updater.pip_install_requirements_cmd(
                plugin_dir,
                settings={"pip_index_url": "https://pypi.tuna.tsinghua.edu.cn/simple"},
                python_exe="C:/py/python.exe",
            )
            self.assertEqual(cmd[:4], ["C:/py/python.exe", "-m", "pip", "install"])
            self.assertIn("--disable-pip-version-check", cmd)
            self.assertEqual(cmd[-2:], ["-i", "https://pypi.tuna.tsinghua.edu.cn/simple"])

            (plugin_dir / "vendor").mkdir()
            (plugin_dir / "vendor" / "x-1.0-py3-none-any.whl").write_bytes(b"")
            cmd = self.updater.pip_install_requirements_cmd(
                plugin_dir,
                settings={"pip_index_url": "https://pypi.tuna.tsinghua.edu.cn/simple"},
                python_exe="C:/py/python.exe",
            )
            self.assertIn("--no-index", cmd)
            self.assertNotIn("-i", cmd)

            self.assertIsNone(
                self.updater.pip_install_requirements_cmd(plugin_dir, plan={"mode": "skip"}, python_exe="py")
            )

    # ---------- 依赖：npm ----------

    def test_node_install_plan_and_cmd(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            self.assertFalse(self.updater.node_install_plan(plugin_dir)["needed"])

            (plugin_dir / "package.json").write_text(json.dumps({"dependencies": {"axios": "^1"}}), encoding="utf-8")
            self.assertTrue(self.updater.node_install_plan(plugin_dir)["needed"])

            (plugin_dir / "node_modules").mkdir()
            self.assertFalse(self.updater.node_install_plan(plugin_dir)["needed"])

            (plugin_dir / "package.json").write_text("{not json", encoding="utf-8")
            plan = self.updater.node_install_plan(plugin_dir)
            self.assertFalse(plan["needed"])
            self.assertTrue(plan.get("warning"))

            cmd = self.updater.npm_install_cmd(
                plugin_dir,
                settings={"npm_registry": "https://registry.npmmirror.com/"},
                npm_prefix=["node", "npm-cli.js"],
            )
            self.assertEqual(cmd[:3], ["node", "npm-cli.js", "install"])
            self.assertIn("--omit=dev", cmd)
            self.assertEqual(cmd[-2:], ["--registry", "https://registry.npmmirror.com/"])
            self.assertIsNone(self.updater.npm_install_cmd(plugin_dir, npm_prefix=[]))

    def test_install_dependencies_skips_pip_when_everything_is_installed(self):
        calls = []

        def runner(cmd, **kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            (plugin_dir / "requirements.txt").write_text("packaging\n", encoding="utf-8")
            stages = []
            warnings = self.updater.install_dependencies(
                plugin_dir,
                report=lambda stage, detail=None: stages.append(stage),
                runner=runner,
                python_exe="py",
                installed_lookup=lambda python_exe: {"packaging": "25.0"},
                npm_prefix=[],
            )
        self.assertEqual(calls, [])
        self.assertEqual(warnings, [])
        self.assertEqual(stages, ["deps_skipped"])

    def test_install_dependencies_installs_only_missing_and_reports_stages(self):
        calls = []

        def runner(cmd, **kwargs):
            calls.append((cmd, kwargs))
            if "-r" in cmd:
                requirements_file = Path(cmd[cmd.index("-r") + 1])
                calls.append(("requirements", requirements_file.read_text(encoding="utf-8")))
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            (plugin_dir / "requirements.txt").write_text("packaging\nsomething-missing==1.0\n", encoding="utf-8")
            (plugin_dir / "package.json").write_text(json.dumps({"dependencies": {"axios": "^1"}}), encoding="utf-8")
            stages = []
            warnings = self.updater.install_dependencies(
                plugin_dir,
                settings={"npm_registry": "https://registry.npmmirror.com/"},
                report=lambda stage, detail=None: stages.append(stage),
                runner=runner,
                python_exe="py",
                installed_lookup=lambda python_exe: {"packaging": "25.0"},
                npm_prefix=["node", "npm-cli.js"],
            )

        self.assertEqual(warnings, [])
        self.assertEqual(stages, ["installing_deps", "installing_node_deps"])
        pip_call = calls[0][0]
        self.assertEqual(pip_call[:4], ["py", "-m", "pip", "install"])
        self.assertEqual(calls[1], ("requirements", "something-missing==1.0\n"))
        npm_call, npm_kwargs = calls[2]
        self.assertEqual(npm_call[:3], ["node", "npm-cli.js", "install"])
        self.assertEqual(Path(npm_kwargs["cwd"]), plugin_dir)
        self.assertEqual(npm_kwargs["env"]["NO_UPDATE_NOTIFIER"], "1")

    def test_install_dependencies_warns_without_npm_but_fails_when_npm_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            (plugin_dir / "package.json").write_text(json.dumps({"dependencies": {"axios": "^1"}}), encoding="utf-8")

            warnings = self.updater.install_dependencies(plugin_dir, runner=lambda *a, **k: None, npm_prefix=[])
            self.assertEqual(len(warnings), 1)
            self.assertIn("未找到 npm", warnings[0])

            def failing_runner(cmd, **kwargs):
                return subprocess.CompletedProcess(cmd, 1, "", "npm ERR! network ECONNRESET")

            with self.assertRaisesRegex(self.updater.DependencyInstallError, "ECONNRESET"):
                self.updater.install_dependencies(plugin_dir, runner=failing_runner, npm_prefix=["node", "npm-cli.js"])

    # ---------- 安装 ----------

    def test_install_plugin_from_archive_reports_source_and_name_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp) / "hub-key"
            stages = []
            result = self.updater.install_plugin_from_archive(
                plugin_dir,
                "https://github.com/example/demo",
                archive_downloader=lambda repo_url: (plugin_archive(name="demo"), "ghfast.top"),
                dependency_installer=lambda path: ["npm 提示"],
                expected_name="hub-key",
                on_stage=stages.append,
            )
            self.assertTrue((plugin_dir / "index.js").is_file())
            self.assertEqual(result["source_used"], "ghfast.top")
            self.assertEqual(stages, ["downloading", "validating", "extracting"])
            self.assertEqual(len(result["warnings"]), 2)
            self.assertIn("metadata.name", result["warnings"][0])
            self.assertEqual(result["warnings"][1], "npm 提示")
            self.assertFalse(any(p.name.startswith(".hub-key.install-") for p in Path(tmp).iterdir()))

    def test_install_plugin_from_archive_rejects_invalid_archive_without_leaving_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp) / "demo"
            with self.assertRaises(self.updater.PluginValidationError):
                self.updater.install_plugin_from_archive(
                    plugin_dir,
                    "https://github.com/example/demo",
                    archive_downloader=lambda repo_url: make_archive({"demo-main/README.md": "no plugin here"}),
                    dependency_installer=lambda path: [],
                )
            self.assertFalse(plugin_dir.exists())
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_install_plugin_from_archive_removes_staging_when_dependencies_fail(self):
        def failing_installer(path):
            raise self.updater.DependencyInstallError("Node 依赖（npm）安装失败：boom")

        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp) / "demo"
            with self.assertRaises(self.updater.DependencyInstallError):
                self.updater.install_plugin_from_archive(
                    plugin_dir,
                    "https://github.com/example/demo",
                    archive_downloader=lambda repo_url: plugin_archive(),
                    dependency_installer=failing_installer,
                )
            self.assertFalse(plugin_dir.exists())
            self.assertEqual(list(Path(tmp).iterdir()), [])

    # ---------- 更新 ----------

    def test_update_plugin_safe_preserves_config_and_replaces_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp) / "demo"
            plugin_dir.mkdir()
            (plugin_dir / "metadata.json").write_text(
                json.dumps({"name": "demo", "version": "1.0.0"}),
                encoding="utf-8",
            )
            (plugin_dir / "index.js").write_text("old", encoding="utf-8")
            (plugin_dir / "plugin_config.json").write_text(
                json.dumps({"api_key": {"value": "keep-me"}}),
                encoding="utf-8",
            )
            (plugin_dir / "old.txt").write_text("old", encoding="utf-8")

            archive_bytes = plugin_archive(version="1.2.0", extra={"new.txt": "new"})

            result = self.updater.update_plugin_safe(
                plugin_dir,
                "demo",
                "https://github.com/example/demo",
                archive_downloader=lambda repo_url: archive_bytes,
                requirements_installer=lambda path: None,
            )

            self.assertEqual(result["version"], "1.2.0")
            self.assertEqual(result["source_used"], "")
            self.assertEqual(result["warnings"], [])
            self.assertFalse((plugin_dir / "old.txt").exists())
            self.assertEqual((plugin_dir / "new.txt").read_text(encoding="utf-8"), "new")
            self.assertEqual(
                json.loads((plugin_dir / "plugin_config.json").read_text(encoding="utf-8")),
                {"api_key": {"value": "keep-me"}},
            )

    def test_update_plugin_safe_preserves_declared_and_common_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp) / "demo"
            (plugin_dir / "data").mkdir(parents=True)
            (plugin_dir / "custom-state").mkdir()
            (plugin_dir / "metadata.json").write_text(
                json.dumps(
                    {
                        "name": "demo",
                        "version": "1.0.0",
                        "persistent_paths": ["custom-state"],
                    }
                ),
                encoding="utf-8",
            )
            (plugin_dir / "index.js").write_text("old", encoding="utf-8")
            (plugin_dir / "plugin_config.json").write_text(
                '{"token":{"value":"keep"}}',
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
            (plugin_dir / "user-cache.db").write_bytes(b"DB")
            (plugin_dir / "old.txt").write_text("stale", encoding="utf-8")

            archive_bytes = plugin_archive(version="2.0.0")

            result = self.updater.update_plugin_safe(
                plugin_dir,
                "demo",
                "https://github.com/example/demo",
                archive_downloader=lambda _repo_url: archive_bytes,
                requirements_installer=lambda _path: None,
            )

            self.assertEqual(
                (plugin_dir / "data" / "state.json").read_text(encoding="utf-8"),
                '{"counter":42}',
            )
            self.assertEqual(
                (plugin_dir / "custom-state" / "user.json").read_text(
                    encoding="utf-8"
                ),
                '{"name":"local"}',
            )
            self.assertEqual((plugin_dir / "user-cache.db").read_bytes(), b"DB")
            self.assertFalse((plugin_dir / "old.txt").exists())
            self.assertTrue(Path(result["backup_path"]).is_dir())

    def test_update_plugin_safe_rolls_back_when_download_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp) / "demo"
            plugin_dir.mkdir()
            (plugin_dir / "metadata.json").write_text(
                json.dumps({"name": "demo", "version": "1.0.0"}),
                encoding="utf-8",
            )
            (plugin_dir / "plugin_config.json").write_text("{}", encoding="utf-8")

            def failing_downloader(repo_url):
                raise RuntimeError("network down")

            with self.assertRaises(RuntimeError):
                self.updater.update_plugin_safe(
                    plugin_dir,
                    "demo",
                    "https://github.com/example/demo",
                    archive_downloader=failing_downloader,
                    requirements_installer=lambda path: None,
                )

            self.assertTrue(plugin_dir.exists())
            self.assertEqual(
                json.loads((plugin_dir / "metadata.json").read_text(encoding="utf-8")),
                {"name": "demo", "version": "1.0.0"},
            )
            self.assertEqual((plugin_dir / "plugin_config.json").read_text(encoding="utf-8"), "{}")
            self.assertFalse((plugin_dir.parent / ".plugin-update-backups").exists())

    def test_update_plugin_safe_rejects_invalid_archive_and_keeps_old_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp) / "demo"
            plugin_dir.mkdir()
            (plugin_dir / "metadata.json").write_text(json.dumps({"name": "demo", "version": "1.0.0"}), encoding="utf-8")
            (plugin_dir / "index.js").write_text("old", encoding="utf-8")

            with self.assertRaises(self.updater.PluginValidationError):
                self.updater.update_plugin_safe(
                    plugin_dir,
                    "demo",
                    "https://github.com/example/demo",
                    archive_downloader=lambda repo_url: make_archive({"demo-main/README.md": "nope"}),
                    requirements_installer=lambda path: None,
                )
            self.assertEqual((plugin_dir / "index.js").read_text(encoding="utf-8"), "old")
            self.assertEqual([p.name for p in Path(tmp).iterdir()], ["demo"])


if __name__ == "__main__":
    unittest.main()
