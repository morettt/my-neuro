# -*- coding: utf-8 -*-
"""设置页：配置读写、LLM 模型拉取、API Key 可见性。"""
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


class SettingsMixin:
    """设置页：配置读写、LLM 模型拉取、API Key 可见性。"""

    def set_btu(self):
        self.ui.pushButton.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(1))
        self.ui.pushButton.clicked.connect(self._tutorial_on_llm_clicked)
        self.ui.comboBox_llm_model.activated.connect(self._tutorial_on_model_selected)
        self.ui.pushButton_3.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(0))
        self.ui.pushButton_3.clicked.connect(self._tutorial_on_start_page_clicked)
        self.ui.pushButton_5.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(2))
        self.ui.pushButton_animation.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(3))  # 动画
        self.ui.pushButton_terminal.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(6))
        self.ui.pushButton_voice_clone.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(5))  # 声音克隆页面
        self.ui.pushButton_ui_settings.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(9))  # UI设置页面
        self.ui.pushButton_tools.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(8))  # 工具屋页面
        self.ui.pushButton_cloud_config.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(10))  # 云端配置页面
        self.ui.pushButton_prompt_market.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(11))  # 提示词广场页面
        self.setup_plugins_page()
        self.ui.pushButton_plugins.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(self._plugins_page_index))
        self.ui.pushButton_chat_history.clicked.connect(self.open_chat_history)  # 对话记录页面
        self.ui.saveConfigButton.clicked.connect(self.save_config)
        self.ui.pushButton_fetch_llm_models.clicked.connect(self.fetch_llm_models)
        self.ui.comboBox_llm_model.setInsertPolicy(QComboBox.NoInsert)
        self.ui.comboBox_llm_model.completer().setCompletionMode(QCompleter.PopupCompletion)
        self.ui.comboBox_llm_model.completer().setCaseSensitivity(Qt.CaseInsensitive)
        # 复位皮套位置按钮
        self.ui.pushButton_reset_model_position.clicked.connect(self.reset_model_position)
        # 调整字幕位置按钮
        self.ui.pushButton_adjust_subtitle_position.clicked.connect(self.adjust_subtitle_position)
        # 桌宠切换按钮（合并启动和关闭）
        self.ui.pushButton_toggle_live2d.clicked.connect(self.toggle_live_2d)
        self.ui.pushButton_toggle_live2d.clicked.connect(self._tutorial_on_pet_toggle_clicked)
        self.live2d_running = False  # 桌宠运行状态标志
        self.ui.pushButton_clearLog.clicked.connect(self.clear_logs)
        self.ui.pushButton_start_terminal.clicked.connect(self.start_terminal)
        self.ui.pushButton_stop_terminal.clicked.connect(self.stop_terminal)  # 新增
        # 新增按钮绑定
        self.ui.pushButton_start_asr.clicked.connect(self.start_asr)
        self.ui.pushButton_stop_asr.clicked.connect(self.stop_asr)
        self.ui.pushButton_start_bert.clicked.connect(self.start_bert)
        self.ui.pushButton_stop_bert.clicked.connect(self.stop_bert)
        self.ui.pushButton_start_rag.clicked.connect(self.start_rag)
        self.ui.pushButton_stop_rag.clicked.connect(self.stop_rag)

        # 添加声音克隆按钮绑定
        self.ui.pushButton_generate_bat.clicked.connect(self.generate_voice_clone_bat)
        self.ui.pushButton_select_model.clicked.connect(self.select_model_file)
        self.ui.pushButton_select_audio.clicked.connect(self.select_audio_file)
        self.ui.pushButton_tutorial.clicked.connect(self.show_tutorial)
        self.ui.pushButton_volcengine_tts_tutorial.clicked.connect(lambda: webbrowser.open('http://mynewbot.com/tutorials/ByteDance-TTS'))

        self.ui.pushButton_back_to_home.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(0))

        # 工具广场相关按钮绑定
        self.ui.pushButton_refresh_tools.clicked.connect(self.refresh_tool_market)
        self.init_tool_market_table()

        # 提示词广场相关按钮绑定
        self.ui.pushButton_refresh_prompts.clicked.connect(self.refresh_prompt_market)
        self.ui.pushButton_back_from_prompt_market.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(0))
        self.init_prompt_market_table()

        # 对话记录相关按钮绑定
        self.ui.pushButton_back_from_chat_history.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(0))

        # Live2D模型选择
        self.ui.comboBox_live2d_models.currentIndexChanged.connect(self.on_model_selection_changed)

        # 云端肥牛网页导航按钮
        self.ui.pushButton_gateway_website.clicked.connect(self.open_gateway_website)

        # 云端/本地样式预览切换
        self._previewing_local = not IS_CLOUD_VERSION  # 本地版本初始即为本地样式
        self.ui.pushButton_toggle_cloud_preview.clicked.connect(self.toggle_cloud_preview)
        self._update_cloud_preview_button()

        # 初始化桌宠切换按钮样式（默认为"启动"状态）
        self.update_toggle_button_style(False)


    def fetch_llm_models(self):
        """根据当前 API URL 和 Key 获取可用的 LLM 模型。"""
        if self.llm_model_fetch_worker and self.llm_model_fetch_worker.isRunning():
            return

        api_url = self.ui.lineEdit_2.text().strip()
        api_key = self.ui.lineEdit.text().strip()
        if not api_url:
            self.toast.show_message("请先填写 API URL", 2500)
            self.ui.lineEdit_2.setFocus()
            return

        button = self.ui.pushButton_fetch_llm_models
        button.setEnabled(False)
        button.setText("正在获取...")
        self.llm_model_fetch_worker = LlmModelFetchWorker(api_url, api_key, self)
        self.llm_model_fetch_worker.succeeded.connect(self.on_llm_models_fetched)
        self.llm_model_fetch_worker.failed.connect(self.on_llm_models_fetch_failed)
        self.llm_model_fetch_worker.finished.connect(self.on_llm_models_fetch_finished)
        self.llm_model_fetch_worker.start()


    def on_llm_models_fetched(self, models):
        combo = self.ui.comboBox_llm_model
        current_model = combo.currentText()
        combo.blockSignals(True)
        combo.clear()
        combo.addItems(models)
        # 只刷新候选项：保留用户原有模型，不擅自改选或清空。
        combo.setCurrentIndex(-1)
        combo.setEditText(current_model)
        combo.blockSignals(False)
        self.toast.show_message(f"已获取 {len(models)} 个模型", 2500)
        combo.setFocus()
        QTimer.singleShot(0, combo.showPopup)


    def on_llm_models_fetch_failed(self, message):
        self.toast.show_message(message, 4500)


    def on_llm_models_fetch_finished(self):
        button = self.ui.pushButton_fetch_llm_models
        button.setEnabled(True)
        button.setText("获取模型")


    def set_config(self):
        self._loading_config_ui = True
        self.ui.lineEdit.setText(self.config['llm']['api_key'])
        self.ui.lineEdit_2.setText(self.config['llm']['api_url'])
        self.ui.comboBox_llm_model.setEditText(self.config['llm']['model'])
        self.ui.textEdit_3.setPlainText(self.config['llm']['system_prompt'])
        self.ui.doubleSpinBox_temperature.setValue(self.config['llm'].get('temperature', 1.0))
        self.ui.checkBox_temperature_enabled.setChecked(self.config['llm'].get('temperature_enabled', False))
        self.ui.lineEdit_4.setText(self.config['ui']['intro_text'])
        self.ui.lineEdit_5.setText(str(self.config['context']['max_messages']))
        self.ui.checkBox_mcp_enable.setChecked(self.config.get('mcp', {}).get('enabled', True))
        self.ui.checkBox_5.setChecked(self.config['vision']['auto_screenshot'])
        self.ui.checkBox_3.setChecked(self.config['ui']['show_chat_box'])
        self.ui.checkBox_4.setChecked(self.config['context']['enable_limit'])
        # 新增ASR和TTS配置
        self.ui.checkBox_asr.setChecked(self.config['asr']['enabled'])
        self.ui.checkBox_tts.setChecked(self.config['tts']['enabled'])
        self.ui.checkBox_persistent_history.setChecked(self.config['context']['persistent_history'])
        self.ui.checkBox_voice_barge_in.setChecked(self.config['asr']['voice_barge_in'])
        self.ui.checkBox_ptt_enabled.setChecked(self.config['asr'].get('ptt_enabled', False))

        # 新增：设置TTS语言下拉框
        tts_language = self.ui.comboBox_tts_language.currentText().split(' - ')[0]
        index = self.ui.comboBox_tts_language.findText(tts_language)
        if index >= 0:
            self.ui.comboBox_tts_language.setCurrentIndex(index)

        # 新增：设置UI设置配置
        subtitle_labels = self.config.get('subtitle_labels', {})
        self.ui.checkBox_subtitle_enabled.setChecked(subtitle_labels.get('enabled', True))
        self.ui.lineEdit_user_name.setText(subtitle_labels.get('user', '用户'))
        self.ui.lineEdit_ai_name.setText(subtitle_labels.get('ai', 'Fake Neuro'))

        # 新增：设置隐藏皮套配置
        ui_config = self.config.get('ui', {})
        show_model = ui_config.get('show_model', True)
        self.ui.checkBox_hide_model.setChecked(not show_model)  # 注意：勾选表示隐藏，所以需要取反

        # 新增：设置自动关闭服务配置
        auto_close_services = self.config.get('auto_close_services', {})
        self.ui.checkBox_auto_close_services.setChecked(auto_close_services.get('enabled', True))

        # 新增：设置云端配置
        cloud_config = self.config.get('cloud', {})
        # 通用云端配置（两个标签页都设置）
        provider = cloud_config.get('provider', 'siliconflow')
        api_key = cloud_config.get('api_key', '')
        self.ui.lineEdit_cloud_provider.setText(provider)
        self.ui.lineEdit_cloud_api_key.setText(api_key)

        # 云端TTS配置
        cloud_tts = cloud_config.get('tts', {})
        self.ui.checkBox_cloud_tts_enabled.setChecked(cloud_tts.get('enabled', False))
        self.ui.lineEdit_cloud_tts_url.setText(cloud_tts.get('url', 'https://api.siliconflow.cn/v1/audio/speech'))
        self.ui.lineEdit_cloud_tts_model.setText(cloud_tts.get('model', 'FunAudioLLM/CosyVoice2-0.5B'))
        self.ui.lineEdit_cloud_tts_voice.setText(cloud_tts.get('voice', ''))
        # 设置音频格式下拉框
        tts_format = cloud_tts.get('response_format', 'mp3')
        format_index = self.ui.comboBox_cloud_tts_format.findText(tts_format)
        if format_index >= 0:
            self.ui.comboBox_cloud_tts_format.setCurrentIndex(format_index)
        self.ui.doubleSpinBox_cloud_tts_speed.setValue(cloud_tts.get('speed', 1.0))

        # 阿里云TTS配置
        aliyun_tts = cloud_config.get('aliyun_tts', {})
        self.ui.checkBox_aliyun_tts_enabled.setChecked(aliyun_tts.get('enabled', False))
        self.ui.lineEdit_aliyun_tts_api_key.setText(aliyun_tts.get('api_key', ''))
        self.ui.lineEdit_aliyun_tts_model.setText(aliyun_tts.get('model', 'cosyvoice-v3-flash'))
        self.ui.lineEdit_aliyun_tts_voice.setText(aliyun_tts.get('voice', ''))

        # 字节TTS配置
        volcengine_tts = cloud_config.get('volcengine_tts', {})
        self.ui.checkBox_volcengine_tts_enabled.setChecked(volcengine_tts.get('enabled', False))
        self.ui.lineEdit_volcengine_tts_appid.setText(volcengine_tts.get('appid', ''))
        self.ui.lineEdit_volcengine_tts_access_token.setText(volcengine_tts.get('access_token', ''))
        self.ui.lineEdit_volcengine_tts_voice_type.setText(volcengine_tts.get('voice_type', 'saturn_zh_female_keainvsheng_tob'))
        # 与实际运行优先级一致：字节 > 阿里云 > SiliconFlow。
        if volcengine_tts.get('enabled', False):
            tts_provider_index = 1
        elif aliyun_tts.get('enabled', False):
            tts_provider_index = 0
        elif cloud_tts.get('enabled', False):
            tts_provider_index = 2
        else:
            tts_provider_index = 0
        self.ui.comboBox_cloud_tts_provider.setCurrentIndex(tts_provider_index)
        self.on_cloud_tts_provider_changed(tts_provider_index)
        self.ui.checkBox_cloud_tts_provider_enabled.blockSignals(True)
        self.ui.checkBox_cloud_tts_provider_enabled.setChecked(
            volcengine_tts.get('enabled', False)
            or aliyun_tts.get('enabled', False)
            or cloud_tts.get('enabled', False)
        )
        self.ui.checkBox_cloud_tts_provider_enabled.blockSignals(False)

        # 百度流式ASR配置
        baidu_asr = cloud_config.get('baidu_asr', {})
        self.ui.checkBox_cloud_asr_enabled.setChecked(baidu_asr.get('enabled', False))
        self.ui.lineEdit_cloud_asr_url.setText(baidu_asr.get('url', 'ws://vop.baidu.com/realtime_asr'))
        self.ui.lineEdit_cloud_asr_appid.setText(str(baidu_asr.get('appid', '')))
        self.ui.lineEdit_cloud_asr_appkey.setText(baidu_asr.get('appkey', ''))
        self.ui.lineEdit_cloud_asr_dev_pid.setText(str(baidu_asr.get('dev_pid', 15372)))

        # SiliconFlow ASR 配置
        siliconflow_asr = cloud_config.get('siliconflow_asr', {})
        self.ui.checkBox_siliconflow_asr_enabled.setChecked(siliconflow_asr.get('enabled', False))
        self.ui.lineEdit_siliconflow_asr_api.setText(siliconflow_asr.get(
            'api', 'https://api.siliconflow.cn/v1/audio/transcriptions'))
        self.ui.lineEdit_siliconflow_asr_key.setText(siliconflow_asr.get('key', ''))
        self.ui.lineEdit_siliconflow_asr_model.setText(siliconflow_asr.get(
            'model', 'TeleAI/TeleSpeechASR'))
        # 自动显示当前启用的平台；都未启用时默认显示百度。
        provider_index = 1 if siliconflow_asr.get('enabled', False) else 0
        self.ui.comboBox_cloud_asr_provider.setCurrentIndex(provider_index)
        self.on_cloud_asr_provider_changed(provider_index)
        self.ui.checkBox_cloud_asr_provider_enabled.blockSignals(True)
        self.ui.checkBox_cloud_asr_provider_enabled.setChecked(
            baidu_asr.get('enabled', False) or siliconflow_asr.get('enabled', False)
        )
        self.ui.checkBox_cloud_asr_provider_enabled.blockSignals(False)

        # 云端肥牛配置（API Gateway）
        api_gateway = self.config.get('api_gateway', {})
        self.ui.checkBox_gateway_enabled.setChecked(api_gateway.get('use_gateway', False))
        self.ui.lineEdit_gateway_base_url.setText(api_gateway.get('base_url', ''))
        self.ui.lineEdit_gateway_api_key.setText(api_gateway.get('api_key', ''))

        # 新增：设置辅助视觉模型配置
        vision_config = self.config.get('vision', {})
        self.ui.checkBox_use_vision_model.setChecked(vision_config.get('use_vision_model', True))
        vision_model_config = vision_config.get('vision_model', {})
        self.ui.lineEdit_vision_api_key.setText(vision_model_config.get('api_key', ''))
        self.ui.lineEdit_vision_api_url.setText(vision_model_config.get('api_url', ''))
        self.ui.lineEdit_vision_model.setText(vision_model_config.get('model', ''))

        # 新增：设置VMC配置（如果控件已创建）
        if hasattr(self, 'checkBox_vmc_enabled'):
            vmc_config = self.config.get('vmc', {})
            self.checkBox_vmc_enabled.setChecked(vmc_config.get('enabled', False))
            self.lineEdit_vmc_host.setText(vmc_config.get('host', '127.0.0.1'))
            self.lineEdit_vmc_port.setText(str(vmc_config.get('port', 39539)))
        self._loading_config_ui = False


    def load_config(self):
        with open(self.config_path, 'r', encoding='utf-8') as f:
            return json.load(f)


    def save_config(self):
        # 如果当前在插件详情页，同时保存插件配置
        if self.ui.stackedWidget.currentIndex() == self._plugins_detail_index:
            self._save_plugin_detail()
            return

        current_config = self.load_config()

        current_config['llm'] = {
            "api_key": self.ui.lineEdit.text(),
            "api_url": self.ui.lineEdit_2.text(),
            "model": self.ui.comboBox_llm_model.currentText().strip(),
            "temperature_enabled": self.ui.checkBox_temperature_enabled.isChecked(),
            "temperature": self.ui.doubleSpinBox_temperature.value(),
            "system_prompt": self.ui.textEdit_3.toPlainText()
        }

        current_config["ui"]["intro_text"] = self.ui.lineEdit_4.text()
        current_config['context']['max_messages'] = int(self.ui.lineEdit_5.text())
        # 确保mcp配置存在
        if 'mcp' not in current_config:
            current_config['mcp'] = {}
        current_config['mcp']['enabled'] = self.ui.checkBox_mcp_enable.isChecked()
        current_config['vision']['auto_screenshot'] = self.ui.checkBox_5.isChecked()

        # 新增：保存辅助视觉模型配置
        current_config['vision']['use_vision_model'] = self.ui.checkBox_use_vision_model.isChecked()
        if 'vision_model' not in current_config['vision']:
            current_config['vision']['vision_model'] = {}
        current_config['vision']['vision_model']['api_key'] = self.ui.lineEdit_vision_api_key.text()
        current_config['vision']['vision_model']['api_url'] = self.ui.lineEdit_vision_api_url.text()
        current_config['vision']['vision_model']['model'] = self.ui.lineEdit_vision_model.text()

        current_config['ui']['show_chat_box'] = self.ui.checkBox_3.isChecked()
        current_config['context']['enable_limit'] = self.ui.checkBox_4.isChecked()
        current_config['context']['persistent_history'] = self.ui.checkBox_persistent_history.isChecked()

        # 保存本地ASR和TTS配置（保持现有配置结构，只更新enabled状态）
        current_config['asr']['enabled'] = self.ui.checkBox_asr.isChecked()
        current_config['asr']['voice_barge_in'] = self.ui.checkBox_voice_barge_in.isChecked()
        current_config['asr']['ptt_enabled'] = self.ui.checkBox_ptt_enabled.isChecked()
        current_config['tts']['enabled'] = self.ui.checkBox_tts.isChecked()

        # 保存TTS语言
        tts_language = self.ui.comboBox_tts_language.currentText().split(' - ')[0]
        current_config['tts']['language'] = tts_language

        # 新增：保存云端配置
        if 'cloud' not in current_config:
            current_config['cloud'] = {}

        # 保存通用云端配置
        current_config['cloud']['provider'] = self.ui.lineEdit_cloud_provider.text() or 'siliconflow'
        current_config['cloud']['api_key'] = self.ui.lineEdit_cloud_api_key.text()

        # 保存云端TTS配置
        if 'tts' not in current_config['cloud']:
            current_config['cloud']['tts'] = {}
        current_config['cloud']['tts']['enabled'] = self.ui.checkBox_cloud_tts_enabled.isChecked()
        current_config['cloud']['tts']['url'] = self.ui.lineEdit_cloud_tts_url.text() or 'https://api.siliconflow.cn/v1/audio/speech'
        current_config['cloud']['tts']['model'] = self.ui.lineEdit_cloud_tts_model.text() or 'FunAudioLLM/CosyVoice2-0.5B'
        current_config['cloud']['tts']['voice'] = self.ui.lineEdit_cloud_tts_voice.text()
        current_config['cloud']['tts']['response_format'] = self.ui.comboBox_cloud_tts_format.currentText()
        current_config['cloud']['tts']['speed'] = self.ui.doubleSpinBox_cloud_tts_speed.value()

        # 保存阿里云TTS配置
        if 'aliyun_tts' not in current_config['cloud']:
            current_config['cloud']['aliyun_tts'] = {}
        current_config['cloud']['aliyun_tts']['enabled'] = self.ui.checkBox_aliyun_tts_enabled.isChecked()
        current_config['cloud']['aliyun_tts']['api_key'] = self.ui.lineEdit_aliyun_tts_api_key.text()
        current_config['cloud']['aliyun_tts']['model'] = self.ui.lineEdit_aliyun_tts_model.text() or 'cosyvoice-v3-flash'
        current_config['cloud']['aliyun_tts']['voice'] = self.ui.lineEdit_aliyun_tts_voice.text()

        # 保存字节TTS配置
        if 'volcengine_tts' not in current_config['cloud']:
            current_config['cloud']['volcengine_tts'] = {}
        current_config['cloud']['volcengine_tts']['enabled'] = self.ui.checkBox_volcengine_tts_enabled.isChecked()
        current_config['cloud']['volcengine_tts']['appid'] = self.ui.lineEdit_volcengine_tts_appid.text()
        current_config['cloud']['volcengine_tts']['access_token'] = self.ui.lineEdit_volcengine_tts_access_token.text()
        current_config['cloud']['volcengine_tts']['voice_type'] = self.ui.lineEdit_volcengine_tts_voice_type.text() or 'saturn_zh_female_keainvsheng_tob'

        # 保存百度流式ASR配置
        if 'baidu_asr' not in current_config['cloud']:
            current_config['cloud']['baidu_asr'] = {}
        current_config['cloud']['baidu_asr']['enabled'] = self.ui.checkBox_cloud_asr_enabled.isChecked()
        current_config['cloud']['baidu_asr']['url'] = self.ui.lineEdit_cloud_asr_url.text() or 'ws://vop.baidu.com/realtime_asr'
        appid_text = self.ui.lineEdit_cloud_asr_appid.text()
        current_config['cloud']['baidu_asr']['appid'] = int(appid_text) if appid_text.isdigit() else 0
        current_config['cloud']['baidu_asr']['appkey'] = self.ui.lineEdit_cloud_asr_appkey.text()
        dev_pid_text = self.ui.lineEdit_cloud_asr_dev_pid.text()
        current_config['cloud']['baidu_asr']['dev_pid'] = int(dev_pid_text) if dev_pid_text.isdigit() else 15372

        # 保存 SiliconFlow ASR 配置
        if 'siliconflow_asr' not in current_config['cloud']:
            current_config['cloud']['siliconflow_asr'] = {}
        current_config['cloud']['siliconflow_asr']['enabled'] = self.ui.checkBox_siliconflow_asr_enabled.isChecked()
        current_config['cloud']['siliconflow_asr']['api'] = (
            self.ui.lineEdit_siliconflow_asr_api.text().strip()
            or 'https://api.siliconflow.cn/v1/audio/transcriptions'
        )
        current_config['cloud']['siliconflow_asr']['key'] = self.ui.lineEdit_siliconflow_asr_key.text().strip()
        current_config['cloud']['siliconflow_asr']['model'] = (
            self.ui.lineEdit_siliconflow_asr_model.text().strip()
            or 'TeleAI/TeleSpeechASR'
        )

        # 保存云端肥牛配置（API Gateway）
        if 'api_gateway' not in current_config:
            current_config['api_gateway'] = {}
        current_config['api_gateway']['use_gateway'] = self.ui.checkBox_gateway_enabled.isChecked()
        current_config['api_gateway']['base_url'] = self.ui.lineEdit_gateway_base_url.text()
        current_config['api_gateway']['api_key'] = self.ui.lineEdit_gateway_api_key.text()

        # 新增：保存UI设置
        if 'subtitle_labels' not in current_config:
            current_config['subtitle_labels'] = {}
        current_config['subtitle_labels']['enabled'] = self.ui.checkBox_subtitle_enabled.isChecked()
        current_config['subtitle_labels']['user'] = self.ui.lineEdit_user_name.text() or "用户"
        current_config['subtitle_labels']['ai'] = self.ui.lineEdit_ai_name.text() or "Fake Neuro"

        # 新增：保存隐藏皮套设置
        if 'ui' not in current_config:
            current_config['ui'] = {}
        current_config['ui']['show_model'] = not self.ui.checkBox_hide_model.isChecked()  # 注意：勾选表示隐藏，所以需要取反

        # 新增：保存自动关闭服务设置
        if 'auto_close_services' not in current_config:
            current_config['auto_close_services'] = {}
        current_config['auto_close_services']['enabled'] = self.ui.checkBox_auto_close_services.isChecked()

        # 新增：保存VMC配置
        if hasattr(self, 'checkBox_vmc_enabled'):
            if 'vmc' not in current_config:
                current_config['vmc'] = {}
            current_config['vmc']['enabled'] = self.checkBox_vmc_enabled.isChecked()
            current_config['vmc']['host'] = self.lineEdit_vmc_host.text() or '127.0.0.1'
            port_text = self.lineEdit_vmc_port.text()
            current_config['vmc']['port'] = int(port_text) if port_text.isdigit() else 39539

        # 新增：保存模型选择（支持Live2D和VRM）
        selected_model = self.ui.comboBox_live2d_models.currentText()
        if selected_model and selected_model != "未找到任何模型":
            is_vrm = selected_model.startswith("[VRM] ")

            if is_vrm:
                # VRM模型：保存VRM配置
                vrm_file = selected_model.replace("[VRM] ", "")
                if 'ui' not in current_config:
                    current_config['ui'] = {}
                current_config['ui']['model_type'] = 'vrm'
                current_config['ui']['vrm_model'] = vrm_file
                current_config['ui']['vrm_model_path'] = f"3D/{vrm_file}"
                print(f"已应用VRM模型: {vrm_file}")

            else:
                # Live2D模型：保存Live2D配置
                if 'ui' not in current_config:
                    current_config['ui'] = {}
                current_config['ui']['model_type'] = 'live2d'
                current_config['ui']['vrm_model'] = ''
                current_config['ui']['vrm_model_path'] = ''

                try:
                    import re
                    app_path = get_app_path()

                    # 1. 更新main.js的优先级
                    main_js_path = os.path.join(app_path, "main.js")
                    with open(main_js_path, 'r', encoding='utf-8') as f:
                        main_content = f.read()

                    new_priority = f"const priorityFolders = ['{selected_model}', 'Hiyouri', 'Default', 'Main']"
                    main_content = re.sub(r"const priorityFolders = \[.*?\]", new_priority, main_content)

                    with open(main_js_path, 'w', encoding='utf-8') as f:
                        f.write(main_content)

                    # 2. 更新app.js中的角色名设置
                    app_js_path = os.path.join(app_path, "app.js")
                    with open(app_js_path, 'r', encoding='utf-8') as f:
                        app_content = f.read()

                    # 先删除所有旧的角色名设置行
                    app_content = re.sub(r'\s*global\.currentCharacterName = [\'"].*?[\'"];?\n?', '', app_content)

                    # 设置全局角色名
                    insert_line = f"global.currentCharacterName = '{selected_model}';"

                    # 在emotionMapper创建后插入(只替换第一次匹配)
                    pattern = r"(emotionMapper = new EmotionMotionMapper\(model\);)"
                    if re.search(pattern, app_content):
                        replacement = f"\\1\n        {insert_line}"
                        app_content = re.sub(pattern, replacement, app_content, count=1)
                    else:
                        # 备选位置：在模型设置后
                        pattern = r"(currentModel = model;)"
                        replacement = f"\\1\n        {insert_line}"
                        app_content = re.sub(pattern, replacement, app_content, count=1)

                    with open(app_js_path, 'w', encoding='utf-8') as f:
                        f.write(app_content)

                    print(f"已应用Live2D模型和角色: {selected_model}")

                    # 重新加载动作配置以匹配新选择的角色
                    try:
                        self.load_motion_config()
                        self.refresh_drag_drop_interface()
                        print(f"已更新动作界面为角色: {selected_model}")
                    except Exception as refresh_error:
                        print(f"更新动作界面失败: {refresh_error}")

                except Exception as e:
                    print(f"应用Live2D模型失败: {str(e)}")

        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(current_config, f, ensure_ascii=False, indent=2)

        # 重新加载配置到内存，确保立即生效
        self.config = current_config
        self._clear_config_dirty()

        # 使用Toast提示替代QMessageBox
        self.toast.show_message("配置已保存，模型选择已应用", 1500)


    def setup_api_key_visibility_toggles(self):
        """为API KEY输入框添加小眼睛图标"""
        try:
            # API KEY输入框列表
            api_key_fields = [
                self.ui.lineEdit,  # 主要LLM API KEY
            ]
            if hasattr(self.ui, 'lineEdit_translation_api_key'):
                api_key_fields.append(self.ui.lineEdit_translation_api_key)  # 同传API KEY

            for line_edit in api_key_fields:
                if line_edit:
                    # 创建眼睛图标动作
                    eye_action = QAction(line_edit)
                    eye_action.setIcon(self.create_eye_icon("🙈"))
                    eye_action.setToolTip("点击显示/隐藏API KEY")

                    # 添加到输入框右侧
                    line_edit.addAction(eye_action, QLineEdit.TrailingPosition)

                    # 绑定点击事件
                    def toggle_visibility(checked, le=line_edit, action=eye_action):
                        if le.echoMode() == QLineEdit.Password:
                            # 切换为显示
                            le.setEchoMode(QLineEdit.Normal)
                            action.setIcon(self.create_eye_icon("👁"))
                            action.setToolTip("点击隐藏API KEY")
                        else:
                            # 切换为隐藏
                            le.setEchoMode(QLineEdit.Password)
                            action.setIcon(self.create_eye_icon("🙈"))
                            action.setToolTip("点击显示API KEY")

                    eye_action.triggered.connect(toggle_visibility)

        except Exception as e:
            print(f"设置API KEY小眼睛图标失败: {e}")


    def create_eye_icon(self, emoji):
        """创建眼睛图标"""
        try:
            # 创建一个简单的图标
            pixmap = QPixmap(24, 24)
            pixmap.fill(Qt.transparent)

            painter = QPainter(pixmap)
            painter.setFont(QFont("Segoe UI Emoji", 12))
            painter.drawText(pixmap.rect(), Qt.AlignCenter, emoji)
            painter.end()

            return QIcon(pixmap)
        except:
            # 如果创建图标失败，返回空图标
            return QIcon()
