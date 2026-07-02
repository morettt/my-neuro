import json
import tempfile
import unittest
import zipfile
from io import BytesIO
from pathlib import Path


class MarketplaceUpdaterTests(unittest.TestCase):
    def setUp(self):
        try:
            from webui import marketplace_updater
        except ImportError as exc:
            self.fail(f"marketplace_updater module missing: {exc}")
        self.updater = marketplace_updater

    def _archive_bytes(self, files):
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for path, content in files.items():
                archive.writestr(path, content)
        return buffer.getvalue()

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

    def test_update_plugin_safe_preserves_config_and_replaces_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp) / "demo"
            plugin_dir.mkdir()
            (plugin_dir / "metadata.json").write_text(
                json.dumps({"name": "demo", "version": "1.0.0"}),
                encoding="utf-8",
            )
            (plugin_dir / "plugin_config.json").write_text(
                json.dumps({"api_key": {"value": "keep-me"}}),
                encoding="utf-8",
            )
            (plugin_dir / "old.txt").write_text("old", encoding="utf-8")

            archive_bytes = self._archive_bytes(
                {
                    "demo-main/metadata.json": json.dumps(
                        {"name": "demo", "version": "1.2.0"}
                    ),
                    "demo-main/new.txt": "new",
                }
            )

            result = self.updater.update_plugin_safe(
                plugin_dir,
                "demo",
                "https://github.com/example/demo",
                archive_downloader=lambda repo_url: archive_bytes,
                requirements_installer=lambda path: None,
            )

            self.assertEqual(result["version"], "1.2.0")
            self.assertFalse((plugin_dir / "old.txt").exists())
            self.assertEqual((plugin_dir / "new.txt").read_text(encoding="utf-8"), "new")
            self.assertEqual(
                json.loads((plugin_dir / "plugin_config.json").read_text(encoding="utf-8")),
                {"api_key": {"value": "keep-me"}},
            )

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


if __name__ == "__main__":
    unittest.main()
