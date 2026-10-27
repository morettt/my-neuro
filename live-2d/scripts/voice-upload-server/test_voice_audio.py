"""Run with the website's existing Python environment before deployment."""
import importlib.util
import os
from pathlib import Path
import tempfile
import time
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location('voice_audio', Path(__file__).with_name('voice_audio.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AudioUploadTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        module.UPLOAD_DIR = root / 'audio'
        module.TOKEN_FILE = root / 'token'
        module.TOKEN_FILE.write_text('unit-test-token')
        self.headers = {'Authorization': 'Bearer unit-test-token'}
        app = FastAPI()
        app.include_router(module.router)
        self.client = TestClient(app)
        self.audio = b'RIFF' + b'\x24\x00\x00\x00' + b'WAVEfmt ' + b'\0' * 32

    def tearDown(self):
        self.client.close()
        self.directory.cleanup()

    def test_rejects_unauthorized_upload(self):
        response = self.client.post('/api/voice-audio?format=wav', content=self.audio)
        self.assertEqual(response.status_code, 401)
        self.assertFalse(module.UPLOAD_DIR.exists())

    def test_round_trip_and_expiry(self):
        response = self.client.post('/api/voice-audio?format=wav', headers=self.headers, content=self.audio)
        self.assertEqual(response.status_code, 200)
        url = response.json()['url']
        self.assertTrue(url.startswith('https://mynewbot.com/api/voice-audio/'))
        downloaded = self.client.get(url)
        self.assertEqual(downloaded.content, self.audio)
        self.assertEqual(downloaded.headers['content-type'], 'audio/wav')
        file = next(module.UPLOAD_DIR.iterdir())
        expired = time.time() - module.TTL - 1
        os.utime(file, (expired, expired))
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_rejects_non_audio_and_cleans_partial_file(self):
        response = self.client.post('/api/voice-audio?format=wav', headers=self.headers, content=b'<html>no audio</html>')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(list(module.UPLOAD_DIR.iterdir()), [])

    def test_rejects_oversized_upload(self):
        response = self.client.post('/api/voice-audio?format=mp3', headers=self.headers, content=b'ID3' + b'\0' * module.MAX_BYTES)
        self.assertEqual(response.status_code, 413)

    def test_rejects_unknown_format_and_invalid_name(self):
        self.assertEqual(self.client.post('/api/voice-audio?format=exe', headers=self.headers).status_code, 400)
        self.assertEqual(self.client.get('/api/voice-audio/app.py').status_code, 404)


if __name__ == '__main__':
    unittest.main()
