import contextlib
import errno
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

import download as installer


def create_bundle(root):
    for name in installer.CHECKS:
        item = Path(root) / installer.BUNDLE / name
        if name == 'GPT_SoVITS':
            item.mkdir(parents=True, exist_ok=True)
        else:
            item.parent.mkdir(parents=True, exist_ok=True)
            item.write_bytes(b'fixture')


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / 'dlc'
        self.legacy = self.root / 'full-hub'

    def run_download(self, snapshot, extract=None, model=installer.STANDARD_MODEL):
        module = types.ModuleType('modelscope.hub.snapshot_download')
        module.snapshot_download = snapshot
        with patch.dict(os.environ, MY_NEURO_PLUGIN_DLC_DIR=str(self.target), MY_NEURO_FULL_HUB_DIR=str(self.legacy)), \
             patch.dict(sys.modules, {'modelscope.hub.snapshot_download': module}), \
             patch.object(installer, 'select_model', return_value=model), \
             patch.object(installer, 'extract', side_effect=extract), \
             patch.object(installer.time, 'sleep'), contextlib.redirect_stdout(io.StringIO()):
            installer.download()

    def snapshot(self, repo, local_dir):
        (Path(local_dir) / installer.ARCHIVE_NAME).write_bytes(b'archive')

    def test_old_bundle_reused_without_downloading(self):
        create_bundle(self.legacy)
        snapshot = Mock()
        self.run_download(snapshot)
        snapshot.assert_not_called()
        self.assertFalse(self.target.exists())

    def test_new_bundle_extracted_and_archive_removed_only_after_validation(self):
        snapshot = Mock(side_effect=self.snapshot)
        self.run_download(snapshot, lambda *_: create_bundle(self.target), installer.RTX50_MODEL)
        self.assertEqual(snapshot.call_args.args[0], installer.RTX50_MODEL)
        self.assertTrue(installer.ready(self.target))
        self.assertFalse((self.target / 'tts-hub' / installer.ARCHIVE_NAME).exists())

    def test_failed_extraction_retains_archive_for_retry(self):
        snapshot = Mock(side_effect=self.snapshot)
        with self.assertRaisesRegex(RuntimeError, '文件不完整'):
            self.run_download(snapshot, lambda *_: None)
        self.assertEqual(snapshot.call_count, 3)
        self.assertTrue((self.target / 'tts-hub' / installer.ARCHIVE_NAME).exists())

    def test_disk_full_does_not_retry(self):
        snapshot = Mock(side_effect=self.snapshot)
        with self.assertRaises(OSError):
            self.run_download(snapshot, Mock(side_effect=OSError(errno.ENOSPC, 'No space left on device')))
        self.assertEqual(snapshot.call_count, 1)

    def test_gpu_variant_detected_without_download(self):
        for name, expected in [('NVIDIA GeForce RTX 5090', installer.RTX50_MODEL),
                               ('NVIDIA GeForce RTX 4060', installer.STANDARD_MODEL)]:
            with patch.object(installer.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout=name)):
                self.assertEqual(installer.select_model(), expected)

    def test_extraction_space_check(self):
        with patch.object(installer.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=1024)):
            with self.assertRaises(OSError):
                installer.check_space(self.root, 4096)

    def test_native_extraction_streams_progress_and_checks_space_first(self):
        process = Mock()
        process.stdout = io.BytesIO(b' 25%\r 100%\nEverything is Ok\n')
        process.wait.return_value = 0
        with patch.object(installer, 'archive_size_and_validate', return_value=12345), \
             patch.object(installer, 'check_space') as check, \
             patch.object(installer, 'seven_zip_tool', return_value=self.root / '7zr.exe'), \
             patch.object(installer.subprocess, 'Popen', return_value=process) as popen, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            installer.extract(self.root / 'archive.7z', self.root)
        check.assert_called_once_with(self.root, 12345)
        self.assertIn('-bsp1', popen.call_args.args[0])
        self.assertIn('@@DLC_EXTRACT_START', output.getvalue())
        self.assertIn('25%', output.getvalue())
        self.assertIn('100%', output.getvalue())

    def test_archive_paths_and_metadata_checked_before_extracting(self):
        package = Mock()
        package.getnames.return_value = ['GPT-SoVITS-Bundle/api.py']
        package.archiveinfo.return_value = types.SimpleNamespace(uncompressed=12345)
        archive = Mock()
        archive.__enter__ = Mock(return_value=package)
        archive.__exit__ = Mock(return_value=False)
        py7zr = types.ModuleType('py7zr')
        py7zr.SevenZipFile = Mock(return_value=archive)
        with patch.dict(sys.modules, {'py7zr': py7zr}):
            self.assertEqual(installer.archive_size_and_validate('archive.7z', self.root), 12345)
            package.getnames.return_value = ['../outside.txt']
            with self.assertRaisesRegex(RuntimeError, '路径无效'):
                installer.archive_size_and_validate('archive.7z', self.root)
        metadata = json.loads(Path(__file__).with_name('metadata.json').read_text(encoding='utf-8'))
        self.assertEqual(metadata['localService']['checks'], [f'{installer.BUNDLE.as_posix()}/{name}' for name in installer.CHECKS])


if __name__ == '__main__':
    unittest.main()
