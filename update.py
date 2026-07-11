import requests
import os
import sys
import zipfile
import shutil
import json
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent


def now_version():
    with open(PROJECT_ROOT / "live-2d" / "config.json", 'r', encoding="utf-8") as f:
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


# 添加下载文件函数（支持断点续传）
def download_file(url, file_name=None, max_retries=5):
    """下载文件并显示进度条，支持断点续传和自动重试"""
    if file_name is None:
        file_name = url.split('/')[-1]

    # 添加请求头
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }

    # 检查文件是否已部分下载
    downloaded_size = 0
    if os.path.exists(file_name):
        downloaded_size = os.path.getsize(file_name)
        print(f"检测到未完成的下载，已下载: {downloaded_size / (1024 * 1024):.2f}MB")

    retry_count = 0

    while retry_count < max_retries:
        try:
            # 如果有已下载的部分，使用Range头继续下载
            if downloaded_size > 0:
                headers['Range'] = f'bytes={downloaded_size}-'
                print(f"正在从 {downloaded_size / (1024 * 1024):.2f}MB 处继续下载...")
            else:
                print(f"正在下载: {file_name}...")

            response = requests.get(url, stream=True, headers=headers, timeout=30)

            # 检查服务器是否支持断点续传
            if downloaded_size > 0 and response.status_code == 206:
                print("✓ 服务器支持断点续传")
                mode = 'ab'  # 追加模式
            elif downloaded_size > 0 and response.status_code == 200:
                print("✗ 服务器不支持断点续传，重新下载")
                downloaded_size = 0
                mode = 'wb'
            else:
                mode = 'wb'

            # 获取总大小
            if 'content-length' in response.headers:
                content_length = int(response.headers.get('content-length', 0))
                if response.status_code == 206:
                    # 206响应时，content-length是剩余部分
                    total_size = downloaded_size + content_length
                else:
                    # 200响应时，content-length是总大小
                    total_size = content_length
            else:
                # 如果是206响应，从content-range获取总大小
                if response.status_code == 206:
                    content_range = response.headers.get('content-range', '')
                    if content_range:
                        total_size = int(content_range.split('/')[-1])
                    else:
                        total_size = downloaded_size
                else:
                    total_size = 0

            # 开始下载
            with open(file_name, mode) as file:
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

        except (requests.exceptions.ChunkedEncodingError,
                requests.exceptions.ConnectionError,
                requests.exceptions.Timeout,
                Exception) as e:
            retry_count += 1
            print(f"\n✗ 下载中断: {e}")

            if retry_count < max_retries:
                wait_time = min(retry_count * 2, 10)  # 等待时间递增，最多10秒
                print(f"等待 {wait_time} 秒后自动重试... (第 {retry_count}/{max_retries} 次重试)")
                time.sleep(wait_time)

                # 检查当前已下载的大小
                if os.path.exists(file_name):
                    downloaded_size = os.path.getsize(file_name)
            else:
                print(f"已重试 {max_retries} 次，下载失败")
                raise Exception(f"下载失败: {e}")

    raise Exception("下载失败：超过最大重试次数")


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
                    # 直接提取到目标文件夹
                    zip_ref.extract(file, target_folder)

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


