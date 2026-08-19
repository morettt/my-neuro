# -*- coding: utf-8 -*-
"""云端 TTS/ASR 服务商配置页与声音克隆（模型/音频选择、bat 生成）。"""
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


class VoiceCloneMixin:
    """云端 TTS/ASR 服务商配置页与声音克隆（模型/音频选择、bat 生成）。"""

    def setup_cloud_tts_provider_tab(self):
        """把阿里云与字节 TTS 合并为单一平台选择器。"""
        tab_widget = self.ui.tabWidget_cloud_config
        tab = self.ui.tab_cloud_aliyun_tts
        volcengine_tab = self.ui.tab_cloud_volcengine_tts
        siliconflow_tab = self.ui.tab_cloud_tts

        tab_index = tab_widget.indexOf(tab)
        tab_widget.setTabText(tab_index, "云端 TTS")
        volcengine_index = tab_widget.indexOf(volcengine_tab)
        if volcengine_index >= 0:
            tab_widget.removeTab(volcengine_index)
        siliconflow_index = tab_widget.indexOf(siliconflow_tab)
        if siliconflow_index >= 0:
            tab_widget.removeTab(siliconflow_index)

        layout = tab.layout()
        while layout.count():
            layout.takeAt(0)

        for obsolete_name in (
            'label_aliyun_tts_title', 'label_aliyun_tts_api_key',
            'label_aliyun_tts_model', 'label_aliyun_tts_voice',
            'label_volcengine_tts_title', 'label_volcengine_tts_appid',
            'label_volcengine_tts_access_token', 'label_volcengine_tts_voice_type'
        ):
            obsolete_widget = getattr(self.ui, obsolete_name, None)
            if obsolete_widget:
                obsolete_widget.hide()

        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)

        title = QLabel("🔊 云端 TTS 配置")
        title.setStyleSheet("font-size: 18px; font-weight: bold;")
        layout.addWidget(title)

        platform_row = QHBoxLayout()
        platform_row.addWidget(QLabel("TTS 平台："))
        self.ui.comboBox_cloud_tts_provider = QComboBox()
        self.ui.comboBox_cloud_tts_provider.addItem("阿里云 TTS", "aliyun")
        self.ui.comboBox_cloud_tts_provider.addItem("字节 TTS", "volcengine")
        self.ui.comboBox_cloud_tts_provider.addItem("SiliconFlow TTS", "siliconflow")
        platform_row.addWidget(self.ui.comboBox_cloud_tts_provider, 1)
        layout.addLayout(platform_row)

        self.ui.checkBox_cloud_tts_provider_enabled = QCheckBox("启用云端 TTS")
        layout.addWidget(self.ui.checkBox_cloud_tts_provider_enabled)

        self.ui.stackedWidget_cloud_tts_provider = QStackedWidget()

        aliyun_page = QWidget()
        aliyun_form = QFormLayout(aliyun_page)
        aliyun_form.setHorizontalSpacing(18)
        aliyun_form.setVerticalSpacing(12)
        aliyun_form.addRow("API Key：", self.ui.lineEdit_aliyun_tts_api_key)
        aliyun_form.addRow("模型：", self.ui.lineEdit_aliyun_tts_model)
        aliyun_form.addRow("音色：", self.ui.lineEdit_aliyun_tts_voice)
        self.ui.stackedWidget_cloud_tts_provider.addWidget(aliyun_page)

        volcengine_page = QWidget()
        volcengine_form = QFormLayout(volcengine_page)
        volcengine_form.setHorizontalSpacing(18)
        volcengine_form.setVerticalSpacing(12)
        volcengine_form.addRow("APP ID：", self.ui.lineEdit_volcengine_tts_appid)
        volcengine_form.addRow("Access Token：", self.ui.lineEdit_volcengine_tts_access_token)
        volcengine_form.addRow("音色类型：", self.ui.lineEdit_volcengine_tts_voice_type)
        self.ui.stackedWidget_cloud_tts_provider.addWidget(volcengine_page)

        siliconflow_page = QWidget()
        siliconflow_form = QFormLayout(siliconflow_page)
        siliconflow_form.setHorizontalSpacing(18)
        siliconflow_form.setVerticalSpacing(12)
        siliconflow_form.addRow("API Key：", self.ui.lineEdit_cloud_api_key)
        siliconflow_form.addRow("音色：", self.ui.lineEdit_cloud_tts_voice)
        self.ui.stackedWidget_cloud_tts_provider.addWidget(siliconflow_page)

        layout.addWidget(self.ui.stackedWidget_cloud_tts_provider)
        layout.addStretch()

        self.ui.checkBox_aliyun_tts_enabled.hide()
        self.ui.checkBox_volcengine_tts_enabled.hide()
        self.ui.checkBox_cloud_tts_enabled.hide()
        self.ui.comboBox_cloud_tts_provider.currentIndexChanged.connect(
            self.on_cloud_tts_provider_changed)
        self.ui.checkBox_cloud_tts_provider_enabled.toggled.connect(
            self.on_cloud_tts_provider_enabled_changed)
        self.on_cloud_tts_provider_changed(0)


    def on_cloud_tts_provider_changed(self, index):
        """切换 TTS 平台表单；总开关开启时直接改用新平台。"""
        self.ui.stackedWidget_cloud_tts_provider.setCurrentIndex(index)
        if (self.ui.checkBox_cloud_tts_provider_enabled.isChecked()
                and not self._loading_config_ui):
            self.on_cloud_tts_provider_enabled_changed(True)


    def on_cloud_tts_provider_enabled_changed(self, enabled):
        """启用所选 TTS 平台，并自动关闭另一个平台。"""
        index = self.ui.comboBox_cloud_tts_provider.currentIndex()
        self.ui.checkBox_aliyun_tts_enabled.setChecked(enabled and index == 0)
        self.ui.checkBox_volcengine_tts_enabled.setChecked(enabled and index == 1)
        self.ui.checkBox_cloud_tts_enabled.setChecked(enabled and index == 2)


    def setup_siliconflow_asr_tab(self):
        """创建单一平台选择器，按所选平台切换对应的 ASR 配置表单。"""
        tab = self.ui.tab_cloud_asr
        old_layout = tab.layout()
        tab_index = self.ui.tabWidget_cloud_config.indexOf(tab)
        self.ui.tabWidget_cloud_config.setTabText(tab_index, "云端 ASR")

        # 保留 Designer 中已有的百度输入框，清空旧布局后重新组织页面。
        while old_layout.count():
            old_layout.takeAt(0)

        for obsolete_name in (
            'label_cloud_asr_title', 'label_cloud_asr_url',
            'label_cloud_asr_appid', 'label_cloud_asr_appkey',
            'label_cloud_asr_dev_pid'
        ):
            obsolete_widget = getattr(self.ui, obsolete_name, None)
            if obsolete_widget:
                obsolete_widget.hide()

        layout = old_layout
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)

        title = QLabel("🎤 云端 ASR 配置")
        title.setStyleSheet("font-size: 18px; font-weight: bold;")
        layout.addWidget(title)

        platform_row = QHBoxLayout()
        platform_row.addWidget(QLabel("ASR 平台："))
        self.ui.comboBox_cloud_asr_provider = QComboBox()
        self.ui.comboBox_cloud_asr_provider.addItem("百度流式 ASR", "baidu")
        self.ui.comboBox_cloud_asr_provider.addItem("SiliconFlow ASR", "siliconflow")
        platform_row.addWidget(self.ui.comboBox_cloud_asr_provider, 1)
        layout.addLayout(platform_row)

        self.ui.checkBox_cloud_asr_provider_enabled = QCheckBox("启用云端 ASR")
        layout.addWidget(self.ui.checkBox_cloud_asr_provider_enabled)

        self.ui.stackedWidget_cloud_asr_provider = QStackedWidget()

        baidu_page = QWidget()
        baidu_form = QFormLayout(baidu_page)
        baidu_form.setHorizontalSpacing(18)
        baidu_form.setVerticalSpacing(12)
        baidu_form.addRow("WebSocket URL：", self.ui.lineEdit_cloud_asr_url)
        baidu_form.addRow("APP ID：", self.ui.lineEdit_cloud_asr_appid)
        baidu_form.addRow("APP KEY：", self.ui.lineEdit_cloud_asr_appkey)
        baidu_form.addRow("DEV PID：", self.ui.lineEdit_cloud_asr_dev_pid)
        self.ui.stackedWidget_cloud_asr_provider.addWidget(baidu_page)

        siliconflow_page = QWidget()
        form = QFormLayout(siliconflow_page)
        form.setHorizontalSpacing(18)
        form.setVerticalSpacing(12)

        self.ui.lineEdit_siliconflow_asr_api = QLineEdit()
        self.ui.lineEdit_siliconflow_asr_api.setPlaceholderText(
            "https://api.siliconflow.cn/v1/audio/transcriptions"
        )
        form.addRow("API 地址：", self.ui.lineEdit_siliconflow_asr_api)

        self.ui.lineEdit_siliconflow_asr_key = QLineEdit()
        self.ui.lineEdit_siliconflow_asr_key.setEchoMode(QLineEdit.Password)
        self.ui.lineEdit_siliconflow_asr_key.setPlaceholderText("sk-...")
        form.addRow("API Key：", self.ui.lineEdit_siliconflow_asr_key)

        self.ui.lineEdit_siliconflow_asr_model = QLineEdit()
        self.ui.lineEdit_siliconflow_asr_model.setPlaceholderText("TeleAI/TeleSpeechASR")
        form.addRow("模型：", self.ui.lineEdit_siliconflow_asr_model)

        self.ui.stackedWidget_cloud_asr_provider.addWidget(siliconflow_page)
        layout.addWidget(self.ui.stackedWidget_cloud_asr_provider)
        layout.addStretch()

        # 旧开关仍作为配置存储控件使用，但不再直接展示。
        self.ui.checkBox_cloud_asr_enabled.hide()
        self.ui.checkBox_siliconflow_asr_enabled = QCheckBox()
        self.ui.checkBox_siliconflow_asr_enabled.hide()

        self.ui.comboBox_cloud_asr_provider.currentIndexChanged.connect(
            self.on_cloud_asr_provider_changed)
        self.ui.checkBox_cloud_asr_provider_enabled.toggled.connect(
            self.on_cloud_asr_provider_enabled_changed)
        self.on_cloud_asr_provider_changed(0)


    def on_cloud_asr_provider_changed(self, index):
        """切换 ASR 平台表单；总开关开启时直接改用新平台。"""
        self.ui.stackedWidget_cloud_asr_provider.setCurrentIndex(index)
        if (self.ui.checkBox_cloud_asr_provider_enabled.isChecked()
                and not self._loading_config_ui):
            self.on_cloud_asr_provider_enabled_changed(True)


    def on_cloud_asr_provider_enabled_changed(self, enabled):
        """启用所选平台；启用时自动关闭另一个平台。"""
        index = self.ui.comboBox_cloud_asr_provider.currentIndex()
        self.ui.checkBox_cloud_asr_enabled.setChecked(enabled and index == 0)
        self.ui.checkBox_siliconflow_asr_enabled.setChecked(enabled and index == 1)


    def voice_clone_dragEnterEvent(self, event: QDragEnterEvent):
        """
        处理拖拽对象进入控件区域的事件。
        """
        # 检查拖拽的数据中是否包含URL（也就是文件）
        if event.mimeData().hasUrls():
            # 获取第一个URL来检查文件类型
            url = event.mimeData().urls()[0]
            if url.isLocalFile():
                file_path = url.toLocalFile()
                # 如果是 .pth 或 .wav 文件，就接受这个拖放动作
                if file_path.lower().endswith(('.pth', '.wav')):
                    event.acceptProposedAction()


    def voice_clone_dropEvent(self, event: QDropEvent):
        """
        处理文件在控件上被释放（放下）的事件。
        """
        for url in event.mimeData().urls():
            if url.isLocalFile():
                file_path = url.toLocalFile()
                filename = os.path.basename(file_path)

                # 确保目标文件夹存在
                app_path = get_app_path()
                voice_model_dir = os.path.join(app_path, "Voice_Model_Factory")
                if not os.path.exists(voice_model_dir):
                    os.makedirs(voice_model_dir)

                dest_path = os.path.join(voice_model_dir, filename)

                try:
                    # 复制文件
                    shutil.copy2(file_path, dest_path)

                    # 根据文件类型，更新对应的UI元素
                    if file_path.lower().endswith('.pth'):
                        self.selected_model_path = dest_path
                        self.ui.label_model_status.setText(f"已上传：{filename}")
                        self.toast.show_message(f"模型已拖拽上传至 Voice_Model_Factory", 2000)

                    elif file_path.lower().endswith('.wav'):
                        self.selected_audio_path = dest_path
                        self.ui.label_audio_status.setText(f"已上传：{filename}")
                        self.toast.show_message(f"音频已拖拽上传至 Voice_Model_Factory", 2000)

                except Exception as e:
                    self.toast.show_message(f"文件处理失败: {str(e)}", 3000)


    # 添加文件选择方法：
    def select_model_file(self):
        """选择模型文件"""
        try:
            from PyQt5.QtWidgets import QFileDialog
            file_path, _ = QFileDialog.getOpenFileName(
                self,
                "选择模型文件",
                "",
                "PyTorch模型文件 (*.pth);;所有文件 (*)"
            )

            if file_path:
                # 确保Voice_Model_Factory文件夹存在
                app_path = get_app_path()
                voice_model_dir = os.path.join(app_path, "Voice_Model_Factory")
                if not os.path.exists(voice_model_dir):
                    os.makedirs(voice_model_dir)

                # 获取文件名并构建目标路径
                filename = os.path.basename(file_path)
                dest_path = os.path.join(voice_model_dir, filename)

                # 复制文件到Voice_Model_Factory文件夹
                shutil.copy2(file_path, dest_path)

                self.selected_model_path = dest_path
                self.ui.label_model_status.setText(f"已上传：{filename}")
                self.toast.show_message(f"模型文件已保存到Voice_Model_Factory", 2000)

        except Exception as e:
            self.toast.show_message(f"选择模型文件失败：{str(e)}", 3000)


    def select_audio_file(self):
        """选择音频文件"""
        try:
            from PyQt5.QtWidgets import QFileDialog
            file_path, _ = QFileDialog.getOpenFileName(
                self,
                "选择音频文件",
                "",
                "音频文件 (*.wav);;所有文件 (*)"
            )

            if file_path:
                # 确保Voice_Model_Factory文件夹存在
                app_path = get_app_path()
                voice_model_dir = os.path.join(app_path, "Voice_Model_Factory")
                if not os.path.exists(voice_model_dir):
                    os.makedirs(voice_model_dir)

                # 获取文件名并构建目标路径
                filename = os.path.basename(file_path)
                dest_path = os.path.join(voice_model_dir, filename)

                # 复制文件到Voice_Model_Factory文件夹
                shutil.copy2(file_path, dest_path)

                self.selected_audio_path = dest_path
                self.ui.label_audio_status.setText(f"已上传：{filename}")
                self.toast.show_message(f"音频文件已保存到Voice_Model_Factory", 2000)

        except Exception as e:
            self.toast.show_message(f"选择音频文件失败：{str(e)}", 3000)


    def generate_voice_clone_bat(self):
        """使用上传文件生成声音克隆的bat文件"""
        try:
            # 获取用户输入
            text = self.ui.textEdit_voice_text.toPlainText().strip()
            if not text:
                self.toast.show_message("请输入要合成的文本内容", 2000)
                return

            character_name = self.ui.lineEdit_character_name.text().strip()
            if not character_name:
                self.toast.show_message("请输入角色名称", 2000)
                return

            # 检查是否已选择文件
            if not self.selected_model_path or not os.path.exists(self.selected_model_path):
                self.toast.show_message("请先选择模型文件", 2000)
                return

            if not self.selected_audio_path or not os.path.exists(self.selected_audio_path):
                self.toast.show_message("请先选择音频文件", 2000)
                return

            # 获取语言选择
            language = self.ui.comboBox_language.currentText().split(' - ')[0]  # 提取语言代码

            # 使用绝对路径来引用模型和音频文件
            model_path = os.path.abspath(self.selected_model_path)
            audio_path = os.path.abspath(self.selected_audio_path)

            # 生成命令 - 使用绝对路径
            cmd = (f"python api.py -p 5000 -d cuda "
                   f"-s \"{model_path}\" -dr \"{audio_path}\" -dt \"{text}\" -dl {language}")

            # 创建bat文件在Voice_Model_Factory文件夹里
            app_path = get_app_path()
            voice_model_dir = os.path.join(app_path, "Voice_Model_Factory")
            bat_path = os.path.join(voice_model_dir, f"{character_name}_TTS.bat")

            # 写入bat文件内容 - 使用新的路径结构
            with open(bat_path, "w", encoding="gbk") as bat_file:
                bat_file.write("@echo off\n")
                bat_file.write('set "PATH=%~dp0..\\..\\full-hub\\tts-hub\\GPT-SoVITS-Bundle\\runtime;%PATH%"\n')
                bat_file.write("cd %~dp0..\\..\\full-hub\\tts-hub\\GPT-SoVITS-Bundle\n")
                bat_file.write(f"{cmd}\n")
                bat_file.write("pause\n")

            self.toast.show_message(f"生成成功：{character_name}_TTS.bat", 2000)
            self.ui.label_bat_status.setText(f"已生成：Voice_Model_Factory/{character_name}_TTS.bat")

            print(f"使用模型：{os.path.basename(self.selected_model_path)}")
            print(f"使用音频：{os.path.basename(self.selected_audio_path)}")
            print(f"使用语言：{language}")

        except Exception as e:
            self.toast.show_message(f"生成失败：{str(e)}", 3000)
            self.ui.label_bat_status.setText("生成失败")
