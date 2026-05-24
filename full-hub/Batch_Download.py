import os
import shutil
import zipfile
import time
import warnings

import sys
import platform
import subprocess

# 统一子进程 / 自身的 stdout/stderr 编码为 UTF-8，避免 installer 父进程按 utf-8
# 解码时把 GBK 字节替换成 ? 导致中文乱码。同时把 env/Scripts 加进 PATH，
# 让 modelscope CLI 在没有全局 Python 的机器上也能被找到。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"
_env_dir = os.path.dirname(sys.executable)
_env_scripts = os.path.join(_env_dir, "Scripts")
if os.path.isdir(_env_scripts):
    os.environ["PATH"] = _env_scripts + os.pathsep + os.environ.get("PATH", "")

# modelscope 通过 CLI 子进程调用，不在此脚本顶层 import（避免启动慢 + pkg_resources 警告）。
warnings.filterwarnings("ignore", message=".*pkg_resources is deprecated.*")

import requests
import urllib3
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

system = platform.system()

version_tag = "v6.5.5"

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

current_dir = os.path.dirname(os.path.abspath(__file__))

MAX_RETRY = 3
RETRY_WAIT = 5


def _fmt_bytes(n):
    if n >= 1024 ** 3:
        return f"{n / 1024 ** 3:.2f}G"
    if n >= 1024 ** 2:
        return f"{n / 1024 ** 2:.1f}M"
    if n >= 1024:
        return f"{n / 1024:.0f}K"
    return f"{n}B"


def _cleanup_modelscope_temp(local_dir):
    """清理 modelscope 未完成的 ._____temp 临时文件，避免 resume 卡死。"""
    temp_dir = os.path.join(local_dir, "._____temp")
    if os.path.isdir(temp_dir):
        print(f"[提示] 清理未完成的临时下载: {temp_dir}")
        sys.stdout.flush()
        shutil.rmtree(temp_dir, ignore_errors=True)


class InstallerProgressCallback:
    """modelscope 下载进度回调，输出格式与 installer 进度条正则兼容。"""

    def __init__(self, filename, file_size):
        self.filename = filename
        self.file_size = file_size
        self.downloaded = 0
        self._last_print = 0.0
        size_hint = _fmt_bytes(file_size) if file_size > 0 else "未知大小"
        print(f"正在下载 {filename} ({size_hint})...")
        sys.stdout.flush()

    def update(self, size):
        self.downloaded += size
        now = time.time()
        if now - self._last_print < 0.5:
            if not (self.file_size > 0 and self.downloaded >= self.file_size):
                return
        pct = int(self.downloaded * 100 / self.file_size) if self.file_size > 0 else 0
        dl = _fmt_bytes(self.downloaded)
        total = _fmt_bytes(self.file_size) if self.file_size > 0 else "?"
        sys.stdout.write(f"\rDownloading [{self.filename}]  {pct}%  {dl}/{total}")
        sys.stdout.flush()
        self._last_print = now

    def end(self):
        print()
        sys.stdout.flush()


def _release_modelscope_lock(model_id):
    """清理上次异常退出遗留的 modelscope 文件锁，避免无限等待 acquire lock。"""
    lock_name = model_id.replace("/", "___")
    lock_dir = os.path.join(os.path.expanduser("~"), ".cache", "modelscope", "hub", ".lock")
    lock_file = os.path.join(lock_dir, lock_name)
    if os.path.exists(lock_file):
        try:
            os.remove(lock_file)
            print(f"[提示] 已清理遗留锁: {lock_name}")
            sys.stdout.flush()
        except OSError as e:
            print(f"[警告] 锁文件被占用，请关闭其他安装窗口后重试: {e}")
            sys.stdout.flush()


