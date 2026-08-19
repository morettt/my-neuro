# -*- coding: utf-8 -*-
"""心情分更新与配置脏标记跟踪。"""
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


class ConfigTrackingMixin:
    """心情分更新与配置脏标记跟踪。"""

    def update_mood_score(self):
        """更新心情分显示"""
        try:
            # 读取心情分文件
            app_path = get_app_path()
            mood_file = os.path.join(app_path, "..", "AI记录室", "mood_status.json")

            if not os.path.exists(mood_file):
                self.ui.label_mood_value.setText("--")
                self.ui.label_mood_status.setText("（未启动）")
                return

            with open(mood_file, 'r', encoding='utf-8') as f:
                mood_data = json.load(f)

            score = mood_data.get('score', 0)
            interval = mood_data.get('interval', 0)
            waiting = mood_data.get('waitingResponse', False)

            # 更新心情分数值
            self.ui.label_mood_value.setText(str(score))

            # 根据心情分改变颜色
            if score >= 90:
                color_style = "color: rgb(76, 175, 80);"  # 绿色 - 兴奋
                status_text = "（兴奋😄）"
            elif score >= 80:
                color_style = "color: rgb(0, 120, 212);"  # 蓝色 - 正常
                status_text = "（正常😊）"
            elif score >= 60:
                color_style = "color: rgb(255, 152, 0);"  # 橙色 - 低落
                status_text = "（低落😐）"
            else:
                color_style = "color: rgb(244, 67, 54);"  # 红色 - 沉默
                status_text = "（沉默😔）"

            # 如果正在等待回应，添加提示
            if waiting:
                status_text += " 等待回应..."

            self.ui.label_mood_value.setStyleSheet(color_style)
            self.ui.label_mood_status.setText(status_text)

            # 只在心情分变化时更新，减少日志输出
            if self.last_mood_score != score:
                self.last_mood_score = score

        except Exception as e:
            # 静默失败，不显示错误
            pass


    def _mark_config_dirty(self):
        if self._loading_config_ui:
            return
        self.config_dirty = True
        self._update_config_dirty_indicator()


    def _clear_config_dirty(self):
        self.config_dirty = False
        self._update_config_dirty_indicator()


    def _update_config_dirty_indicator(self):
        if not hasattr(self, 'ui') or not hasattr(self.ui, 'saveConfigButton'):
            return

        if self.config_dirty:
            self.ui.saveConfigButton.setStyleSheet("""
                QPushButton {
                    background-color: #eab308;
                    color: #111111;
                    border-radius: 8px;
                    border: 1px solid #ca8a04;
                    padding: 6px 12px;
                    font-weight: bold;
                }
                QPushButton:hover {
                    background-color: #f59e0b;
                }
            """)
            self.ui.saveConfigButton.setToolTip("当前配置有未保存的修改，请先保存配置")
        else:
            self.ui.saveConfigButton.setStyleSheet(self._save_button_default_style)
            self.ui.saveConfigButton.setToolTip("")


    def _init_config_dirty_tracking(self):
        self._save_button_default_style = self.ui.saveConfigButton.styleSheet()
        self._config_dirty_widgets = [
            self.ui.lineEdit,
            self.ui.lineEdit_2,
            self.ui.comboBox_llm_model,
            self.ui.textEdit_3,
            self.ui.doubleSpinBox_temperature,
            self.ui.checkBox_temperature_enabled,
            self.ui.lineEdit_4,
            self.ui.lineEdit_5,
            self.ui.checkBox_mcp_enable,
            self.ui.checkBox_5,
            self.ui.checkBox_3,
            self.ui.checkBox_4,
            self.ui.checkBox_asr,
            self.ui.checkBox_tts,
            self.ui.checkBox_persistent_history,
            self.ui.checkBox_voice_barge_in,
            self.ui.checkBox_ptt_enabled,
            self.ui.comboBox_tts_language,
            self.ui.checkBox_subtitle_enabled,
            self.ui.lineEdit_user_name,
            self.ui.lineEdit_ai_name,
            self.ui.checkBox_hide_model,
            self.ui.checkBox_auto_close_services,
            self.ui.lineEdit_cloud_provider,
            self.ui.lineEdit_cloud_api_key,
            self.ui.checkBox_cloud_tts_enabled,
            self.ui.lineEdit_cloud_tts_url,
            self.ui.lineEdit_cloud_tts_model,
            self.ui.lineEdit_cloud_tts_voice,
            self.ui.comboBox_cloud_tts_format,
            self.ui.doubleSpinBox_cloud_tts_speed,
            self.ui.checkBox_aliyun_tts_enabled,
            self.ui.lineEdit_aliyun_tts_api_key,
            self.ui.lineEdit_aliyun_tts_model,
            self.ui.lineEdit_aliyun_tts_voice,
            self.ui.checkBox_volcengine_tts_enabled,
            self.ui.lineEdit_volcengine_tts_appid,
            self.ui.lineEdit_volcengine_tts_access_token,
            self.ui.lineEdit_volcengine_tts_voice_type,
            self.ui.comboBox_cloud_tts_provider,
            self.ui.checkBox_cloud_tts_provider_enabled,
            self.ui.checkBox_cloud_asr_enabled,
            self.ui.lineEdit_cloud_asr_url,
            self.ui.lineEdit_cloud_asr_appid,
            self.ui.lineEdit_cloud_asr_appkey,
            self.ui.lineEdit_cloud_asr_dev_pid,
            self.ui.checkBox_siliconflow_asr_enabled,
            self.ui.lineEdit_siliconflow_asr_api,
            self.ui.lineEdit_siliconflow_asr_key,
            self.ui.lineEdit_siliconflow_asr_model,
            self.ui.comboBox_cloud_asr_provider,
            self.ui.checkBox_cloud_asr_provider_enabled,
            self.ui.checkBox_gateway_enabled,
            self.ui.lineEdit_gateway_base_url,
            self.ui.lineEdit_gateway_api_key,
            self.ui.checkBox_use_vision_model,
            self.ui.lineEdit_vision_api_key,
            self.ui.lineEdit_vision_api_url,
            self.ui.lineEdit_vision_model,
        ]

        if hasattr(self, 'checkBox_vmc_enabled'):
            self._config_dirty_widgets.extend([
                self.checkBox_vmc_enabled,
                self.lineEdit_vmc_host,
                self.lineEdit_vmc_port,
            ])

        for widget in self._config_dirty_widgets:
            try:
                if isinstance(widget, QLineEdit):
                    widget.textChanged.connect(self._mark_config_dirty)
                elif isinstance(widget, QTextEdit):
                    widget.textChanged.connect(self._mark_config_dirty)
                elif isinstance(widget, QCheckBox):
                    widget.stateChanged.connect(lambda *_: self._mark_config_dirty())
                elif isinstance(widget, QComboBox):
                    widget.currentIndexChanged.connect(lambda *_: self._mark_config_dirty())
                elif isinstance(widget, (QSpinBox, QDoubleSpinBox)):
                    widget.valueChanged.connect(lambda *_: self._mark_config_dirty())
            except RuntimeError:
                pass

        self._clear_config_dirty()


    def _confirm_discard_unsaved_config(self, title="未保存配置"):
        if not self.config_dirty:
            return True
        reply = QMessageBox.warning(
            self,
            title,
            "当前配置有未保存的修改，继续操作可能导致配置未生效。\n\n是否仍要继续？",
            QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel,
            QMessageBox.Save
        )
        if reply == QMessageBox.Save:
            self.save_config()
            return not self.config_dirty
        if reply == QMessageBox.Discard:
            return True
        return False
