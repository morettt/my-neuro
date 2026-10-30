"""验证真实 HTTP/WebSocket 接口，模型推理使用替身，不下载模型。"""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

import numpy as np
from fastapi.testclient import TestClient

from models import COMPONENTS
from test_download import create_component


class ServerTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        for component in COMPONENTS:
            create_component(self.root, component)
        self.hotwords = self.root / 'hotwords.txt'
        self.hotwords.write_text('肥牛 20\n', encoding='utf-8')

    @contextlib.contextmanager
    def server(self, vad_only=False):
        torch = types.ModuleType('torch')
        torch.cuda = types.SimpleNamespace(is_available=lambda: False)
        torch.float32 = 'float32'
        torch.set_default_dtype = Mock()
        torch.FloatTensor = lambda audio: audio
        torch.no_grad = contextlib.nullcontext
        vad = Mock(return_value=types.SimpleNamespace(item=lambda: 0.9))
        torch.hub = types.SimpleNamespace(load=Mock(return_value=(vad, None)))
        asr = Mock()
        asr.generate.return_value = [{'text': '你好肥牛'}]
        punc = Mock()
        punc.generate.return_value = [{'text': '你好，肥牛。'}]
        funasr = types.ModuleType('funasr')
        funasr.AutoModel = Mock(side_effect=[asr, punc])
        auto_module = types.ModuleType('funasr.auto.auto_model')
        auto_module.load_pretrained_model = Mock()
        soundfile = types.ModuleType('soundfile')
        soundfile.read = lambda _: (np.zeros(1600, dtype=np.float32), 16000)
        with patch.dict(os.environ, MY_NEURO_SERVICE_RESOURCE_DIR=str(self.root), MY_NEURO_FULL_HUB_DIR=str(self.root)), \
             patch.dict(sys.modules, {'torch': torch, 'funasr': funasr, 'funasr.auto.auto_model': auto_module, 'soundfile': soundfile}), \
             patch.object(sys, 'argv', ['server.py'] + (['--vad-only'] if vad_only else [])), \
             contextlib.redirect_stdout(io.StringIO()):
            spec = importlib.util.spec_from_file_location('local_asr_server_test', Path(__file__).with_name('server.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            with TestClient(module.app) as client:
                yield client, module, torch, funasr, asr

    def test_upload_contract_and_models_use_local_paths(self):
        with self.server() as (client, module, torch, funasr, asr):
            response = client.post('/v1/upload_audio', files={'file': ('recording.wav', b'audio', 'audio/wav')})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {'status': 'success', 'filename': 'recording.wav', 'text': '你好，肥牛。'})
            self.assertEqual(asr.generate.call_args.kwargs['hotword'], '肥牛 20')
            self.assertEqual(funasr.AutoModel.call_count, 2)
            for call in funasr.AutoModel.call_args_list:
                self.assertTrue(Path(call.kwargs['model']).is_absolute())
                self.assertTrue(call.kwargs['disable_update'])
            self.assertEqual(torch.hub.load.call_args.kwargs['source'], 'local')

    def test_cloud_mode_runs_vad_without_loading_asr_or_punctuation(self):
        # 云端模式无需加载本地识别权重。
        for component in COMPONENTS[1:]:
            (self.root / component['path'] / 'model.pt').unlink()
        with self.server(vad_only=True) as (client, module, torch, funasr, asr):
            funasr.AutoModel.assert_not_called()
            with client.websocket_connect('/v1/ws/vad') as websocket:
                websocket.send_bytes(np.zeros(512, dtype=np.float32).tobytes())
                self.assertEqual(websocket.receive_json(), {'is_speech': True, 'probability': 0.9})
                self.assertEqual(client.get('/vad/status').json()['active_connections'], 1)
            self.assertEqual(client.get('/vad/status').json()['active_connections'], 0)
            response = client.post('/v1/upload_audio', files={'file': ('recording.wav', b'audio')})
            self.assertEqual(response.status_code, 503)

    def test_hotword_reload_preserves_old_file(self):
        with self.server() as (client, module, *_):
            self.assertEqual(client.get('/hotwords').json()['hotwords'], '肥牛 20')
            self.hotwords.write_text('新词 30\n', encoding='utf-8')
            response = client.post('/hotwords/reload')
            self.assertEqual(response.json()['hotwords'], '新词 30')
            self.assertEqual(Path(client.get('/hotwords').json()['file']), self.hotwords)

    def test_shutdown_responds_before_process_exit(self):
        with self.server(vad_only=True) as (client, module, *_):
            with patch.object(module.threading, 'Thread') as thread:
                self.assertEqual(client.post('/shutdown').json(), {'ok': True})
                thread.return_value.start.assert_called_once()

    def test_incomplete_model_fails_startup_without_downloading(self):
        (self.root / COMPONENTS[1]['path'] / 'model.pt').unlink()
        with self.assertRaisesRegex(RuntimeError, '安装 ASR DLC'):
            with self.server():
                self.fail('missing model must prevent startup')


if __name__ == '__main__':
    unittest.main()