def download_modelscope(model_id, local_dir, max_retry=MAX_RETRY, wait_time=RETRY_WAIT):
    """通过 modelscope Python API 下载模型，带实时进度（替代无输出的 CLI 子进程）。"""
    from modelscope.hub.snapshot_download import snapshot_download

    local_dir = os.path.abspath(local_dir)
    os.makedirs(local_dir, exist_ok=True)
    _cleanup_modelscope_temp(local_dir)
    _release_modelscope_lock(model_id)

    print(f"开始从 ModelScope 下载: {model_id}")
    print(f"目标目录: {local_dir}")
    sys.stdout.flush()

    for attempt in range(max_retry):
        if attempt > 0:
            print(f"第 {attempt + 1} 次尝试下载 {model_id}...")
            _cleanup_modelscope_temp(local_dir)
            sys.stdout.flush()
        try:
            snapshot_download(
                model_id=model_id,
                local_dir=local_dir,
                progress_callbacks=[InstallerProgressCallback],
            )
            print(f"{model_id} 下载成功!")
            sys.stdout.flush()
            return True
        except Exception as e:
            print(f"[FAIL] {model_id} 下载失败: {e}")
            sys.stdout.flush()
            if attempt < max_retry - 1:
                print(f"等待 {wait_time} 秒后重试...")
                sys.stdout.flush()
                time.sleep(wait_time)
    print(f"经过 {max_retry} 次尝试后，{model_id} 仍然下载失败")
    sys.stdout.flush()
    return False


def display_progress_bar(percent, message="", mb_downloaded=None, mb_total=None, current=None, total=None):
    bar_length = 40
    filled_length = int(bar_length * percent / 100)
    bar = '█' * filled_length + '-' * (bar_length - filled_length)
    extra_info = ""
    if mb_downloaded is not None and mb_total is not None:
        extra_info = f" ({mb_downloaded:.2f}MB/{mb_total:.2f}MB)"
    elif current is not None and total is not None:
        extra_info = f" ({current}/{total}个文件)"
    sys.stdout.write(f"\r{message}: |{bar}| {percent}% 完成{extra_info}")
    sys.stdout.flush()


def download_file(url, file_name=None):
    if file_name is None:
        file_name = url.split('/')[-1]
    print(f"正在下载: {file_name}...")
    session = requests.Session()
    retry_strategy = Retry(
        total=3,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "OPTIONS"]
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    try:
        response = session.get(url, stream=True, headers=headers, timeout=30)
    except requests.exceptions.SSLError:
        print("SSL验证失败，使用不安全模式重新尝试...")
        response = session.get(url, stream=True, headers=headers, timeout=30, verify=False)
    if response.status_code != 200:
        raise RuntimeError(f"HTTP {response.status_code} 不是 200")
    total_size = int(response.headers.get('content-length', 0))
    downloaded_size = 0
    with open(file_name, 'wb') as file:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                file.write(chunk)
                downloaded_size += len(chunk)
                percent = int(downloaded_size * 100 / total_size) if total_size > 0 else 0
                mb_downloaded = downloaded_size / (1024 * 1024)
                mb_total = total_size / (1024 * 1024)
                display_progress_bar(percent, "下载进度", mb_downloaded=mb_downloaded, mb_total=mb_total)
    # 镜像代理（gh-proxy 等）在大文件上经常静默截断，HTTP 200 + 部分数据。
    # 必须校验 Content-Length，否则下游解压会得到 Bad CRC-32 / Bad magic number。
    if total_size > 0 and downloaded_size != total_size:
        try:
            os.remove(file_name)
        except Exception:
            pass
        raise RuntimeError(
            f"下载残缺: 已下载 {downloaded_size} 字节，期望 {total_size} 字节")
    print("\n下载完成!")
    return file_name


