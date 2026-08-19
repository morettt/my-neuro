# -*- coding: utf-8 -*-
"""后台工作线程：日志跟踪、压缩包安装、DLC 下载、LLM 模型列表拉取。"""
import json
import sys
from PyQt5.QtWidgets import *
from PyQt5.QtCore import *
from PyQt5.QtGui import *
from PyQt5.QtWidgets import QGridLayout, QWidget, QPushButton
from PyQt5 import uic
import subprocess
import time
import os
import urllib.request
import urllib.error
import ctypes
from PyQt5.QtCore import QMimeData
from PyQt5.QtGui import QDrag
import shutil
import re
import socket
from threading import Thread
import glob
import webbrowser
import requests
from pathlib import Path


class LogReader(QThread):
    """读取日志文件的线程"""
    log_signal = pyqtSignal(str)

    def __init__(self, log_file_path):
        super().__init__()
        self.log_file_path = log_file_path
        self.running = True

    def run(self):
        """实时读取日志文件"""
        while not os.path.exists(self.log_file_path) and self.running:
            time.sleep(0.1)

        if not self.running:
            return

        encodings = ['utf-8', 'gbk']
        file_handle = None

        for encoding in encodings:
            try:
                file_handle = open(self.log_file_path, 'r', encoding=encoding, errors='ignore')
                file_handle.seek(0, 2)
                break
            except Exception:
                if file_handle:
                    file_handle.close()
                continue

        if not file_handle:
            return

        try:
            while self.running:
                line = file_handle.readline()
                if line:
                    self.log_signal.emit(line.strip())
                else:
                    time.sleep(0.1)
        except Exception:
            pass
        finally:
            if file_handle:
                file_handle.close()

    def stop(self):
        self.running = False

