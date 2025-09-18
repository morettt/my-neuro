import os
import subprocess
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

# 添加7z支持
try:
    import py7zr
    HAS_PY7ZR = True
except ImportError:
    HAS_PY7ZR = False

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


def extract_archive(archive_file, target_folder):
    """解压压缩文件（支持zip和7z格式）"""
    print(f"正在解压 {archive_file} 到 {target_folder}...")
    
    if not os.path.exists(target_folder):
        os.makedirs(target_folder)
        print(f"已创建目标文件夹: {target_folder}")
    
    file_ext = archive_file.lower().split('.')[-1]
    
    try:
        if file_ext == '7z':
            # 首先尝试使用py7zr库
            if HAS_PY7ZR:
                print("使用py7zr库解压7z文件...")
                with py7zr.SevenZipFile(archive_file, mode='r') as archive:
                    archive.extractall(path=target_folder)
            else:
                # 如果没有py7zr库，尝试使用系统的7z命令
                print("py7zr库未安装，尝试使用系统7z命令...")
                
                # 检查是否安装了7z
                try:
                    result = subprocess.run(['7z'], capture_output=True, check=False)
                except FileNotFoundError:
                    print("错误: 系统中未找到7z命令行工具")
                    print("请安装以下之一:")
                    print("1. Python库: pip install py7zr")
                    print("2. 系统工具:")
                    print("   Windows: 下载并安装7-Zip")
                    print("   Linux: sudo apt-get install p7zip-full")
                    print("   macOS: brew install p7zip")
                    return False
                
                # 解压命令
                result = subprocess.run(
                    ['7z', 'x', archive_file, f'-o{target_folder}', '-y'],
                    capture_output=True,
                    text=True
                )
                
                if result.returncode != 0:
                    print(f"7z解压失败: {result.stderr}")
                    return False
                    
        elif file_ext == 'zip':
            print("解压ZIP文件...")
            with zipfile.ZipFile(archive_file, 'r') as zip_ref:
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
                        current=index+1, 
                        total=total_files
                    )
        else:
            print(f"不支持的压缩格式: {file_ext}")
            return False
            
        print("\n解压完成!")
        print(f"所有文件已解压到 '{target_folder}' 文件夹")
        return True
        
    except Exception as e:
        print(f"解压过程中出错: {e}")
        return False


# 添加Live2D下载函数（在现有代码的最开始部分添加）
def download_live2d_model():
    """下载并解压Live 2D模型到live-2d文件夹"""
    print("\n========== 下载Live 2D模型 ==========")

    target_folder = "live-2d"

    # 检查live-2d文件夹是否已存在且不为空
    if os.path.exists(target_folder) and os.listdir(target_folder):
        print(f"检测到 {target_folder} 文件夹已存在且包含文件，跳过下载。")
        return True

    url = "https://github.com/morettt/my-neuro/releases/download/v5.2.1/live-2d.7z"
    file_name = url.split('/')[-1]

    # 下载文件
    downloaded_file = download_file(url, file_name)

    # 解压文件 - 现在使用新的extract_archive函数
    extract_success = extract_archive(downloaded_file, target_folder)

    # 清理：删除压缩文件
    if extract_success and os.path.exists(downloaded_file):
        os.remove(downloaded_file)
        print(f"原压缩文件 {downloaded_file} 已删除")

    return extract_success


print("开始下载Live2D模型...")
download_live2d_model()


# 定义下载函数，包含重试机制
def download_with_retry(command, max_retry=MAX_RETRY, wait_time=RETRY_WAIT):
    print(f"执行命令: {command}")
    for attempt in range(max_retry):
        if attempt > 0:
            print(f"第 {attempt+1} 次尝试下载...")
        
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

# 获取当前工作目录
current_dir = os.getcwd()

# 1. 下载Omni_fn_bert模型到omni_bert文件夹
omni_bert_dir = os.path.join(current_dir, "omni_bert")
if not os.path.exists(omni_bert_dir):
    os.makedirs(omni_bert_dir)

# 切换到omni_bert目录
os.chdir(omni_bert_dir)
print(f"下载Omni_fn_bert模型到: {os.getcwd()}")

