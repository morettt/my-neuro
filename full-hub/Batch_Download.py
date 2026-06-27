import os
import json
import shutil
import zipfile
import time

import requests
import sys
import urllib3
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import platform
import subprocess

system = platform.system()

version_tag = "v6.6"

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

current_dir = os.path.dirname(os.path.abspath(__file__))

MAX_RETRY = 3
RETRY_WAIT = 5


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
    # 镜像返回 404/5xx 时必须抛错，否则错误页会被当成压缩包保存，多源切换也不会触发
    response.raise_for_status()
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


def extract_7z(archive_file, target_folder):
    print(f"正在解压 {archive_file} 到 {target_folder}...")
    if not os.path.exists(target_folder):
        os.makedirs(target_folder)
    try:
        local_7z = os.path.join(current_dir, "7z", "7z.exe")
        if not os.path.exists(local_7z):
            print("正在自动下载7z工具...")
            sevenz_dir = os.path.join(current_dir, "7z")
            if not os.path.exists(sevenz_dir):
                os.makedirs(sevenz_dir)
            seven_zip_url = "https://www.7-zip.org/a/7zr.exe"
            try:
                response = requests.get(seven_zip_url, timeout=30)
                with open(local_7z, 'wb') as f:
                    f.write(response.content)
                print("7z工具下载完成!")
            except Exception as e:
                print(f"下载7z失败: {e}")
                return False
        print('正在解压TTS模型包，这可能需要几分钟时间.......')
        cmd = f'"{local_7z}" x "{archive_file}" -o"{target_folder}" -y'
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if result.returncode == 0:
            print("\n解压完成!")
            return True
        else:
            print(f"\n解压失败: {result.stderr}")
            return False
    except Exception as e:
        print(f"解压过程中出错: {e}")
        return False


def _clear_modelscope_lock(model_id):
    lock_name = model_id.replace('/', '___')
    lock_path = os.path.join(os.path.expanduser('~'), '.cache', 'modelscope', 'hub', '.lock', lock_name)
    if not os.path.exists(lock_path):
        return

    print(f"检测到残留锁文件: {lock_path}", flush=True)

    # 找到占用锁文件的进程并强制终止
    try:
        import psutil
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                for f in proc.open_files():
                    if os.path.normcase(f.path) == os.path.normcase(lock_path):
                        print(f"终止占用锁的进程: PID={proc.pid} ({proc.name()})", flush=True)
                        proc.kill()
                        proc.wait(timeout=5)
                        break
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.TimeoutExpired):
                pass
    except ImportError:
        print("psutil 未安装，跳过进程检测", flush=True)

    # 重试删除
    for attempt in range(5):
        try:
            os.remove(lock_path)
            print(f"已清除锁文件", flush=True)
            return
        except Exception:
            time.sleep(1)
    print(f"警告: 锁文件无法删除，下载可能仍会卡住: {lock_path}", flush=True)


def download_model_direct(model_id, local_dir):
    """直接用Python API下载modelscope模型，不依赖CLI命令"""
    from modelscope.hub.snapshot_download import snapshot_download
    _clear_modelscope_lock(model_id)
    print(f"开始下载: {model_id}", flush=True)
    print(f"保存到: {local_dir}", flush=True)
    os.makedirs(local_dir, exist_ok=True)
    for attempt in range(MAX_RETRY):
        try:
            snapshot_download(model_id, local_dir=local_dir)
            print(f"下载完成: {model_id}", flush=True)
            return True
        except Exception as e:
            print(f"下载失败({attempt + 1}/{MAX_RETRY}): {e}", flush=True)
            if attempt < MAX_RETRY - 1:
                _clear_modelscope_lock(model_id)
                print(f"等待{RETRY_WAIT}秒后重试...", flush=True)
                time.sleep(RETRY_WAIT)
    return False


# ─────────────────────────────────────────────
# 各模块下载函数
# ─────────────────────────────────────────────

def _live2d_installed_version(target_folder):
    """读取已安装 live-2d 的版本号（与 update.py 相同的约定），读不到返回 None"""
    try:
        with open(os.path.join(target_folder, "config.json"), 'r', encoding='utf-8') as f:
            return json.load(f).get('version')
    except Exception:
        return None


