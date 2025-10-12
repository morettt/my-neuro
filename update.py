import subprocess

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


def extract_archive(archive_file, target_folder):
    """解压压缩文件（自动下载7z工具）"""
    print(f"正在解压 {archive_file} 到 {target_folder}...")

    if not os.path.exists(target_folder):
        os.makedirs(target_folder)
        print(f"已创建目标文件夹: {target_folder}")

    try:
        if archive_file.endswith('.7z'):
            # 检查本地是否有7z.exe
            local_7z = os.path.join(current_dir, "7z", "7z.exe")
            local_7z_dll = os.path.join(current_dir, "7z", "7z.dll")

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
                    print("\n请手动下载7-Zip并安装，或手动解压 live-2d.7z 文件")
                    return False

            print('正在解压live-2d文件，请耐心等待.......')

            # 使用7z解压
            cmd = f'"{local_7z}" x "{archive_file}" -o"{target_folder}" -y'
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)

            if result.returncode == 0:
                print("\n解压完成!")
                print(f"所有文件已解压到 '{target_folder}' 文件夹")
                return True
            else:
                print(f"\n解压失败: {result.stderr}")
                return False

        elif archive_file.endswith('.zip'):
            print("使用zipfile解压zip文件...")
            with zipfile.ZipFile(archive_file, 'r') as zip_ref:
                zip_ref.extractall(target_folder)
            print("\n解压完成!")
            return True

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
    extract_success = extract_archive(downloaded_file, target_folder)

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
