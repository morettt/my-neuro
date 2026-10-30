import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import server
from test_download import create_bundle
from download import BUNDLE


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        create_bundle(self.root)
        self.bundle = self.root / BUNDLE

    def test_default_voice_and_cpu_cuda_arguments_preserved(self):
        for cuda, device in [(True, 'cuda'), (False, 'cpu')]:
            args = server.launch_arguments(self.bundle, {}, cuda)
            self.assertEqual(args[args.index('-d') + 1], device)
            self.assertEqual(args[args.index('-p') + 1], '5000')
            self.assertEqual(args[args.index('-dt') + 1], server.DEFAULT_TEXT)

    def test_custom_reference_text_remains_a_single_argument(self):
        text = 'hello "world" & echo %PATH%\n下一行'
        args = server.launch_arguments(self.bundle, {'model': str(self.bundle / 'role_voice_api/neuro/merge.pth'),
            'reference': str(self.bundle / 'role_voice_api/neuro/01.wav'), 'text': text, 'language': 'zh'}, False)
        self.assertEqual(args[args.index('-dt') + 1], text)
        self.assertEqual(args[-1], 'zh')

    def test_wrapper_runs_api_in_bundle_directory_with_project_cache(self):
        output = self.root / 'launched.json'
        (self.bundle / 'api.py').write_text(
            'import sys,os,json\nfrom pathlib import Path\n'
            f'Path({str(output)!r}).write_text(json.dumps({{"cwd":os.getcwd(),"argv":sys.argv,"temp":os.environ["TEMP"]}}))\n', encoding='utf-8')
        torch = types.ModuleType('torch')
        torch.cuda = types.SimpleNamespace(is_available=lambda: False)
        original_cwd = Path.cwd()
        try:
            with patch.dict(os.environ), patch.dict(sys.modules, {'torch': torch}), \
                 patch.object(sys, 'argv', sys.argv[:]), patch.object(sys, 'path', sys.path[:]), \
                 contextlib.redirect_stdout(io.StringIO()):
                server.main(['--bundle', str(self.bundle)])
        finally:
            os.chdir(original_cwd)
        launched = json.loads(output.read_text())
        self.assertEqual(Path(launched['cwd']), self.bundle)
        self.assertIn('cpu', launched['argv'])
        self.assertTrue(Path(launched['temp']).is_relative_to(Path(__file__).resolve().parents[3]))

    def test_missing_model_fails_before_api_launch(self):
        (self.bundle / 'role_voice_api/neuro/merge.pth').unlink()
        with self.assertRaisesRegex(RuntimeError, '文件缺失'):
            server.launch_arguments(self.bundle, {}, False)


if __name__ == '__main__':
    unittest.main()
