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

# 禁用SSL警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 获取脚本所在目录（full-hub 目录）
current_dir = os.path.dirname(os.path.abspath(__file__))

# 设置最大重试次数
MAX_RETRY = 3
# 重试等待时间（秒）
RETRY_WAIT = 5


# 添加进度条显示函数
def display_progress_bar(percent, message="", mb_downloaded=None, mb_total=None, current=None, total=None):
    """显示通用进度条"""
    bar_length = 40
    filled_length = int(bar_length * percent / 100)
    bar = '█' * filled_length + '-' * (bar_length - filled_length)

    # 添加下载信息（如果提供）
    extra_info = ""
    if mb_downloaded is not None and mb_total is not None:
        extra_info = f" ({mb_downloaded:.2f}MB/{mb_total:.2f}MB)"
    elif current is not None and total is not None:
        extra_info = f" ({current}/{total}个文件)"

    sys.stdout.write(f"\r{message}: |{bar}| {percent}% 完成{extra_info}")
    sys.stdout.flush()


# 添加下载文件函数
def download_file(url, file_name=None):
    """下载文件并显示进度条"""
    if file_name is None:
        file_name = url.split('/')[-1]

    print(f"正在下载: {file_name}...")

    # 创建一个会话来设置参数
    session = requests.Session()

    # 设置重试策略
    retry_strategy = Retry(
        total=3,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "OPTIONS"]
    )

    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)

    # 设置请求头和参数
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }

    try:
        # 尝试正常的SSL验证
        response = session.get(url, stream=True, headers=headers, timeout=30)
    except requests.exceptions.SSLError:
        print("SSL验证失败，使用不安全模式重新尝试...")
        # 如果SSL验证失败，跳过SSL验证
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
    """解压ZIP文件到指定文件夹并显示进度"""
    print(f"正在解压 {zip_file} 到 {target_folder}...")

    if not os.path.exists(target_folder):
        os.makedirs(target_folder)
        print(f"已创建目标文件夹: {target_folder}")

    try:
        with zipfile.ZipFile(zip_file, 'r') as zip_ref:
            # 获取zip文件中的所有文件列表
            file_list = zip_ref.namelist()
            total_files = len(file_list)

            # 逐个解压文件并显示进度
            for index, file in enumerate(file_list):
                # 修复中文文件名编码问题
                try:
                    # 尝试使用CP437解码然后使用GBK/GB2312重新编码
                    correct_filename = file.encode('cp437').decode('gbk')
                    # 创建目标路径
                    target_path = os.path.join(target_folder, correct_filename)

                    # 创建必要的目录
                    if os.path.dirname(target_path) and not os.path.exists(os.path.dirname(target_path)):
                        os.makedirs(os.path.dirname(target_path), exist_ok=True)

                    # 提取文件到目标路径
                    data = zip_ref.read(file)
                    # 如果是目录项则跳过写入文件
                    if not correct_filename.endswith('/'):
                        with open(target_path, 'wb') as f:
                            f.write(data)
                except Exception as e:
                    # 如果编码转换失败，直接使用原始路径
                    # 先提取到临时位置
                    zip_ref.extract(file)

                    # 如果解压成功，移动文件到目标文件夹
                    if os.path.exists(file):
                        target_path = os.path.join(target_folder, file)
                        # 确保目标目录存在
                        if os.path.dirname(target_path) and not os.path.exists(os.path.dirname(target_path)):
                            os.makedirs(os.path.dirname(target_path), exist_ok=True)
                        # 移动文件
                        shutil.move(file, target_path)

                # 计算解压百分比
                percent = int((index + 1) * 100 / total_files)

                # 显示进度条
                display_progress_bar(
                    percent,
                    "解压进度",
                    current=index + 1,
                    total=total_files
                )

        print("\n解压完成!")
        print(f"所有文件已解压到 '{target_folder}' 文件夹")
        return True

    except zipfile.BadZipFile:
        print("错误: 下载的文件不是有效的ZIP格式")
        return False
    except Exception as e:
        print(f"解压过程中出错: {e}")
        return False