def extract_zip(zip_file, target_folder):
    print(f"正在解压 {zip_file} 到 {target_folder}...")
    if not os.path.exists(target_folder):
        os.makedirs(target_folder)
    try:
        with zipfile.ZipFile(zip_file, 'r') as zip_ref:
            file_list = zip_ref.namelist()
            total_files = len(file_list)
            for index, file in enumerate(file_list):
                try:
                    correct_filename = file.encode('cp437').decode('gbk')
                    target_path = os.path.join(target_folder, correct_filename)
                    if os.path.dirname(target_path) and not os.path.exists(os.path.dirname(target_path)):
                        os.makedirs(os.path.dirname(target_path), exist_ok=True)
                    data = zip_ref.read(file)
                    if not correct_filename.endswith('/'):
                        with open(target_path, 'wb') as f:
                            f.write(data)
                except Exception:
                    zip_ref.extract(file)
                    if os.path.exists(file):
                        target_path = os.path.join(target_folder, file)
                        if os.path.dirname(target_path) and not os.path.exists(os.path.dirname(target_path)):
                            os.makedirs(os.path.dirname(target_path), exist_ok=True)
                        shutil.move(file, target_path)
                percent = int((index + 1) * 100 / total_files)
                display_progress_bar(percent, "解压进度", current=index + 1, total=total_files)
        print("\n解压完成!")
        return True
    except zipfile.BadZipFile:
        print("错误: 下载的文件不是有效的ZIP格式")
        return False
    except Exception as e:
        print(f"解压过程中出错: {e}")
        return False


def _ensure_7zr(local_7z):
    """确保本地有可用 7zr.exe。本地优先，缺失时从官方+镜像下载并校验大小。"""
    if os.path.exists(local_7z) and os.path.getsize(local_7z) > 500_000:
        return True

    sevenz_dir = os.path.dirname(local_7z)
    os.makedirs(sevenz_dir, exist_ok=True)

    sources = [
        ("官方", "https://www.7-zip.org/a/7zr.exe"),
        ("香港镜像", "https://hk.gh-proxy.org/https://www.7-zip.org/a/7zr.exe"),
        ("备用镜像", "https://gh-proxy.org/https://www.7-zip.org/a/7zr.exe"),
    ]
    print("本地未发现 7zr.exe，开始联网下载...")
    for src_name, url in sources:
        for attempt in range(1, 4):
            try:
                print(f"  [{src_name}] 第 {attempt} 次尝试: {url}")
                resp = requests.get(url, timeout=30, verify=False)
                if resp.status_code == 200 and len(resp.content) > 500_000:
                    with open(local_7z, "wb") as f:
                        f.write(resp.content)
                    print(f"  [OK] {src_name} 下载成功，大小 {len(resp.content)} 字节")
                    return True
                print(f"  [FAIL] HTTP {resp.status_code}，大小 {len(resp.content)} 字节")
            except Exception as e:
                print(f"  [FAIL] {e}")
            time.sleep(2)
    print("[错误] 无法获取 7zr.exe，请手动放置到 full-hub/7z/7zr.exe")
    return False


def extract_7z(archive_file, target_folder):
    print(f"正在解压 {archive_file} 到 {target_folder}...")
    if not os.path.exists(target_folder):
        os.makedirs(target_folder)
    try:
        local_7z = os.path.join(current_dir, "7z", "7zr.exe")
        if not _ensure_7zr(local_7z):
            return False

        print('正在解压TTS模型包，这可能需要几分钟时间.......')
        # -bsp1 进度写入 stdout / -bso1 普通输出到 stdout / -bse2 错误到 stderr
        cmd = [local_7z, "x", archive_file, f"-o{target_folder}",
               "-y", "-bsp1", "-bso1", "-bse2"]
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1)
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
        proc.wait()

        if proc.returncode == 0:
            print("\n解压完成!")
            return True
        if proc.returncode == 1:
            # 7z 退出码 1 表示有警告（如个别文件跳过）但仍提取了大部分内容，
            # 把最终裁决权交给上层 _verify_tts 校验关键目录是否齐全。
            print("\n[警告] 7z 报告非致命警告 (exit=1)，将由上层校验关键文件")
            return True
        print(f"\n[错误] 7z 解压失败，退出码 {proc.returncode}")
        return False
    except Exception as e:
        print(f"解压过程中出错: {e}")
        return False


# ─────────────────────────────────────────────
# 各模块下载函数
# ─────────────────────────────────────────────

