import requests
import os
import sys
import zipfile
import shutil
import json
import logging
from pathlib import Path

# Fixed: 添加日志配置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('update.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

def now_version():
    """获取当前版本号"""
    try:
        config_path = Path("live-2d/config.json")
        if not config_path.exists():
            logger.error("配置文件不存在: live-2d/config.json")
            return "unknown"
        
        with open(config_path, 'r', encoding="utf-8") as f:
            config = json.load(f)
            return config.get('version', 'unknown')
    except (json.JSONDecodeError, KeyError) as e:
        logger.error(f"读取版本信息失败: {e}")
        return "unknown"
    except Exception as e:
        logger.error(f"获取当前版本时出错: {e}")
        return "unknown"

def get_latest_release():
    """获取最新发布版本"""
    url = "https://api.github.com/repos/morettt/my-neuro/releases/latest"
    try:
        # 发送 HTTP 请求
        response = requests.get(url, headers={"Accept": "application/vnd.github+json"}, timeout=30)
        response.raise_for_status()  # 检查请求是否成功

        # 解析 JSON 数据
        data = response.json()
        # 提取 tag_name 字段并去掉 "v" 前缀
        version = data.get("tag_name", "unknown")
        logger.info(f"获取到最新版本: {version}")
        return version

    except requests.RequestException as e:
        error_msg = f"请求错误: {e}"
        logger.error(error_msg)
        return error_msg
    except KeyError as e:
        error_msg = f"未找到版本信息: {e}"
        logger.error(error_msg)
        return error_msg
    except Exception as e:
        error_msg = f"解析错误: {e}"
        logger.error(error_msg)
        return error_msg

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

    logger.info(f"正在下载: {file_name}...")
    
    try:
        response = requests.get(url, stream=True, timeout=300)
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

        logger.info("下载完成!")
        return file_name
    except Exception as e:
        logger.error(f"下载文件失败: {e}")
        if os.path.exists(file_name):
            os.remove(file_name)
        raise

def extract_zip(zip_file, target_folder):
    """解压ZIP文件到指定文件夹并显示进度"""
    logger.info(f"正在解压 {zip_file} 到 {target_folder}...")

    if not os.path.exists(target_folder):
        os.makedirs(target_folder)
        logger.info(f"已创建目标文件夹: {target_folder}")

    try:
        with zipfile.ZipFile(zip_file, 'r') as zip_ref:
            # 获取zip文件中的所有文件列表
            file_list = zip_ref.namelist()
            total_files = len(file_list)

            # 逐个解压文件并显示进度
            for index, file in enumerate(file_list):
                try:
                    # 修复中文文件名编码问题
                    try:
                        # 尝试使用CP437解码然后使用GBK/GB2312重新编码
                        correct_filename = file.encode('cp437').decode('gbk')
                    except (UnicodeDecodeError, UnicodeEncodeError):
                        # 如果编码转换失败，使用原始文件名
                        correct_filename = file
                    
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
                    logger.warning(f"解压文件 {file} 时出错: {e}")
                    # 如果编码转换失败，直接使用原始路径
                    try:
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
                    except Exception as e2:
                        logger.error(f"备用解压方法也失败: {e2}")

                # 计算解压百分比
                percent = int((index + 1) * 100 / total_files)

                # 显示进度条
                display_progress_bar(
                    percent,
                    "解压进度",
                    current=index + 1,
                    total=total_files
                )

        logger.info("解压完成!")
        logger.info(f"所有文件已解压到 '{target_folder}' 文件夹")
        return True

    except zipfile.BadZipFile:
        error_msg = "错误: 下载的文件不是有效的ZIP格式"
        logger.error(error_msg)
        return False
    except Exception as e:
        error_msg = f"解压过程中出错: {e}"
        logger.error(error_msg)
        return False

# 修正后的Live2D下载函数
def download_live2d_model():
    """下载并解压Live 2D模型到live-2d文件夹"""
    logger.info("========== 下载Live 2D模型 ==========")

    try:
        # 获取最新发布信息
        api_url = "https://api.github.com/repos/morettt/my-neuro/releases/latest"
        response = requests.get(api_url, timeout=30)
        response.raise_for_status()
        data = response.json()

        # 检查是否有assets
        if not data.get('assets'):
            logger.error("错误：未找到可下载的文件")
            return False

        # 提取下载URL和文件名
        live2d_url = data['assets'][0]['browser_download_url']
        filename = data['assets'][0]['name']

    except Exception as e:
        logger.error(f"获取下载链接失败: {e}")
        return False

    target_folder = "live-2d"

    try:
        # 下载文件
        downloaded_file = download_file(live2d_url, filename)

        # 解压文件
        extract_success = extract_zip(downloaded_file, target_folder)

        # 清理：删除ZIP文件
        if extract_success and os.path.exists(downloaded_file):
            os.remove(downloaded_file)
            logger.info(f"原ZIP文件 {downloaded_file} 已删除")

        return extract_success
    except Exception as e:
        logger.error(f"下载Live2D模型失败: {e}")
        return False

def backup_and_restore_memory():
    """备份并恢复记忆库"""
    folder_path = "live-2d"
    memory_file = os.path.join(folder_path, "记忆库.txt")
    memory_content = None  # 用来标记是否有备份内容

    # 尝试读取记忆库内容（如果存在的话）
    if os.path.exists(memory_file):
        try:
            with open(memory_file, 'r', encoding='utf-8') as file:
                memory_content = file.read()
            logger.info("成功读取记忆库内容，已备份")
        except Exception as e:
            logger.error(f"读取记忆库文件时出错: {e}")
            memory_content = None
    else:
        logger.info("记忆库文件不存在，跳过备份")

    # 删除整个live-2d文件夹
    try:
        if os.path.exists(folder_path):
            shutil.rmtree(folder_path)
            logger.info(f"成功删除 {folder_path} 文件夹")
    except Exception as e:
        logger.error(f"删除文件夹时出错: {e}")
        return

    # 下载最新文件
    download_success = download_live2d_model()
    
    if not download_success:
        logger.error("下载失败，无法恢复记忆库")
        return

    # 只有原来存在记忆库文件时才恢复
    if memory_content is not None:
        try:
            # 确保目录存在
            os.makedirs(os.path.dirname(memory_file), exist_ok=True)
            with open(memory_file, 'w', encoding='utf-8') as file:
                file.write(memory_content)
            logger.info("成功恢复记忆库内容")
        except Exception as e:
            logger.error(f"恢复文件时出错: {e}")
    else:
        logger.info("无需恢复记忆库文件")

def main():
    """主函数"""
    try:
        current_version = now_version()
        logger.info(f"当前版本: {current_version}")

        latest_version = get_latest_release()
        if "错误" in latest_version or "未找到" in latest_version:
            logger.error(latest_version)
            return
        elif latest_version == current_version:
            logger.info(f"当前版本：{current_version} 已是最新版本")
        else:
            logger.info(f"找到最新版本：{latest_version}")
            logger.info("开始下载最新版本...")
            backup_and_restore_memory()
    except Exception as e:
        logger.error(f"更新过程中发生错误: {e}")

if __name__ == "__main__":
    main()