def extract_7z(archive_file, target_folder):
    """解压7z文件（自动下载7z工具）"""
    import subprocess

    print(f"正在解压 {archive_file} 到 {target_folder}...")

    if not os.path.exists(target_folder):
        os.makedirs(target_folder)
        print(f"已创建目标文件夹: {target_folder}")

    try:
        # 检查本地是否有7z.exe
        local_7z = os.path.join(current_dir, "7z", "7z.exe")

        # 如果本地没有7z，自动下载
        if not os.path.exists(local_7z):
            print("正在自动下载7z工具...")
            sevenz_dir = os.path.join(current_dir, "7z")
            if not os.path.exists(sevenz_dir):
                os.makedirs(sevenz_dir)

            # 下载7z便携版（官方链接）
            seven_zip_url = "https://www.7-zip.org/a/7zr.exe"

            try:
                response = requests.get(seven_zip_url, timeout=30)
                with open(local_7z, 'wb') as f:
                    f.write(response.content)
                print("7z工具下载完成!")
            except Exception as e:
                print(f"下载7z失败: {e}")
                print("\n请手动下载7-Zip并安装，或手动解压 GPT-SoVITS-Bundle.7z 文件")
                return False

        print('正在解压TTS模型包，这可能需要几分钟时间，请耐心等待.......')

        # 使用7z解压到根目录
        cmd = f'"{local_7z}" x "{archive_file}" -o"{target_folder}" -y'
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)

        if result.returncode == 0:
            print("\n解压完成!")
            print(f"所有文件已解压到 '{target_folder}' 文件夹")
            return True
        else:
            print(f"\n解压失败: {result.stderr}")
            return False

    except Exception as e:
        print(f"解压过程中出错: {e}")
        return False


# 定义下载函数，包含重试机制
def download_with_retry(command, max_retry=MAX_RETRY, wait_time=RETRY_WAIT):
    import subprocess
    print(f"执行命令: {command}")
    for attempt in range(max_retry):
        if attempt > 0:
            print(f"第 {attempt + 1} 次尝试下载...")

        result = subprocess.Popen(
            command,
            shell=True,
            stdout=None,
            stderr=None
        ).wait()

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


# 添加Live2D下载函数
def download_live2d_model():
    """下载并解压Live 2D模型到live-2d文件夹"""
    print("\n========== 下载Live 2D模型 ==========")

    target_folder = "live-2d"

    # 如果live-2d文件夹存在，先清空文件夹内容
    if os.path.exists(target_folder):
        print(f"检测到 {target_folder} 文件夹已存在，正在清空内容...")
        for item in os.listdir(target_folder):
            item_path = os.path.join(target_folder, item)
            if os.path.isfile(item_path) or os.path.islink(item_path):
                os.unlink(item_path)
            elif os.path.isdir(item_path):
                shutil.rmtree(item_path)
        print(f"{target_folder} 文件夹内容已清空")

    url = "https://github.com/morettt/my-neuro/releases/download/v5.9.6/live-2d.zip"
    file_name = url.split('/')[-1]

    # 下载文件
    downloaded_file = download_file(url, file_name)

    # 解压文件
    extract_success = extract_zip(downloaded_file, target_folder)

    # 清理：删除压缩文件
    if extract_success and os.path.exists(downloaded_file):
        os.remove(downloaded_file)
        print(f"原压缩文件 {downloaded_file} 已删除")

    return extract_success


# 开始下载Live2D模型
print("开始下载Live2D模型...")
download_live2d_model()


# 1. 下载Omni_fn_bert模型到bert-hub文件夹
print("\n========== 检查Omni_fn_bert模型 ==========")

bert_hub_dir = os.path.join(current_dir, "bert-hub")
if not os.path.exists(bert_hub_dir):
    os.makedirs(bert_hub_dir)

# 检查Omni_fn_bert模型关键文件
omni_model_files = ["config.json", "model.safetensors", "vocab.txt"]
omni_key_files = [os.path.join(bert_hub_dir, f) for f in omni_model_files]
print(f"检查路径: {bert_hub_dir}")
print(f"检查文件: {omni_key_files}")
omni_already_downloaded = all(os.path.exists(f) for f in omni_key_files)
print(f"文件存在状态: {[os.path.exists(f) for f in omni_key_files]}")

if omni_already_downloaded:
    print("检测到Omni_fn_bert模型已经下载完成，跳过下载步骤")