def download_live2d():
    print("\n========== 下载Live 2D模型 ==========")
    os.chdir(os.path.dirname(current_dir))  # 切换到项目根目录
    target_folder = "live-2d"
    if os.path.exists(target_folder):
        print(f"检测到 {target_folder} 文件夹已存在，正在清空内容...")
        for item in os.listdir(target_folder):
            item_path = os.path.join(target_folder, item)
            if os.path.isfile(item_path) or os.path.islink(item_path):
                os.unlink(item_path)
            elif os.path.isdir(item_path):
                shutil.rmtree(item_path)
    download_sources = [
        ('香港镜像', f'https://hk.gh-proxy.org/https://github.com/morettt/my-neuro/releases/download/{version_tag}/live-2d.zip'),
        ('备用镜像', f'https://gh-proxy.org/https://github.com/morettt/my-neuro/releases/download/{version_tag}/live-2d.zip'),
        ('GitHub原版', f'https://github.com/morettt/my-neuro/releases/download/{version_tag}/live-2d.zip')
    ]
    file_name = 'live-2d.zip'
    downloaded_file = None
    for source_name, url in download_sources:
        try:
            print(f"尝试使用 {source_name} 下载...")
            download_file(url, file_name)
            # 关键校验：很多镜像代理对 300MB+ 大文件会静默截断，HTTP 200 但内容残缺。
            # 必须用 zipfile 实际打开 + testzip 校验 CRC，确保 zip 完整可用。
            if not _verify_zip_integrity(file_name):
                print(f"[FAIL] {source_name} 下载的 zip 损坏，尝试下一个源")
                try:
                    os.remove(file_name)
                except Exception:
                    pass
                continue
            print(f"[OK] {source_name} 下载并校验通过!")
            downloaded_file = file_name
            break
        except Exception as e:
            print(f"[FAIL] {source_name} 下载失败: {e}")
            if os.path.exists(file_name):
                try:
                    os.remove(file_name)
                except Exception:
                    pass
    if not downloaded_file:
        print("[错误] Live2D 所有下载源都失败或下载内容损坏")
        return False

    extract_success = extract_zip(downloaded_file, target_folder)
    if not extract_success:
        return False

    # 解压成功后再确认目录非空，防止 zip 头正常但内部全是空文件的边界情况。
    if not os.path.isdir(target_folder) or not os.listdir(target_folder):
        print(f"[错误] Live2D 解压后目录为空: {target_folder}")
        return False

    if os.path.exists(downloaded_file):
        try:
            os.remove(downloaded_file)
        except Exception as e:
            print(f"[警告] 删除 live-2d.zip 临时包失败（不影响功能）: {e}")
    return True


def _verify_zip_integrity(zip_path):
    """快速校验 zip 文件完整性：能否打开 + 是否所有文件 CRC 通过。

    对于 300+MB 的大 zip，testzip() 需要扫描全部内容（约 5-15 秒）。
    返回 True 表示文件完好可解压；False 表示损坏。
    """
    try:
        size = os.path.getsize(zip_path)
        if size < 1024:
            print(f"[警告] zip 文件过小 ({size} 字节)，疑似下载残缺")
            return False
        with zipfile.ZipFile(zip_path, 'r') as z:
            bad = z.testzip()
            if bad is not None:
                print(f"[警告] zip 内文件 CRC 校验失败: {bad}")
                return False
        return True
    except zipfile.BadZipFile as e:
        print(f"[警告] 不是有效的 zip 文件: {e}")
        return False
    except Exception as e:
        print(f"[警告] zip 校验异常: {e}")
        return False


