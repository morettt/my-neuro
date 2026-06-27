import importlib
import os
import unittest
from unittest import mock


class MarketplaceStatsTests(unittest.TestCase):
    def _reload_stats(self, url="", key=""):
        with mock.patch.dict(
            os.environ,
            {
                "MYNEURO_STATS_URL": url,
                "MYNEURO_STATS_KEY": key,
            },
            clear=False,
        ):
            from webui import marketplace_stats

            return importlib.reload(marketplace_stats)

    def test_empty_env_overrides_disable_stats(self):
        stats = self._reload_stats()

        self.assertFalse(stats.STATS_ENABLED)
        self.assertEqual(stats.fetch_stats_map(), {})
        self.assertIsNone(stats.increment_download("demo"))
        self.assertEqual(
            stats.toggle_star("demo"),
            {
                "success": False,
                "error": "stats_disabled",
                "starred": False,
                "stars": 0,
            },
        )

    def test_fetch_stats_map_normalizes_rpc_rows(self):
        stats = self._reload_stats("https://example.supabase.co", "anon-key")

        with mock.patch.object(stats, "_get_machine_id", return_value="device-1"), \
                mock.patch.object(stats, "_rpc", return_value=[
                    {
                        "plugin_name": "demo",
                        "downloads": 12,
                        "stars": 3,
                        "starred": True,
                    },
                    {"plugin_name": "", "downloads": 99, "stars": 99},
                ]) as rpc:
            self.assertEqual(
                stats.fetch_stats_map(force=True),
                {"demo": {"downloads": 12, "stars": 3, "starred": True}},
            )
            rpc.assert_called_once_with("get_all_stats", {"p_device": "device-1"})

    def test_toggle_star_returns_normalized_result(self):
        stats = self._reload_stats("https://example.supabase.co", "anon-key")

        with mock.patch.object(stats, "_get_machine_id", return_value="device-1"), \
                mock.patch.object(stats, "_rpc", return_value={"starred": True, "stars": "5"}):
            self.assertEqual(
                stats.toggle_star("demo"),
                {"success": True, "starred": True, "stars": 5},
            )

    def test_toggle_star_rejects_invalid_name(self):
        stats = self._reload_stats("https://example.supabase.co", "anon-key")

        self.assertEqual(
            stats.toggle_star(""),
            {
                "success": False,
                "error": "invalid_plugin_name",
                "starred": False,
                "stars": 0,
            },
        )


if __name__ == "__main__":
    unittest.main()