else:
    print(f"Omni_fn_bert模型未完整下载，开始下载到: {bert_hub_dir}")

    # 切换到bert-hub目录
    os.chdir(bert_hub_dir)

    # 使用ModelScope下载Omni_fn_bert模型，带重试机制
    if not download_with_retry("modelscope download --model morelle/Omni_fn_bert --local_dir ./"):
        print("Omni_fn_bert模型下载失败，终止程序")
        exit(1)

    # 检查下载的模型是否存在 - ModelScope直接下载到指定目录
    # 检查一些关键文件是否存在来确认模型是否下载成功
    missing_files = [f for f in omni_model_files if not os.path.exists(os.path.join(bert_hub_dir, f))]
    if missing_files:
        print(f"错误：下载后无法找到Omni_fn_bert模型的关键文件: {', '.join(missing_files)}")
        exit(1)
    print("Omni_fn_bert模型下载成功！")

# 返回到原始目录
os.chdir(current_dir)

# 2. 下载TTS模型包 (gsv-fn-v1) 到tts-hub文件夹
# 返回到原始目录
os.chdir(current_dir)

# 创建tts-hub目录
tts_hub_dir = os.path.join(current_dir, "tts-hub")
if not os.path.exists(tts_hub_dir):
    os.makedirs(tts_hub_dir)
    print(f"创建目录: {tts_hub_dir}")

print("\n========== 检查TTS模型包 ==========")

# 检查TTS模型包是否已经解压完成
# 验证关键文件/文件夹是否存在
tts_bundle_dir = os.path.join(tts_hub_dir, "GPT-SoVITS-Bundle")
tts_key_files = [
    os.path.join(tts_bundle_dir, "runtime"),
    os.path.join(tts_bundle_dir, "GPT_SoVITS"),
]

tts_already_extracted = all(os.path.exists(f) for f in tts_key_files)

if tts_already_extracted:
    print("检测到TTS模型包已经解压完成，跳过下载和解压步骤")
else:
    print(f"TTS模型包未完整解压，开始下载...")
    print(f"下载gsv-fn-v1模型包到tts-hub文件夹: {tts_hub_dir}")

    # 使用ModelScope下载gsv-fn-v1模型包到tts-hub文件夹，带重试机制
    if not download_with_retry(f"modelscope download --model morelle/gsv-fn-v1 --local_dir ./tts-hub"):
        print("gsv-fn-v1模型包下载失败，终止程序")
        exit(1)

    print("gsv-fn-v1模型包下载成功！")

    # 检查是否存在 GPT-SoVITS-Bundle.7z 文件（在tts-hub文件夹中）
    bundle_7z_file = os.path.join(tts_hub_dir, "GPT-SoVITS-Bundle.7z")
    if os.path.exists(bundle_7z_file):
        print(f"\n检测到 GPT-SoVITS-Bundle.7z 文件，开始解压...")

        # 解压到tts-hub目录
        if extract_7z(bundle_7z_file, tts_hub_dir):
            print("TTS模型包解压成功！")

            # 删除压缩包
            try:
                os.remove(bundle_7z_file)
                print(f"已删除原压缩文件: {bundle_7z_file}")
            except Exception as e:
                print(f"删除压缩文件时出错: {e}")
        else:
            print("TTS模型包解压失败，请手动解压 GPT-SoVITS-Bundle.7z 文件")
            exit(1)
    else:
        print(f"警告: 未找到 GPT-SoVITS-Bundle.7z 文件，跳过解压步骤")

# 7. 下载BAAI/bge-m3模型到rag-hub文件夹
print("\n========== 检查BAAI/bge-m3模型 ==========")

# 返回到原始目录
os.chdir(current_dir)

# 创建rag-hub目录
rag_hub_dir = os.path.join(current_dir, "rag-hub")
if not os.path.exists(rag_hub_dir):
    os.makedirs(rag_hub_dir)
    print(f"创建目录: {rag_hub_dir}")

# 检查BAAI/bge-m3模型关键文件
bge_key_files = [
    os.path.join(rag_hub_dir, "config.json"),
    os.path.join(rag_hub_dir, "model.safetensors"),
    os.path.join(rag_hub_dir, "tokenizer.json")
]
bge_already_downloaded = all(os.path.exists(f) for f in bge_key_files)

