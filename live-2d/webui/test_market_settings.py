import json
import tempfile
import unittest
from pathlib import Path


class MarketSettingsTests(unittest.TestCase):
    def setUp(self):
        from webui import market_settings
        self.settings = market_settings
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / ".runtime" / "plugin_market_settings.json"

    def tearDown(self):
        self._tmp.cleanup()

    def test_missing_file_returns_defaults(self):
        loaded = self.settings.load_settings(self.path)
        self.assertEqual(loaded, self.settings.DEFAULTS)
        self.assertIsNot(loaded, self.settings.DEFAULTS)

    def test_corrupted_or_invalid_file_falls_back_to_defaults(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text("{not json", encoding="utf-8")
        self.assertEqual(self.settings.load_settings(self.path), self.settings.DEFAULTS)

        self.path.write_text(json.dumps({"github_mirror_mode": "weird"}), encoding="utf-8")
        self.assertEqual(self.settings.load_settings(self.path), self.settings.DEFAULTS)

    def test_validate_rejects_bad_values_with_field_name(self):
        validate = self.settings.validate_settings
        normalize = self.settings.normalize_settings

        ok, message = validate(normalize({"github_mirror_mode": "fixed"}))
        self.assertFalse(ok)
        self.assertIn("github_mirror", message)

        ok, message = validate(normalize({"github_mirror_mode": "fixed", "github_mirror": "http://insecure"}))
        self.assertFalse(ok)
        self.assertIn("https://", message)

        ok, message = validate(normalize({"github_mirror": "https://mirror.example/some/path"}))
        self.assertFalse(ok)
        self.assertIn("不能带路径", message)

        ok, message = validate(normalize({"pip_index_url": "https://pypi.example/simple index"}))
        self.assertFalse(ok)
        self.assertIn("pip", message)

        ok, message = validate(normalize({"npm_registry": "ftp://registry"}))
        self.assertFalse(ok)
        self.assertIn("npm", message)

        ok, message = validate(normalize({"hub_url": "https://hub.example/plugin hub.json"}))
        self.assertFalse(ok)
        self.assertIn("插件源", message)

        ok, _message = validate(normalize({
            "github_mirror_mode": "fixed",
            "github_mirror": "https://ghfast.top/",
            "pip_index_url": "https://pypi.tuna.tsinghua.edu.cn/simple",
            "npm_registry": "https://registry.npmmirror.com/",
            "hub_url": "https://example.com/hub.json?x=1",
        }))
        self.assertTrue(ok)

    def test_save_merges_normalizes_and_persists(self):
        saved = self.settings.save_settings(
            {"github_mirror_mode": "FIXED", "github_mirror": " https://ghfast.top/ ", "unknown": "x"},
            self.path,
        )
        self.assertEqual(saved["github_mirror_mode"], "fixed")
        self.assertEqual(saved["github_mirror"], "https://ghfast.top")
        self.assertNotIn("unknown", saved)
        self.assertEqual(saved["npm_registry"], self.settings.DEFAULTS["npm_registry"])

        on_disk = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(on_disk, saved)

        # 只改一个字段时其余保留
        saved2 = self.settings.save_settings({"pip_index_url": "https://pypi.tuna.tsinghua.edu.cn/simple"}, self.path)
        self.assertEqual(saved2["github_mirror"], "https://ghfast.top")
        self.assertEqual(saved2["pip_index_url"], "https://pypi.tuna.tsinghua.edu.cn/simple")

    def test_save_invalid_raises_and_does_not_write(self):
        with self.assertRaises(ValueError):
            self.settings.save_settings({"github_mirror_mode": "fixed"}, self.path)
        self.assertFalse(self.path.exists())

        self.settings.save_settings({"github_mirror_mode": "direct"}, self.path)
        with self.assertRaises(ValueError):
            self.settings.save_settings({"pip_index_url": "not-a-url"}, self.path)
        self.assertEqual(self.settings.load_settings(self.path)["github_mirror_mode"], "direct")


if __name__ == "__main__":
    unittest.main()