class _ZipInstallWorker(QThread):
    """后台下载 ZIP 并解压安装插件（+ 可选 pip install），结果通过信号回到主线程"""
    done     = pyqtSignal(bool, str)  # (success, error_message)
    progress = pyqtSignal(str)        # 进度提示文字

    def __init__(self, repo_url, target_dir):
        super().__init__()
        self.repo_url   = repo_url
        self.target_dir = target_dir

    def run(self):
        import sys, re, io, zipfile, shutil
        try:
            # 解析 GitHub URL，提取 author/repo/branch
            cleaned = self.repo_url.rstrip('/')
            pattern = r'^https://github\.com/([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:/tree/([a-zA-Z0-9_/.-]+))?$'
            match = re.match(pattern, cleaned)
            if not match:
                self.done.emit(False, f"无效的 GitHub URL: {self.repo_url}")
                return
            author, repo, branch = match.group(1), match.group(2), match.group(3)

            # 构建下载 URL，优先使用指定分支，否则尝试 main，再尝试 master
            if branch:
                candidates = [f"https://github.com/{author}/{repo}/archive/refs/heads/{branch}.zip"]
            else:
                candidates = [
                    f"https://github.com/{author}/{repo}/archive/refs/heads/main.zip",
                    f"https://github.com/{author}/{repo}/archive/refs/heads/master.zip",
                ]

            self.progress.emit("正在下载...")
            response = None
            last_err = ""
            for zip_url in candidates:
                try:
                    r = requests.get(zip_url, timeout=120, stream=True)
                    if r.status_code == 200:
                        response = r
                        break
                    last_err = f"HTTP {r.status_code}"
                except Exception as e:
                    last_err = str(e)
            if response is None:
                self.done.emit(False, f"下载失败: {last_err}")
                return

            total = int(response.headers.get('content-length', 0))
            downloaded = 0
            chunks = []
            for chunk in response.iter_content(chunk_size=65536):
                if chunk:
                    chunks.append(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        pct = int(downloaded * 100 / total)
                        self.progress.emit(f'下载中 {pct}%')
                    else:
                        self.progress.emit(f'下载中 {downloaded // 1024}KB')

            self.progress.emit("正在解压...")
            zip_data = io.BytesIO(b''.join(chunks))
            os.makedirs(self.target_dir, exist_ok=True)
            with zipfile.ZipFile(zip_data) as zf:
                names = zf.namelist()
                root_dir = names[0].split('/')[0]
                zf.extractall(self.target_dir)

            # 将 zip 内第一层子目录的内容平铺到 target_dir
            extracted_root = os.path.join(self.target_dir, root_dir)
            for item in os.listdir(extracted_root):
                src = os.path.join(extracted_root, item)
                dst = os.path.join(self.target_dir, item)
                if os.path.exists(dst):
                    shutil.rmtree(dst) if os.path.isdir(dst) else os.remove(dst)
                shutil.move(src, self.target_dir)
            shutil.rmtree(extracted_root)

            # 安装依赖
            req_path = os.path.join(self.target_dir, 'requirements.txt')
            if os.path.exists(req_path):
                self.progress.emit("正在安装依赖...")
                pip_result = subprocess.run(
                    [sys.executable, '-m', 'pip', 'install', '-r', req_path],
                    capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300
                )
                if pip_result.returncode != 0:
                    self.done.emit(False, f'依赖安装失败:\n{pip_result.stderr.strip()}')
                    return

            self.done.emit(True, "")
        except Exception as ex:
            self.done.emit(False, str(ex))

class _DlcWorker(QThread):
    """后台下载并解压插件DLC，结果通过信号回到主线程"""
    done     = pyqtSignal(bool, str)  # (success, error_message)
    progress = pyqtSignal(str)        # 进度文字

    def __init__(self, url, dlc_dir):
        super().__init__()
        self.url = url
        self.dlc_dir = dlc_dir

    def run(self):
        import zipfile
        import io
        try:
            os.makedirs(self.dlc_dir, exist_ok=True)
            response = requests.get(self.url, timeout=180, stream=True)
            response.raise_for_status()

            total = int(response.headers.get('content-length', 0))
            downloaded = 0
            chunks = []
            for chunk in response.iter_content(chunk_size=65536):
                if chunk:
                    chunks.append(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        pct = int(downloaded * 100 / total)
                        self.progress.emit(f'下载中 {pct}%')
                    else:
                        self.progress.emit(f'下载中 {downloaded // 1024}KB')

            zip_data = io.BytesIO(b''.join(chunks))
            with zipfile.ZipFile(zip_data) as zf:
                names = zf.namelist()
                total_files = len(names)
                for i, name in enumerate(names, 1):
                    zf.extract(name, self.dlc_dir)
                    self.progress.emit(f'解压中 {i}/{total_files}')
            self.done.emit(True, '')
        except Exception as ex:
            self.done.emit(False, str(ex))

class LlmModelFetchWorker(QThread):
    """在后台请求 OpenAI 兼容接口的模型列表，避免阻塞界面。"""
    succeeded = pyqtSignal(list)
    failed = pyqtSignal(str)

    def __init__(self, api_url, api_key, parent=None):
        super().__init__(parent)
        self.api_url = api_url.strip()
        self.api_key = api_key.strip()

    @staticmethod
    def models_url(api_url):
        url = api_url.strip().rstrip('/')
        if not url:
            raise ValueError("请先填写 API URL")

        # 同时接受服务根地址、/v1 地址和完整的聊天接口地址。
        known_suffixes = (
            '/chat/completions', '/completions', '/responses', '/models'
        )
        for suffix in known_suffixes:
            if url.lower().endswith(suffix):
                url = url[:-len(suffix)].rstrip('/')
                break
        return f"{url}/models"

    def run(self):
        try:
            endpoint = self.models_url(self.api_url)
            headers = {'Accept': 'application/json'}
            if self.api_key:
                headers['Authorization'] = f'Bearer {self.api_key}'

            response = requests.get(endpoint, headers=headers, timeout=(8, 20))
            response.raise_for_status()
            payload = response.json()
            items = payload.get('data', payload) if isinstance(payload, dict) else payload
            if not isinstance(items, list):
                raise ValueError("接口返回格式不受支持：未找到模型列表")

            models = []
            for item in items:
                model_id = (item.get('id') or item.get('name')) if isinstance(item, dict) else item
                if model_id:
                    models.append(str(model_id))
            models = sorted(set(models), key=str.lower)
            if not models:
                raise ValueError("接口返回成功，但模型列表为空")
            self.succeeded.emit(models)
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else ''
            detail = ''
            if exc.response is not None:
                try:
                    body = exc.response.json()
                    detail = body.get('error', {}).get('message', '') if isinstance(body, dict) else ''
                except Exception:
                    detail = ''
            self.failed.emit(f"获取失败（HTTP {status}）{': ' + detail if detail else ''}")
        except requests.RequestException as exc:
            self.failed.emit(f"连接模型接口失败：{exc}")
        except (ValueError, TypeError) as exc:
            self.failed.emit(str(exc))
        except Exception as exc:
            self.failed.emit(f"获取模型失败：{exc}")