def download_live2d(force=False):
    print("\n========== 下载Live 2D模型 ==========")
    repo_root = os.path.dirname(current_dir)
    target_folder = os.path.join(repo_root, "live-2d")

    if not force and _live2d_installed_version(target_folder) == version_tag:
        print(f"live-2d 已是 {version_tag} 版本，跳过下载（如需重新下载请加 --force-live2d）")
        return True

    download_sources = [
        ('香港镜像', f'https://hk.gh-proxy.org/https://github.com/morettt/my-neuro/releases/download/{version_tag}/live-2d.zip'),
        ('备用镜像', f'https://gh-proxy.org/https://github.com/morettt/my-neuro/releases/download/{version_tag}/live-2d.zip'),
        ('GitHub原版', f'https://github.com/morettt/my-neuro/releases/download/{version_tag}/live-2d.zip')
    ]
    zip_path = os.path.join(repo_root, 'live-2d.zip')
    downloaded_file = None
    for source_name, url in download_sources:
        try:
            print(f"尝试使用 {source_name} 下载...")
            downloaded_file = download_file(url, zip_path)
            print(f"[OK] {source_name} 下载成功!")
            break
        except Exception as e:
            print(f"[FAIL] {source_name} 下载失败: {e}")
    if not downloaded_file:
        print("所有下载源均失败，保留现有 live-2d 文件夹")
        return False

    # 先解压到临时文件夹，全部成功后再替换旧文件夹（与 update.py 的更新策略一致），
    # 避免下载/解压中途失败时用户原有的 live-2d（含配置和记忆数据）已被清空
    temp_folder = os.path.join(repo_root, 'live-2d-temp')
    if os.path.exists(temp_folder):
        shutil.rmtree(temp_folder)
    extract_success = extract_zip(downloaded_file, temp_folder)
    if os.path.exists(downloaded_file):
        os.remove(downloaded_file)
    if not extract_success:
        shutil.rmtree(temp_folder, ignore_errors=True)
        return False

    try:
        if os.path.exists(target_folder):
            shutil.rmtree(target_folder)
        os.rename(temp_folder, target_folder)
    except Exception as e:
        print(f"替换 live-2d 文件夹失败（若 live-2d 正在运行请先关闭后重试）: {e}")
        if os.path.exists(temp_folder) and not os.path.exists(target_folder):
            os.rename(temp_folder, target_folder)
        return False
    print(f"live-2d {version_tag} 下载完成")
    return True


def download_bert():
    print("\n========== 下载BERT模型 ==========")
    bert_hub_dir = os.path.join(current_dir, "bert-hub")
    omni_key_files = [
        os.path.join(bert_hub_dir, "config.json"),
        os.path.join(bert_hub_dir, "model.safetensors"),
        os.path.join(bert_hub_dir, "vocab.txt"),
    ]
    if all(os.path.exists(f) for f in omni_key_files):
        print("BERT模型已存在，跳过下载")
        return True
    print(f"开始下载BERT模型到: {bert_hub_dir}")
    if not download_model_direct("morelle/Omni_fn_bert", bert_hub_dir):
        print("BERT模型下载失败")
        return False
    print("BERT模型下载成功！")
    return True


def download_tts(gpu_type=None):
    print("\n========== 下载TTS模型包 ==========")
    tts_hub_dir = os.path.join(current_dir, "tts-hub")
    tts_bundle_dir = os.path.join(tts_hub_dir, "GPT-SoVITS-Bundle")
    tts_key_files = [
        os.path.join(tts_bundle_dir, "runtime"),
        os.path.join(tts_bundle_dir, "GPT_SoVITS"),
    ]
    if all(os.path.exists(f) for f in tts_key_files):
        print("TTS模型包已存在，跳过下载")
        return True

    if gpu_type is None:
        gpu_type = _detect_gpu_type()

    if gpu_type == '50':
        print("下载50系专属TTS包...")
        model_name = "morelle/fake-neuro-gsv-50"
    else:
        print("下载标准TTS包...")
        model_name = "morelle/fake-neuro-gsv"

    if not download_model_direct(model_name, tts_hub_dir):
        print("TTS模型包下载失败")
        return False

    bundle_7z_file = os.path.join(tts_hub_dir, "GPT-SoVITS-Bundle.7z")
    if os.path.exists(bundle_7z_file):
        if extract_7z(bundle_7z_file, tts_hub_dir):
            try:
                os.remove(bundle_7z_file)
            except Exception:
                pass
            return True
        else:
            return False
    return True


