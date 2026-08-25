# -*- coding: utf-8 -*-
"""主窗口类 set_pyqt：通过 Mixin 组合全部功能模块。

新增功能时建议优先在 qt_ui/mixins/ 下新建 Mixin 模块并加入上方基类列表，
或在既有分组模块中添加方法，避免本类继续膨胀。
"""
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

from .paths import get_base_path, get_app_path, IS_CLOUD_VERSION, TEST_PY_DIR  # noqa: F401
from .tool_descriptions import load_tool_descriptions  # noqa: F401
from .workers import (  # noqa: F401
    LogReader, _ZipInstallWorker, _DlcWorker, LlmModelFetchWorker,
)
from .widgets.toast import ToastNotification  # noqa: F401
from .widgets.title_bar import CustomTitleBar  # noqa: F401

from .mixins import (
    VoiceCloneMixin,
    MotionExpressionMixin,
    Live2DControlMixin,
    LogsMixin,
    WindowBehaviorMixin,
    ConfigTrackingMixin,
    SettingsMixin,
    ServicesMixin,
    PluginsMixin,
    TutorialMixin,
    McpToolsMixin,
    MarketMixin,
    ChatHistoryMixin,
)


class set_pyqt(VoiceCloneMixin, MotionExpressionMixin, Live2DControlMixin, LogsMixin, WindowBehaviorMixin, ConfigTrackingMixin, SettingsMixin, ServicesMixin, PluginsMixin, TutorialMixin, McpToolsMixin, MarketMixin, ChatHistoryMixin, QWidget):
    # 添加信号用于线程安全的日志更新
    log_signal = pyqtSignal(str)
    mcp_log_signal = pyqtSignal(str)
    plugin_market_loaded = pyqtSignal(list)
    plugin_market_failed = pyqtSignal(str)

    def __init__(self):
        super().__init__()
        self.live2d_process = None
        self.mcp_enabled = False    # MCP功能状态，默认关闭
        self.terminal_process = None  # 新增：后台终端进程
        self.asr_process = None  # 新增：ASR进程
        self.bert_process = None  # 新增：BERT进程
        self.rag_process = None  # 新增：RAG进程
        self.voice_clone_process = None  # 新增：声音克隆进程
        self.selected_model_path = None  # 选择的模型文件路径
        self.selected_audio_path = None  # 选择的音频文件路径
        self.config_path = 'config.json'
        self.config = self.load_config()
        self.config_dirty = False
        self._loading_config_ui = False
        self._config_dirty_widgets = []
        self._save_button_default_style = ''
        self.llm_model_fetch_worker = None
        self._tutorial_step = 0
        self._tutorial_edition = None
        self._tutorial_bubble = None
        self._tutorial_next_button = None
        self._tutorial_close_button = None
        self._tutorial_original_styles = {}

        # 日志读取相关
        self.log_readers = {}
        self.log_file_paths = {
            'asr': r"..\logs\asr.log",
            'tts': r"..\logs\tts.log",
            'bert': r"..\logs\bert.log",
            'rag': r"..\logs\rag.log"
        }

        # 🔥 新增：主日志读取线程控制标志
        self.log_thread_running = False

        # 加载工具描述
        self.tool_descriptions, self.mcp_tools = load_tool_descriptions()

        # 调整大小相关变量
        self.resizing = False
        self.resize_edge = None
        self.resize_start_pos = None
        self.resize_start_geometry = None
        self.edge_margin = 10

        # 字体缩放相关
        self._base_size = None
        self._base_font_entries = []   # [(widget, base_point_size), ...]
        self._current_scale = 1.0
        self._resize_debounce = QTimer()
        self._resize_debounce.setSingleShot(True)
        self._resize_debounce.timeout.connect(self._apply_font_scale)

        # 新增分页变量
        self.current_page = 0
        self.items_per_page = 15
        self.pagination_widget = None
        self.unclassified_actions_cache = []

        # Live2D模型切换相关
        self.is_loading_model_list = False  # 标志：正在加载模型列表，忽略选择改变事件
        self.last_model_switch_time = 0  # 上次切换模型的时间
        self.model_switch_cooldown = 3.0  # 切换冷却时间（秒）

        # 心情分定时器
        self.mood_timer = QTimer()
        self.mood_timer.timeout.connect(self.update_mood_score)
        self.mood_timer.setInterval(2000)  # 每2秒更新一次
        self.last_mood_score = None  # 上次的心情分

        self.init_ui()
        self.init_live2d_models()


        self.check_all_service_status()
        self.run_startup_scan()  # 添加这行
        self.drag_start_position = None
        self.dragged_action = None
        # 备份原始配置
        self.original_config = None
        self.original_config1 = None
        self.backup_original_config()
        self.backup_original_config1()


    def init_ui(self):
        # 设置无边框
        self.setWindowFlags(Qt.FramelessWindowHint)

        # 启用透明背景
        self.setAttribute(Qt.WA_TranslucentBackground)

        # 启用鼠标跟踪
        self.setMouseTracking(True)

        # 为整个应用安装事件过滤器
        app = QApplication.instance()
        app.installEventFilter(self)

        # 添加圆角样式 - 改为浅色渐变
        self.setStyleSheet("""
            QWidget {
                border-radius: 25px;
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 rgba(250, 249, 245, 255), stop:0.5 rgba(245, 243, 235, 255), stop:1 rgba(240, 238, 230, 255));
            }
        """)

        # 加载原始UI文件
        self.ui = uic.loadUi('test222.ui')

        # 云端配置：补充 SiliconFlow ASR 子标签
        self.setup_cloud_tts_provider_tab()
        self.setup_siliconflow_asr_tab()
        self.setup_module_download_controls()

        # self.ui.label_model_status.setText("未上传模型文件 (.pth)")
        # self.ui.label_audio_status.setText("未上传参考音频 (.wav)")
        # self.ui.label_bat_status.setText("状态：请上传文件并生成配置")

        # 添加下面这行代码来让声音克隆页面支持拖放
        self.ui.tab_tts_switch.setAcceptDrops(True)
        self.ui.tab_tts_switch.dragEnterEvent = self.voice_clone_dragEnterEvent
        self.ui.tab_tts_switch.dropEvent = self.voice_clone_dropEvent

        # 隐藏状态栏
        self.ui.statusbar.hide()

        # 创建一个容器来装标题栏和原UI
        container = QWidget()
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(0, 0, 0, 0)
        container_layout.setSpacing(0)

        # 添加自定义标题栏
        self.title_bar = CustomTitleBar(self)
        version = self.config.get('version', '')
        cloud_tag = '(云端)' if IS_CLOUD_VERSION else '(本地)'
        version_str = f'  {version}' if version else ''
        self.title_bar.title_label.setText(f'My-Neuro {cloud_tag}{version_str}')
        container_layout.addWidget(self.title_bar)

        # 添加原始UI
        container_layout.addWidget(self.ui)

        # 设置主布局
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.addWidget(container)

        # 设置窗口大小
        # 获取桌面尺寸
        desktop = QApplication.desktop()
        screen_rect = desktop.screenGeometry()

        # 计算合理的窗口大小
        width = int(screen_rect.width() * 0.45)
        height = int(screen_rect.height() * 0.55)

        # 设置窗口大小
        self.resize(width, height)


        # 设置最小尺寸为1x1，允许任意缩小
        # self.setMinimumSize(1, 1)

        # 保持原来的功能
        self.set_btu()
        self.set_config()
        self._init_config_dirty_tracking()
        self.ui.pushButton_terminal.show()

        # 云端版本隐藏本地专属功能入口
        if IS_CLOUD_VERSION:
            self.ui.pushButton_voice_clone.hide()

        # 为API KEY输入框添加小眼睛图标
        self.setup_api_key_visibility_toggles()

        # 修改复选框布局为水平布局
        self.modify_checkbox_layout()

        # 创建Toast提示
        self.toast = ToastNotification(self)

        # 初始化时刷新工具列表
        self.refresh_mcp_tools_list()

        # 根据UI复选框状态初始化开关（必须在日志信号连接之前设置）
        self.mcp_enabled = self.ui.checkBox_mcp_enable.isChecked()  # MCP功能开关

        # 加载最近的日志记录
        self.load_recent_logs()

        # 连接日志信号
        self.log_signal.connect(self.update_log)
        self.mcp_log_signal.connect(self.update_tool_log)
        self.plugin_market_loaded.connect(self._on_plugin_market_loaded)
        self.plugin_market_failed.connect(self._on_plugin_market_failed)

        # 设置动画控制按钮
        self.setup_motion_buttons()
        # 在现有动画控制按钮设置后添加表情按钮设置
        self.setup_expression_buttons()
        # 立即创建动画页面UI
        self.create_expression_buttons_on_animation_page() 

        # 启动心情分定时器
        self.mood_timer.start()

        # 延迟捕获基准字体（等待所有控件渲染完毕）
        QTimer.singleShot(300, self._capture_base_fonts)
