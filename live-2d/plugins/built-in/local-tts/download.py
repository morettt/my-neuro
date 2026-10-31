"""TTS DLC 安装：复用旧包，按显卡选择版本，在项目盘下载和解压。"""
import errno
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

BUNDLE = Path('tts-hub/GPT-SoVITS-Bundle')
CHECKS = ('runtime/python.exe', 'api.py', 'GPT_SoVITS',
          'role_voice_api/neuro/merge.pth', 'role_voice_api/neuro/01.wav')
ARCHIVE_NAME = 'GPT-SoVITS-Bundle.7z'
STANDARD_MODEL = 'morelle/fake-neuro-gsv'
RTX50_MODEL = 'morelle/fake-neuro-gsv-50'


def ready(root):
    return all((Path(root) / BUNDLE / name).exists() for name in CHECKS)


def windows_options():
    return {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}


def select_model():
    probes = (
        ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
        ['wmic', 'path', 'win32_VideoController', 'get', 'name'],
        ['powershell', '-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
    )
    for command in probes:
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=15, **windows_options())
            if result.returncode == 0 and result.stdout.strip():
                return RTX50_MODEL if re.search(r'RTX\s*50\d\d', result.stdout, re.I) else STANDARD_MODEL
        except (OSError, subprocess.TimeoutExpired):
            continue
    return STANDARD_MODEL


def check_space(root, required):
    free = shutil.disk_usage(root).free
    required += 64 * 1024 * 1024
    if free < required:
        raise OSError(errno.ENOSPC, f'磁盘空间不足：{root}，剩余 {free / 1024**3:.2f} GB，至少需要 {required / 1024**3:.2f} GB')


def archive_size_and_validate(archive, target):
    import py7zr
    target = Path(target).resolve()
    with py7zr.SevenZipFile(archive, 'r') as package:
        for name in package.getnames():
            destination = (target / name).resolve()
            if not destination.is_relative_to(target):
                raise RuntimeError(f'DLC 压缩包路径无效：{name}')
        return package.archiveinfo().uncompressed


def seven_zip_tool():
    import requests
    legacy_tool = Path(os.environ['MY_NEURO_FULL_HUB_DIR']) / '7z/7z.exe'
    if legacy_tool.is_file():
        return legacy_tool
    cache = Path(os.environ['TEMP']).parent
    tool = cache / 'tools/7zr.exe'
    if tool.is_file():
        return tool
    tool.parent.mkdir(parents=True, exist_ok=True)
    partial = tool.with_suffix('.download')
    try:
        with requests.get('https://www.7-zip.org/a/7zr.exe', stream=True, timeout=30) as response:
            response.raise_for_status()
            total = int(response.headers.get('content-length', 0))
            check_space(tool.parent, total)
            with partial.open('wb') as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        output.write(chunk)
        partial.replace(tool)
        return tool
    finally:
        partial.unlink(missing_ok=True)


def extract(archive, target):
    size = archive_size_and_validate(archive, target)
    check_space(target, size)
    tool = seven_zip_tool()
    print('@@DLC_EXTRACT_START', flush=True)
    print('正在解压 TTS 模型包及独立运行环境…', flush=True)
    process = subprocess.Popen([str(tool), 'x', str(archive), f'-o{target}', '-y', '-bsp1', '-bso1', '-bse1'],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **windows_options())
    # 原样转发 7-Zip 的回车进度，不等到整个解压进程退出。
    tail = b''
    while True:
        chunk = process.stdout.read(1)
        if not chunk:
            break
        tail = (tail + chunk)[-4096:]
        print(chunk.decode('utf-8', errors='replace'), end='', flush=True)
    code = process.wait()
    print('', flush=True)
    if code:
        message = tail.decode('utf-8', errors='replace')
        if re.search(r'not enough space|no space left|磁盘空间不足', message, re.I):
            raise OSError(errno.ENOSPC, f'磁盘空间不足：{target}')
        raise RuntimeError(f'TTS 解压失败（{code}）：{message}')


def download():
    root = Path(os.environ['MY_NEURO_PLUGIN_DLC_DIR'])
    legacy = Path(os.environ['MY_NEURO_FULL_HUB_DIR'])
    print('@@MODULE_START:tts', flush=True)
    if ready(legacy) or ready(root):
        print('已有完整 TTS 模型包及独立运行环境，直接复用', flush=True)
        print('@@MODULE_DONE:tts', flush=True)
        return
    target = root / 'tts-hub'
    target.mkdir(parents=True, exist_ok=True)
    model = select_model()
    print(f'开始下载 {model}', flush=True)
    from modelscope.hub.snapshot_download import snapshot_download
    for attempt in range(3):
        try:
            snapshot_download(model, local_dir=str(target))
            if not ready(root):
                archive = target / ARCHIVE_NAME
                if not archive.is_file():
                    raise RuntimeError(f'TTS DLC 不完整：缺少 {ARCHIVE_NAME}')
                extract(archive, target)
            if not ready(root):
                raise RuntimeError('TTS DLC 解压后文件不完整')
            (target / ARCHIVE_NAME).unlink(missing_ok=True)
            print('@@MODULE_DONE:tts', flush=True)
            return
        except Exception as error:
            if isinstance(error, OSError) and error.errno == errno.ENOSPC:
                raise
            if attempt == 2:
                raise
            print('安装失败，5 秒后重试…', flush=True)
            time.sleep(5)


if __name__ == '__main__':
    try:
        download()
    except Exception:
        print('@@MODULE_FAIL:tts', flush=True)
        raise