# 修改下载函数，支持指定目标文件夹
def download_live2d_model_to_temp(target_folder):
    """下载并解压Live 2D模型到指定文件夹"""
    print(f"\n========== 下载Live 2D模型到 {target_folder} ==========")

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

        # 提取GitHub原始下载URL和文件名
        github_url = data['assets'][0]['browser_download_url']
        filename = data['assets'][0]['name']
        download_path = PROJECT_ROOT / filename

    except Exception as e:
        print(f"获取下载链接失败: {e}")
        return False

    # 定义多个下载源（按优先级排序）
    download_sources = [
        ('香港镜像', f'https://hk.gh-proxy.org/{github_url}'),
        ('备用镜像', f'https://gh-proxy.org/{github_url}'),
        ('GitHub原版', github_url)
    ]

    downloaded_file = None

    # 依次尝试每个下载源
    for source_name, url in download_sources:
        try:
            print(f"\n尝试使用 {source_name} 下载...")
            downloaded_file = download_file(url, download_path)
            print(f"✓ {source_name} 下载成功!")
            break  # 下载成功就跳出循环
        except Exception as e:
            print(f"✗ {source_name} 下载失败: {e}")
            # 注意：不要删除不完整的文件，因为下次可以断点续传

            if source_name != download_sources[-1][0]:  # 如果不是最后一个源
                print("尝试下一个下载源...")
            else:
                print("\n所有下载源都已尝试失败!")
                print("=" * 60)
                print("\n📌 手动更新步骤:")
                print("1. 打开网址: https://github.com/morettt/my-neuro/releases")
                print("2. 找到版本号最高的 my-neuro (版本号)正式版")
                print("3. 下载里面的 live-2d.zip 文件")
                print("4. 解压并覆盖live-2d 这个文件夹里面")
                print('5. 可通过这种方法来完成手动更新')
                print("=" * 60 + "\n")

                # 即使失败也不删除部分下载的文件
                if os.path.exists(download_path):
                    print(f"⚠️ 保留部分下载的文件 {download_path}，下次运行可继续下载")

                return False

    # 解压文件
    if downloaded_file:
        extract_success = extract_zip(downloaded_file, target_folder)

        # 清理：删除压缩文件
        if os.path.exists(downloaded_file):
            os.remove(downloaded_file)
            print(f"原压缩文件 {downloaded_file} 已删除")

        return extract_success

    return False


def backup_and_restore_memory():
    folder_path = PROJECT_ROOT / "live-2d"
    temp_folder = PROJECT_ROOT / "live-2d-temp"  # 临时文件夹
    memory_file = os.path.join(folder_path, "AI记录室/记忆库.txt")
    memory_content = None  # 用来标记是否有备份内容
    backup_path = PROJECT_ROOT / "memory_backup.txt"

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

    if input("确认更新(y/n):") == 'y':
        print("开始更新")

        # 清理可能存在的旧临时文件夹
        if os.path.exists(temp_folder):
            print("检测到旧的临时文件夹，正在清理...")
            try:
                shutil.rmtree(temp_folder)
            except Exception as e:
                print(f"清理临时文件夹失败: {e}")
                return

        # 下载最新文件到临时文件夹
        print("正在下载到临时文件夹...")
        download_success = download_live2d_model_to_temp(temp_folder)

        if not download_success:
            print("下载失败，保留原有文件，不进行更新")
            # 清理失败的临时文件夹
            if os.path.exists(temp_folder):
                shutil.rmtree(temp_folder)
            return

        # 下载成功后，才删除旧文件夹并重命名
        try:
            print("下载成功！正在替换旧版本...")

            # 删除旧的live-2d文件夹
            if os.path.exists(folder_path):
                shutil.rmtree(folder_path)
                print(f"已删除旧版本 {folder_path}")

            # 将临时文件夹重命名为live-2d
            os.rename(temp_folder, folder_path)
            print(f"已将新版本重命名为 {folder_path}")

        except Exception as e:
            print(f"替换文件夹时出错: {e}")
            print("尝试恢复...")
            # 如果重命名失败，尝试恢复
            if os.path.exists(temp_folder) and not os.path.exists(folder_path):
                os.rename(temp_folder, folder_path)
            return

        # 恢复记忆库
        if os.path.exists(backup_path):
            print("开始恢复记忆库...")
            try:
                new_memory_file = os.path.join(folder_path, "AI记录室/记忆库.txt")
                with open(backup_path, 'r', encoding='utf-8') as file:
                    memory_content = file.read()
                with open(new_memory_file, 'w', encoding='utf-8') as file:
                    file.write(memory_content)
                print("成功恢复记忆库内容")

                os.remove(backup_path)
                print('清理记忆库缓存文本')

            except Exception as e:
                print(f"恢复文件时出错: {e}")
        else:
            print("无备份记忆库文件，不恢复")

        print("✓ 更新完成！")
    else:
        print("已停止更新")


if __name__ == "__main__":
    current_version = now_version()
    latest_version = get_latest_release()
    if "错误" in latest_version or "未找到" in latest_version:
        print(latest_version)
    elif latest_version == current_version:
        print(f"当前版本：{current_version} 已是最新版本")
    else:
        print(f"找到最新版本：{latest_version}")
        print("开始下载最新版本...")
        backup_and_restore_memory()
