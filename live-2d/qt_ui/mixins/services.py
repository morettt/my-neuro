# -*- coding: utf-8 -*-
"""本地服务进程管理：TTS/ASR/BERT/RAG/终端/Minecraft 启停与状态检测。"""
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

from ..paths import get_base_path, get_app_path, IS_CLOUD_VERSION, TEST_PY_DIR  # noqa: F401
from ..tool_descriptions import load_tool_descriptions  # noqa: F401
from ..workers import (  # noqa: F401
    LogReader, _ZipInstallWorker, _DlcWorker, LlmModelFetchWorker,
)
from ..widgets.toast import ToastNotification  # noqa: F401
from ..widgets.title_bar import CustomTitleBar  # noqa: F401


class ServicesMixin:
    """本地服务进程管理：TTS/ASR/BERT/RAG/终端/Minecraft 启停与状态检测。"""

    def scan_voice_models(self):
        """扫描当前目录下的pth模型文件"""
        try:
            import glob
            current_dir = TEST_PY_DIR
            pth_files = glob.glob(os.path.join(current_dir, "*.pth"))

            self.ui.comboBox_models.clear()
            if pth_files:
                for pth_file in pth_files:
                    model_name = os.path.basename(pth_file)
                    self.ui.comboBox_models.addItem(model_name, pth_file)
                self.toast.show_message(f"找到 {len(pth_files)} 个模型文件", 2000)
            else:
                self.toast.show_message("未找到pth模型文件，请将模型文件放在程序目录下", 3000)

        except Exception as e:
            self.toast.show_message(f"扫描模型文件失败：{str(e)}", 3000)


    def scan_reference_audio(self):
        """扫描当前目录下的wav音频文件"""
        try:
            import glob
            current_dir = TEST_PY_DIR
            wav_files = glob.glob(os.path.join(current_dir, "*.wav"))

            self.ui.comboBox_audio.clear()
            if wav_files:
                for wav_file in wav_files:
                    audio_name = os.path.basename(wav_file)
                    self.ui.comboBox_audio.addItem(audio_name, wav_file)
                self.toast.show_message(f"找到 {len(wav_files)} 个音频文件", 2000)
            else:
                self.toast.show_message("未找到wav音频文件，请将音频文件放在程序目录下", 3000)

        except Exception as e:
            self.toast.show_message(f"扫描音频文件失败：{str(e)}", 3000)


    def start_voice_tts(self):
        """启动声音克隆TTS服务"""
        try:
            # 检查是否已生成bat文件
            character_name = self.ui.lineEdit_character_name.text().strip()
            if not character_name:
                self.toast.show_message("请先生成bat文件", 2000)
                return

            current_dir = TEST_PY_DIR
            bat_path = os.path.join(current_dir, f"{character_name}_TTS.bat")

            if not os.path.exists(bat_path):
                self.toast.show_message("bat文件不存在，请先生成", 2000)
                return

            if self.voice_clone_process and self.voice_clone_process.poll() is None:
                self.toast.show_message("声音克隆服务已在运行中", 2000)
                return

            # 启动bat文件
            self.voice_clone_process = subprocess.Popen(
                bat_path,
                shell=True,
                cwd=current_dir,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                errors='ignore'
            )

            self.ui.label_voice_tts_status.setText("状态：声音克隆服务正在运行")
            self.toast.show_message("声音克隆服务启动成功", 2000)

        except Exception as e:
            error_msg = f"启动声音克隆服务失败：{str(e)}"
            self.toast.show_message(error_msg, 3000)
            self.ui.label_voice_tts_status.setText("状态：启动失败")


    def stop_voice_tts(self):
        """关闭声音克隆TTS服务"""
        try:
            # 通过进程名强制关闭TTS相关进程
            subprocess.run('wmic process where "name=\'python.exe\' and commandline like \'%tts_api%\'" delete',
                           shell=True, capture_output=True)

            # 清空进程引用
            self.voice_clone_process = None

            # 更新状态显示
            self.ui.label_voice_tts_status.setText("状态：声音克隆服务未启动")
            self.toast.show_message("声音克隆服务已关闭", 2000)

        except Exception as e:
            error_msg = f"关闭声音克隆服务失败：{str(e)}"
            self.toast.show_message(error_msg, 3000)


    def start_asr(self):
        """启动ASR服务"""
        try:
            if self.asr_process and self.asr_process.poll() is None:
                print("ASR服务已在运行中，无需重复启动")
                self.toast.show_message("ASR服务已在运行中", 2000)
                self.ui.label_asr_status.setText("状态：ASR服务正在运行")
                self.update_status_indicator('asr', True)
                return

            print("正在启动ASR终端.....")

            # 根据config中的百度流式ASR配置选择对应的bat文件
            cloud_config = self.config.get('cloud', {})
            use_baidu_asr = cloud_config.get('baidu_asr', {}).get('enabled', False)
            use_siliconflow_asr = cloud_config.get('siliconflow_asr', {}).get('enabled', False)
            base_path = get_base_path()

            if use_baidu_asr:  # 百度流式ASR不需要本地识别服务
                bat_file = os.path.join(base_path, "VAD.bat")
                asr_type_name = "百度流式ASR（仅VAD）"
            elif use_siliconflow_asr:
                # SiliconFlow 负责转写；现有 1.ASR.bat 同时提供端口1000的VAD。
                bat_file = os.path.join(base_path, "1.ASR.bat")
                asr_type_name = "SiliconFlow ASR（本地VAD）"
            else:  # 本地ASR
                bat_file = os.path.join(base_path, "1.ASR.bat")
                asr_type_name = "本地ASR"

            print(f"选择的ASR类型：{asr_type_name}")

            if not os.path.exists(bat_file):
                error_msg = f"找不到文件：{bat_file}"
                print(f"错误：{error_msg}")
                self.toast.show_message(error_msg, 3000)
                return

            # 直接打开新的cmd窗口运行bat文件
            self.asr_process = subprocess.Popen(
                f'start cmd /k "{bat_file}"',
                shell=True,
                cwd=base_path
            )

            print(f"ASR进程已启动，PID: {self.asr_process.pid}")
            print("当前ASR终端已成功启动！！！")

            self.ui.label_asr_status.setText(f"状态：{asr_type_name}服务正在运行")
            self.update_status_indicator('asr', True)
            self.toast.show_message(f"{asr_type_name}服务启动成功", 2000)

        except Exception as e:
            error_msg = f"启动ASR服务失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.ui.label_asr_status.setText("状态：启动失败")
            self.toast.show_message(error_msg, 3000)


    def stop_asr(self):
        """关闭ASR服务"""
        try:
            # 在ASR日志窗口显示关闭信息
            self.update_service_log('asr', "正在关闭ASR服务...")

            # 停止日志读取线程
            if 'asr' in self.log_readers:
                self.log_readers['asr'].stop()
                self.log_readers['asr'].wait()
                del self.log_readers['asr']

            # 通过端口1000查找并关闭ASR进程
            result = subprocess.run('netstat -ano | findstr :1000',
                                    shell=True, capture_output=True, text=True)

            if result.stdout:
                # 解析netstat输出，提取PID
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    parts = line.split()
                    if len(parts) >= 5 and 'LISTENING' in line:
                        pid = parts[-1]
                        # 杀掉进程
                        subprocess.run(f'taskkill /PID {pid} /F',
                                       shell=True, capture_output=True)
                        print(f"已关闭ASR进程 PID: {pid}")
                        self.update_service_log('asr', f"已关闭ASR进程 PID: {pid}")
                        break
            else:
                print("未找到监听端口1000的进程")
                self.update_service_log('asr', "未找到监听端口1000的进程")

            self.asr_process = None
            self.ui.label_asr_status.setText("状态：ASR服务未启动")
            self.update_status_indicator('asr', False)

            # 在日志窗口显示关闭完成信息
            self.update_service_log('asr', "当前ASR终端已关闭！！！")
            print("当前ASR终端已关闭！！！")  # 同时在控制台也打印

            self.toast.show_message("ASR服务已关闭", 2000)

        except Exception as e:
            error_msg = f"关闭ASR服务失败：{str(e)}"
            self.update_service_log('asr', f"错误：{error_msg}")
            print(f"错误：{error_msg}")
            self.toast.show_message(error_msg, 3000)


    def start_bert(self):
        """启动BERT服务"""
        try:
            if self.bert_process and self.bert_process.poll() is None:
                print("BERT服务已在运行中，无需重复启动")
                self.toast.show_message("BERT服务已在运行中", 2000)
                self.ui.label_bert_status.setText("状态：BERT服务正在运行")
                self.update_status_indicator('bert', True)
                return

            print("正在启动BERT终端.....")

            base_path = get_base_path()
            bat_file = os.path.join(base_path, "3.bert.bat")

            if not os.path.exists(bat_file):
                error_msg = f"找不到文件：{bat_file}"
                print(f"错误：{error_msg}")
                self.toast.show_message(error_msg, 3000)
                return

            # 直接打开新的cmd窗口运行bat文件
            self.bert_process = subprocess.Popen(
                f'start cmd /k "{bat_file}"',
                shell=True,
                cwd=base_path
            )

            print(f"BERT进程已启动，PID: {self.bert_process.pid}")
            print("当前BERT终端已成功启动！！！")

            self.ui.label_bert_status.setText("状态：BERT服务正在运行")
            self.update_status_indicator('bert', True)
            self.toast.show_message("BERT服务启动成功", 2000)

        except Exception as e:
            error_msg = f"启动BERT服务失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.ui.label_bert_status.setText("状态：启动失败")
            self.toast.show_message(error_msg, 3000)


    def stop_bert(self):
        """关闭BERT服务"""
        try:
            print("正在关闭BERT终端...")
            self.update_service_log('bert', "正在关闭BERT服务...")

            # 停止日志读取线程
            if 'bert' in self.log_readers:
                self.log_readers['bert'].stop()
                self.log_readers['bert'].wait()
                del self.log_readers['bert']

            # 通过端口6007查找并关闭BERT进程
            result = subprocess.run('netstat -ano | findstr :6007',
                                    shell=True, capture_output=True, text=True)

            if result.stdout:
                # 解析netstat输出，提取PID
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    parts = line.split()
                    if len(parts) >= 5 and 'LISTENING' in line:
                        pid = parts[-1]
                        # 杀掉进程
                        subprocess.run(f'taskkill /PID {pid} /F',
                                       shell=True, capture_output=True)
                        print(f"已关闭BERT进程 PID: {pid}")
                        self.update_service_log('bert', f"已关闭BERT进程 PID: {pid}")
                        break
            else:
                print("未找到监听端口6007的进程")
                self.update_service_log('bert', "未找到监听端口6007的进程")

            self.bert_process = None
            self.ui.label_bert_status.setText("状态：BERT服务未启动")
            self.update_status_indicator('bert', False)

            print("当前BERT终端已关闭！！！")
            self.update_service_log('bert', "当前BERT终端已关闭！！！")
            self.toast.show_message("BERT服务已关闭", 2000)

        except Exception as e:
            error_msg = f"关闭BERT服务失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.update_service_log('bert', f"错误：{error_msg}")
            self.toast.show_message(error_msg, 3000)


    def start_rag(self):
        """启动RAG服务"""
        try:
            if self.rag_process and self.rag_process.poll() is None:
                print("RAG服务已在运行中，无需重复启动")
                self.toast.show_message("RAG服务已在运行中", 2000)
                self.ui.label_rag_status.setText("状态：RAG服务正在运行")
                self.update_status_indicator('rag', True)
                return

            print("正在启动RAG终端.....")

            base_path = get_base_path()
            bat_file = os.path.join(base_path, "plugins-dlc", "memos", "MEMOS-API.bat")

            if not os.path.exists(bat_file):
                error_msg = f"找不到文件：{bat_file}"
                print(f"错误：{error_msg}")
                self.toast.show_message(error_msg, 3000)
                return

            # 直接打开新的cmd窗口运行bat文件
            self.rag_process = subprocess.Popen(
                f'start cmd /k "{bat_file}"',
                shell=True,
                cwd=base_path
            )

            print(f"RAG进程已启动，PID: {self.rag_process.pid}")
            print("当前RAG终端已成功启动！！！")

            self.ui.label_rag_status.setText("状态：RAG服务正在运行")
            self.update_status_indicator('rag', True)
            self.toast.show_message("RAG服务启动成功", 2000)

        except Exception as e:
            error_msg = f"启动RAG服务失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.ui.label_rag_status.setText("状态：启动失败")
            self.toast.show_message(error_msg, 3000)


    def stop_rag(self):
        """关闭RAG服务"""
        try:
            print("正在关闭RAG终端...")
            self.update_service_log('rag', "正在关闭RAG服务...")

            # 停止日志读取线程
            if 'rag' in self.log_readers:
                self.log_readers['rag'].stop()
                self.log_readers['rag'].wait()
                del self.log_readers['rag']

            # 通过端口8002查找并关闭RAG进程
            result = subprocess.run('netstat -ano | findstr :8002',
                                    shell=True, capture_output=True, text=True)

            if result.stdout:
                # 解析netstat输出，提取PID
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    parts = line.split()
                    if len(parts) >= 5 and 'LISTENING' in line:
                        pid = parts[-1]
                        # 杀掉进程
                        subprocess.run(f'taskkill /PID {pid} /F',
                                       shell=True, capture_output=True)
                        print(f"已关闭RAG进程 PID: {pid}")
                        self.update_service_log('rag', f"已关闭RAG进程 PID: {pid}")
                        break
            else:
                print("未找到监听端口8002的进程")
                self.update_service_log('rag', "未找到监听端口8002的进程")

            self.rag_process = None
            self.ui.label_rag_status.setText("状态：RAG服务未启动")
            self.update_status_indicator('rag', False)

            print("当前RAG终端已关闭！！！")
            self.update_service_log('rag', "当前RAG终端已关闭！！！")
            self.toast.show_message("RAG服务已关闭", 2000)

        except Exception as e:
            error_msg = f"关闭RAG服务失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.update_service_log('rag', f"错误：{error_msg}")
            self.toast.show_message(error_msg, 3000)


    # 新增关闭后台服务的方法
    def stop_terminal(self):
        """关闭TTS服务"""
        try:
            print("正在关闭TTS终端...")
            self.update_service_log('tts', "正在关闭TTS服务...")

            # 停止日志读取线程
            if 'tts' in self.log_readers:
                self.log_readers['tts'].stop()
                self.log_readers['tts'].wait()
                del self.log_readers['tts']

            # 通过端口5000查找并关闭TTS进程
            result = subprocess.run('netstat -ano | findstr :5000',
                                    shell=True, capture_output=True, text=True)

            if result.stdout:
                # 解析netstat输出，提取PID
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    parts = line.split()
                    if len(parts) >= 5 and 'LISTENING' in line:
                        pid = parts[-1]
                        # 杀掉进程
                        subprocess.run(f'taskkill /PID {pid} /F',
                                       shell=True, capture_output=True)
                        print(f"已关闭TTS进程 PID: {pid}")
                        self.update_service_log('tts', f"已关闭TTS进程 PID: {pid}")
                        break
            else:
                print("未找到监听端口5000的进程")
                self.update_service_log('tts', "未找到监听端口5000的进程")

            # 清空进程引用
            self.terminal_process = None

            # 更新状态显示
            self.ui.label_terminal_status.setText("状态：TTS服务未启动")
            self.update_status_indicator('tts', False)

            print("当前TTS终端已关闭！！！")
            self.update_service_log('tts', "当前TTS终端已关闭！！！")
            self.toast.show_message("TTS服务已关闭", 2000)

        except Exception as e:
            error_msg = f"关闭TTS服务失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.update_service_log('tts', f"错误：{error_msg}")
            self.toast.show_message(error_msg, 3000)

            # 即使出错也更新状态
            self.terminal_process = None
            self.ui.label_terminal_status.setText("状态：TTS服务未启动")


    def start_terminal(self):
        """启动TTS服务"""
        try:
            if self.terminal_process and self.terminal_process.poll() is None:
                print("TTS服务已在运行中，无需重复启动")
                self.toast.show_message("TTS服务已在运行中", 2000)
                self.ui.label_terminal_status.setText("状态：TTS服务正在运行")
                self.update_status_indicator('tts', True)
                return

            print("正在启动TTS终端.....")

            base_path = get_base_path()
            bat_file = os.path.join(base_path, "2.TTS.bat")

            if not os.path.exists(bat_file):
                error_msg = f"找不到文件：{bat_file}"
                print(f"错误：{error_msg}")
                self.toast.show_message(error_msg, 3000)
                return

            print(f"启动TTS.bat文件: {bat_file}")

            # 直接打开新的cmd窗口运行bat文件
            self.terminal_process = subprocess.Popen(
                f'start cmd /k "{bat_file}"',
                shell=True,
                cwd=base_path
            )

            print(f"TTS进程已启动，PID: {self.terminal_process.pid}")
            print("当前TTS终端已成功启动！！！")

            self.ui.label_terminal_status.setText("状态：TTS服务正在运行")
            self.update_status_indicator('tts', True)
            self.toast.show_message("TTS服务启动成功", 2000)

        except Exception as e:
            error_msg = f"启动TTS服务失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.ui.label_terminal_status.setText("状态：启动失败")
            self.toast.show_message(error_msg, 3000)


    def start_minecraft_terminal(self):
        """启动Minecraft游戏终端"""
        try:
            if self.minecraft_terminal_process and hasattr(self.minecraft_terminal_process, 'poll') and self.minecraft_terminal_process.poll() is None:
                self.toast.show_message("Minecraft游戏终端已在运行中", 2000)
                return

            app_path = get_app_path()
            bat_file = os.path.join(app_path, "GAME", "Minecraft", "开启游戏终端.bat")
            
            if not os.path.exists(bat_file):
                error_msg = f"找不到文件：{bat_file}"
                print(f"错误：{error_msg}")
                self.toast.show_message(error_msg, 3000)
                return

            print("正在启动Minecraft游戏终端.....")
            
            # 启动bat文件 - 直接用os.system启动新cmd窗口
            minecraft_dir = os.path.join(app_path, "GAME", "Minecraft")
            current_dir = os.getcwd()  # 保存当前目录
            
            os.chdir(minecraft_dir)
            os.system(f'start cmd /k "{bat_file}"')
            os.chdir(current_dir)  # 恢复原来的目录
            
            # 保持进程引用为了后续管理
            self.minecraft_terminal_process = True  # 标记为已启动

            print("Minecraft游戏终端进程已启动")
            print("当前Minecraft游戏终端已成功启动！！！")
            
            self.toast.show_message("Minecraft游戏终端启动成功", 2000)

        except Exception as e:
            error_msg = f"启动Minecraft游戏终端失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.toast.show_message(error_msg, 3000)


    def stop_minecraft_terminal(self):
        """关闭Minecraft游戏终端"""
        try:
            if self.minecraft_terminal_process and hasattr(self.minecraft_terminal_process, 'poll') and self.minecraft_terminal_process.poll() is None:
                self.minecraft_terminal_process.terminate()
                self.minecraft_terminal_process = None
                print("Minecraft游戏终端已关闭")
                self.toast.show_message("Minecraft游戏终端已关闭", 2000)
            else:
                self.minecraft_terminal_process = None  # 重置状态
                self.toast.show_message("Minecraft游戏终端未在运行", 2000)
        except Exception as e:
            error_msg = f"关闭Minecraft游戏终端失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.toast.show_message(error_msg, 3000)


    def check_all_service_status(self):
        """启动时检查所有服务状态并更新UI - 使用多线程并发检查"""
        from concurrent.futures import ThreadPoolExecutor

        # 定义需要检查的服务列表
        services = [
            ('tts', 5000, 'label_terminal_status'),
            ('asr', 1000, 'label_asr_status'),
            ('bert', 6007, 'label_bert_status'),
            ('rag', 8002, 'label_rag_status')
        ]

        # 使用线程池并发检查所有服务
        with ThreadPoolExecutor(max_workers=4) as executor:
            for service_name, port, status_label in services:
                executor.submit(self.check_service_status, service_name, port, status_label)


    def check_service_status(self, service_name, port, status_label):
        """检查单个服务状态"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.5)  # 优化: 从1秒减少到0.5秒
            result = sock.connect_ex(('localhost', port))
            sock.close()

            if result == 0:
                # 服务正在运行
                getattr(self.ui, status_label).setText(f"状态：{service_name.upper()}服务正在运行")
                self.update_status_indicator(service_name, True)
            else:
                # 服务未运行
                getattr(self.ui, status_label).setText(f"状态：{service_name.upper()}服务未启动")
                self.update_status_indicator(service_name, False)
        except Exception:
            getattr(self.ui, status_label).setText(f"状态：{service_name.upper()}服务未启动")
            self.update_status_indicator(service_name, False)


    def update_status_indicator(self, service_name, is_running):
        """更新状态指示器"""
        indicators = {
            'tts': 'label_tts_status_indicator',
            'asr': 'label_asr_status_indicator',
            'bert': 'label_bert_status_indicator',
            'rag': 'label_rag_status_indicator'
        }

        if service_name in indicators:
            indicator = getattr(self.ui, indicators[service_name], None)
            if indicator:
                if is_running:
                    indicator.setText("●")
                    indicator.setStyleSheet("color: #00AA00; font-size: 20px;")
                else:
                    indicator.setText("○")
                    indicator.setStyleSheet("color: #888888; font-size: 20px;")