# 使用ModelScope下载Omni_fn_bert模型，带重试机制
if not download_with_retry("modelscope download --model morelle/Omni_fn_bert --local_dir ./"):
    print("Omni_fn_bert模型下载失败，终止程序")
    exit(1)

# 检查下载的模型是否存在 - ModelScope直接下载到指定目录
# 检查一些关键文件是否存在来确认模型是否下载成功
omni_model_files = ["config.json", "model.safetensors", "vocab.txt"]
missing_files = [f for f in omni_model_files if not os.path.exists(os.path.join(omni_bert_dir, f))]
if missing_files:
    print(f"错误：下载后无法找到Omni_fn_bert模型的关键文件: {', '.join(missing_files)}")
    exit(1)
print("Omni_fn_bert模型检查通过，关键文件已找到")

# 2. 下载第二个模型 - G2PWModel到tts-studio/text文件夹
# 返回到原始目录
os.chdir(current_dir)

# 创建tts-studio/text路径
tts_studio_dir = os.path.join(current_dir, "tts-studio")
text_dir = os.path.join(tts_studio_dir, "text")
if not os.path.exists(text_dir):
    os.makedirs(text_dir)

# 创建专门的G2PWModel文件夹
g2pw_model_dir = os.path.join(text_dir, "G2PWModel")
if not os.path.exists(g2pw_model_dir):
    os.makedirs(g2pw_model_dir)

# 切换到G2PWModel目录
os.chdir(g2pw_model_dir)
print(f"下载G2PWModel到: {os.getcwd()}")

# 使用ModelScope下载G2PWModel，带重试机制
if not download_with_retry("modelscope download --model zxm2493188292/G2PWModel --local_dir ./"):
    print("G2PWModel下载失败，终止程序")
    exit(1)

# 检查下载的G2PWModel是否存在
if not os.listdir(g2pw_model_dir):
    print(f"错误：下载后G2PWModel目录为空 {g2pw_model_dir}")
    exit(1)
print("G2PWModel模型下载检查通过，文件已找到")

# 3. 复制G2PWModel到tts-studio/GPT_SoVITS/text文件夹
# 返回到原始目录
os.chdir(current_dir)

# 源文件夹路径 - 现在是专门的G2PWModel文件夹
source_g2pw_dir = g2pw_model_dir

# 目标文件夹路径
gpt_sovits_dir = os.path.join(tts_studio_dir, "GPT_SoVITS")
gpt_text_dir = os.path.join(gpt_sovits_dir, "text")
target_g2pw_dir = os.path.join(gpt_text_dir, "G2PWModel")

# 创建目标目录结构
if not os.path.exists(gpt_sovits_dir):
    os.makedirs(gpt_sovits_dir)
if not os.path.exists(gpt_text_dir):
    os.makedirs(gpt_text_dir)

# 复制文件夹
print(f"复制G2PWModel从 {source_g2pw_dir} 到 {target_g2pw_dir}")
# 如果目标文件夹已存在，先删除
if os.path.exists(target_g2pw_dir):
    shutil.rmtree(target_g2pw_dir)
# 复制整个文件夹
try:
    shutil.copytree(source_g2pw_dir, target_g2pw_dir)
    print("复制完成！")
except Exception as e:
    print(f"复制过程中出错: {str(e)}")
    exit(1)

# 3.1 新增：复制G2PWModel到fine_tuning/text文件夹
print("\n开始复制G2PWModel到fine_tuning/text目录...")

# 创建fine_tuning/text目录结构
fine_tuning_dir = os.path.join(current_dir, "fine_tuning")
fine_tuning_text_dir = os.path.join(fine_tuning_dir, "text")
fine_tuning_g2pw_dir = os.path.join(fine_tuning_text_dir, "G2PWModel")

# 创建目标目录结构
if not os.path.exists(fine_tuning_dir):
    os.makedirs(fine_tuning_dir)
    print(f"创建目录: {fine_tuning_dir}")
if not os.path.exists(fine_tuning_text_dir):
    os.makedirs(fine_tuning_text_dir)
    print(f"创建目录: {fine_tuning_text_dir}")

