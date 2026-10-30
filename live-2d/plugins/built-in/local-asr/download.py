"""ASR DLC 安装器；新资源及缓存都位于项目盘。"""
import errno
import os
from pathlib import Path
import shutil
import time

from models import COMPONENTS, component_ready, resources_ready


def download():
    root = Path(os.environ["MY_NEURO_PLUGIN_DLC_DIR"])
    legacy = Path(os.environ["MY_NEURO_FULL_HUB_DIR"])
    print("@@MODULE_START:asr", flush=True)
    if resources_ready(legacy):
        print("已有完整 ASR 模型，直接复用", flush=True)
        print("@@MODULE_DONE:asr", flush=True)
        return

    for component in COMPONENTS:
        target = root / component["path"]
        print(f"正在准备{component['name']}", flush=True)
        if component_ready(root, component):
            print(f"{component['name']}已存在，跳过下载", flush=True)
            continue
        if component_ready(legacy, component):
            shutil.copytree(legacy / component["path"], target, dirs_exist_ok=True)
            print(f"已复用原有{component['name']}", flush=True)
            continue

        from modelscope.hub.snapshot_download import snapshot_download
        for attempt in range(3):
            try:
                options = {"local_dir": str(target)}
                if component.get("revision"):
                    options["revision"] = component["revision"]
                print(f"开始下载 {component['repo']}", flush=True)
                snapshot_download(component["repo"], **options)
                if not component_ready(root, component):
                    raise RuntimeError(f"{component['name']}文件不完整")
                break
            except Exception as error:
                if isinstance(error, OSError) and error.errno == errno.ENOSPC:
                    print(f"磁盘空间不足：{target}", flush=True)
                    raise
                if attempt == 2:
                    raise
                print("下载失败，5 秒后重试…", flush=True)
                time.sleep(5)
    if not resources_ready(root):
        raise RuntimeError("ASR DLC 模型文件不完整")
    print("@@MODULE_DONE:asr", flush=True)


if __name__ == "__main__":
    try:
        download()
    except Exception:
        print("@@MODULE_FAIL:asr", flush=True)
        raise