def download_bert():
    print("\n========== 下载BERT模型 ==========")
    os.chdir(current_dir)
    bert_hub_dir = os.path.join(current_dir, "bert-hub")
    if not os.path.exists(bert_hub_dir):
        os.makedirs(bert_hub_dir)
    omni_model_files = ["config.json", "model.safetensors", "vocab.txt"]
    omni_key_files = [os.path.join(bert_hub_dir, f) for f in omni_model_files]
    if all(os.path.exists(f) for f in omni_key_files):
        print("BERT模型已存在，跳过下载")
        return True
    print(f"开始下载BERT模型到: {bert_hub_dir}")
    if not download_modelscope("morelle/Omni_fn_bert", bert_hub_dir):
        print("BERT模型下载失败")
        return False
    if not all(os.path.exists(f) for f in omni_key_files):
        print("[错误] BERT 下载完成但缺少关键文件: model.safetensors 等")
        return False
    print("BERT模型下载成功！")
    return True


def _verify_tts(tts_bundle_dir):
    """解压后再次确认 TTS 关键目录都存在，避免 7z 退出码 0 但实际产物缺失的'假成功'。"""
    need = [
        os.path.join(tts_bundle_dir, "runtime"),
        os.path.join(tts_bundle_dir, "GPT_SoVITS"),
    ]
    missing = [p for p in need if not os.path.exists(p)]
    if missing:
        print(f"[错误] TTS 解压不完整，缺少关键目录: {missing}")
        return False
    return True


def download_tts(gpu_type=None):
    print("\n========== 下载TTS模型包 ==========")
    os.chdir(current_dir)
    tts_hub_dir = os.path.join(current_dir, "tts-hub")
    if not os.path.exists(tts_hub_dir):
        os.makedirs(tts_hub_dir)
    tts_bundle_dir = os.path.join(tts_hub_dir, "GPT-SoVITS-Bundle")
    if _verify_tts(tts_bundle_dir):
        print("TTS模型包已存在，跳过下载")
        return True

    # 自动检测或使用传入的gpu_type
    if gpu_type is None:
        gpu_type = _detect_gpu_type()

    if gpu_type == '50':
        print("下载50系专属TTS包...")
        model_name = "morelle/fake-neuro-gsv-50"
    else:
        print("下载标准TTS包...")
        model_name = "morelle/fake-neuro-gsv"

    if not download_modelscope(model_name, tts_hub_dir):
        print("TTS模型包下载失败")
        return False

    bundle_7z_file = os.path.join(tts_hub_dir, "GPT-SoVITS-Bundle.7z")
    if not os.path.exists(bundle_7z_file):
        # 旧版本会在此处无条件 return True，导致 modelscope 下载残缺时被
        # 当作'安装成功'。改为显式失败，让父进程能正确捕获。
        print(f"[错误] TTS 包下载后未找到 {bundle_7z_file}，可能下载残缺")
        return False

    if not extract_7z(bundle_7z_file, tts_hub_dir):
        return False

    if not _verify_tts(tts_bundle_dir):
        return False

    try:
        os.remove(bundle_7z_file)
    except Exception as e:
        print(f"[警告] 删除 7z 临时包失败（不影响功能）: {e}")
    return True


def download_rag():
    print("\n========== 下载RAG模型 ==========")
    os.chdir(current_dir)
    rag_hub_dir = os.path.join(current_dir, "rag-hub")
    if not os.path.exists(rag_hub_dir):
        os.makedirs(rag_hub_dir)
    bge_key_files = [
        os.path.join(rag_hub_dir, "config.json"),
        os.path.join(rag_hub_dir, "model.safetensors"),
        os.path.join(rag_hub_dir, "tokenizer.json")
    ]
    if all(os.path.exists(f) for f in bge_key_files):
        print("RAG模型已存在，跳过下载")
        return True
    print(f"开始下载RAG模型到: {rag_hub_dir}")
    if not download_modelscope("BAAI/bge-m3", rag_hub_dir):
        print("RAG模型下载失败")
        return False
    print("RAG模型下载成功！")
    return True


