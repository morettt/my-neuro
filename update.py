import requests
import os
import sys
import zipfile
import shutil
import json


current_path = os.path.dirname(os.path.realpath(__file__))
current_dir = os.getcwd()

def now_version():
    with open(r"live-2d\config.json", 'r', encoding="utf-8") as f:
        return json.load(f)['version']


def get_latest_release():
    url = "https://api.github.com/repos/morettt/my-neuro/releases/latest"
    try:
        # 发送 HTTP 请求
        response = requests.get(url, headers={"Accept": "application/vnd.github+json"})
        response.raise_for_status()  # 检查请求是否成功

        # 解析 JSON 数据
        data = response.json()
        # 提取 tag_name 字段并去掉 "v" 前缀
        version = data["tag_name"]
        return version

    except requests.RequestException as e:
        return f"请求错误: {e}"
    except KeyError:
        return "未找到版本信息"
    except Exception as e:
        return f"解析错误: {e}"


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
    response = requests.get(url, stream=True)

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


# Live2D下载函数
def download_live2d_model():
    """下载并解压Live 2D模型到live-2d文件夹"""
    print("\n========== 下载Live 2D模型 ==========")

    try:
        # 获取最新发布信息
        api_url = "https://api.github.com/repos/morettt/my-neuro/releases/latest"
        response = requests.get(api_url)
        response.raise_for_status()
        data = response.json()

        # 检查是否有assets
        if not data.get('assets'):
            print("错误：未找到可下载的文件")
            return False

        # 提取下载URL和文件名
        live2d_url = data['assets'][0]['browser_download_url']
        filename = data['assets'][0]['name']

    except Exception as e:
        print(f"获取下载链接失败: {e}")
        return False

    target_folder = "live-2d"

    # 下载文件
    downloaded_file = download_file(live2d_url, filename)

    # 解压文件
    extract_success = extract_zip(downloaded_file, target_folder)

    # 清理：删除压缩文件
    if extract_success and os.path.exists(downloaded_file):
        os.remove(downloaded_file)
        print(f"原压缩文件 {downloaded_file} 已删除")

    return extract_success


def backup_and_restore_memory():
    folder_path = "live-2d"
    memory_file = os.path.join(folder_path, "AI记录室/记忆库.txt")
    memory_content = None  # 用来标记是否有备份内容
    global current_path
    backup_path = os.path.join(current_path, "memory_backup.txt")

    # 尝试读取记忆库内容（如果存在的话）
    if os.path.exists(memory_file):
        if input("读取到存在的记忆文件，如果你已经备份过记忆，备份操作将覆盖旧的备份文件\n是否备份(y/n):") == "y":
            try:
                with open(memory_file, 'r', encoding='utf-8') as file:
                    memory_content = file.read()
                    with open(backup_path, 'w', encoding='utf-8') as file2:
                        file2.write(memory_content)
                print("成功读取记忆库内容，已备份")
            except Exception as e:
                print(f"读取记忆库文件时出错: {e}")
                memory_content = None
        else:
            print("跳过备份")
    else:
        print("记忆库文件不存在，跳过备份")

    # 删除整个live-2d文件夹
    if input("确认更新(y/n):") == 'y':
        print("开始更新")
        try:
            print("正在删除旧版文件...")
            if os.path.exists(folder_path):
                shutil.rmtree(folder_path)
                print(f"成功删除 {folder_path} 文件夹")
        except Exception as e:
            print(f"删除文件夹时出错: {e}")
            return

        # 下载最新文件
        download_live2d_model()

        # 只有原来存在记忆库文件时才恢复
        if os.path.exists(backup_path):
            print("开始恢复记忆库...")
            try:
                with open(backup_path, 'r', encoding='utf-8') as file:
                    memory_content = file.read()
                with open(memory_file, 'w', encoding='utf-8') as file:
                    file.write(memory_content)
                print("成功恢复记忆库内容")

                os.remove(backup_path)
                print('清理记忆库缓存文本')

            except Exception as e:
                print(f"恢复文件时出错: {e}")
        else:
            print("无备份记忆库文件，不恢复")
    else:
        print("已停止更新")


current_version = now_version()

if __name__ == "__main__":
    latest_version = get_latest_release()
    if "错误" in latest_version or "未找到" in latest_version:
        print(latest_version)
    elif latest_version == current_version:
        print(f"当前版本：{current_version} 已是最新版本")
    else:
        print(f"找到最新版本：{latest_version}")
        print("开始下载最新版本...")
        backup_and_restore_memory()