# 复制文件夹到fine_tuning/text目录
print(f"复制G2PWModel从 {source_g2pw_dir} 到 {fine_tuning_g2pw_dir}")
# 如果目标文件夹已存在，先删除
if os.path.exists(fine_tuning_g2pw_dir):
    shutil.rmtree(fine_tuning_g2pw_dir)
# 复制整个文件夹
try:
    shutil.copytree(source_g2pw_dir, fine_tuning_g2pw_dir)
    print("G2PWModel复制到fine_tuning/text目录完成！")
except Exception as e:
    print(f"复制G2PWModel到fine_tuning/text目录时出错: {str(e)}")
    # 这里不终止程序，因为这是额外的复制操作

# 4. 下载并解压pretrained_models.zip到tts-studio/GPT_SoVITS/pretrained_models文件夹
# 创建目标目录
pretrained_models_dir = os.path.join(gpt_sovits_dir, "pretrained_models")
if not os.path.exists(pretrained_models_dir):
    os.makedirs(pretrained_models_dir)

# 返回到原始目录
os.chdir(current_dir)

# 切换到GPT_SoVITS目录
print(f"下载GPT-SoVITS预训练模型到: {gpt_sovits_dir}")

# 使用ModelScope下载GPT-SoVITS预训练模型，带重试机制
if not download_with_retry("modelscope download --model AI-ModelScope/GPT-SoVITS --local_dir ./tts-studio/GPT_SoVITS/pretrained_models"):
    print("GPT-SoVITS预训练模型下载失败，终止程序")
    exit(1)

# 确认模型已下载
if not os.path.exists(pretrained_models_dir) or not os.listdir(pretrained_models_dir):
    print(f"错误：下载后无法找到预训练模型目录或目录为空: {pretrained_models_dir}")
    exit(1)

print(f"预训练模型已成功下载到: {pretrained_models_dir}")

# 5. 复制预训练模型到tts-studio/pretrained_models文件夹
# 确保我们在当前工作目录
os.chdir(current_dir)

# 创建目标目录
tts_pretrained_dir = os.path.join(tts_studio_dir, "pretrained_models")
if not os.path.exists(tts_pretrained_dir):
    os.makedirs(tts_pretrained_dir)
    print(f"创建目录: {tts_pretrained_dir}")

# 源文件夹中的所有文件
source_pretrained_dir = pretrained_models_dir
print(f"正在将预训练模型从 {source_pretrained_dir} 复制到 {tts_pretrained_dir}")

# 检查源文件夹中是否有文件
if os.path.exists(source_pretrained_dir) and os.listdir(source_pretrained_dir):
    # 复制文件夹中的所有内容
    print(f"复制预训练模型文件...")
    try:
        # 遍历源目录中的所有文件和文件夹
        for item in os.listdir(source_pretrained_dir):
            source_item = os.path.join(source_pretrained_dir, item)
            target_item = os.path.join(tts_pretrained_dir, item)
            
            # 如果是文件夹，递归复制整个文件夹
            if os.path.isdir(source_item):
                if os.path.exists(target_item):
                    shutil.rmtree(target_item)  # 如果目标已存在，先删除
                shutil.copytree(source_item, target_item)
                print(f"已复制文件夹: {item}")
            # 如果是文件，直接复制
            else:
                shutil.copy2(source_item, target_item)
                print(f"已复制文件: {item}")
        
        print("预训练模型复制完成")
    except Exception as e:
        print(f"复制预训练模型时出错: {str(e)}")
        exit(1)
else:
    print(f"错误：源预训练模型文件夹 {source_pretrained_dir} 不存在或为空")
    exit(1)

# 6. 下载fake_neuro_V2模型
print("\n开始下载fake_neuro_V2模型...")

# 创建tts-model目录
tts_model_dir = os.path.join(tts_studio_dir, "tts-model")
if not os.path.exists(tts_model_dir):
    os.makedirs(tts_model_dir)
    print(f"创建目录: {tts_model_dir}")