def download_asr():
    print("\n========== 下载ASR模型 ==========")
    os.chdir(current_dir)
    asr_hub_dir = os.path.join(current_dir, "asr-hub")
    if not os.path.exists(asr_hub_dir):
        os.makedirs(asr_hub_dir)

    # VAD模型
    print("\n检查VAD模型...")
    vad_target_dir = os.path.join(asr_hub_dir, 'model', 'torch_hub')
    if not os.path.exists(vad_target_dir):
        os.makedirs(vad_target_dir)
    vad_model_path = os.path.join(vad_target_dir, "snakers4_silero-vad_master")
    if not os.path.exists(vad_model_path):
        if not download_modelscope("morelle/my-neuro-vad", vad_target_dir):
            print("VAD模型下载失败")
            return False

    # ASR主模型
    print("\n检查ASR主模型...")
    asr_model_dir = os.path.join(asr_hub_dir, 'model', 'asr', 'models', 'iic',
                                 'speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch')
    if not os.path.exists(asr_model_dir):
        os.makedirs(asr_model_dir)
    asr_key_files = [os.path.join(asr_model_dir, "config.yaml"), os.path.join(asr_model_dir, "model.pb")]
    if not all(os.path.exists(f) for f in asr_key_files):
        if not download_modelscope(
                "iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                asr_model_dir):
            print("ASR主模型下载失败")
            return False

    # 标点模型
    print("\n检查标点符号模型...")
    punc_model_dir = os.path.join(asr_hub_dir, 'model', 'asr', 'models', 'iic',
                                  'punc_ct-transformer_cn-en-common-vocab471067-large')
    if not os.path.exists(punc_model_dir):
        os.makedirs(punc_model_dir)
    punc_key_files = [os.path.join(punc_model_dir, "config.yaml"), os.path.join(punc_model_dir, "model.pt")]
    if not all(os.path.exists(f) for f in punc_key_files):
        if not download_modelscope(
                "iic/punc_ct-transformer_cn-en-common-vocab471067-large",
                punc_model_dir):
            print("标点模型下载失败")
            return False

    print("ASR模型下载完成！")
    return True


def _detect_gpu_type():
    try:
        result = subprocess.run(['wmic', 'path', 'win32_VideoController', 'get', 'name'],
                                capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            for gpu in result.stdout.strip().split('\n')[1:]:
                if 'RTX 50' in gpu:
                    return '50'
        return 'non-50'
    except Exception:
        return 'non-50'


# ─────────────────────────────────────────────
# 命令行入口
# ─────────────────────────────────────────────

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='下载 my-neuro 所需模型')
    parser.add_argument('--live2d', action='store_true', help='下载Live2D模型')
    parser.add_argument('--bert',   action='store_true', help='下载BERT模型')
    parser.add_argument('--tts',    action='store_true', help='下载TTS模型')
    parser.add_argument('--rag',    action='store_true', help='下载RAG模型')
    parser.add_argument('--asr',    action='store_true', help='下载ASR模型')
    parser.add_argument('--all',    action='store_true', help='下载全部模型')
    parser.add_argument('--gpu',    default=None, choices=['50', 'non-50'], help='显卡类型（TTS用）')
    args = parser.parse_args()

    # 没有任何参数时默认下载全部（兼容旧的直接运行方式）
    run_all = args.all or not any([args.live2d, args.bert, args.tts, args.rag, args.asr])

    print("Batch_Download 已启动，开始按模块顺序下载...")
    sys.stdout.flush()

    # 收集每个模块的失败结果，最后统一以非零退出码上报，
    # 让 installer 父进程的 returncode 检测能正确捕获"假成功"。
    failed = []
    if run_all or args.live2d:
        if not download_live2d():
            failed.append("Live2D")
    if run_all or args.bert:
        if not download_bert():
            failed.append("BERT")
    if run_all or args.tts:
        if not download_tts(args.gpu):
            failed.append("TTS")
    if run_all or args.rag:
        if not download_rag():
            failed.append("RAG")
    if run_all or args.asr:
        if not download_asr():
            failed.append("ASR")

    if failed:
        print(f"\n[错误] 以下模块安装失败: {', '.join(failed)}")
        sys.exit(1)

    print("\n所有下载操作完成！")
