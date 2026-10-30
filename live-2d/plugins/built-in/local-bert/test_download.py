import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bert_download", Path(__file__).with_name("download.py"))
downloader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloader)


class DownloadTests(unittest.TestCase):
    def run_download(self, root, snapshot):
        module = types.ModuleType("modelscope.hub.snapshot_download")
        module.snapshot_download = snapshot
        with patch.dict(os.environ, MY_NEURO_FULL_HUB_DIR=root), \
             patch.dict(sys.modules, {"modelscope.hub.snapshot_download": module}), \
             patch.object(downloader.time, "sleep"), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            downloader.download()
        return output.getvalue()

    def test_existing_model_is_reused(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "bert-hub"
            target.mkdir()
            for name in downloader.MODEL_FILES:
                (target / name).write_text("existing")
            def unexpected(*args, **kwargs):
                self.fail("Existing model must not be downloaded again")
            self.assertIn("@@MODULE_DONE:bert", self.run_download(root, unexpected))

    def test_new_model_download_and_validation(self):
        with tempfile.TemporaryDirectory() as root:
            def snapshot(model, local_dir):
                self.assertEqual(model, "morelle/Omni_fn_bert")
                target = Path(local_dir)
                target.mkdir(parents=True)
                for name in downloader.MODEL_FILES:
                    (target / name).write_text("downloaded")
            self.assertIn("@@MODULE_DONE:bert", self.run_download(root, snapshot))

    def test_incomplete_download_fails(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(RuntimeError, "模型文件不完整"):
                self.run_download(root, lambda *args, **kwargs: None)

    def test_new_install_writes_to_dlc_directory(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "plugins-dlc/local-bert"
            def snapshot(model, local_dir):
                self.assertEqual(Path(local_dir), target / "bert-hub")
                Path(local_dir).mkdir(parents=True)
                for name in downloader.MODEL_FILES:
                    (Path(local_dir) / name).write_text("new")
            with patch.dict(os.environ, MY_NEURO_PLUGIN_DLC_DIR=str(target)):
                self.assertIn("@@MODULE_DONE:bert", self.run_download(root, snapshot))


if __name__ == "__main__":
    unittest.main()