def download_rag():
    print("\n========== 下载RAG模型 ==========")
    rag_hub_dir = os.path.join(current_dir, "rag-hub")
    bge_key_files = [
        os.path.join(rag_hub_dir, "config.json"),
        os.path.join(rag_hub_dir, "model.safetensors"),
        os.path.join(rag_hub_dir, "tokenizer.json"),
    ]
    if all(os.path.exists(f) for f in bge_key_files):
        print("RAG模型已存在，跳过下载")
        return True
    print(f"开始下载RAG模型到: {rag_hub_dir}")
    if not download_model_direct("BAAI/bge-m3", rag_hub_dir):
        print("RAG模型下载失败")
        return False
    print("RAG模型下载成功！")
    return True


def download_asr():
    print("\n========== 下载ASR模型 ==========")
    asr_hub_dir = os.path.join(current_dir, "asr-hub")
    os.makedirs(asr_hub_dir, exist_ok=True)
    ok = True

    # VAD模型
    print("\n检查VAD模型...")
    vad_target_dir = os.path.join(asr_hub_dir, 'model', 'torch_hub')
    vad_model_path = os.path.join(vad_target_dir, "snakers4_silero-vad_master")
    if not os.path.exists(vad_model_path):
        ok = download_model_direct("morelle/my-neuro-vad", vad_target_dir) and ok

    # ASR主模型
    print("\n检查ASR主模型...")
    asr_model_dir = os.path.join(asr_hub_dir, 'model', 'asr', 'models', 'iic',
                                 'speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch')
    asr_key_files = [os.path.join(asr_model_dir, "config.yaml")]
    if not all(os.path.exists(f) for f in asr_key_files):
        ok = download_model_direct(
            "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
            asr_model_dir) and ok

    # 标点模型
    print("\n检查标点符号模型...")
    punc_model_dir = os.path.join(asr_hub_dir, 'model', 'asr', 'models', 'iic',
                                  'punc_ct-transformer_cn-en-common-vocab471067-large')
    punc_key_files = [os.path.join(punc_model_dir, "config.yaml"), os.path.join(punc_model_dir, "model.pt")]
    if not all(os.path.exists(f) for f in punc_key_files):
        ok = download_model_direct(
            "iic/punc_ct-transformer_cn-en-common-vocab471067-large",
            punc_model_dir) and ok

    if ok:
        print("ASR模型下载完成！")
    else:
        print("部分ASR模型下载失败")
    return ok


def _detect_gpu_type():
    # wmic 在新版 Windows 11 中已被移除，按顺序尝试多种检测方式
    probes = [
        ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
        ['wmic', 'path', 'win32_VideoController', 'get', 'name'],
        ['powershell', '-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
    ]
    for probe in probes:
        try:
            result = subprocess.run(probe, capture_output=True, text=True, timeout=15)
        except Exception:
            continue
        if result.returncode == 0 and result.stdout.strip():
            names = [l.strip() for l in result.stdout.splitlines()
                     if l.strip() and l.strip() != 'Name']
            print(f"检测到显卡: {' / '.join(names)}")
            return '50' if 'RTX 50' in result.stdout else 'non-50'
    print("无法自动检测显卡，默认按非50系处理（50系显卡请用 --gpu 50 指定）")
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
    parser.add_argument('--force-live2d', action='store_true', help='live-2d 已是当前版本时也强制重新下载')
    args = parser.parse_args()

    run_all = args.all or not any([args.live2d, args.bert, args.tts, args.rag, args.asr])

    results = {}
    if run_all or args.live2d:
        results['live-2d'] = download_live2d(force=args.force_live2d)
    if run_all or args.bert:
        results['bert'] = download_bert()
    if run_all or args.tts:
        results['tts'] = download_tts(args.gpu)
    if run_all or args.rag:
        results['rag'] = download_rag()
    if run_all or args.asr:
        results['asr'] = download_asr()

    failed = [name for name, ok in results.items() if not ok]
    if failed:
        print(f"\n以下模块下载失败: {', '.join(failed)}，请重新运行重试")
        sys.exit(1)

    print("\n所有下载操作完成！")
