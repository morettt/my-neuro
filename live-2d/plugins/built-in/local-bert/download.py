"""安装 BERT DLC，保留对旧模型目录的兼容。"""
import os
from pathlib import Path
import time
import errno

MODEL_FILES = ("config.json", "model.safetensors", "vocab.txt")


def download():
    root = Path(os.environ.get("MY_NEURO_PLUGIN_DLC_DIR") or os.environ["MY_NEURO_FULL_HUB_DIR"])
    target = root / "bert-hub"
    legacy = Path(os.environ["MY_NEURO_FULL_HUB_DIR"]) / "bert-hub"
    print("@@MODULE_START:bert", flush=True)
    if all((legacy / name).is_file() for name in MODEL_FILES):
        print("已有 BERT 模型，直接复用", flush=True)
        print("@@MODULE_DONE:bert", flush=True)
        return
    if not all((target / name).is_file() for name in MODEL_FILES):
        from modelscope.hub.snapshot_download import snapshot_download

        for attempt in range(3):
            try:
                print("开始下载 morelle/Omni_fn_bert", flush=True)
                snapshot_download("morelle/Omni_fn_bert", local_dir=str(target))
                if not all((target / name).is_file() for name in MODEL_FILES):
                    raise RuntimeError("模型文件不完整")
                break
            except Exception as error:
                if isinstance(error, OSError) and error.errno == errno.ENOSPC:
                    print(f"磁盘空间不足：{target}", flush=True)
                    raise
                if attempt == 2:
                    raise
                print("下载失败，5 秒后重试…", flush=True)
                time.sleep(5)
    print("BERT 模型已安装", flush=True)
    print("@@MODULE_DONE:bert", flush=True)


if __name__ == "__main__":
    try:
        download()
    except Exception:
        print("@@MODULE_FAIL:bert", flush=True)
        raise