# 切换到tts-model目录
os.chdir(tts_model_dir)
print(f"下载fake_neuro_V2模型到: {os.getcwd()}")

# 使用ModelScope下载fake_neuro_V2模型，带重试机制
if not download_with_retry("modelscope download --model morelle/Fake-Neuro-TTS-V2 --local_dir ./"):
    print("fake_neuro_V2模型下载失败")
    # 不终止程序，因为这是额外的模型
else:
    print("fake_neuro_V2模型下载成功！")

# 7. 下载BAAI/bge-m3模型到RAG-model文件夹
print("\n开始下载BAAI/bge-m3模型...")

# 返回到原始目录
os.chdir(current_dir)

# 创建RAG-model目录
rag_model_dir = os.path.join(current_dir, "RAG-model")
if not os.path.exists(rag_model_dir):
    os.makedirs(rag_model_dir)
    print(f"创建目录: {rag_model_dir}")

print(f"下载BAAI/bge-m3模型到: {rag_model_dir}")

# 使用ModelScope下载BAAI/bge-m3模型，带重试机制
if not download_with_retry("modelscope download --model BAAI/bge-m3 --local_dir ./RAG-model"):
    print("BAAI/bge-m3模型下载失败")
    # 不终止程序，继续执行其他任务
else:
    print("BAAI/bge-m3模型下载成功！")

# 8. 下载UVR5权重文件到fine_tuning/tools/uvr5/uvr5_weights目录
print("\n开始下载UVR5权重文件...")

# 返回到原始目录
os.chdir(current_dir)

# 创建fine_tuning/tools/uvr5/uvr5_weights目录结构
uvr5_weights_dir = os.path.join(current_dir, "fine_tuning", "tools", "uvr5", "uvr5_weights")
if not os.path.exists(uvr5_weights_dir):
    os.makedirs(uvr5_weights_dir)
    print(f"创建目录: {uvr5_weights_dir}")

print(f"下载UVR5权重文件到: {uvr5_weights_dir}")

# 使用ModelScope下载UVR5权重文件，带重试机制
if not download_with_retry(f"modelscope download --model AI-ModelScope/uvr5_weights HP2_all_vocals.pth --local_dir {uvr5_weights_dir}"):
    print("UVR5权重文件下载失败")
    # 不终止程序，因为这是额外的模型
else:
    print("UVR5权重文件下载成功！")

# 9. 下载faster-whisper-medium模型到fine_tuning/tools/asr/models目录
print("\n开始下载faster-whisper-medium模型...")

# 返回到原始目录
os.chdir(current_dir)

# 创建fine_tuning/tools/asr/models目录结构
asr_models_dir = os.path.join(current_dir, "fine_tuning", "tools", "asr", "models")
faster_whisper_dir = os.path.join(asr_models_dir, "faster-whisper-medium")
if not os.path.exists(asr_models_dir):
    os.makedirs(asr_models_dir)
    print(f"创建目录: {asr_models_dir}")

print(f"下载faster-whisper-medium模型到: {faster_whisper_dir}")

# 使用ModelScope下载faster-whisper-medium模型，带重试机制
if not download_with_retry(f"modelscope download --model pengzhendong/faster-whisper-medium --local_dir {faster_whisper_dir}"):
    print("faster-whisper-medium模型下载失败")
    # 不终止程序，因为这是额外的模型
else:
    print("faster-whisper-medium模型下载成功！")

# 10. 下载nltk_data到tts-studio目录
print("\n开始下载nltk_data...")

# 返回到原始目录
os.chdir(current_dir)

# 确保tts-studio目录存在
if not os.path.exists(tts_studio_dir):
    os.makedirs(tts_studio_dir)
    print(f"创建目录: {tts_studio_dir}")

print(f"下载nltk_data到: {tts_studio_dir}")

# 使用ModelScope下载nltk_data，带重试机制
if not download_with_retry("modelscope download --model morelle/nltk_data --local_dir ./tts-studio"):
    print("nltk_data下载失败")
    # 不终止程序，因为这是额外的数据
else:
    print("nltk_data下载成功！")

print("\n所有下载操作全部完成！")