if bge_already_downloaded:
    print("检测到BAAI/bge-m3模型已经下载完成，跳过下载步骤")
else:
    print(f"BAAI/bge-m3模型未完整下载，开始下载到: {rag_hub_dir}")

    # 使用ModelScope下载BAAI/bge-m3模型，带重试机制
    if not download_with_retry("modelscope download --model BAAI/bge-m3 --local_dir ./rag-hub"):
        print("BAAI/bge-m3模型下载失败")
        # 不终止程序，继续执行其他任务
    else:
        print("BAAI/bge-m3模型下载成功！")

# 9. 下载ASR相关模型到asr-hub目录
print("\n========== 开始下载ASR相关模型 ==========")

# 返回到原始目录
os.chdir(current_dir)

# 创建asr-hub目录结构
asr_hub_dir = os.path.join(current_dir, "asr-hub")
if not os.path.exists(asr_hub_dir):
    os.makedirs(asr_hub_dir)
    print(f"创建目录: {asr_hub_dir}")

# 9.1 下载VAD模型
print("\n检查VAD模型...")
vad_target_dir = os.path.join(asr_hub_dir, 'model', 'torch_hub')
if not os.path.exists(vad_target_dir):
    os.makedirs(vad_target_dir)
    print(f"创建目录: {vad_target_dir}")

# 检查VAD模型关键文件
vad_model_path = os.path.join(vad_target_dir, "snakers4_silero-vad_master")
vad_already_downloaded = os.path.exists(vad_model_path)

if vad_already_downloaded:
    print("检测到VAD模型已经下载完成，跳过下载步骤")
else:
    print("VAD模型未下载，开始下载...")
    if not download_with_retry(f"modelscope download --model morelle/my-neuro-vad --local_dir {vad_target_dir}"):
        print("VAD模型下载失败")
    else:
        print("VAD模型下载成功！")

# 9.2 下载ASR主模型
print("\n检查ASR主模型...")
asr_model_dir = os.path.join(asr_hub_dir, 'model', 'asr', 'models', 'iic', 'speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch')
if not os.path.exists(asr_model_dir):
    os.makedirs(asr_model_dir)
    print(f"创建目录: {asr_model_dir}")

# 检查ASR主模型关键文件
asr_key_files = [
    os.path.join(asr_model_dir, "config.yaml"),
    os.path.join(asr_model_dir, "model.pb")
]
asr_already_downloaded = all(os.path.exists(f) for f in asr_key_files)

if asr_already_downloaded:
    print("检测到ASR主模型已经下载完成，跳过下载步骤")
else:
    print("ASR主模型未完整下载，开始下载...")
    if not download_with_retry(
            f"modelscope download --model iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch --local_dir {asr_model_dir}"):
        print("ASR主模型下载失败")
    else:
        print("ASR主模型下载成功！")

# 9.3 下载标点符号模型
print("\n检查标点符号模型...")
# 注意：这里使用 iic/punc_ct-transformer_cn-en-common-vocab471067-large 以匹配 asr_api.py 中的 ct-punc 别名
punc_model_dir = os.path.join(asr_hub_dir, 'model', 'asr', 'models', 'iic', 'punc_ct-transformer_cn-en-common-vocab471067-large')
if not os.path.exists(punc_model_dir):
    os.makedirs(punc_model_dir)
    print(f"创建目录: {punc_model_dir}")

# 检查标点符号模型关键文件
punc_key_files = [
    os.path.join(punc_model_dir, "config.yaml"),
    os.path.join(punc_model_dir, "model.pt")
]
punc_already_downloaded = all(os.path.exists(f) for f in punc_key_files)

if punc_already_downloaded:
    print("检测到标点符号模型已经下载完成，跳过下载步骤")
else:
    print("标点符号模型未完整下载，开始下载...")
    if not download_with_retry(f"modelscope download --model iic/punc_ct-transformer_cn-en-common-vocab471067-large --local_dir {punc_model_dir}"):
        print("标点符号模型下载失败")
    else:
        print("标点符号模型下载成功！")

print("\n所有下载操作全部完成！")




