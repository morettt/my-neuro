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
from models import COMPONENTS, resources_ready


def create_component(root, component):
    for name in component['files']:
        file = Path(root) / component['path'] / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('fixture', encoding='utf-8')


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / 'plugins-dlc/local-asr'
        self.legacy = self.root / 'full-hub'

    def run_download(self, snapshot):
        module = types.ModuleType('modelscope.hub.snapshot_download')
        module.snapshot_download = snapshot
        with patch.dict(os.environ, MY_NEURO_PLUGIN_DLC_DIR=str(self.target), MY_NEURO_FULL_HUB_DIR=str(self.legacy)), \
             patch.dict(sys.modules, {'modelscope.hub.snapshot_download': module}), \
             patch.object(installer.time, 'sleep'), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            installer.download()
        return output.getvalue()

    def snapshot(self, repo, local_dir, **options):
        component = next(item for item in COMPONENTS if item['repo'] == repo)
        self.assertEqual(Path(local_dir), self.target / component['path'])
        if repo == COMPONENTS[2]['repo']:
            self.assertEqual(options['revision'], 'v2.0.4')
        create_component(self.target, component)

    def test_new_install_downloads_all_three_models_to_dlc(self):
        snapshot = Mock(side_effect=self.snapshot)
        self.assertIn('@@MODULE_DONE:asr', self.run_download(snapshot))
        self.assertEqual(snapshot.call_count, 3)
        self.assertTrue(resources_ready(self.target))

    def test_install_checks_match_plugin_declaration(self):
        metadata = json.loads(Path(__file__).with_name('metadata.json').read_text(encoding='utf-8'))
        expected = [f"{item['path']}/{name}" for item in COMPONENTS for name in item['files']]
        self.assertEqual(metadata['localService']['checks'], expected)

    def test_complete_legacy_models_are_reused_without_copy_or_download(self):
        for component in COMPONENTS:
            create_component(self.legacy, component)
        snapshot = Mock(side_effect=AssertionError('must not download'))
        self.run_download(snapshot)
        snapshot.assert_not_called()
        self.assertFalse(self.target.exists())

    def test_partial_legacy_models_are_reused_and_missing_components_downloaded(self):
        create_component(self.legacy, COMPONENTS[0])
        snapshot = Mock(side_effect=self.snapshot)
        self.run_download(snapshot)
        self.assertEqual(snapshot.call_count, 2)
        self.assertTrue(resources_ready(self.target))
        self.assertTrue((self.legacy / COMPONENTS[0]['path']).is_dir())

    def test_installed_dlc_is_not_downloaded_again(self):
        for component in COMPONENTS:
            create_component(self.target, component)
        snapshot = Mock()
        self.run_download(snapshot)
        snapshot.assert_not_called()

    def test_missing_weights_are_rejected_and_retried(self):
        snapshot = Mock()
        with self.assertRaisesRegex(RuntimeError, '文件不完整'):
            self.run_download(snapshot)
        self.assertEqual(snapshot.call_count, 3)

    def test_disk_full_stops_without_retry(self):
        snapshot = Mock(side_effect=OSError(errno.ENOSPC, 'No space left on device'))
        with self.assertRaises(OSError):
            self.run_download(snapshot)
        self.assertEqual(snapshot.call_count, 1)


if __name__ == '__main__':
    unittest.main()
