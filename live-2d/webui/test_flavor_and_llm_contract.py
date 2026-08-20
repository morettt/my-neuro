# -*- coding: utf-8 -*-
"""方案 D 门闩：flavor 缺省新版、LLM 双契约、旧 advanced 字段、releases 仍在。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

LIVE2D_ROOT = Path(__file__).resolve().parent.parent
if str(LIVE2D_ROOT) not in sys.path:
    sys.path.insert(0, str(LIVE2D_ROOT))


class FlavorAndLlmContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.config_path = self.root / 'config.json'
        self.provider_path = self.root / 'llm_providers.json'
        self.config_path.write_text(
            json.dumps(
                {
                    'version': '9.9.9',
                    'ui': {},
                    'llm': {
                        'api_key': 'sk-test',
                        'api_url': 'https://example.com/v1',
                        'model': 'demo-model',
                        'system_prompt': 'hi',
                    },
                    'bert': {'enabled': True},
                    'vision': {
                        'use_vision_model': False,
                        'vision_model': {
                            'api_key': 'vis-key',
                            'api_url': 'https://vision.example/v1',
                            'model': 'vl-demo',
                        },
                    },
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding='utf-8',
        )

        from webui import config_manager

        self.cm = config_manager
        self.patches = [
            mock.patch.object(config_manager, 'CONFIG_PATH', self.config_path),
            mock.patch.object(config_manager, 'PROVIDER_STORE_PATH', self.provider_path),
        ]
        for patch in self.patches:
            patch.start()

        from webui.main_app import create_app

        self.app = create_app()
        self.client = self.app.test_client()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        self.tmp.cleanup()

    def test_normalize_flavor_defaults_to_new(self):
        self.assertEqual(self.cm.normalize_webui_flavor(None), 'new')
        self.assertEqual(self.cm.normalize_webui_flavor(''), 'new')
        self.assertEqual(self.cm.normalize_webui_flavor('garbage'), 'new')
        self.assertEqual(self.cm.normalize_webui_flavor('cyber'), 'new')
        self.assertEqual(self.cm.normalize_webui_flavor('classic'), 'old')
        self.assertEqual(self.cm.normalize_webui_flavor('old'), 'old')
        self.assertEqual(self.cm.normalize_webui_flavor('new'), 'new')

    def test_flavor_get_default_is_new_and_roundtrip(self):
        resp = self.client.get('/api/webui/flavor')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json().get('flavor'), 'new')

        resp = self.client.post(
            '/api/webui/flavor',
            json={'flavor': 'old'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json().get('success'))
        self.assertEqual(self.client.get('/api/webui/flavor').get_json().get('flavor'), 'old')

        resp = self.client.post(
            '/api/webui/flavor',
            json={'flavor': 'new'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.client.get('/api/webui/flavor').get_json().get('flavor'), 'new')

        bad = self.client.post('/api/webui/flavor', json={'flavor': 'nope'})
        self.assertEqual(bad.status_code, 400)

    def test_root_defaults_to_new_template(self):
        html = self.client.get('/').get_data(as_text=True)
        self.assertIn('basic-config', html)
        self.assertIn('data-theme', html)
        self.assertIn('/static/new/css/themes.css', html)
        self.assertNotIn('打开肥牛小屋', html)
        self.assertNotIn('switchToNewLayoutBtn', html)

        self.client.post('/api/webui/flavor', json={'flavor': 'old'})
        old_html = self.client.get('/').get_data(as_text=True)
        self.assertIn('switchToNewLayoutBtn', old_html)
        self.assertIn('/static/css/style.css', old_html)
        self.assertNotIn('/static/new/css/themes.css', old_html)

    def test_cloud_hides_voice_clone_on_both_layouts(self):
        with mock.patch('webui.main_app.IS_CLOUD_VERSION', True):
            new_html = self.client.get('/').get_data(as_text=True)
            self.assertNotIn("switchTab('model-manager')", new_html)
            self.client.post('/api/webui/flavor', json={'flavor': 'old'})
            old_html = self.client.get('/').get_data(as_text=True)
            self.assertNotIn("switchTab('model-manager')", old_html)

        self.client.post('/api/webui/flavor', json={'flavor': 'new'})
        with mock.patch('webui.main_app.IS_CLOUD_VERSION', False):
            local_new = self.client.get('/').get_data(as_text=True)
            self.assertIn("switchTab('model-manager')", local_new)
            self.client.post('/api/webui/flavor', json={'flavor': 'old'})
            local_old = self.client.get('/').get_data(as_text=True)
            self.assertIn("switchTab('model-manager')", local_old)
            self.assertIn("switchTab('terminal')", local_old)

    def test_new_locales_have_required_keys(self):
        locales_dir = Path(__file__).resolve().parent / 'static' / 'new' / 'locales'
        for lang in ('zh', 'en'):
            data = json.loads((locales_dir / lang / 'translation.json').read_text(encoding='utf-8'))
            self.assertIn('basic_config', data.get('tabs') or {})
            self.assertIn('persona_config', data.get('tabs') or {})
            self.assertIn('volcengine_title', data.get('cloud_config') or {})
            self.assertIn('pipeline', data.get('overview') or {})
            self.assertIn('title', data.get('releases') or {})
            self.assertNotEqual(data['tabs']['basic_config'], 'tabs.basic_config')

    def test_releases_route_still_registered(self):
        resp = self.client.get('/api/releases')
        self.assertNotEqual(resp.status_code, 404)

    def test_llm_get_is_superset_and_migrates_legacy_fields(self):
        resp = self.client.get('/api/config/llm')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn('api_key', data)
        self.assertIn('providers', data)
        self.assertEqual(data.get('api_key'), 'sk-test')
        self.assertEqual(data.get('api_url'), 'https://example.com/v1')
        self.assertEqual(data.get('model'), 'demo-model')
        self.assertTrue(isinstance(data.get('providers'), list))
        self.assertGreaterEqual(len(data.get('providers') or []), 1)
        self.assertTrue(self.provider_path.exists())

    def test_llm_old_post_writes_into_provider_store(self):
        self.client.get('/api/config/llm')
        resp = self.client.post(
            '/api/config/llm',
            json={
                'api_key': 'sk-new',
                'api_url': 'https://new.example/v1',
                'model': 'new-model',
                'system_prompt': 'hello',
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json().get('success'))
        again = self.client.get('/api/config/llm').get_json()
        self.assertEqual(again.get('api_key'), 'sk-new')
        self.assertEqual(again.get('model'), 'new-model')
        self.assertEqual(again.get('system_prompt'), 'hello')

    def test_llm_new_post_providers_roundtrip(self):
        resp = self.client.post(
            '/api/config/llm',
            json={
                'providers': [
                    {
                        'id': 'main',
                        'name': 'main',
                        'api_key': 'sk-p',
                        'api_url': 'https://p.example/v1',
                        'enabled': True,
                        'models': [{'model_id': 'm1', 'name': 'm1', 'enabled': True}],
                    }
                ],
                'provider_id': 'main',
                'model_id': 'm1',
                'system_prompt': 'from-new',
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = self.client.get('/api/config/llm').get_json()
        self.assertEqual(data.get('provider_id'), 'main')
        self.assertEqual(data.get('model_id'), 'm1')
        self.assertEqual(data.get('api_key'), 'sk-p')
        self.assertEqual(data.get('system_prompt'), 'from-new')

    def test_advanced_keeps_bert_and_vision_model(self):
        data = self.client.get('/api/settings/advanced').get_json()
        self.assertIn('bert_enabled', data)
        self.assertTrue(data.get('bert_enabled'))
        vision = data.get('vision_model') or {}
        self.assertEqual(vision.get('model'), 'vl-demo')

        resp = self.client.post(
            '/api/settings/advanced',
            json={
                'bert_enabled': False,
                'vision_model': {
                    'api_key': 'vis-2',
                    'api_url': 'https://vision2.example/v1',
                    'model': 'vl-2',
                },
                'auto_screenshot': False,
                'use_vision_model': True,
                'show_chat_box': True,
                'show_model': True,
                'voice_barge_in': True,
                'mcp_enabled': True,
            },
        )
        self.assertEqual(resp.status_code, 200)
        again = self.client.get('/api/settings/advanced').get_json()
        self.assertFalse(again.get('bert_enabled'))
        self.assertEqual((again.get('vision_model') or {}).get('model'), 'vl-2')

    def test_system_info_has_both_version_fields(self):
        data = self.client.get('/api/system/info').get_json()
        self.assertIn('neuro_version', data)
        self.assertIn('version', data)
        self.assertEqual(data.get('neuro_version'), '9.9.9')

    def test_overview_and_readiness_do_not_500(self):
        overview = self.client.get('/api/overview')
        self.assertNotEqual(overview.status_code, 500)
        readiness = self.client.get('/api/services/readiness')
        self.assertNotEqual(readiness.status_code, 500)

    def test_runtime_log_route_not_swallowed(self):
        resp = self.client.get('/api/logs/runtime')
        self.assertNotEqual(resp.status_code, 404)
        self.assertIn('logs', resp.get_json() or {})


if __name__ == '__main__':
    unittest.main()
