import os
import shutil
import zipfile
import time
import modelscope

import requests
import sys
import urllib3
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import platform
import subprocess

system = platform.system()

version_tag = "v6.5.5"

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


def download_with_retry(command, max_retry=MAX_RETRY, wait_time=RETRY_WAIT):
    print(f"执行命令: {command}")
    for attempt in range(max_retry):
        if attempt > 0:
            print(f"第 {attempt + 1} 次尝试下载...")
        result = subprocess.Popen(command, shell=True, stdout=None, stderr=None).wait()
        if result == 0:
            print("下载成功!")
            return True
        else:
            print(f"下载失败，返回值: {result}")
            if attempt < max_retry - 1:
                print(f"等待 {wait_time} 秒后重试...")
                time.sleep(wait_time)
    print(f"经过 {max_retry} 次尝试后，下载仍然失败")
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
            downloaded_file = download_file(url, file_name)
            print(f"[OK] {source_name} 下载成功!")
            break
        except Exception as e:
            print(f"[FAIL] {source_name} 下载失败: {e}")
    if downloaded_file:
        extract_success = extract_zip(downloaded_file, target_folder)
        if extract_success and os.path.exists(downloaded_file):
            os.remove(downloaded_file)
        return extract_success
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
    os.chdir(bert_hub_dir)
    if not download_with_retry("modelscope download --model morelle/Omni_fn_bert --local_dir ./"):
        print("BERT模型下载失败")
        os.chdir(current_dir)
        return False
    os.chdir(current_dir)
    print("BERT模型下载成功！")
    return True


def download_tts(gpu_type=None):
    print("\n========== 下载TTS模型包 ==========")
    os.chdir(current_dir)
    tts_hub_dir = os.path.join(current_dir, "tts-hub")
    if not os.path.exists(tts_hub_dir):
        os.makedirs(tts_hub_dir)
    tts_bundle_dir = os.path.join(tts_hub_dir, "GPT-SoVITS-Bundle")
    tts_key_files = [
        os.path.join(tts_bundle_dir, "runtime"),
        os.path.join(tts_bundle_dir, "GPT_SoVITS"),
    ]
    if all(os.path.exists(f) for f in tts_key_files):
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

    if not download_with_retry(f"modelscope download --model {model_name} --local_dir ./tts-hub"):
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
    if not download_with_retry("modelscope download --model BAAI/bge-m3 --local_dir ./rag-hub"):
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
        download_with_retry(f"modelscope download --model morelle/my-neuro-vad --local_dir {vad_target_dir}")

    # ASR主模型
    print("\n检查ASR主模型...")
    asr_model_dir = os.path.join(asr_hub_dir, 'model', 'asr', 'models', 'iic',
                                 'speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch')
    if not os.path.exists(asr_model_dir):
        os.makedirs(asr_model_dir)
    asr_key_files = [os.path.join(asr_model_dir, "config.yaml"), os.path.join(asr_model_dir, "model.pb")]
    if not all(os.path.exists(f) for f in asr_key_files):
        download_with_retry(
            f"modelscope download --model iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch --local_dir {asr_model_dir}")

    # 标点模型
    print("\n检查标点符号模型...")
    punc_model_dir = os.path.join(asr_hub_dir, 'model', 'asr', 'models', 'iic',
                                  'punc_ct-transformer_cn-en-common-vocab471067-large')
    if not os.path.exists(punc_model_dir):
        os.makedirs(punc_model_dir)
    punc_key_files = [os.path.join(punc_model_dir, "config.yaml"), os.path.join(punc_model_dir, "model.pt")]
    if not all(os.path.exists(f) for f in punc_key_files):
        download_with_retry(
            f"modelscope download --model iic/punc_ct-transformer_cn-en-common-vocab471067-large --local_dir {punc_model_dir}")

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

    if run_all or args.live2d:
        download_live2d()
    if run_all or args.bert:
        download_bert()
    if run_all or args.tts:
        download_tts(args.gpu)
    if run_all or args.rag:
        download_rag()
    if run_all or args.asr:
        download_asr()

    print("\n所有下载操作完成！")
