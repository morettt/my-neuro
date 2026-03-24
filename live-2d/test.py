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


# 在这里添加新函数
def get_base_path():
    """获取程序基础路径，兼容开发环境和打包后的exe"""
    if getattr(sys, 'frozen', False):
        # 如果是打包后的exe，获取exe所在目录的上级目录
        exe_dir = os.path.dirname(sys.executable)
        return os.path.dirname(exe_dir)  # 返回上级目录
    else:
        # 如果是开发环境，返回Python文件所在目录的上级目录
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_app_path():
    """获取程序运行的主目录，无论是开发环境还是打包后的exe"""
    if getattr(sys, 'frozen', False):
        # 如果是打包后的exe，获取exe所在的目录
        return os.path.dirname(sys.executable)
    else:
        # 如果是开发环境，返回Python文件所在的目录
        return os.path.dirname(os.path.abspath(__file__))


def load_tool_descriptions():
    """加载所有工具的名称和描述"""
    tool_descriptions = {}
    fc_tools = set()  # Function Call工具集合
    mcp_tools = set()  # MCP工具集合

    try:
        # 获取server-tools目录路径
        app_path = get_app_path()
        server_tools_path = os.path.join(app_path, "server-tools")

        if not os.path.exists(server_tools_path):
            print(f"server-tools目录不存在: {server_tools_path}")
            return tool_descriptions, fc_tools, mcp_tools

        # 加载Function Call工具描述（server-tools目录）
        js_files = glob.glob(os.path.join(server_tools_path, "*.js"))
        js_files = [f for f in js_files if not f.endswith("index.js")]

        for file_path in js_files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                # 使用更灵活的正则表达式提取工具定义
                # 支持跨行和不同的引号格式
                pattern = r'name:\s*["\']([^"\']+)["\']\s*,\s*description:\s*["\']([^"\']*(?:[^"\'\\]|\\.)*)["\']'
                matches = re.findall(pattern, content, re.DOTALL)

                file_tools = []
                for name, description in matches:
                    # 清理描述文本，移除多余的空白
                    clean_description = re.sub(r'\s+', ' ', description.strip())
                    tool_descriptions[name] = clean_description
                    fc_tools.add(name)  # 记录为Function Call工具
                    file_tools.append(name)

                if file_tools:
                    filename = os.path.basename(file_path)
                    print(f"文件 {filename} 包含工具: {', '.join(file_tools)}")

            except Exception as e:
                print(f"读取工具文件失败 {file_path}: {e}")

        # 加载MCP工具描述（mcp/tools目录）
        mcp_tools_path = os.path.join(app_path, "mcp", "tools")
        if os.path.exists(mcp_tools_path):
            mcp_js_files = glob.glob(os.path.join(mcp_tools_path, "*.js"))

            for file_path in mcp_js_files:
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()

                    # MCP工具使用不同的格式：name: "tool_name", description: "描述"
                    pattern = r'name:\s*["\']([^"\']+)["\']\s*,\s*description:\s*["\']([^"\']*(?:[^"\'\\]|\\.)*)["\']'
                    matches = re.findall(pattern, content, re.DOTALL)

                    file_tools = []
                    for name, description in matches:
                        clean_description = re.sub(r'\s+', ' ', description.strip())
                        tool_descriptions[name] = clean_description
                        mcp_tools.add(name)  # 记录为MCP工具
                        file_tools.append(name)

                    if file_tools:
                        filename = os.path.basename(file_path)
                        print(f"MCP文件 {filename} 包含工具: {', '.join(file_tools)}")

                except Exception as e:
                    print(f"读取MCP工具文件失败 {file_path}: {e}")

        # 从 mcp_config.json 读取外部MCP工具配置（如playwright）
        mcp_config_path = os.path.join(app_path, "mcp", "mcp_config.json")
        if os.path.exists(mcp_config_path):
            try:
                with open(mcp_config_path, 'r', encoding='utf-8') as f:
                    mcp_config = json.load(f)

                for tool_name, config in mcp_config.items():
                    # 跳过禁用的工具
                    if tool_name.endswith('_disabled'):
                        continue

                    # 检查配置的args，判断是否指向本地文件
                    args = config.get('args', [])
                    is_local_tool = False

                    # 如果args中包含 ./mcp/tools/ 路径，说明是本地工具
                    for arg in args:
                        if isinstance(arg, str) and './mcp/tools/' in arg:
                            is_local_tool = True
                            break

                    # 只添加真正的外部工具（非本地文件）
                    if not is_local_tool and tool_name not in mcp_tools:
                        # 为外部MCP工具添加默认描述
                        command = config.get('command', '')
                        description = f"外部MCP工具 (通过 {command} 启动)"

                        tool_descriptions[tool_name] = description
                        mcp_tools.add(tool_name)
                        print(f"从配置加载外部MCP工具: {tool_name} - {description}")

            except Exception as e:
                print(f"读取MCP配置文件失败 {mcp_config_path}: {e}")

    except Exception as e:
        print(f"加载工具描述失败: {e}")

    return tool_descriptions, fc_tools, mcp_tools


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


class ToastNotification(QLabel):
    """自定义Toast提示"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAlignment(Qt.AlignCenter)
        self.setStyleSheet("""
            QLabel {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, 
                    stop:0 rgba(255, 255, 255, 240), 
                    stop:1 rgba(248, 248, 248, 240));
                color: rgb(60, 60, 60);
                border: 1px solid rgba(200, 200, 200, 150);
                border-radius: 15px;
                padding: 18px 36px;
                font-size: 16px;
                font-family: "Microsoft YaHei";
                font-weight: normal;
            }
        """)
        self.hide()

        # 创建动画效果
        self.effect = QGraphicsOpacityEffect()
        self.setGraphicsEffect(self.effect)

        # 滑入动画
        self.slide_in_animation = QPropertyAnimation(self, b"pos")
        self.slide_in_animation.setDuration(300)
        self.slide_in_animation.setEasingCurve(QEasingCurve.OutCubic)

        # 滑出动画（使用独立对象）
        self.slide_out_animation = QPropertyAnimation(self, b"pos")
        self.slide_out_animation.setDuration(300)
        self.slide_out_animation.setEasingCurve(QEasingCurve.InCubic)

        # 透明度动画
        self.opacity_in_animation = QPropertyAnimation(self.effect, b"opacity")
        self.opacity_in_animation.setDuration(300)

        self.opacity_out_animation = QPropertyAnimation(self.effect, b"opacity")
        self.opacity_out_animation.setDuration(300)
        self.opacity_out_animation.finished.connect(self.hide)

        # 定时器
        self._hide_timer = QTimer(self)
        self._hide_timer.setSingleShot(True)
        self._hide_timer.timeout.connect(self.hide_with_animation)

    def show_message(self, message, duration=2000):
        """显示消息，duration为显示时长（毫秒）"""
        self.setText(message)
        self.adjustSize()

        # 计算位置
        parent = self.parent()
        if parent:
            x = (parent.width() - self.width()) // 2
            start_y = -self.height()  # 从顶部外面开始
            end_y = 20  # 最终位置距离顶部20像素

            # 设置起始位置
            self.move(x, start_y)
            self.show()
            self.raise_()

            # 滑入动画
            self.slide_in_animation.setStartValue(QPoint(x, start_y))
            self.slide_in_animation.setEndValue(QPoint(x, end_y))
            self.slide_in_animation.start()

            # 透明度渐入
            self.opacity_in_animation.setStartValue(0.0)
            self.opacity_in_animation.setEndValue(1.0)
            self.opacity_in_animation.start()

            # 启动隐藏定时器
            self._hide_timer.start(duration)

    def hide_with_animation(self):
        """带动画的隐藏"""
        parent = self.parent()
        if parent and self.isVisible():
            current_pos = self.pos()
            end_y = -self.height()

            # 滑出动画（使用独立对象）
            self.slide_out_animation.setStartValue(current_pos)
            self.slide_out_animation.setEndValue(QPoint(current_pos.x(), end_y))
            self.slide_out_animation.start()

            # 透明度渐出
            self.opacity_out_animation.setStartValue(1.0)
            self.opacity_out_animation.setEndValue(0.0)
            self.opacity_out_animation.start()


class _CloneWorker(QThread):
    """后台执行 git clone（+ 可选 pip install），结果通过信号回到主线程"""
    done     = pyqtSignal(bool, str)  # (success, error_message)
    progress = pyqtSignal(str)        # 进度提示文字

    def __init__(self, repo_url, target_dir):
        super().__init__()
        self.repo_url   = repo_url
        self.target_dir = target_dir

    def run(self):
        import sys
        try:
            result = subprocess.run(
                ["git", "clone", self.repo_url, self.target_dir],
                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120
            )
            if result.returncode != 0:
                self.done.emit(False, result.stderr.strip())
                return

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


class CustomTitleBar(QWidget):
    """自定义标题栏"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent = parent
        self.setFixedHeight(65)
        self.setStyleSheet("""
           CustomTitleBar {
               background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 rgba(235, 233, 225, 255), stop:1 rgba(230, 228, 220, 255));
               border: none;
               border-radius: 25px 25px 0px 0px;
           }
       """)
        self.init_ui()

    def init_ui(self):
        layout = QHBoxLayout(self)
        layout.setContentsMargins(20, 0, 5, 0)
        layout.setSpacing(0)

        # 标题
        self.title_label = QLabel()
        self.title_label.setStyleSheet("""
           QLabel {
               color: rgb(114, 95, 77);
               font-size: 24px;
               font-family: "Microsoft YaHei";
               font-weight: bold;
               background-color: transparent;
           }
       """)

        layout.addWidget(self.title_label)
        layout.addStretch()

        # 窗口控制按钮
        button_style = """
           QPushButton {
               background-color: transparent;
               border: none;
               width: 55px;
               height: 50px;
               font-size: 22px;
               font-weight: bold;
               color: rgb(114, 95, 77);
           }
           QPushButton:hover {
               background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 rgba(200, 195, 185, 255), stop:1 rgba(180, 175, 165, 255));
               color: rgb(40, 35, 25);
               border-radius: 5px;
           }
       """

        close_style = """
           QPushButton {
               background-color: transparent;
               border: none;
               width: 55px;
               height: 50px;
               font-size: 22px;
               font-weight: bold;
               color: rgb(114, 95, 77);
           }
           QPushButton:hover {
               background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 rgba(255, 182, 193, 255), stop:1 rgba(255, 160, 122, 255));
               color: rgb(139, 69, 19);
               border-radius: 5px;
           }
       """

        # 最小化按钮
        self.min_btn = QPushButton("−")
        self.min_btn.setStyleSheet(button_style)
        self.min_btn.clicked.connect(self.parent.showMinimized)

        # 最大化/还原按钮
        self.max_btn = QPushButton("□")
        self.max_btn.setStyleSheet(button_style)
        self.max_btn.clicked.connect(self.toggle_maximize)

        # 关闭按钮
        self.close_btn = QPushButton("×")
        self.close_btn.setStyleSheet(close_style)
        self.close_btn.clicked.connect(self.parent.close)

        layout.addWidget(self.min_btn)
        layout.addWidget(self.max_btn)
        layout.addWidget(self.close_btn)

    def toggle_maximize(self):
        """切换最大化状态"""
        if self.parent.isMaximized():
            self.parent.showNormal()
            self.max_btn.setText("□")
        else:
            self.parent.showMaximized()
            self.max_btn.setText("◱")

    def mousePressEvent(self, event):
        """鼠标按下事件 - 用于拖拽窗口"""
        if event.button() == Qt.LeftButton:
            self.drag_pos = event.globalPos() - self.parent.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        """鼠标移动事件 - 拖拽窗口"""
        if event.buttons() == Qt.LeftButton and hasattr(self, 'drag_pos'):
            self.parent.move(event.globalPos() - self.drag_pos)
            event.accept()

    def mouseDoubleClickEvent(self, event):
        """双击标题栏最大化/还原"""
        if event.button() == Qt.LeftButton:
            self.toggle_maximize()


class set_pyqt(QWidget):
    # 添加信号用于线程安全的日志更新
    log_signal = pyqtSignal(str)
    mcp_log_signal = pyqtSignal(str)

    def __init__(self):
        super().__init__()
        self.live2d_process = None
        self.tools_enabled = False  # 工具调用功能状态，默认关闭
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
        self.tool_descriptions, self.fc_tools, self.mcp_tools = load_tool_descriptions()

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
        self.title_bar.title_label.setText(f'My-Neuro  {version}' if version else 'My-Neuro')
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

        # 为API KEY输入框添加小眼睛图标
        self.setup_api_key_visibility_toggles()

        # 修改复选框布局为水平布局
        self.modify_checkbox_layout()

        # 创建Toast提示
        self.toast = ToastNotification(self)

        # 初始化时刷新工具列表
        self.refresh_tools_list()
        self.refresh_mcp_tools_list()

        # 根据UI复选框状态初始化开关（必须在日志信号连接之前设置）
        self.mcp_enabled = self.ui.checkBox_mcp_enable.isChecked()  # MCP功能开关
        self.tools_enabled = self.ui.checkBox_mcp.isChecked()       # 工具调用功能开关

        # 加载最近的日志记录
        self.load_recent_logs()

        # 连接日志信号
        self.log_signal.connect(self.update_log)
        self.mcp_log_signal.connect(self.update_tool_log)

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

    def closeEvent(self, event):
        """处理窗口关闭事件"""
        try:
            # 重新加载配置，确保使用最新的设置
            try:
                self.config = self.load_config()
            except Exception as e:
                print(f"重新加载配置失败: {e}")

            # 检查是否启用了自动关闭服务功能
            auto_close_config = self.config.get('auto_close_services', {})
            if auto_close_config.get('enabled', True):
                print("自动关闭所有服务...")

                # 关闭各种服务进程
                self.stop_asr()
                self.stop_bert()
                self.stop_rag()
                self.stop_voice_tts()
                self.stop_terminal()

                print("所有服务已关闭")
            else:
                print("未启用自动关闭服务，只关闭UI界面")

            # 无论是否启用自动关闭服务，都关闭桌宠进程
            self.close_live_2d()

        except Exception as e:
            print(f"关闭服务时出错: {e}")

        # 停止日志读取线程
        for reader in self.log_readers.values():
            if reader and reader.isRunning():
                reader.stop()
                reader.wait(1000)  # 等待最多1秒

        # 停止心情分定时器
        if self.mood_timer.isActive():
            self.mood_timer.stop()

        # 接受关闭事件
        event.accept()

    def update_service_log(self, service_name, text):
        """更新指定服务的日志显示"""
        log_widgets = {
            'asr': getattr(self.ui, 'textEdit_asr_log', None),
            'tts': getattr(self.ui, 'textEdit_tts_log', None),
            'bert': getattr(self.ui, 'textEdit_bert_log', None),
            'rag': getattr(self.ui, 'textEdit_rag_log', None)
        }

        widget = log_widgets.get(service_name)
        if widget:
            widget.append(text)
            scrollbar = widget.verticalScrollBar()
            scrollbar.setValue(scrollbar.maximum())

    def load_recent_logs(self, max_lines=10):
        """加载最近的日志记录到UI界面，并启动日志读取线程"""
        log_widgets = {
            'asr': getattr(self.ui, 'textEdit_asr_log', None),
            'tts': getattr(self.ui, 'textEdit_tts_log', None),
            'bert': getattr(self.ui, 'textEdit_bert_log', None),
            'rag': getattr(self.ui, 'textEdit_rag_log', None)
        }

        for service_name, widget in log_widgets.items():
            if widget:
                log_file = self.log_file_paths.get(service_name)
                if log_file and os.path.exists(log_file):
                    try:
                        with open(log_file, 'r', encoding='utf-8') as f:
                            lines = f.readlines()
                            # 获取最后max_lines行
                            recent_lines = lines[-max_lines:] if len(lines) > max_lines else lines

                            # 清空当前内容并加载历史日志
                            widget.clear()
                            for line in recent_lines:
                                line = line.strip()
                                if line:  # 只添加非空行
                                    widget.append(line)

                            # 滚动到底部
                            scrollbar = widget.verticalScrollBar()
                            scrollbar.setValue(scrollbar.maximum())

                        # 启动日志读取线程来实时监控日志文件更新
                        if service_name in self.log_readers:
                            # 如果已有读取线程，先停止它
                            self.log_readers[service_name].stop()
                            self.log_readers[service_name].wait()

                        self.log_readers[service_name] = LogReader(log_file)
                        self.log_readers[service_name].log_signal.connect(
                            lambda text, sn=service_name: self.update_service_log(sn, text)
                        )
                        self.log_readers[service_name].start()
                        print(f"已启动{service_name}日志监控线程")

                    except Exception as e:
                        print(f"加载{service_name}日志失败: {str(e)}")

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


    def setup_motion_buttons(self):

        # 加载动作配置
        self.load_motion_config()

    def setup_expression_buttons(self):
        """设置表情控制按钮"""
    # 加载表情配置
        self.load_expression_config()
    # 创建动态表情按钮
        self.create_dynamic_expression_buttons()

    def load_motion_config(self):
        try:
            app_path = get_app_path()
            config_path = os.path.join(app_path, 'emotion_actions.json')
            print(f"尝试加载配置文件: {config_path}")
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            print(f"JSON文件中的角色列表: {list(data.keys())}")
            # 获取当前角色名称
            current_character = self.get_current_character_name()
            print(f"当前角色: '{current_character}'")
            # 加载对应角色的配置
            if current_character in data:
                self.motion_config = data[current_character].get('emotion_actions', {})
                print(f"成功加载角色 '{current_character}' 的动作配置，共 {len(self.motion_config)} 个动作")
            else:
                print(f"错误：未找到角色 '{current_character}' 的配置")
                print(f"可用角色: {list(data.keys())}")
                self.motion_config = {}
        except Exception as e:
            print(f"加载动作配置失败: {e}")
            self.motion_config = {}


    def load_expression_config(self):
        """加载表情配置"""
        try:
            app_path = get_app_path()
            config_path = os.path.join(app_path, 'emotion_expressions.json')
            print(f"尝试加载配置文件: {config_path}")
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            print(f"表情JSON文件中的角色列表: {list(data.keys())}")
            
            # 获取当前角色名称
            current_character = self.get_current_character_name()
            print(f"当前角色: '{current_character}'")
            
            # 加载对应角色的配置
            if current_character in data:
                self.expression_config = data[current_character].get('emotion_expressions', {})
                print(f"成功加载角色 '{current_character}' 的表情配置，共 {len(self.expression_config)} 个表情")
                
                # # 检查配置中的表情命名，确保是中文
                # self.ensure_expression_names_in_chinese()
            else:
                print(f"未找到角色 '{current_character}' 的表情配置，创建新配置")
                print(f"可用角色: {list(data.keys())}")
                self.expression_config = {}         
        except Exception as e:
            print(f"加载表情配置失败: {e}")
            self.expression_config = {}


    def scan_all_expressions_from_2d(self):
        """扫描2D文件夹下所有角色的表情文件"""
        try:
            app_path = get_app_path()
            two_d_path = os.path.join(app_path, "2D")
            
            if not os.path.exists(two_d_path):
                print(f"2D文件夹不存在: {two_d_path}")
                return []
            
            all_expressions = []
            
            # 遍历所有角色文件夹
            for character_folder in os.listdir(two_d_path):
                character_path = os.path.join(two_d_path, character_folder)
                if os.path.isdir(character_path):
                    # 检查是否有expressions文件夹
                    expressions_dir = os.path.join(character_path, "expressions")
                    if os.path.exists(expressions_dir):
                        for file in os.listdir(expressions_dir):
                            if file.endswith('.exp3.json'):
                                # 去掉扩展名作为表情名称
                                expression_name = file[:-10]  # 移除 .exp3.json
                                all_expressions.append(expression_name)
                                print(f"找到表情: {expression_name} (角色: {character_folder})")
            
            return all_expressions
            
        except Exception as e:
            print(f"扫描2D文件夹失败: {e}")
            return []  

    def get_current_character_name(self):
        # 直接从main.js读取当前设置的模型优先级
        try:
            app_path = get_app_path()
            main_js_path = os.path.join(app_path, "main.js")

            with open(main_js_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # 提取当前priorityFolders中第一个角色（这就是实际使用的角色）
            import re
            match = re.search(r"const priorityFolders = \['([^']+)'", content)
            if match:
                current_character = match.group(1)
                print(f"从main.js获取实际使用的角色: {current_character}")
                return current_character


        except Exception as e:
            print(f"读取main.js失败: {e}")
            raise Exception("无法确定当前使用的角色")

    def save_motion_config(self):
        """保存时需要更新对应角色的配置"""
        try:
            app_path = get_app_path()
            config_path = os.path.join(app_path, 'emotion_actions.json')

            # 读取完整配置
            with open(config_path, 'r', encoding='utf-8') as f:
                all_data = json.load(f)

            # 更新当前角色的配置
            current_character = self.get_current_character_name()
            if current_character not in all_data:
                all_data[current_character] = {"emotion_actions": {}}

            all_data[current_character]["emotion_actions"] = self.motion_config

            # 保存回文件
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(all_data, f, ensure_ascii=False, indent=2)

        except Exception as e:
            print(f"保存动作配置失败: {e}")

    def backup_original_config(self):
        """检查并加载分角色备份配置"""
        try:
            app_path = get_app_path()
            character_backup_path = os.path.join(app_path, 'character_backups.json')
            old_backup_path = os.path.join(app_path, 'emotion_actions_backup.json')

            # 兼容性处理：如果存在旧的备份文件但没有新的备份文件，进行迁移
            if os.path.exists(old_backup_path) and not os.path.exists(character_backup_path):
                self.migrate_old_backup_format(old_backup_path, character_backup_path)

            # 加载分角色备份配置
            if os.path.exists(character_backup_path):
                with open(character_backup_path, 'r', encoding='utf-8') as f:
                    self.character_backups = json.load(f)
                    print("已加载分角色备份配置")
            else:
                self.character_backups = {}
                print("未找到分角色备份文件，将在需要时创建")

        except Exception as e:
            print(f"加载备份配置失败: {e}")
            self.character_backups = {}

    def backup_original_config1(self):
        """检查并加载分角色备份配置"""
        try:
            app_path = get_app_path()
            character_backup_path = os.path.join(app_path, 'character_backups1.json')
           
            # 加载分角色备份配置
            if os.path.exists(character_backup_path):
                with open(character_backup_path, 'r', encoding='utf-8') as f:
                    self.character_backups1 = json.load(f)
                    print("已加载分角色备份配置")
            else:
                self.character_backups1 = {}
                print("未找到分角色备份文件，将在需要时创建")

        except Exception as e:
            print(f"加载备份配置失败: {e}")
            self.character_backups1 = {}

    def migrate_old_backup_format(self, old_backup_path, new_backup_path):
        """将旧格式的备份文件迁移到新格式"""
        try:
            import time
            with open(old_backup_path, 'r', encoding='utf-8') as f:
                old_data = json.load(f)

            new_format = {}
            current_time = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())

            for character_name, character_data in old_data.items():
                new_format[character_name] = {
                    "original_config": character_data,
                    "backup_time": current_time,
                    "migrated_from": "emotion_actions_backup.json"
                }

            with open(new_backup_path, 'w', encoding='utf-8') as f:
                json.dump(new_format, f, ensure_ascii=False, indent=2)

            print("已将旧格式备份文件迁移到新格式")

            # 重命名旧备份文件
            os.rename(old_backup_path, old_backup_path + '.old')

        except Exception as e:
            print(f"迁移旧备份文件失败: {e}")

    def scan_expression_files(self):
        """扫描expressions文件夹中的表情文件"""
        try:
            app_path = get_app_path()
            # 获取当前角色
            current_character = self.get_current_character_name()
            expressions_dir = os.path.join(app_path, "2D", current_character, "expressions")
            
            expression_files = []
            if os.path.exists(expressions_dir):
                for file in os.listdir(expressions_dir):
                    if file.endswith('.exp3.json'):
                        # 去掉扩展名作为表情名称
                        expression_name = file[:-10]  # 移除 .exp3.json
                        # 将 expression1, expression2 转换为 表情1, 表情2
                        if expression_name.startswith("expression"):
                            try:
                                # 提取数字
                                num = expression_name.replace("expression", "")
                                if num.isdigit():
                                    expression_name = f"表情{num}"
                            except:
                                pass
                        expression_files.append(expression_name)
            
            return expression_files
        except Exception as e:
            print(f"扫描表情文件失败: {e}")
            return []        
        


    def create_dynamic_motion_buttons(self):
        """创建动画页面 - 包含表情按钮和动作分类"""
        # 直接调用已存在的函数，这个函数已经集成了表情按钮
        self.create_expression_buttons_on_animation_page()

    def create_dynamic_expression_buttons(self):
        """创建表情按钮（直接调用完整函数）"""
        self.create_expression_buttons_on_animation_page()


    def create_expression_buttons_on_animation_page(self):
        """创建表情与动作页面 - 三部分布局"""
        
        # 获取动画页面的布局
        page_6_layout = self.ui.page_6.layout()
        if not page_6_layout:
            page_6_layout = QVBoxLayout(self.ui.page_6)
            self.ui.page_6.setLayout(page_6_layout)
        
        # 清空现有内容
        while page_6_layout.count():
            item = page_6_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
            elif item.layout():
                # 递归删除布局中的所有控件
                while item.layout().count():
                    child = item.layout().takeAt(0)
                    if child.widget():
                        child.widget().deleteLater()
                    elif child.layout():
                        self.delete_layout(child.layout())
        
        # 创建主滚动区域
        scroll_area = QScrollArea()
        scroll_widget = QWidget()
        main_layout = QVBoxLayout(scroll_widget)
        scroll_area.setWidget(scroll_widget)
        scroll_area.setWidgetResizable(True)
        
        # === 第一部分：唱歌控制区域（固定在最上面）===
        singing_section = QWidget()
        singing_section.setFixedHeight(150)
        singing_layout = QVBoxLayout(singing_section)
        
        singing_label = QLabel("🎵 唱歌控制")
        singing_label.setObjectName("subTitle")
        singing_label.setStyleSheet("font-size: 14px; font-weight: bold;")
        singing_layout.addWidget(singing_label)
        
        singing_buttons_layout = QHBoxLayout()
        start_singing_btn = QPushButton("🎵 开始唱歌")
        start_singing_btn.setObjectName("start_singing_btn")
        start_singing_btn.clicked.connect(lambda: self.trigger_emotion_motion("唱歌"))
        
        stop_singing_btn = QPushButton("🛑 停止唱歌")
        stop_singing_btn.setObjectName("stop_singing_btn")
        stop_singing_btn.clicked.connect(lambda: self.trigger_emotion_motion("停止"))
        
        singing_buttons_layout.addWidget(start_singing_btn)
        singing_buttons_layout.addWidget(stop_singing_btn)
        singing_layout.addLayout(singing_buttons_layout)
        
        # 添加固定分隔线
        separator1 = QFrame()
        separator1.setFrameShape(QFrame.HLine)
        separator1.setFrameShadow(QFrame.Sunken)
        separator1.setStyleSheet("background-color: #ccc; margin: 10px 0;")
        separator1.setFixedHeight(2)
        singing_layout.addWidget(separator1)
        
        main_layout.addWidget(singing_section)
        
        # === VMC协议控制区域（仅设置目标地址与端口，启用/关闭由桌宠按钮控制） ===
        vmc_section = QWidget()
        vmc_section.setFixedHeight(130)
        vmc_layout = QVBoxLayout(vmc_section)
        
        vmc_label = QLabel("📡 VMC协议目标设置")
        vmc_label.setStyleSheet("font-size: 14px; font-weight: bold;")
        vmc_layout.addWidget(vmc_label)
        
        # VMC 地址和端口
        vmc_addr_layout = QHBoxLayout()
        vmc_config = self.config.get('vmc', {})
        vmc_addr_layout.addWidget(QLabel("目标地址:"))
        self.lineEdit_vmc_host = QLineEdit(vmc_config.get('host', '127.0.0.1'))
        self.lineEdit_vmc_host.setPlaceholderText("127.0.0.1")
        self.lineEdit_vmc_host.setFixedWidth(150)
        vmc_addr_layout.addWidget(self.lineEdit_vmc_host)
        
        vmc_addr_layout.addWidget(QLabel("端口:"))
        self.lineEdit_vmc_port = QLineEdit(str(vmc_config.get('port', 39539)))
        self.lineEdit_vmc_port.setPlaceholderText("39539")
        self.lineEdit_vmc_port.setFixedWidth(80)
        vmc_addr_layout.addWidget(self.lineEdit_vmc_port)
        vmc_addr_layout.addStretch()
        vmc_layout.addLayout(vmc_addr_layout)
        
        # VMC 应用按钮
        vmc_btn_layout = QHBoxLayout()
        vmc_apply_btn = QPushButton("✅ 应用地址")
        vmc_apply_btn.setFixedWidth(120)
        vmc_apply_btn.clicked.connect(self.apply_vmc_settings)
        vmc_btn_layout.addWidget(vmc_apply_btn)
        
        vmc_hint = QLabel("提示: 启用/关闭VMC请使用桌宠上的📡按钮")
        vmc_hint.setStyleSheet("color: #999; font-size: 11px;")
        vmc_btn_layout.addWidget(vmc_hint)
        vmc_btn_layout.addStretch()
        vmc_layout.addLayout(vmc_btn_layout)
        
        # 分隔线
        vmc_separator = QFrame()
        vmc_separator.setFrameShape(QFrame.HLine)
        vmc_separator.setFrameShadow(QFrame.Sunken)
        vmc_separator.setStyleSheet("background-color: #ccc; margin: 10px 0;")
        vmc_separator.setFixedHeight(2)
        vmc_layout.addWidget(vmc_separator)
        
        main_layout.addWidget(vmc_section)
        
        # === 第二部分：表情区块 ===
        expression_section = QWidget()
        expression_layout = QVBoxLayout(expression_section)
        
        expression_label = QLabel("😊 表情控制")
        expression_label.setObjectName("subTitle")
        expression_label.setStyleSheet("font-size: 14px; font-weight: bold; margin-top: 10px;")
        expression_layout.addWidget(expression_label)
        
        # 表情一键还原按钮
        expression_reset_btn = QPushButton("🔄 一键还原表情")
        expression_reset_btn.setObjectName("stopButton")
        # expression_reset_btn.clicked.connect(self.reset_expression_config)
        expression_reset_btn.clicked.connect(self.reset_current_character1)
        expression_layout.addWidget(expression_reset_btn, alignment=Qt.AlignRight)
        
        # 表情情绪绑定区域说明
        binding_label = QLabel("情绪表情绑定区域（拖拽下方表情按钮到对应区域）")
        binding_label.setObjectName("subTitle")
        binding_label.setStyleSheet("font-size: 12px; color: #666; margin-top: 5px;")
        expression_layout.addWidget(binding_label)
        
        # 创建情绪表情绑定区域（6种情绪）
        emotion_expression_frame = QFrame()
        emotion_expression_frame.setStyleSheet("""
            QFrame {
                border: 2px solid #9370DB;
                border-radius: 10px;
                padding: 10px;
                background-color: #F8F0FF;
                margin: 10px 0;
            }
        """)
        emotion_expression_layout = QGridLayout(emotion_expression_frame)
        
        # 创建6种情绪绑定区域（不作为按钮，只作为投放区域）
        emotion_bindings = ["开心", "生气", "难过", "惊讶", "害羞", "俏皮"]
        for i, emotion in enumerate(emotion_bindings):
            drop_zone = self.create_emotion_expression_drop_zone(emotion)
            emotion_expression_layout.addWidget(drop_zone, i // 3, i % 3)
        
        expression_layout.addWidget(emotion_expression_frame)
        
        # 可拖动表情按钮区域说明
        buttons_label = QLabel("可拖拽表情按钮（点击预览，拖拽到上方情绪区域绑定）")
        buttons_label.setObjectName("subTitle")
        expression_layout.addWidget(buttons_label)
        
        # 创建可拖拽的表情按钮区域
        expression_buttons_frame = QFrame()
        expression_buttons_frame.setStyleSheet("""
            QFrame {
                border: 2px solid #ddd;
                border-radius: 10px;
                padding: 10px;
                background-color: #fff;
                margin-bottom: 10px;
            }
        """)
        expression_buttons_layout = QGridLayout(expression_buttons_frame)
        
        # 创建表情按钮（仅创建表情1-表情7等按钮，不包括情绪分类）
        self.create_expression_draggable_buttons(expression_buttons_layout)
        
        expression_layout.addWidget(expression_buttons_frame)
        main_layout.addWidget(expression_section)
        
        # 添加分隔线
        separator2 = QFrame()
        separator2.setFrameShape(QFrame.HLine)
        separator2.setFrameShadow(QFrame.Sunken)
        separator2.setStyleSheet("background-color: #ccc; margin: 10px 0;")
        separator2.setFixedHeight(2)
        main_layout.addWidget(separator2)
        
        # === 第三部分：动作区块 ===
        motion_section = QWidget()
        motion_layout = QVBoxLayout(motion_section)
        
        motion_label = QLabel("🎬 动作控制")
        motion_label.setObjectName("subTitle")
        motion_label.setStyleSheet("font-size: 14px; font-weight: bold;")
        motion_layout.addWidget(motion_label)
        
        # 动作一键还原按钮
        motion_reset_btn = QPushButton("🔄 一键还原动作")
        motion_reset_btn.setObjectName("stopButton")
        motion_reset_btn.clicked.connect(self.reset_current_character)
        motion_layout.addWidget(motion_reset_btn, alignment=Qt.AlignRight)
        
        # 情绪分类区域
        emotion_frame = QFrame()
        emotion_frame.setStyleSheet("""
            QFrame {
                border: 2px solid #ccc;
                border-radius: 10px;
                padding: 10px;
                background-color: #f9f9f9;
                margin: 10px 0;
            }
        """)
        emotion_layout = QGridLayout(emotion_frame)
        
        # 创建动作情绪分类容器
        empty_emotions = ["开心", "生气", "难过", "惊讶", "害羞", "俏皮"]
        for i, emotion in enumerate(empty_emotions):
            drop_zone = self.create_drop_zone(emotion)
            emotion_layout.addWidget(drop_zone, i // 3, i % 3)
        
        motion_layout.addWidget(emotion_frame)
        
        # 未分类动作区域
        action_label = QLabel("未分类动作（点击预览，拖拽到上方分类）")
        action_label.setObjectName("subTitle")
        motion_layout.addWidget(action_label)
        
        action_frame = QFrame()
        action_frame.setStyleSheet("""
            QFrame {
                border: 2px solid #ddd;
                border-radius: 10px;
                padding: 10px;
                background-color: #fff;
            }
        """)
        action_layout = QGridLayout(action_frame)
        
        # 创建分页后的动作按钮
        self.unclassified_actions_cache = [key for key in self.motion_config.keys()
                                        if key not in empty_emotions and self.motion_config[key]]
        self.create_action_buttons_only(action_layout)
        
        motion_layout.addWidget(action_frame)
        
        # 分页控件
        if len(self.unclassified_actions_cache) > self.items_per_page:
            self.create_standalone_pagination(motion_layout)
        
        main_layout.addWidget(motion_section)
        main_layout.addStretch()
        
        # 设置到页面
        page_6_layout.addWidget(scroll_area)

    def create_emotion_expression_drop_zone(self, emotion_name):
        """创建情绪表情投放区域（不作为按钮，只作为投放区域）"""
        drop_zone = QLabel()
        drop_zone.setMinimumSize(200, 120)
        drop_zone.setAlignment(Qt.AlignCenter)
        drop_zone.setWordWrap(True)
        drop_zone.setAcceptDrops(True)
        drop_zone.emotion_name = emotion_name
        
        # 更新显示
        self.update_emotion_expression_drop_zone_display(drop_zone, emotion_name)
        
        # 拖拽事件
        def dragEnterEvent(event):
            if event.mimeData().hasText() and event.mimeData().text().startswith("EXPRESSION:"):
                event.acceptProposedAction()
        
        def dropEvent(event):
            mime_text = event.mimeData().text()
            if mime_text.startswith("EXPRESSION:"):
                expression_name = mime_text.replace("EXPRESSION:", "")
                self.move_expression_to_emotion(expression_name, emotion_name)
                event.acceptProposedAction()
            else:
                event.ignore()
        
        drop_zone.dragEnterEvent = dragEnterEvent
        drop_zone.dropEvent = dropEvent
        
        return drop_zone    

    def update_emotion_expression_drop_zone_display(self, drop_zone, emotion_name):
        """更新情绪表情投放区域的显示"""
        # 确保表情配置已加载
        if not hasattr(self, 'expression_config'):
            self.load_expression_config()
        
        # 检查是否有绑定的表情文件
        has_expressions = False
        expression_files = []
        
        if self.expression_config and emotion_name in self.expression_config:
            expression_files = self.expression_config[emotion_name]
            if expression_files and len(expression_files) > 0:
                has_expressions = True
        
        if has_expressions:
            # 有绑定的表情文件
            count = len(expression_files)
            
            # 提取表情名称
            expression_names = []
            for expr_file in expression_files:
                if isinstance(expr_file, str):
                    # 从路径中提取表情名称
                    filename = expr_file.split('/')[-1].replace('.exp3.json', '')
                    # 转换为中文显示
                    if filename.startswith("expression"):
                        try:
                            num = filename.replace("expression", "")
                            if num.isdigit():
                                filename = f"表情{num}"
                        except:
                            pass
                    expression_names.append(filename)
            
            if len(expression_names) <= 2:
                display_text = f"{emotion_name}\n({count}个表情)\n{', '.join(expression_names)}"
            else:
                display_text = f"{emotion_name}\n({count}个表情)\n{', '.join(expression_names[:2])}..."
            
            drop_zone.setStyleSheet("""
                QLabel {
                    border: 2px solid #9370DB;
                    border-radius: 8px;
                    background-color: #F0E6FF;
                    font-size: 13px;
                    color: #4B0082;
                    padding: 5px;
                    font-weight: bold;
                }
                QLabel:hover {
                    border-color: #8A2BE2;
                    background-color: #E6E6FA;
                }
            """)
        else:
            # 没有绑定的表情文件
            display_text = f"{emotion_name}\n(拖拽表情到此绑定)"
            drop_zone.setStyleSheet("""
                QLabel {
                    border: 2px dashed #aaa;
                    border-radius: 8px;
                    background-color: #f5f5f5;
                    font-size: 14px;
                    color: #666;
                    padding: 5px;
                }
                QLabel:hover {
                    border-color: #9370DB;
                    background-color: #F0E6FF;
                }
            """)
        
        drop_zone.setText(display_text)

    

    def create_expression_draggable_buttons(self, layout):
        """创建可拖拽的表情按钮（仅表情按钮，不包括情绪分类）"""
        # 清空布局
        for i in reversed(range(layout.count())):
            item = layout.itemAt(i)
            if item and item.widget():
                item.widget().deleteLater()
        
        # 确保表情配置已加载
        if not hasattr(self, 'expression_config') or not self.expression_config:
            self.load_expression_config()
            if not hasattr(self, 'expression_config') or not self.expression_config:
                # 如果没有表情，显示提示
                no_expr_label = QLabel("未找到表情文件")
                no_expr_label.setAlignment(Qt.AlignCenter)
                no_expr_label.setStyleSheet("color: #666; font-size: 12px; padding: 20px;")
                layout.addWidget(no_expr_label)
                return
        
        # 获取表情按钮列表（排除情绪分类）
        expression_buttons = []
        emotion_categories = ["开心", "生气", "难过", "惊讶", "害羞", "俏皮"]
        
        for key in self.expression_config.keys():
            # 只显示表情按钮（表情1、表情2等），不显示情绪分类
            if key not in emotion_categories and key != "默认表情":
                # 检查是否是表情按钮（以"表情"开头或以"expression"开头）
                if key.startswith("表情") or key.startswith("expression"):
                    expression_buttons.append(key)
        
        print(f"可拖拽的表情按钮: {expression_buttons}")
        
        if not expression_buttons:
            # 如果没有表情按钮，显示提示
            no_expr_label = QLabel("未找到可用的表情按钮")
            no_expr_label.setAlignment(Qt.AlignCenter)
            no_expr_label.setStyleSheet("color: #666; font-size: 12px; padding: 20px;")
            layout.addWidget(no_expr_label)
            return
        
        # 创建表情按钮
        for i, expression_name in enumerate(expression_buttons):
            btn = self.create_single_expression_button(expression_name)
            row = i // 4
            col = i % 4
            layout.addWidget(btn, row, col)

    def create_single_expression_button(self, expression_name):
        """创建单个表情按钮"""
        btn = QPushButton(f"{expression_name}")
        btn.setObjectName("expressionButton")
        btn.setMinimumSize(150, 60)
        btn.setMaximumSize(200, 80)
        btn.expression_name = expression_name
        
        # 设置样式（与动作按钮相同）
        btn.setStyleSheet("""
            QPushButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, 
                    stop:0 rgba(255, 218, 185, 255), 
                    stop:1 rgba(255, 192, 203, 255));
                color: rgb(139, 69, 19);
                border: 1px solid #ffb6c1;
                border-radius: 8px;
                padding: 10px 15px;
                font-weight: bold;
                font-size: 12px;
            }
            QPushButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, 
                    stop:0 rgba(255, 192, 203, 255), 
                    stop:1 rgba(255, 182, 193, 255));
                color: rgb(178, 34, 34);
                border-color: #ff69b4;
            }
            QPushButton:pressed {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, 
                    stop:0 rgba(255, 182, 193, 255), 
                    stop:1 rgba(255, 160, 122, 255));
            }
        """)
        
        # 点击预览表情
        btn.clicked.connect(lambda checked, name=expression_name: self.trigger_expression(name))
        
        # 拖拽功能
        btn.mousePressEvent = self.create_expression_mouse_press_event(btn)
        btn.mouseMoveEvent = self.create_expression_mouse_move_event(btn)
        btn.mouseReleaseEvent = self.create_expression_mouse_release_event(btn)
        
        return btn

    def create_expression_mouse_press_event(self, btn):
        """创建表情按钮的鼠标按下事件"""
        def mousePressEvent(event):
            if event.button() == Qt.LeftButton:
                btn.drag_start_position = event.pos()
            QPushButton.mousePressEvent(btn, event)
        return mousePressEvent

    def create_expression_mouse_move_event(self, btn):
        """创建表情按钮的鼠标移动事件"""
        def mouseMoveEvent(event):
            if (event.buttons() == Qt.LeftButton and 
                hasattr(btn, 'drag_start_position') and
                btn.drag_start_position and
                (event.pos() - btn.drag_start_position).manhattanLength() > 20):
                
                drag = QDrag(btn)
                mimeData = QMimeData()
                mimeData.setText(f"EXPRESSION:{btn.expression_name}")
                drag.setMimeData(mimeData)
                drag.exec_(Qt.MoveAction)
            else:
                QPushButton.mouseMoveEvent(btn, event)
        return mouseMoveEvent

    def create_expression_mouse_release_event(self, btn):
        """创建表情按钮的鼠标释放事件"""
        def mouseReleaseEvent(event):
            if event.button() == Qt.LeftButton:
                btn.drag_start_position = None
            QPushButton.mouseReleaseEvent(btn, event)
        return mouseReleaseEvent    


    def move_expression_to_emotion(self, expression_name, emotion_name):
        """将表情按钮绑定到指定情绪分类"""
       
        if expression_name in self.expression_config:
            # 获取表情文件路径
            expression_files = self.expression_config[expression_name]
            
            # 追加到目标情绪分类（不是覆盖）
            if emotion_name in self.expression_config:
                # 如果目标情绪已有动作，追加到现有列表
                if isinstance(self.expression_config[emotion_name], list):
                    self.expression_config[emotion_name].extend(expression_files)
                else:
                    self.expression_config[emotion_name] = expression_files
            else:
                # 如果目标情绪还没有动作，直接赋值
                self.expression_config[emotion_name] = expression_files

            self.save_expression_config()
            # 刷新界面
            self.refresh_expression_interface()
            self.toast.show_message(f"已将 {expression_name} 追加到 {emotion_name}", 2000)    

   

    def save_expression_config(self):
        """保存表情配置"""
        try:
            app_path = get_app_path()
            config_path = os.path.join(app_path, 'emotion_expressions.json')
            
            # 读取完整配置
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    all_data = json.load(f)
            else:
                all_data = {}
            
            # 更新当前角色的配置
            current_character = self.get_current_character_name()
            if current_character not in all_data:
                all_data[current_character] = {"emotion_expressions": {}}
        
            
            all_data[current_character]["emotion_expressions"] = self.expression_config

            # 保存回文件
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(all_data, f, ensure_ascii=False, indent=2)
                
        except Exception as e:
            print(f"保存表情配置失败: {e}")
            

    def refresh_expression_interface(self):
        """刷新表情界面"""

        # 保存当前滚动位置
        scroll_position = self.save_scroll_position()

        # 重新加载表情配置
        self.load_expression_config()
        
        # 重新创建表情页面
        self.create_expression_buttons_on_animation_page()

        # 恢复滚动位置
        self.restore_scroll_position(scroll_position)

    def scan_and_reload_expressions(self):
        """扫描并重新加载表情"""
        try:
            # 扫描表情文件
            expression_files = self.scan_expression_files()
            
            if not expression_files:
                self.toast.show_message("未找到任何 .exp3.json 文件", 3000)
                return
            
            self.toast.show_message(f"找到 {len(expression_files)} 个表情文件", 2000)
            
            # 重新加载表情配置
            self.load_expression_config()
            
            # 刷新界面
            self.refresh_drag_drop_interface()
            
        except Exception as e:
            self.toast.show_message(f"扫描失败: {str(e)}", 3000)
            print(f"扫描表情失败: {e}") 


    def save_scroll_position(self):
        """保存当前滚动区域的位置"""
        try:
            # 查找 page_6 中的滚动区域
            scroll_area = self.find_scroll_area(self.ui.page_6)
            if scroll_area:
                return {
                    'has_scroll': True,
                    'value': scroll_area.verticalScrollBar().value()
                }
        except Exception as e:
            print(f"保存滚动位置失败: {e}")
        
        return {'has_scroll': False}

    def restore_scroll_position(self, scroll_position):
        """恢复滚动区域的位置"""
        if not scroll_position or not scroll_position.get('has_scroll'):
            return
        
        try:
            # 延迟恢复滚动位置，等待界面完全渲染
            QTimer.singleShot(0, lambda: self.do_restore_scroll(scroll_position))
        except Exception as e:
            print(f"恢复滚动位置失败: {e}")

    def do_restore_scroll(self, scroll_position):
        """实际执行滚动位置恢复"""
        try:
            scroll_area = self.find_scroll_area(self.ui.page_6)
            if scroll_area:
                scroll_bar = scroll_area.verticalScrollBar()
                target_value = scroll_position.get('value', 0)
                # 确保目标值在有效范围内
                max_value = scroll_bar.maximum()
                if target_value > max_value:
                    target_value = max_value
                scroll_bar.setValue(target_value)
                print(f"恢复滚动位置到: {target_value}")
        except Exception as e:
            print(f"执行滚动恢复失败: {e}")

    def find_scroll_area(self, widget):
        """递归查找 QScrollArea"""
        if isinstance(widget, QScrollArea):
            return widget
        
        for child in widget.children():
            if isinstance(child, QScrollArea):
                return child
            result = self.find_scroll_area(child)
            if result:
                return result
        
        return None

    def create_action_buttons_only(self, action_layout):
        """只创建动作按钮，不创建分页控件"""
        # 清空旧的动作按钮
        for i in reversed(range(action_layout.count())):
            item = action_layout.itemAt(i)
            if item and item.widget():
                item.widget().deleteLater()

        total_actions = len(self.unclassified_actions_cache)

        # 计算当前页的动作
        start_idx = self.current_page * self.items_per_page
        end_idx = min(start_idx + self.items_per_page, total_actions)
        current_page_actions = self.unclassified_actions_cache[start_idx:end_idx]

        # 创建动作按钮
        for i, action in enumerate(current_page_actions):
            btn = self.create_draggable_button(action, self.motion_config[action])
            action_layout.addWidget(btn, i // 4, i % 4)

    def create_standalone_pagination(self, parent_layout):
        """创建独立的分页控件"""
        total_items = len(self.unclassified_actions_cache)
        total_pages = (total_items + self.items_per_page - 1) // self.items_per_page

        # 创建分页容器
        pagination_layout = QHBoxLayout()
        pagination_layout.addStretch()

        # 上一页按钮
        prev_btn = QPushButton("上一页")
        prev_btn.setObjectName("navButton")
        prev_btn.setMinimumSize(80, 40)
        prev_btn.setEnabled(self.current_page > 0)
        prev_btn.clicked.connect(self.go_to_prev_page)
        pagination_layout.addWidget(prev_btn)

        # 页码按钮
        for page in range(total_pages):
            page_btn = QPushButton(str(page + 1))
            page_btn.setObjectName("navButton")
            page_btn.setMinimumSize(40, 40)
            page_btn.setCheckable(True)
            page_btn.setChecked(page == self.current_page)
            page_btn.clicked.connect(lambda checked, p=page: self.go_to_page(p))
            pagination_layout.addWidget(page_btn)

        # 下一页按钮
        next_btn = QPushButton("下一页")
        next_btn.setObjectName("navButton")
        next_btn.setMinimumSize(80, 40)
        next_btn.setEnabled(self.current_page < total_pages - 1)
        next_btn.clicked.connect(self.go_to_next_page)
        pagination_layout.addWidget(next_btn)

        pagination_layout.addStretch()

        # 将分页布局添加到主布局
        parent_layout.addLayout(pagination_layout)

    def go_to_prev_page(self):
        """切换到上一页"""
        if self.current_page > 0:
            self.current_page -= 1
            self.refresh_drag_drop_interface()

    def go_to_next_page(self):
        """切换到下一页"""
        total_pages = (len(self.unclassified_actions_cache) + self.items_per_page - 1) // self.items_per_page
        if self.current_page < total_pages - 1:
            self.current_page += 1
            self.refresh_drag_drop_interface()

    def go_to_page(self, page):
        """切换到指定页"""
        self.current_page = page
        self.refresh_drag_drop_interface()

    def create_drop_zone(self, emotion_name):
        """创建情绪分类投放区域"""
        drop_zone = QLabel()
        # drop_zone.setMinimumSize(200, 120)  # 增加高度以显示更多内容
        drop_zone.setAlignment(Qt.AlignCenter)
        drop_zone.setWordWrap(True)  # 允许文字换行
        drop_zone.setAcceptDrops(True)
        drop_zone.emotion_name = emotion_name

        # 更新显示内容
        self.update_drop_zone_display(drop_zone, emotion_name)

        # 重写拖拽事件
        def dragEnterEvent(event):
            if event.mimeData().hasText():
                event.acceptProposedAction()

        def dropEvent(event):
            action_name = event.mimeData().text()
            self.move_action_to_emotion(action_name, emotion_name)
            event.acceptProposedAction()

        drop_zone.dragEnterEvent = dragEnterEvent
        drop_zone.dropEvent = dropEvent

        return drop_zone

    def update_drop_zone_display(self, drop_zone, emotion_name):
        """更新投放区域的显示内容"""
        if emotion_name in self.motion_config and self.motion_config[emotion_name]:
            # 如果有动作文件，显示动作数量和部分文件名
            motion_files = self.motion_config[emotion_name]
            count = len(motion_files)

            # 获取动作文件名（去掉路径和扩展名）
            action_names = []
            for file_path in motion_files:
                if isinstance(file_path, str):
                    # 提取文件名，去掉路径和.motion3.json扩展名
                    filename = file_path.split('/')[-1].replace('.motion3.json', '')
                    action_names.append(filename)

            # 显示内容：情绪名 + 动作数量 + 部分动作名
            if action_names:
                if len(action_names) <= 2:
                    display_text = f"{emotion_name}\n({count}个动作)\n{', '.join(action_names)}"
                else:
                    display_text = f"{emotion_name}\n({count}个动作)\n{', '.join(action_names[:2])}..."
            else:
                display_text = f"{emotion_name}\n({count}个动作)"

            # 改变样式表示已有内容
            drop_zone.setStyleSheet("""
                QLabel {
                    border: 2px solid #4CAF50;
                    border-radius: 8px;
                    background-color: #E8F5E8;
                    font-size: 13px;
                    color: #2E7D32;
                    padding: 5px;
                    font-weight: bold;
                }
                QLabel:hover {
                    border-color: #388E3C;
                    background-color: #C8E6C9;
                }
            """)
        else:
            # 空的情绪分类
            display_text = f"{emotion_name}\n(拖拽动作到此)"
            drop_zone.setStyleSheet("""
                QLabel {
                    border: 2px dashed #aaa;
                    border-radius: 8px;
                    background-color: #f5f5f5;
                    font-size: 14px;
                    color: #666;
                    padding: 5px;
                }
                QLabel:hover {
                    border-color: #007acc;
                    background-color: #e8f4fd;
                }
            """)
        drop_zone.setText(display_text)

    def create_draggable_button(self, action_name, motion_files):
        """创建可拖拽的动作按钮"""
        btn = QPushButton(f"{action_name}\n({len(motion_files)}个)")
        btn.setObjectName("motionButton")
        btn.setMinimumSize(150, 80)
        btn.action_name = action_name
        btn.motion_files = motion_files

        # 点击预览动作
        btn.clicked.connect(lambda: self.trigger_emotion_motion(action_name))

        # 重写鼠标事件实现拖拽
        def mousePressEvent(event):
            if event.button() == Qt.LeftButton:
                self.drag_start_position = event.pos()
            # 调用原始的mousePressEvent以保持点击功能
            QPushButton.mousePressEvent(btn, event)

        def mouseMoveEvent(event):
            if (event.buttons() == Qt.LeftButton and
                    self.drag_start_position and
                    (event.pos() - self.drag_start_position).manhattanLength() > 20):
                drag = QDrag(btn)
                mimeData = QMimeData()
                mimeData.setText(action_name)
                drag.setMimeData(mimeData)
                drag.exec_(Qt.MoveAction)
            else:
                # 调用原始的mouseMoveEvent
                QPushButton.mouseMoveEvent(btn, event)

        def mouseReleaseEvent(event):
            # 重置拖拽起始位置
            if event.button() == Qt.LeftButton:
                self.drag_start_position = None
            # 调用原始的mouseReleaseEvent以保持点击功能
            QPushButton.mouseReleaseEvent(btn, event)

        btn.mousePressEvent = mousePressEvent
        btn.mouseMoveEvent = mouseMoveEvent
        btn.mouseReleaseEvent = mouseReleaseEvent

        return btn

    def move_action_to_emotion(self, action_name, emotion_name):
        """将动作移动到指定情绪分类"""
        if action_name in self.motion_config:
            # 获取要移动的动作文件
            motion_files = self.motion_config[action_name]
            # 从原位置删除
            del self.motion_config[action_name]
            # 追加到目标情绪分类（不是覆盖）
            if emotion_name in self.motion_config:
                # 如果目标情绪已有动作，追加到现有列表
                if isinstance(self.motion_config[emotion_name], list):
                    self.motion_config[emotion_name].extend(motion_files)
                else:
                    self.motion_config[emotion_name] = motion_files
            else:
                # 如果目标情绪还没有动作，直接赋值
                self.motion_config[emotion_name] = motion_files

            self.save_motion_config()
            # 刷新界面
            self.refresh_drag_drop_interface()
            self.toast.show_message(f"已将 {action_name} 追加到 {emotion_name}", 2000)

    def reset_current_character(self):
        """复位当前选中的角色到原版配置"""
        try:
            # 获取当前角色名称
            current_character = self.get_current_character_name()
            if not current_character:
                self.toast.show_message("无法获取当前角色信息", 3000)
                return

            # 检查角色是否有备份
            if current_character not in self.character_backups:
                self.toast.show_message(f"角色 {current_character} 没有备份配置", 3000)
                return

            # 加载当前完整配置
            app_path = get_app_path()
            config_path = os.path.join(app_path, 'emotion_actions.json')

            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    all_config = json.load(f)
            else:
                self.toast.show_message("配置文件不存在", 3000)
                return

            # 只复位当前角色的配置
            original_config = self.character_backups[current_character]["original_config"]
            all_config[current_character] = original_config

            # 保存更新后的配置
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(all_config, f, ensure_ascii=False, indent=2)

            # 重新加载配置
            self.load_motion_config()

            # 刷新界面
            self.refresh_drag_drop_interface()

            self.toast.show_message(f"已复位当前皮套到原版配置", 2000)

        except Exception as e:
            self.toast.show_message(f"复位失败：{str(e)}", 3000)

    def reset_current_character1(self):
        """复位当前选中的角色到原版配置"""
        try:
            # 获取当前角色名称
            current_character = self.get_current_character_name()
            if not current_character:
                self.toast.show_message("无法获取当前角色信息", 3000)
                return

            # 检查角色是否有备份
            if current_character not in self.character_backups1:
                self.toast.show_message(f"角色 {current_character} 没有备份配置", 3000)
                return

            # 加载当前完整配置
            app_path = get_app_path()
            config_path = os.path.join(app_path, 'emotion_expressions.json')

            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    all_config = json.load(f)
            else:
                self.toast.show_message("配置文件不存在", 3000)
                return

            # 只复位当前角色的配置
            original_config = self.character_backups1[current_character]["original_config1"]
            all_config[current_character] = original_config

            # 保存更新后的配置
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(all_config, f, ensure_ascii=False, indent=2)

            # 重新加载配置
            self.load_expression_config()

            
            
            # 刷新界面
            self.refresh_expression_interface()

            self.toast.show_message(f"已复位当前皮套到原版配置", 2000)

        except Exception as e:
            self.toast.show_message(f"复位失败：{str(e)}", 3000)


    def refresh_drag_drop_interface(self):
        """刷新拖拽界面"""

        # 保存当前滚动位置
        scroll_position = self.save_scroll_position()

        # 保持当前页码不变，除非超出范围
        unclassified_keys = [key for key in self.motion_config.keys()
                             if key not in ["开心", "生气", "难过", "惊讶", "害羞", "俏皮"]
                             and self.motion_config[key]]
        max_page = max(0, (len(unclassified_keys) - 1) // self.items_per_page)
        if self.current_page > max_page:
            self.current_page = max_page

        # 重新加载配置并刷新界面
        self.load_motion_config()

        # 清空并重新创建界面
        page_layout = self.ui.page_6.layout()
        # 移除旧的动态控件，确保完全清理
        items_to_remove = []
        for i in range(page_layout.count()):
            if i > 0:  # 保留第一个控件
                items_to_remove.append(i)

        # 从后往前删除，避免索引变化问题
        for i in reversed(items_to_remove):
            item = page_layout.takeAt(i)
            if item.widget():
                item.widget().deleteLater()
            elif item.layout():
                # 递归删除布局中的所有控件
                while item.layout().count():
                    child = item.layout().takeAt(0)
                    if child.widget():
                        child.widget().deleteLater()
                    elif child.layout():
                        self.delete_layout(child.layout())
                item.layout().deleteLater()

        self.create_dynamic_motion_buttons()

        # 恢复滚动位置
        self.restore_scroll_position(scroll_position)

    def delete_layout(self, layout):
        """递归删除布局中的所有控件和子布局"""
        if layout is not None:
            while layout.count():
                item = layout.takeAt(0)
                if item.widget() is not None:
                    item.widget().deleteLater()
                elif item.layout() is not None:
                    self.delete_layout(item.layout())
            layout.deleteLater()

    def update_all_drop_zones(self):
        """更新所有投放区域的显示"""
        # 这个方法会在刷新界面时自动调用，暂时留空
        pass

    def _update_vmc_status_label(self):
        """VMC状态标签已移除，此方法保留为空以兼容"""
        pass

    def apply_vmc_settings(self):
        """立即应用VMC目标地址和端口（不控制启用/关闭）"""
        host = self.lineEdit_vmc_host.text() or '127.0.0.1'
        port_text = self.lineEdit_vmc_port.text()
        port = int(port_text) if port_text.isdigit() else 39539

        # 先保存到config.json
        try:
            current_config = self.load_config()
            if 'vmc' not in current_config:
                current_config['vmc'] = {}
            current_config['vmc']['host'] = host
            current_config['vmc']['port'] = port
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(current_config, f, ensure_ascii=False, indent=2)
            self.config = current_config
        except Exception as e:
            print(f"保存VMC配置失败: {e}")

        # 发送HTTP请求到Electron实时更新VMC目标地址
        if not (hasattr(self, 'live2d_process') and self.live2d_process and self.live2d_process.poll() is None):
            self.toast.show_message("VMC目标已保存，桌宠启动后生效", 2000)
            return

        try:
            data = json.dumps({
                "host": host,
                "port": port
            }).encode('utf-8')

            req = urllib.request.Request(
                'http://localhost:3002/control-vmc',
                data=data,
                headers={'Content-Type': 'application/json'}
            )

            with urllib.request.urlopen(req, timeout=2) as response:
                result = json.loads(response.read().decode('utf-8'))
                if result.get('success'):
                    self.toast.show_message(f"VMC目标已更新 → {host}:{port}", 2000)
                else:
                    self.toast.show_message(f"VMC更新失败: {result.get('message', '未知错误')}", 2000)
        except Exception as e:
            print(f"VMC实时更新失败: {e}")
            self.toast.show_message("VMC目标已保存，重启桌宠后生效", 2000)

    def trigger_emotion_motion(self, emotion_name):
        """
        最终版：通过HTTP请求直接调用前端底层的情绪触发逻辑。
        """
        if not (self.live2d_process and self.live2d_process.poll() is None):
            self.toast.show_message("桌宠未启动，无法触发动作", 2000)
            return

        print(f"准备通过HTTP发送情绪指令: {emotion_name}")
        try:
            # 构建一个完全符合前端 emotion-motion-mapper.js 逻辑的请求
            data = json.dumps({
                "action": "trigger_emotion",  # 告诉前端使用情绪名称触发
                "emotion_name": emotion_name  # 传递情绪名称
            }).encode('utf-8')

            # 创建请求
            req = urllib.request.Request(
                'http://localhost:3002/control-motion',  # 这是内嵌在main.js的命令接收地址
                data=data,
                headers={'Content-Type': 'application/json'}
            )

            # 发送请求并处理响应
            with urllib.request.urlopen(req, timeout=2) as response:
                result = json.loads(response.read().decode('utf-8'))
                if result.get('success'):
                    self.toast.show_message(f"已触发情绪: {emotion_name}", 1500)
                    print(f"前端成功响应: {result.get('message')}")
                else:
                    self.toast.show_message(f"指令失败: {result.get('message', '未知错误')}", 2000)

        except urllib.error.URLError as e:
            error_message = f"动作触发失败: 无法连接到桌宠的命令接收器。请确认桌宠已完全启动。"
            print(f"HTTP请求失败: {e}")
            self.toast.show_message(error_message, 3000)
        except Exception as e:
            error_message = f"动作触发失败: 发生未知错误 - {str(e)}"
            print(f"触发动作时发生未知错误: {e}")
            self.toast.show_message(error_message, 3000)


    def trigger_expression(self, expression_name):
        """触发表情播放"""
        if not (self.live2d_process and self.live2d_process.poll() is None):
            self.toast.show_message("桌宠未启动，无法触发表情", 2000)
            return
        
        print(f"准备通过HTTP发送表情指令: {expression_name}")
        
        # 转换为中文显示名称
        display_name = expression_name
        if expression_name.startswith("expression"):
            try:
                num = expression_name.replace("expression", "")
                if num.isdigit():
                    display_name = f"表情{num}"
            except:
                pass
        
        try:
            # 构建HTTP请求
            data = json.dumps({
                "action": "trigger_expression",
                "expression_name": expression_name  # 发送原始名称
            }).encode('utf-8')
            
            req = urllib.request.Request(
                'http://localhost:3002/control-expression',
                data=data,
                headers={'Content-Type': 'application/json'}
            )
            
            with urllib.request.urlopen(req, timeout=2) as response:
                result = json.loads(response.read().decode('utf-8'))
                if result.get('success'):
                    self.toast.show_message(f"已触发表情: {display_name}", 1500)
                else:
                    self.toast.show_message(f"表情触发失败: {result.get('message', '未知错误')}", 2000)
                    
        except urllib.error.URLError as e:
            error_message = "表情触发失败: 无法连接到桌宠的命令接收器"
            self.toast.show_message(error_message, 3000)
        except Exception as e:
            error_message = f"表情触发失败: {str(e)}"
            self.toast.show_message(error_message, 3000)

    def read_live2d_logs(self):
        """读取桌宠进程的标准输出"""
        if not self.live2d_process:
            return

        # 持续读取直到进程结束
        for line in iter(self.live2d_process.stdout.readline, ''):
            if line:
                line_stripped = line.strip()

                # ✅ 新方案：只检查 [TOOL] 标记，100%准确
                is_tool_log = '[TOOL]' in line_stripped

                if is_tool_log:
                    # 工具日志发送到工具日志框
                    clean_line = self.clean_log_line(line_stripped)
                    if clean_line is not None:
                        self.mcp_log_signal.emit(clean_line)
                else:
                    # 普通日志发送到桌宠日志框
                    self.log_signal.emit(line_stripped)
            if self.live2d_process.poll() is not None:
                break

    def tail_log_file(self):
        """实时读取runtime.log文件"""
        log_file = "runtime.log"

        # 如果文件存在，先清空
        if os.path.exists(log_file):
            open(log_file, 'w').close()

        # 等待文件创建
        while not os.path.exists(log_file):
            time.sleep(0.1)
            # 如果进程已经结束或线程被停止，退出
            if not self.log_thread_running:
                return
            if self.live2d_process and self.live2d_process.poll() is not None:
                return

        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                f.seek(0, 2)  # 移到文件末尾
                while self.log_thread_running:  # 🔥 使用标志控制循环
                    line = f.readline()
                    if line:
                        line_stripped = line.strip()

                        # ✅ 新方案：只检查 [TOOL] 标记，100%准确
                        is_tool_log = '[TOOL]' in line_stripped

                        if is_tool_log:
                            # 工具日志发送到工具日志框
                            clean_line = self.clean_log_line(line_stripped)
                            if clean_line is not None:
                                self.mcp_log_signal.emit(clean_line)
                        else:
                            # 普通日志发送到桌宠日志框
                            self.log_signal.emit(line_stripped)
                    else:
                        time.sleep(0.1)

                    # 如果进程已经结束，停止读取
                    if self.live2d_process and self.live2d_process.poll() is not None:
                        break
        except Exception as e:
            self.log_signal.emit(f"读取日志文件出错: {str(e)}")
        finally:
            # 🔥 线程退出时重置标志
            self.log_thread_running = False

    def update_log(self, text):
        """更新日志到UI（在主线程中执行）"""
        self.ui.textEdit_2.append(text)

    def clean_log_line(self, log_line):
        """清理日志行，去除时间戳前缀并简化特定的MCP状态信息"""
        try:
            # 匹配并去除时间戳格式：[2025-09-26T15:46:16.371Z] [INFO]
            import re
            pattern = r'^\[[\d\-T:.Z]+\]\s*\[[\w]+\]\s*'
            cleaned = re.sub(pattern, '', log_line)
            cleaned = cleaned.strip()

            # 只简化特定的MCP状态信息
            if '✅ MCPManager创建成功，启用状态: true' in cleaned:
                return None  # 不显示这个
            elif '✅ MCPManager创建成功，启用状态: false' in cleaned:
                return 'MCP启动失败'
            elif '🔍 检查MCP状态: mcpManager=true, isEnabled=true' in cleaned:
                return 'MCP启动成功'
            elif '✅ MCP系统初始化完成，耗时:' in cleaned:
                # 提取耗时信息
                match = re.search(r'耗时:\s*(\d+)ms', cleaned)
                if match:
                    time_ms = match.group(1)
                    return f'mcp服务器开启耗时：{time_ms}ms'
                return 'mcp服务器开启完成'

            return cleaned
        except Exception as e:
            print(f"清理日志行失败: {e}")
            return log_line


    def enhance_tool_log_with_description(self, log_text):
        """增强工具日志，添加工具描述"""
        try:
            enhanced_text = log_text

            # 检查日志中是否包含工具名称，并添加描述
            for tool_name, description in self.tool_descriptions.items():
                if tool_name in log_text and "→" not in log_text:
                    # 对于MCP工具调用日志，替换JSON中的工具名
                    if '{"name":"' + tool_name + '"' in log_text or '"function":{"name":"' + tool_name + '"' in log_text:
                        enhanced_text = log_text.replace(tool_name, f"{tool_name} → {description}")
                    else:
                        # 对于其他格式，添加描述到日志末尾
                        enhanced_text = f"{log_text} → {description}"
                    break

            return enhanced_text
        except Exception as e:
            print(f"增强工具日志失败: {e}")
            return log_text

    def update_tool_log(self, text):
        """更新工具日志到UI（在主线程中执行）"""
        # 增强日志文本，添加工具描述
        # enhanced_text = self.enhance_tool_log_with_description(text)
        # self.ui.textEdit.append(enhanced_text)
        self.ui.textEdit.append(text)

    def is_tool_related_log(self, log_line):
        """判断日志是否与工具调用相关（排除初始化日志）"""
        # 排除桌宠初始化时的MCP系统日志
        init_keywords = [
            '初始化MCP系统', 'MCP管理器配置', 'MCPManager创建',
            '检查MCP状态', 'MCP系统未启用', 'MCP系统启用失败'
        ]

        # 如果包含初始化关键词，不视为工具调用日志
        if any(keyword in log_line for keyword in init_keywords):
            return False

        # 只有实际工具调用相关的日志才路由到工具日志
        actual_tool_keywords = [
            'Function Call', 'function call',
            '工具调用', '函数调用',
            'tool_calls', 'function_name',
            'tool executed', 'tool execution',
            'handleToolCalls', 'callTool',
            '正在执行工具', '工具执行',
            'server-tools'
        ]

        return any(keyword in log_line for keyword in actual_tool_keywords)

    # ===== 以下函数已废弃，使用 [TOOL] 标记替代关键词匹配 =====
    # def contains_mcp_content(self, log_line):
    #     """判断日志是否包含MCP相关内容（已废弃）"""
    #     mcp_status_keywords = [
    #         'MCP系统初始化完成，耗时',
    #         'MCP状态:',
    #         'MCPManager创建成功，启用状态'
    #     ]
    #     if any(keyword in log_line for keyword in mcp_status_keywords):
    #         return True
    #     tool_call_keywords = ['检测到工具调用', '开始执行工具调用', '工具调用结果', '发送工具结果到LLM']
    #     if any(keyword in log_line for keyword in tool_call_keywords):
    #         fc_tool_names = list(self.fc_tools) if hasattr(self, 'fc_tools') else []
    #         if any(tool_name in log_line for tool_name in fc_tool_names):
    #             return False
    #         return True
    #     return False
    #
    # def contains_function_call_content(self, log_line):
    #     """判断日志是否包含Function Call相关内容（已废弃）"""
    #     fc_status_keywords = [
    #         'Function Call', 'function call',
    #         'server-tools', '工具服务器', '正在执行工具', '工具执行'
    #     ]
    #     if any(keyword in log_line for keyword in fc_status_keywords):
    #         return True
    #     tool_call_keywords = ['检测到工具调用', '开始执行工具调用', '工具调用结果', '发送工具结果到LLM']
    #     if any(keyword in log_line for keyword in tool_call_keywords):
    #         fc_tool_names = list(self.fc_tools) if hasattr(self, 'fc_tools') else []
    #         if any(tool_name in log_line for tool_name in fc_tool_names):
    #             return True
    #         return False
    #     return False

    def eventFilter(self, obj, event):
        """全局事件过滤器 - 捕获所有鼠标事件"""
        if event.type() == QEvent.MouseMove:
            # 将全局坐标转换为窗口本地坐标
            if self.isVisible():
                local_pos = self.mapFromGlobal(QCursor.pos())

                if self.resizing and self.resize_edge:
                    self.do_resize(QCursor.pos())
                    return True
                else:
                    # 更新光标
                    edge = self.get_resize_edge(local_pos)
                    if edge and self.rect().contains(local_pos):
                        self.setCursor(self.get_resize_cursor(edge))
                    else:
                        self.setCursor(Qt.ArrowCursor)

        elif event.type() == QEvent.MouseButtonPress:
            if event.button() == Qt.LeftButton and self.isVisible():
                local_pos = self.mapFromGlobal(QCursor.pos())
                if self.rect().contains(local_pos):
                    self.resize_edge = self.get_resize_edge(local_pos)
                    if self.resize_edge:
                        self.resizing = True
                        self.resize_start_pos = QCursor.pos()
                        self.resize_start_geometry = self.geometry()
                        return True

        elif event.type() == QEvent.MouseButtonRelease:
            if event.button() == Qt.LeftButton and self.resizing:
                self.resizing = False
                self.resize_edge = None
                self.setCursor(Qt.ArrowCursor)
                return True

        return super().eventFilter(obj, event)

    def modify_checkbox_layout(self):
        """修改复选框布局为水平布局"""
        # 找到启动页面
        page = self.ui.page
        page_layout = page.layout()

        # 移除原来的垂直布局中的复选框
        checkbox_mcp = self.ui.checkBox_mcp
        checkbox_mcp_enable = self.ui.checkBox_mcp_enable
        checkbox_vision = self.ui.checkBox_5

        # 从原布局中移除
        page_layout.removeWidget(checkbox_mcp)
        page_layout.removeWidget(checkbox_mcp_enable)
        page_layout.removeWidget(checkbox_vision)

        # 创建新的水平布局
        checkbox_layout = QHBoxLayout()
        checkbox_layout.setSpacing(30)
        checkbox_layout.addWidget(checkbox_mcp)
        checkbox_layout.addWidget(checkbox_mcp_enable)
        checkbox_layout.addWidget(checkbox_vision)
        checkbox_layout.addStretch()  # 添加弹性空间

        # 将水平布局插入到原来的位置（在按钮布局之后）
        page_layout.insertLayout(1, checkbox_layout)

    def get_resize_edge(self, pos):
        """判断鼠标是否在边缘 - 只检测四个角"""
        rect = self.rect()
        x, y = pos.x(), pos.y()

        # 检查是否在边缘
        left = x <= self.edge_margin
        right = x >= rect.width() - self.edge_margin
        top = y <= self.edge_margin
        bottom = y >= rect.height() - self.edge_margin

        # 只返回四个角的情况
        if top and left:
            return 'top-left'
        elif top and right:
            return 'top-right'
        elif bottom and left:
            return 'bottom-left'
        elif bottom and right:
            return 'bottom-right'
        return None

    def get_resize_cursor(self, edge):
        """根据边缘返回光标样式"""
        cursor_map = {
            'top': Qt.SizeVerCursor,
            'bottom': Qt.SizeVerCursor,
            'left': Qt.SizeHorCursor,
            'right': Qt.SizeHorCursor,
            'top-left': Qt.SizeFDiagCursor,
            'top-right': Qt.SizeBDiagCursor,
            'bottom-left': Qt.SizeBDiagCursor,
            'bottom-right': Qt.SizeFDiagCursor,
        }
        return cursor_map.get(edge, Qt.ArrowCursor)

    def mousePressEvent(self, event):
        # 这些方法保留，但主要逻辑在eventFilter中
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        # 这些方法保留，但主要逻辑在eventFilter中
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        # 这些方法保留，但主要逻辑在eventFilter中
        super().mouseReleaseEvent(event)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if self._base_size:
            self._resize_debounce.start(80)  # 80ms 防抖，避免拖拽时频繁刷新

    def changeEvent(self, event):
        super().changeEvent(event)
        # 最大化 ↔ 还原切换时 resizeEvent 在 Windows 上不总触发，这里兜底
        if event.type() == QEvent.WindowStateChange and self._base_size:
            self._resize_debounce.start(150)

    def do_resize(self, global_pos):
        """执行窗口调整大小"""
        if not self.resize_start_pos or not self.resize_start_geometry:
            return

        delta = global_pos - self.resize_start_pos
        geo = QRect(self.resize_start_geometry)

        # 处理水平调整
        if 'left' in self.resize_edge:
            geo.setLeft(geo.left() + delta.x())
            geo.setWidth(geo.width() - delta.x())
        elif 'right' in self.resize_edge:
            geo.setWidth(geo.width() + delta.x())

        # 处理垂直调整
        if 'top' in self.resize_edge:
            geo.setTop(geo.top() + delta.y())
            geo.setHeight(geo.height() - delta.y())
        elif 'bottom' in self.resize_edge:
            geo.setHeight(geo.height() + delta.y())

        self.setGeometry(geo)

    def update_mood_score(self):
        """更新心情分显示"""
        try:
            # 读取心情分文件
            app_path = get_app_path()
            mood_file = os.path.join(app_path, "AI记录室", "mood_status.json")

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

    def set_btu(self):
        self.ui.pushButton.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(1))
        self.ui.pushButton_3.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(0))
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
        # 复位皮套位置按钮
        self.ui.pushButton_reset_model_position.clicked.connect(self.reset_model_position)
        # 桌宠切换按钮（合并启动和关闭）
        self.ui.pushButton_toggle_live2d.clicked.connect(self.toggle_live_2d)
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

        self.ui.pushButton_back_to_home.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(0))

        # 工具广场相关按钮绑定
        self.ui.pushButton_refresh_tools.clicked.connect(self.refresh_tool_market)
        self.init_tool_market_table()

        # FC广场相关按钮绑定
        try:
            self.ui.pushButton_refresh_fc_tools.clicked.connect(self.refresh_fc_market)
            self.init_fc_market_table()
        except Exception as e:
            print(f"FC广场初始化失败: {e}")

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

        # 初始化桌宠切换按钮样式（默认为"启动"状态）
        self.update_toggle_button_style(False)

    def scan_voice_models(self):
        """扫描当前目录下的pth模型文件"""
        try:
            import glob
            current_dir = os.path.dirname(os.path.abspath(__file__))
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
            current_dir = os.path.dirname(os.path.abspath(__file__))
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

            current_dir = os.path.dirname(os.path.abspath(__file__))
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
            is_cloud_asr = self.config.get('cloud', {}).get('baidu_asr', {}).get('enabled', False)
            base_path = get_base_path()

            if is_cloud_asr:  # 云端ASR
                bat_file = os.path.join(base_path, "VAD.bat")
                asr_type_name = "云端ASR（仅VAD）"
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
            bat_file = os.path.join(base_path, "MEMOS-API.bat")

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

    def clear_logs(self):
        """清空日志功能"""
        # 清空桌宠日志
        self.ui.textEdit_2.clear()
        # 清空工具日志
        self.ui.textEdit.clear()
        # 显示提示
        self.toast.show_message("日志已清空", 1500)



    def set_config(self):
        self.ui.lineEdit.setText(self.config['llm']['api_key'])
        self.ui.lineEdit_2.setText(self.config['llm']['api_url'])
        self.ui.lineEdit_3.setText(self.config['llm']['model'])
        self.ui.textEdit_3.setPlainText(self.config['llm']['system_prompt'])
        self.ui.doubleSpinBox_temperature.setValue(self.config['llm'].get('temperature', 1.0))
        self.ui.lineEdit_4.setText(self.config['ui']['intro_text'])
        self.ui.lineEdit_5.setText(str(self.config['context']['max_messages']))
        self.ui.checkBox_mcp.setChecked(self.config.get('tools', {}).get('enabled', True))
        self.ui.checkBox_mcp_enable.setChecked(self.config.get('mcp', {}).get('enabled', True))
        self.ui.checkBox_5.setChecked(self.config['vision']['auto_screenshot'])
        self.ui.checkBox_3.setChecked(self.config['ui']['show_chat_box'])
        self.ui.checkBox_4.setChecked(self.config['context']['enable_limit'])
        # 新增ASR和TTS配置
        self.ui.checkBox_asr.setChecked(self.config['asr']['enabled'])
        self.ui.checkBox_tts.setChecked(self.config['tts']['enabled'])
        self.ui.checkBox_persistent_history.setChecked(self.config['context']['persistent_history'])
        self.ui.checkBox_voice_barge_in.setChecked(self.config['asr']['voice_barge_in'])

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

        # 百度流式ASR配置
        baidu_asr = cloud_config.get('baidu_asr', {})
        self.ui.checkBox_cloud_asr_enabled.setChecked(baidu_asr.get('enabled', False))
        self.ui.lineEdit_cloud_asr_url.setText(baidu_asr.get('url', 'ws://vop.baidu.com/realtime_asr'))
        self.ui.lineEdit_cloud_asr_appid.setText(str(baidu_asr.get('appid', '')))
        self.ui.lineEdit_cloud_asr_appkey.setText(baidu_asr.get('appkey', ''))
        self.ui.lineEdit_cloud_asr_dev_pid.setText(str(baidu_asr.get('dev_pid', 15372)))

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


    # ===== 插件配置文件读写 =====

    def _plugin_config_path(self, plugin_type, plugin_name):
        app_path = get_app_path()
        return os.path.join(app_path, 'plugins', plugin_type, plugin_name, 'plugin_config.json')

    def _load_plugin_file_config(self, plugin_type, plugin_name):
        path = self._plugin_config_path(plugin_type, plugin_name)
        if not os.path.exists(path):
            return {}
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_plugin_file_config(self, plugin_type, plugin_name, cfg):
        path = self._plugin_config_path(plugin_type, plugin_name)
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
        except Exception as e:
            QMessageBox.warning(self, '保存失败', f'插件配置保存失败: {e}')

    # ===== enabled_plugins.json 读写 =====

    def _enabled_plugins_path(self):
        return os.path.join(get_app_path(), 'plugins', 'enabled_plugins.json')

    def _load_enabled_plugins(self):
        path = self._enabled_plugins_path()
        if not os.path.exists(path):
            return set()
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return set(data.get('plugins', []))
        except Exception:
            return set()

    def _save_enabled_plugins(self, enabled_set):
        path = self._enabled_plugins_path()
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump({'plugins': sorted(enabled_set)}, f, ensure_ascii=False, indent=2)
        except Exception as e:
            QMessageBox.warning(self, '保存失败', f'enabled_plugins.json 写入失败: {e}')

    def _resolve_plugin_schema(self, raw):
        """将 schema 格式的 plugin_config 解析为 {key: value} 平铺字典"""
        result = {}
        for key, field_def in raw.items():
            if isinstance(field_def, dict) and 'type' in field_def:
                if field_def['type'] == 'object' and 'fields' in field_def:
                    result[key] = self._resolve_plugin_schema(field_def['fields'])
                else:
                    result[key] = field_def.get('value', field_def.get('default'))
            else:
                result[key] = field_def
        return result

    def _set_schema_value(self, raw, key, value):
        """将值写入 schema 条目的 value 字段（兼容旧格式）"""
        if isinstance(raw.get(key), dict) and 'type' in raw[key]:
            raw[key]['value'] = value
        else:
            raw[key] = value

    # ===== 插件管理页 =====

    def setup_plugins_page(self):
        app_path = get_app_path()
        self._plugin_infos = []
        self._plugin_tab_layouts = {}
        self._plugin_tab_dirs    = {}

        # --- 列表页：对齐提示词广场布局风格 ---
        list_page = QWidget()
        outer = QVBoxLayout(list_page)
        outer.setContentsMargins(20, 20, 20, 20)
        outer.setSpacing(15)

        tab_widget = QTabWidget()
        tab_widget.setFont(self._ui_font())
        outer.addWidget(tab_widget)

        for plugin_type, base_dir, tab_title in [
            ('built-in',  os.path.join(app_path, 'plugins', 'built-in'),  '内置插件'),
            ('community', os.path.join(app_path, 'plugins', 'community'), '社区插件'),
        ]:
            scroll = QScrollArea()
            scroll.setWidgetResizable(True)
            scroll.setFrameShape(QFrame.NoFrame)
            scroll.setStyleSheet('QScrollArea { border: none; background-color: transparent; }')
            content = QWidget()
            content.setStyleSheet('background-color: transparent;')
            layout = QVBoxLayout(content)
            layout.setContentsMargins(0, 10, 0, 10)
            layout.setSpacing(15)

            if os.path.isdir(base_dir):
                for entry in sorted(os.listdir(base_dir)):
                    plugin_dir = os.path.join(base_dir, entry)
                    meta_path  = os.path.join(plugin_dir, 'metadata.json')
                    cfg_path   = os.path.join(plugin_dir, 'plugin_config.json')
                    if not os.path.isdir(plugin_dir) or not os.path.exists(meta_path):
                        continue
                    try:
                        with open(meta_path, 'r', encoding='utf-8') as f:
                            meta = json.load(f)
                    except Exception:
                        continue
                    cfg = {}
                    if os.path.exists(cfg_path):
                        try:
                            with open(cfg_path, 'r', encoding='utf-8') as f:
                                cfg = json.load(f)
                        except Exception:
                            pass
                    info = {'meta': meta, 'cfg': cfg, 'cfg_path': cfg_path,
                            'plugin_type': plugin_type, 'plugin_name': entry}
                    self._plugin_infos.append(info)
                    self._build_plugin_row(info, layout)

            layout.addStretch()
            scroll.setWidget(content)
            tab_widget.addTab(scroll, tab_title)

            self._plugin_tab_layouts[plugin_type] = layout
            self._plugin_tab_dirs[plugin_type]    = base_dir

        self._plugin_watcher = QFileSystemWatcher()
        for _watch_dir in self._plugin_tab_dirs.values():
            if os.path.isdir(_watch_dir):
                self._plugin_watcher.addPath(_watch_dir)
        self._plugin_watcher.directoryChanged.connect(self._on_plugin_dir_changed)

        # --- 插件广场标签 ---
        market_tab = QWidget()
        market_tab.setStyleSheet('background-color: transparent;')
        market_vbox = QVBoxLayout(market_tab)
        market_vbox.setContentsMargins(0, 10, 0, 0)
        market_vbox.setSpacing(10)

        # 刷新按钮
        refresh_btn = QPushButton('🔄 刷新列表')
        refresh_btn.setFont(self._ui_font(10, bold=True))
        refresh_btn.setMinimumHeight(36)
        refresh_btn.setStyleSheet("""
            QPushButton { background-color: #27ae60; color: white; border-radius: 8px; border: none; padding: 6px 14px; }
            QPushButton:hover { background-color: #2ecc71; }
            QPushButton:pressed { background-color: #1e8449; }
        """)
        refresh_btn.clicked.connect(self.refresh_plugin_market)
        market_vbox.addWidget(refresh_btn)

        # 卡片滚动区
        market_scroll = QScrollArea()
        market_scroll.setWidgetResizable(True)
        market_scroll.setFrameShape(QFrame.NoFrame)
        market_scroll.setStyleSheet('QScrollArea { border: none; background-color: transparent; }')
        self._plugin_market_content = QWidget()
        self._plugin_market_content.setStyleSheet('background-color: transparent;')
        self._plugin_market_layout = QVBoxLayout(self._plugin_market_content)
        self._plugin_market_layout.setContentsMargins(0, 0, 0, 0)
        self._plugin_market_layout.setSpacing(12)
        # 初始提示
        hint = QLabel('点击「🔄 刷新列表」加载插件广场')
        hint.setAlignment(Qt.AlignCenter)
        hint.setFont(self._ui_font(11))
        hint.setStyleSheet('color: #aaa; border: none;')
        self._plugin_market_layout.addWidget(hint)
        self._plugin_market_layout.addStretch()
        market_scroll.setWidget(self._plugin_market_content)
        market_vbox.addWidget(market_scroll)

        tab_widget.addTab(market_tab, '🧩 插件广场')

        self._plugins_page_index = self.ui.stackedWidget.addWidget(list_page)

        # --- 详情页（对齐提示词广场按钮风格）---
        self._detail_page = QWidget()
        d = QVBoxLayout(self._detail_page)
        d.setContentsMargins(20, 20, 20, 20)
        d.setSpacing(15)

        back_btn = QPushButton('← 返回插件列表')
        back_btn.setFont(QFont('微软雅黑', 11, QFont.Bold))
        back_btn.setMinimumHeight(40)
        back_btn.setStyleSheet("""
            QPushButton { background-color: #3498db; color: white; border-radius: 8px; padding: 8px; border: none; }
            QPushButton:hover { background-color: #5dade2; }
            QPushButton:pressed { background-color: #2874a6; }
        """)
        back_btn.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(self._plugins_page_index))
        d.addWidget(back_btn)

        header_row = QHBoxLayout()
        self._detail_name_lbl = QLabel()
        self._detail_name_lbl.setFont(self._ui_font(11, bold=True))
        header_row.addWidget(self._detail_name_lbl, stretch=1)

        self._detail_readme_btn = QPushButton('📖 此插件教程')
        self._detail_readme_btn.setFont(self._ui_font(9, bold=True))
        self._detail_readme_btn.setMinimumHeight(30)
        self._detail_readme_btn.setStyleSheet(
            'QPushButton{background:#8e44ad;color:white;border-radius:6px;border:none;padding:4px 12px;}'
            'QPushButton:hover{background:#9b59b6;}'
            'QPushButton:pressed{background:#6c3483;}'
            'QPushButton:checked{background:#6c3483;}'
        )
        self._detail_readme_btn.setCheckable(True)
        self._detail_readme_btn.setVisible(False)
        self._detail_readme_btn.toggled.connect(self._toggle_plugin_readme)
        header_row.addWidget(self._detail_readme_btn)
        d.addLayout(header_row)

        self._detail_desc_lbl = QLabel()
        self._detail_desc_lbl.setFont(self._ui_font())
        self._detail_desc_lbl.setWordWrap(True)
        d.addWidget(self._detail_desc_lbl)

        self._detail_form_scroll = QScrollArea()
        self._detail_form_scroll.setWidgetResizable(True)
        self._detail_form_scroll.setFrameShape(QFrame.NoFrame)
        self._detail_form_scroll.setStyleSheet('QScrollArea { border: none; background-color: transparent; }')
        d.addWidget(self._detail_form_scroll)
        self._detail_form_layout = None

        self._plugins_detail_index = self.ui.stackedWidget.addWidget(self._detail_page)
        self._detail_edits = {}
        self._detail_current_info = None

    def _capture_base_fonts(self):
        """记录当前所有子控件的字体大小，作为缩放基准"""
        self._base_size = (self.width(), self.height())
        self._base_font_entries = []
        for w in self.findChildren(QWidget):
            pt = w.font().pointSize()
            if pt > 0:
                self._base_font_entries.append((w, pt))

    def _apply_font_scale(self):
        """按当前窗口尺寸缩放所有已捕获控件的字体"""
        if not self._base_size:
            return
        bw, bh = self._base_size
        self._current_scale = min(self.width() / bw, self.height() / bh)
        alive = []
        for w, base_pt in self._base_font_entries:
            try:
                f = w.font()
                f.setPointSize(max(7, round(base_pt * self._current_scale)))
                w.setFont(f)
                alive.append((w, base_pt))
            except RuntimeError:
                pass  # 控件已被销毁，跳过
        self._base_font_entries = alive

    def _ui_font(self, size=10, bold=False):
        f = self.font()
        f.setFamily('微软雅黑')
        f.setPointSize(max(7, round(size * self._current_scale)))
        f.setBold(bold)
        return f

    def _build_plugin_row(self, info, parent_layout):
        meta         = info['meta']
        cfg          = info['cfg']
        plugin_type  = info['plugin_type']
        plugin_name  = info['plugin_name']
        extra_keys   = list(cfg.keys())

        display_name = meta.get('displayName', meta.get('name', ''))
        desc         = meta.get('description', '')

        # 白色卡片容器，和提示词广场风格一致
        card = QWidget()
        card.setStyleSheet("""
            QWidget {
                background-color: white;
                border-radius: 8px;
                border: 1px solid #e0e0e0;
            }
        """)

        card_layout = QHBoxLayout(card)
        card_layout.setContentsMargins(15, 12, 15, 12)
        card_layout.setSpacing(15)

        # 左：插件名称 + 描述
        summary_text = f'<b>{display_name}</b>'
        if desc:
            summary_text += f'  <span style="color: #777; font-size: 9pt;">{desc}</span>'
        title_lbl = QLabel(summary_text)
        title_lbl.setFont(QFont('微软雅黑', 10))
        title_lbl.setStyleSheet('color: #2c3e50; border: none; background: transparent;')
        title_lbl.setWordWrap(True)
        card_layout.addWidget(title_lbl, stretch=1)

        # 右：开关 checkbox（读取 enabled_plugins.json）+ 可选配置按钮
        rel_path = f'{plugin_type}/{plugin_name}'
        enabled_set = self._load_enabled_plugins()

        # 检查是否为特殊插件（需要DLC）
        download_dlc = meta.get('download_dlc')
        dlc_installed = True
        if download_dlc:
            dlc_path = os.path.join(get_base_path(), 'plugins-dlc', plugin_name)
            dlc_installed = os.path.isdir(dlc_path)

        if download_dlc and not dlc_installed:
            # DLC未安装，显示"安装DLC"按钮
            dlc_btn = QPushButton('安装DLC')
            dlc_btn.setFont(self._ui_font())
            dlc_btn.setMinimumSize(80, 30)
            dlc_btn.setStyleSheet("""
                QPushButton { background-color: #FF9800; color: white; border-radius: 6px; border: none; padding: 4px 8px; }
                QPushButton:hover { background-color: #F57C00; }
                QPushButton:pressed { background-color: #E65100; }
            """)
            dlc_btn.clicked.connect(lambda checked=False, url=download_dlc, pn=plugin_name,
                                    btn=dlc_btn, cl=card_layout, pt=plugin_type, ek=extra_keys, inf=info:
                                    self._install_plugin_dlc(url, pn, btn, cl, pt, ek, inf))
            card_layout.addWidget(dlc_btn)
        else:
            chk = QCheckBox('启用')
            chk.setFont(self._ui_font())
            chk.setChecked(rel_path in enabled_set)
            chk.stateChanged.connect(lambda state, pt=plugin_type, pn=plugin_name: self._on_plugin_enabled_changed(pt, pn, state))
            card_layout.addWidget(chk)
            if extra_keys:
                btn = QPushButton('配置')
                btn.setFont(self._ui_font())
                btn.setMinimumSize(60, 30)
                btn.clicked.connect(lambda checked=False, i=info: self._open_plugin_detail(i))
                card_layout.addWidget(btn)

        parent_layout.addWidget(card)

    def _toggle_plugin_readme(self, checked):
        if checked:
            # 显示 README
            if not self._detail_current_readme:
                return
            try:
                with open(self._detail_current_readme, 'r', encoding='utf-8') as f:
                    md_text = f.read()
            except Exception as e:
                self._detail_readme_btn.setChecked(False)
                return
            browser = QTextBrowser()
            browser.setOpenExternalLinks(True)
            browser.setHtml(self._md_to_html(md_text))
            browser.setStyleSheet('QTextBrowser{background:#fff;border:none;}')
            self._detail_form_scroll.setWidget(browser)
            self._detail_readme_btn.setText('⚙ 返回配置')
        else:
            # 恢复配置表单
            self._detail_readme_btn.setText('📖 此插件教程')
            if self._detail_current_info:
                self._rebuild_detail_form(self._detail_current_info['cfg'])

    def _rebuild_detail_form(self, cfg):
        form_widget = QWidget()
        form_widget.setStyleSheet('background-color: transparent;')
        self._detail_form_layout = QVBoxLayout(form_widget)
        self._detail_form_layout.setSpacing(12)
        self._detail_form_layout.setContentsMargins(0, 0, 0, 0)
        self._detail_edits = {}
        for key, field_def in cfg.items():
            if not isinstance(field_def, dict) or 'type' not in field_def:
                self._add_detail_field(key, key, '', 'string', field_def)
                continue
            field_type = field_def.get('type', 'string')
            if field_type == 'object' and 'fields' in field_def:
                section_lbl = QLabel(f'── {field_def.get("title", key)} ──')
                section_lbl.setFont(self._ui_font(bold=True))
                section_lbl.setStyleSheet('color:#555;border:none;background:transparent;')
                self._detail_form_layout.addWidget(section_lbl)
                if field_def.get('description'):
                    hint = QLabel(field_def['description'])
                    hint.setFont(self._ui_font(9))
                    hint.setStyleSheet('color:#999;border:none;background:transparent;')
                    hint.setWordWrap(True)
                    self._detail_form_layout.addWidget(hint)
                for sub_key, sub_def in field_def['fields'].items():
                    if not isinstance(sub_def, dict) or 'type' not in sub_def:
                        continue
                    cur_val = sub_def.get('value', sub_def.get('default'))
                    self._add_detail_field(f'{key}.{sub_key}',
                                           sub_def.get('title', sub_key),
                                           sub_def.get('description', ''),
                                           sub_def.get('type', 'string'), cur_val)
            else:
                cur_val = field_def.get('value', field_def.get('default'))
                self._add_detail_field(key, field_def.get('title', key),
                                       field_def.get('description', ''),
                                       field_type, cur_val)
        self._detail_form_layout.addStretch()
        self._detail_form_scroll.setWidget(form_widget)

    def _show_plugin_readme(self, readme_path, plugin_name):
        """弹出对话框展示插件 README.md（支持基础 Markdown 渲染）"""
        try:
            with open(readme_path, 'r', encoding='utf-8') as f:
                md_text = f.read()
        except Exception as e:
            QMessageBox.warning(self, '读取失败', str(e))
            return

        html = self._md_to_html(md_text)

        dlg = QDialog(self)
        dlg.setWindowTitle(f'{plugin_name} - 教程')
        dlg.resize(720, 560)
        layout = QVBoxLayout(dlg)
        layout.setContentsMargins(16, 16, 16, 16)

        browser = QTextBrowser()
        browser.setOpenExternalLinks(True)
        browser.setHtml(html)
        browser.setStyleSheet('QTextBrowser { background: #fff; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; }')
        layout.addWidget(browser)

        close_btn = QPushButton('关闭')
        close_btn.setMinimumHeight(36)
        close_btn.clicked.connect(dlg.accept)
        layout.addWidget(close_btn)

        dlg.exec_()

    def _md_to_html(self, text):
        """Markdown → 带样式 HTML，优先用 markdown 库，否则用内置转换"""
        try:
            import markdown
            body = markdown.markdown(
                text,
                extensions=['fenced_code', 'tables', 'nl2br', 'sane_lists']
            )
        except ImportError:
            import re as _re, html as _html
            t = _html.escape(text)
            # 代码块（```...```）
            def code_block(m):
                return f'<pre style="background:#f6f8fa;padding:12px;border-radius:6px;overflow-x:auto;font-family:Consolas,monospace;font-size:12px;">{m.group(1)}</pre>'
            t = _re.sub(r'```[^\n]*\n(.*?)```', code_block, t, flags=_re.DOTALL)
            # 标题
            t = _re.sub(r'^### (.+)$', lambda m: f'<h3 style="color:#1a252f;font-size:15px;margin:14px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px;">{m.group(1)}</h3>', t, flags=_re.MULTILINE)
            t = _re.sub(r'^## (.+)$',  lambda m: f'<h2 style="color:#1a252f;font-size:18px;margin:16px 0 8px;border-bottom:2px solid #eee;padding-bottom:6px;">{m.group(1)}</h2>', t, flags=_re.MULTILINE)
            t = _re.sub(r'^# (.+)$',   lambda m: f'<h1 style="color:#1a252f;font-size:22px;margin:18px 0 10px;border-bottom:3px solid #3498db;padding-bottom:8px;">{m.group(1)}</h1>', t, flags=_re.MULTILINE)
            # 加粗 / 斜体
            t = _re.sub(r'\*\*(.+?)\*\*', lambda m: f'<strong>{m.group(1)}</strong>', t)
            t = _re.sub(r'\*(.+?)\*',     lambda m: f'<em>{m.group(1)}</em>', t)
            # 行内代码
            t = _re.sub(r'`(.+?)`', lambda m: f'<code style="background:#f0f0f0;padding:2px 5px;border-radius:3px;font-family:Consolas,monospace;font-size:12px;">{m.group(1)}</code>', t)
            # 链接
            t = _re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: f'<a href="{m.group(2)}" style="color:#2980b9;">{m.group(1)}</a>', t)
            # 列表项
            t = _re.sub(r'^[-*] (.+)$', lambda m: f'<li style="margin:4px 0;">{m.group(1)}</li>', t, flags=_re.MULTILINE)
            t = _re.sub(r'(<li.*</li>)', r'<ul style="padding-left:20px;margin:8px 0;">\1</ul>', t, flags=_re.DOTALL)
            # 分割线
            t = _re.sub(r'^---+$', '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">', t, flags=_re.MULTILINE)
            # 换行
            t = t.replace('\n', '<br>')
            body = t

        return (
            '<!DOCTYPE html><html><head><meta charset="utf-8">'
            '<style>'
            'body{font-family:"Microsoft YaHei",sans-serif;font-size:13px;line-height:1.8;color:#2c3e50;padding:16px;}'
            'h1{color:#1a252f;font-size:22px;border-bottom:3px solid #3498db;padding-bottom:8px;margin:18px 0 10px;}'
            'h2{color:#1a252f;font-size:18px;border-bottom:2px solid #eee;padding-bottom:6px;margin:16px 0 8px;}'
            'h3{color:#1a252f;font-size:15px;border-bottom:1px solid #eee;padding-bottom:4px;margin:14px 0 6px;}'
            'code{background:#f0f0f0;padding:2px 5px;border-radius:3px;font-family:Consolas,monospace;font-size:12px;}'
            'pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow-x:auto;border:1px solid #e1e4e8;}'
            'pre code{background:none;padding:0;}'
            'a{color:#2980b9;text-decoration:none;}'
            'a:hover{text-decoration:underline;}'
            'blockquote{border-left:4px solid #3498db;margin:12px 0;padding:8px 16px;background:#f8f9fa;color:#555;}'
            'table{border-collapse:collapse;width:100%;margin:12px 0;}'
            'th,td{border:1px solid #ddd;padding:8px 12px;text-align:left;}'
            'th{background:#f0f0f0;font-weight:bold;}'
            'tr:nth-child(even){background:#f9f9f9;}'
            'hr{border:none;border-top:1px solid #ddd;margin:16px 0;}'
            'ul,ol{padding-left:24px;margin:8px 0;}'
            'li{margin:4px 0;}'
            'img{max-width:100%;border-radius:4px;}'
            '</style></head>'
            f'<body>{body}</body></html>'
        )

    def _open_plugin_detail(self, info):
        """切换到详情页并刷新内容（支持 schema 格式）"""
        self._detail_current_info = info
        meta = info['meta']
        cfg  = info['cfg']

        self._detail_name_lbl.setText(meta.get('displayName', meta.get('name', '')))
        desc = meta.get('description', '')
        self._detail_desc_lbl.setText(desc)
        self._detail_desc_lbl.setVisible(bool(desc))

        # 教程按钮：有 README.md 才显示，重置为未激活状态
        readme_path = os.path.join(get_app_path(), 'plugins',
                                   info['plugin_type'], info['plugin_name'], 'README.md')
        self._detail_current_readme = readme_path if os.path.exists(readme_path) else None
        self._detail_readme_btn.setVisible(self._detail_current_readme is not None)
        self._detail_readme_btn.setChecked(False)

        # 每次创建全新的内容 widget，setWidget 会自动销毁旧的
        form_widget = QWidget()
        form_widget.setStyleSheet('background-color: transparent;')
        self._detail_form_layout = QVBoxLayout(form_widget)
        self._detail_form_layout.setSpacing(12)
        self._detail_form_layout.setContentsMargins(0, 0, 0, 0)
        self._detail_edits = {}

        for key, field_def in cfg.items():
            if not isinstance(field_def, dict) or 'type' not in field_def:
                self._add_detail_field(key, key, '', 'string', field_def)
                continue

            field_type = field_def.get('type', 'string')

            if field_type == 'object' and 'fields' in field_def:
                section_lbl = QLabel(f'── {field_def.get("title", key)} ──')
                section_lbl.setFont(self._ui_font(bold=True))
                section_lbl.setStyleSheet('color: #555; border: none; background: transparent;')
                self._detail_form_layout.addWidget(section_lbl)
                if field_def.get('description'):
                    hint = QLabel(field_def['description'])
                    hint.setFont(self._ui_font(9))
                    hint.setStyleSheet('color: #999; border: none; background: transparent;')
                    hint.setWordWrap(True)
                    self._detail_form_layout.addWidget(hint)
                for sub_key, sub_def in field_def['fields'].items():
                    if not isinstance(sub_def, dict) or 'type' not in sub_def:
                        continue
                    cur_val = sub_def.get('value', sub_def.get('default'))
                    self._add_detail_field(f'{key}.{sub_key}',
                                           sub_def.get('title', sub_key),
                                           sub_def.get('description', ''),
                                           sub_def.get('type', 'string'),
                                           cur_val)
            else:
                cur_val = field_def.get('value', field_def.get('default'))
                self._add_detail_field(key,
                                       field_def.get('title', key),
                                       field_def.get('description', ''),
                                       field_type,
                                       cur_val)

        self._detail_form_layout.addStretch()
        self._detail_form_scroll.setWidget(form_widget)
        self.ui.stackedWidget.setCurrentIndex(self._plugins_detail_index)

    def _add_detail_field(self, edit_key, title, description, field_type, current_value):
        """在详情页添加一个配置字段"""
        container = QVBoxLayout()
        container.setSpacing(3)

        lbl = QLabel(title + '：')
        lbl.setFont(self._ui_font(bold=True))
        lbl.setStyleSheet('color: #2c3e50; border: none; background: transparent;')
        lbl.setWordWrap(True)
        container.addWidget(lbl)

        if field_type == 'bool':
            widget = QCheckBox()
            widget.setChecked(bool(current_value))
            self._detail_edits[edit_key] = widget
            container.addWidget(widget)
        elif field_type == 'text':
            widget = QTextEdit()
            widget.setFont(self._ui_font())
            widget.setPlainText(str(current_value) if current_value is not None else '')
            widget.setMinimumHeight(80)
            widget.setMaximumHeight(120)
            self._detail_edits[edit_key] = widget
            container.addWidget(widget)
        else:
            widget = QLineEdit(str(current_value) if current_value is not None else '')
            widget.setFont(self._ui_font())
            self._detail_edits[edit_key] = widget
            container.addWidget(widget)

        if description:
            desc_lbl = QLabel(description)
            desc_lbl.setFont(self._ui_font(9))
            desc_lbl.setStyleSheet('color: #999; border: none; background: transparent;')
            desc_lbl.setWordWrap(True)
            container.addWidget(desc_lbl)

        self._detail_form_layout.addLayout(container)

    def _save_plugin_detail(self):
        if not self._detail_current_info:
            return
        cfg      = self._detail_current_info['cfg']
        cfg_path = self._detail_current_info['cfg_path']

        for edit_key, widget in self._detail_edits.items():
            if isinstance(widget, QCheckBox):
                value = widget.isChecked()
            elif isinstance(widget, QTextEdit):
                value = widget.toPlainText()
            else:
                value = widget.text()

            if '.' in edit_key:
                parent_key, child_key = edit_key.split('.', 1)
                field_def = cfg.get(parent_key, {}).get('fields', {}).get(child_key, {})
                value = self._cast_value(value, field_def.get('type', 'string'), edit_key)
                if value is None:
                    return
                cfg[parent_key]['fields'][child_key]['value'] = value
            else:
                field_def = cfg.get(edit_key, {})
                if isinstance(field_def, dict) and 'type' in field_def:
                    if field_def.get('type') != 'bool':
                        value = self._cast_value(value, field_def.get('type', 'string'), edit_key)
                        if value is None:
                            return
                    cfg[edit_key]['value'] = value
                else:
                    cfg[edit_key] = value

        try:
            with open(cfg_path, 'w', encoding='utf-8') as f:
                import json
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            self.toast.show_message("配置已保存", 1500)
        except Exception as e:
            self.toast.show_message(f"保存失败: {e}", 3000)

    def _cast_value(self, value, field_type, key):
        """根据 type 转换输入值，失败返回 None"""
        if field_type == 'int':
            try:
                return int(value)
            except ValueError:
                QMessageBox.warning(self, '格式错误', f'{key} 必须是整数')
                return None
        elif field_type == 'float':
            try:
                return float(value)
            except ValueError:
                QMessageBox.warning(self, '格式错误', f'{key} 必须是数字')
                return None
        return value

    def _on_plugin_dir_changed(self, path):
        """文件系统监听回调：插件目录有变化时刷新对应 tab"""
        for plugin_type, base_dir in self._plugin_tab_dirs.items():
            if os.path.normpath(path) == os.path.normpath(base_dir):
                self._refresh_plugin_tab(plugin_type)
                break

    def _refresh_plugin_tab(self, plugin_type):
        """清空并重建指定插件 tab 的卡片列表"""
        layout  = self._plugin_tab_layouts.get(plugin_type)
        base_dir = self._plugin_tab_dirs.get(plugin_type)
        if not layout or not base_dir:
            return

        # 清除旧卡片
        while layout.count():
            item = layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        # 从 _plugin_infos 中移除该 type 的旧条目
        self._plugin_infos = [i for i in self._plugin_infos if i['plugin_type'] != plugin_type]

        # 重新扫描并构建卡片
        if os.path.isdir(base_dir):
            for entry in sorted(os.listdir(base_dir)):
                plugin_dir = os.path.join(base_dir, entry)
                meta_path  = os.path.join(plugin_dir, 'metadata.json')
                cfg_path   = os.path.join(plugin_dir, 'plugin_config.json')
                if not os.path.isdir(plugin_dir) or not os.path.exists(meta_path):
                    continue
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                except Exception:
                    continue
                cfg = {}
                if os.path.exists(cfg_path):
                    try:
                        with open(cfg_path, 'r', encoding='utf-8') as f:
                            cfg = json.load(f)
                    except Exception:
                        pass
                info = {'meta': meta, 'cfg': cfg, 'cfg_path': cfg_path,
                        'plugin_type': plugin_type, 'plugin_name': entry}
                self._plugin_infos.append(info)
                self._build_plugin_row(info, layout)

        layout.addStretch()

    def _on_plugin_enabled_changed(self, plugin_type, plugin_name, state):
        rel_path = f'{plugin_type}/{plugin_name}'
        enabled_set = self._load_enabled_plugins()
        if state == Qt.Checked:
            enabled_set.add(rel_path)
        else:
            enabled_set.discard(rel_path)
        self._save_enabled_plugins(enabled_set)

    # ===== DLC 安装 =====

    def _install_plugin_dlc(self, url, plugin_name, dlc_btn, card_layout, plugin_type, extra_keys, info):
        """后台下载并解压插件DLC"""
        dlc_path = os.path.join(get_base_path(), 'plugins-dlc', plugin_name)
        dlc_btn.setEnabled(False)
        dlc_btn.setText('下载中...')

        worker = _DlcWorker(url, dlc_path)
        worker.progress.connect(lambda msg, btn=dlc_btn: btn.setText(msg))
        worker.done.connect(lambda ok, err,
                            btn=dlc_btn, cl=card_layout, pn=plugin_name,
                            pt=plugin_type, ek=extra_keys, inf=info:
                            self._on_dlc_installed(ok, err, btn, cl, pn, pt, ek, inf))
        # 防止被GC回收
        if not hasattr(self, '_dlc_workers'):
            self._dlc_workers = []
        self._dlc_workers.append(worker)
        worker.start()

    def _on_dlc_installed(self, success, error, dlc_btn, card_layout, plugin_name, plugin_type, extra_keys, info):
        """DLC安装完成回调"""
        if not success:
            dlc_btn.setText('安装DLC')
            dlc_btn.setEnabled(True)
            QMessageBox.warning(self, 'DLC安装失败', f'下载失败: {error}')
            return

        # 安装成功：移除DLC按钮，替换为启用checkbox
        dlc_btn.deleteLater()
        rel_path = f'{plugin_type}/{plugin_name}'
        enabled_set = self._load_enabled_plugins()
        chk = QCheckBox('启用')
        chk.setFont(self._ui_font())
        chk.setChecked(rel_path in enabled_set)
        chk.stateChanged.connect(lambda state, pt=plugin_type, pn=plugin_name:
                                 self._on_plugin_enabled_changed(pt, pn, state))
        card_layout.addWidget(chk)
        if extra_keys:
            btn = QPushButton('配置')
            btn.setFont(self._ui_font())
            btn.setMinimumSize(60, 30)
            btn.clicked.connect(lambda checked=False, i=info: self._open_plugin_detail(i))
            card_layout.addWidget(btn)

    # ===== 插件广场 =====

    def refresh_plugin_market(self):
        RAW_URL = "https://raw.githubusercontent.com/morettt/my-neuro/main/live-2d/plugins/plugin-house/plugin_hub.json"
        print("开始刷新插件广场...")
        try:
            resp = requests.get(RAW_URL, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            plugins = [
                {
                    "id":           key,
                    "display_name": info.get("display_name", key),
                    "desc":         info.get("desc", ""),
                    "author":       info.get("author", ""),
                    "repo":         info.get("repo", ""),
                }
                for key, info in data.items()
            ]
            self._display_plugin_market(plugins)
            self.toast.show_message(f"插件广场已加载，共 {len(plugins)} 个插件", 2000)
        except Exception as e:
            print(f"拉取插件列表失败: {e}")
            self.toast.show_message(f"获取插件列表失败: {e}", 3000)

    def _display_plugin_market(self, plugins):
        layout = self._plugin_market_layout
        while layout.count() > 0:
            item = layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        app_path = get_app_path()
        for plugin in plugins:
            card = self._build_market_card(plugin, app_path)
            layout.addWidget(card)
        layout.addStretch()

    def _build_market_card(self, plugin, app_path):
        target_dir = os.path.join(app_path, "plugins", "community", plugin["id"])
        already_installed = os.path.exists(target_dir)

        card = QWidget()
        card.setStyleSheet("""
            QWidget { background-color: white; border-radius: 8px; border: 1px solid #e0e0e0; }
        """)
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(14, 12, 14, 12)
        card_layout.setSpacing(6)

        # 标题行 + 安装按钮
        title_row = QHBoxLayout()
        name_lbl = QLabel(f"🧩 <b>{plugin['display_name']}</b>")
        name_lbl.setFont(self._ui_font(11))
        name_lbl.setStyleSheet('color: #2c3e50; border: none;')
        title_row.addWidget(name_lbl, 1)

        install_btn = QPushButton("✓ 已安装" if already_installed else "⬇ 安装")
        install_btn.setFont(self._ui_font(9, bold=True))
        install_btn.setMinimumSize(88, 32)
        install_btn.setEnabled(not already_installed)
        install_btn.setStyleSheet("""
            QPushButton { background-color: #27ae60; color: white; border-radius: 7px; border: none; }
            QPushButton:hover { background-color: #2ecc71; }
            QPushButton:pressed { background-color: #1e8449; }
            QPushButton:disabled { background-color: #95a5a6; }
        """)
        install_btn.clicked.connect(lambda _, p=plugin, b=install_btn: self._install_plugin(p, b))
        title_row.addWidget(install_btn)
        card_layout.addLayout(title_row)

        # 描述
        if plugin.get("desc"):
            desc_lbl = QLabel(plugin["desc"])
            desc_lbl.setFont(self._ui_font(9))
            desc_lbl.setStyleSheet('color: #555; border: none;')
            desc_lbl.setWordWrap(True)
            card_layout.addWidget(desc_lbl)

        # 作者 + 来源
        meta_row = QHBoxLayout()
        author_lbl = QLabel(f"👤 {plugin.get('author', '未知')}")
        author_lbl.setFont(self._ui_font(8))
        author_lbl.setStyleSheet('color: #888; border: none;')
        meta_row.addWidget(author_lbl)

        repo = plugin.get("repo", "")
        if repo:
            repo_lbl = QLabel(f'<a href="{repo}" style="color:#3498db;">📎 查看来源</a>')
            repo_lbl.setFont(self._ui_font(8))
            repo_lbl.setStyleSheet('border: none;')
            repo_lbl.setOpenExternalLinks(True)
            meta_row.addWidget(repo_lbl)

        meta_row.addStretch()
        card_layout.addLayout(meta_row)
        return card

    def _install_plugin(self, plugin, btn):
        repo_url  = plugin.get("repo", "")
        plugin_id = plugin.get("id", "")
        if not repo_url or not plugin_id:
            self.toast.show_message("插件信息不完整，无法安装", 3000)
            return

        target_dir = os.path.join(get_app_path(), "plugins", "community", plugin_id)
        if os.path.exists(target_dir):
            self.toast.show_message(f"{plugin['display_name']} 已安装", 2000)
            return

        btn.setEnabled(False)
        btn.setText("安装中...")
        self.toast.show_message(f"正在安装 {plugin['display_name']}...", 2000)

        worker = _CloneWorker(repo_url, target_dir)

        def on_done(success, err):
            if success:
                btn.setText("✓ 已安装")
                self.toast.show_message(f"✓ {plugin['display_name']} 安装成功！", 4000)
                self._refresh_plugin_tab('community')
            else:
                btn.setText("⬇ 安装")
                btn.setEnabled(True)
                self.toast.show_message(f"✗ 安装失败: {err}", 4000)
                print(f"插件安装失败: {err}")

        worker.done.connect(on_done)
        worker.progress.connect(lambda msg: self.toast.show_message(msg, 10000))
        worker.start()
        if not hasattr(self, '_clone_workers'):
            self._clone_workers = []
        self._clone_workers.append(worker)

    def toggle_live_2d(self):
        """切换桌宠启动/关闭状态"""
        if self.live2d_running:
            # 当前正在运行，执行关闭操作
            self.close_live_2d()
            self.live2d_running = False
            self.update_toggle_button_style(False)
        else:
            # 当前未运行，执行启动操作
            self.start_live_2d()
            self.live2d_running = True
            self.update_toggle_button_style(True)

    def update_toggle_button_style(self, is_running):
        """更新切换按钮的文本和样式"""
        button = self.ui.pushButton_toggle_live2d
        if is_running:
            button.setText("关闭桌宠")
            button.setProperty("state", "stop")
        else:
            button.setText("启动桌宠")
            button.setProperty("state", "start")
        # 强制刷新样式
        button.style().unpolish(button)
        button.style().polish(button)
        button.update()

    def start_live_2d(self):
        # 检查是否已经有桌宠在运行
        if self.live2d_process and self.live2d_process.poll() is None:
            self.toast.show_message("桌宠已在运行中，请勿重复启动", 2000)
            return

        # 🔥 停止旧的日志读取线程（如果存在）
        if self.log_thread_running:
            self.log_thread_running = False
            time.sleep(0.3)  # 等待旧线程退出

        # 清空之前的日志
        self.ui.textEdit_2.clear()  # 清空桌宠日志
        self.ui.textEdit.clear()    # 清空工具日志

        # 启动桌宠进程 - 使用bat文件
        self.live2d_process = subprocess.Popen(
            "go.bat",
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='ignore',
            bufsize=1,
            universal_newlines=True
        )

        # 检查复选框状态（必须在启动日志线程之前设置）
        self.mcp_enabled = self.ui.checkBox_mcp_enable.isChecked()  # MCP功能
        self.tools_enabled = self.ui.checkBox_mcp.isChecked()       # 工具调用功能

        # 重新加载工具描述，确保显示最新的工具列表
        self.tool_descriptions, self.fc_tools, self.mcp_tools = load_tool_descriptions()

        # 检查工具状态
        self.check_tools_status()

        # 🔥 设置标志并启动新的日志读取线程
        from threading import Thread
        self.log_thread_running = True
        Thread(target=self.tail_log_file, daemon=True).start()

        self.toast.show_message("桌宠启动中...", 1500)

    def check_tools_status(self):
        """检查工具状态和模块"""
        try:
            # 只有任何一个工具功能启用时才显示详细信息
            if not self.tools_enabled and not self.mcp_enabled:
                return

            tools_path = ".\\server-tools"

            # 检查工具目录是否存在
            if not os.path.exists(tools_path):
                self.mcp_log_signal.emit("❌ server-tools目录不存在")
                return

            # 扫描工具模块
            js_files = [f for f in os.listdir(tools_path) if f.endswith('.js') and f != 'server.js']

            # 显示Function Call工具状态
            # if self.tools_enabled:
            #     self.mcp_log_signal.emit("🔧 工具调用功能: 已启用")  # 不显示，直接显示工具列表即可

            # 分别统计和显示Function Call和MCP工具
            if hasattr(self, 'tool_descriptions') and self.tool_descriptions:
                # 只有启用对应功能时才显示
                if self.tools_enabled and hasattr(self, 'fc_tools') and self.fc_tools:
                    self.mcp_log_signal.emit("🧪 Function Call工具:")
                    for tool_name in self.fc_tools:
                        if tool_name in self.tool_descriptions:
                            description = self.tool_descriptions[tool_name]
                            self.mcp_log_signal.emit(f"【{tool_name}】→ {description}")
                        else:
                            self.mcp_log_signal.emit(f"【{tool_name}】")

                if self.mcp_enabled and hasattr(self, 'mcp_tools') and self.mcp_tools:
                    self.mcp_log_signal.emit("🧪 MCP工具:")
                    for tool_name in self.mcp_tools:
                        if tool_name in self.tool_descriptions:
                            description = self.tool_descriptions[tool_name]
                            self.mcp_log_signal.emit(f"【{tool_name}】→ {description}")
                        else:
                            self.mcp_log_signal.emit(f"【{tool_name}】")

        except Exception as e:
            # 错误信息仍然显示，以便调试
            self.mcp_log_signal.emit(f"❌ 检查工具状态失败: {e}")


    def close_live_2d(self):
        """关闭桌宠进程"""
        try:
            # 🔥 先停止日志读取线程
            if self.log_thread_running:
                self.log_thread_running = False
                time.sleep(0.2)  # 等待线程退出

            if self.live2d_process and self.live2d_process.poll() is None:
                # 只关闭当前桌宠启动的这个特定进程
                pid = self.live2d_process.pid
                subprocess.run(
                    f'taskkill /f /pid {pid} /t',
                    shell=True, capture_output=True, text=True
                )
                self.mcp_log_signal.emit(f"✅ 桌宠进程已关闭 (PID: {pid})")
                self.live2d_process = None
            else:
                self.mcp_log_signal.emit("⚠️ 桌宠进程未在运行")
                self.live2d_process = None

        except Exception as e:
            self.mcp_log_signal.emit(f"❌ 关闭进程失败: {e}")
            self.live2d_process = None

    def reset_model_position(self):
        """复位皮套位置到默认位置"""
        try:
            # 读取配置文件
            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)

            # 设置默认位置（与 model-interaction.js 中的默认值一致）
            default_x = 1.35  # 屏幕宽度的 135%（右边）
            default_y = 0.8   # 屏幕高度的 80%（下方）

            if 'ui' not in config:
                config['ui'] = {}
            if 'model_position' not in config['ui']:
                config['ui']['model_position'] = {}

            config['ui']['model_position']['x'] = default_x
            config['ui']['model_position']['y'] = default_y
            config['ui']['model_position']['remember_position'] = True

            # 保存配置文件
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)

            # 调用API立即重置模型位置
            try:
                import requests
                response = requests.post('http://127.0.0.1:3002/reset-model-position', timeout=2)
                if response.status_code == 200:
                    result = response.json()
                    if result.get('success'):
                        self.toast.show_message("皮套位置已立即复位", 2000)
                    else:
                        self.toast.show_message("皮套位置已保存，请重启桌宠生效", 2000)
                else:
                    self.toast.show_message("皮套位置已保存，请重启桌宠生效", 2000)
            except Exception as api_error:
                # 如果API调用失败，只是提示需要重启
                print(f"API调用失败: {api_error}")
                self.toast.show_message("皮套位置已保存，请重启桌宠生效", 2000)

        except Exception as e:
            self.toast.show_message(f"复位失败: {e}", 2000)

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
            "model": self.ui.lineEdit_3.text(),
            "temperature": self.ui.doubleSpinBox_temperature.value(),
            "system_prompt": self.ui.textEdit_3.toPlainText()
        }

        current_config["ui"]["intro_text"] = self.ui.lineEdit_4.text()
        current_config['context']['max_messages'] = int(self.ui.lineEdit_5.text())
        # 确保tools配置存在
        if 'tools' not in current_config:
            current_config['tools'] = {}
        current_config['tools']['enabled'] = self.ui.checkBox_mcp.isChecked()
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

        # 使用Toast提示替代QMessageBox
        self.toast.show_message("配置已保存，模型选择已应用", 1500)

    def open_gateway_website(self):
        """打开云端肥牛官网获取API KEY"""
        try:
            webbrowser.open('http://mynewbot.com')
            self.toast.show_message("正在打开云端肥牛官网...", 2000)
        except Exception as e:
            self.toast.show_message(f"打开网页失败: {e}", 3000)

    def init_live2d_models(self):
        """初始化Live2D模型功能"""
        try:
            self.refresh_model_list()
        except Exception as e:
            print(f"初始化Live2D模型失败: {e}")
            # 如果失败，至少设置一个默认项
            self.ui.comboBox_live2d_models.clear()
            self.ui.comboBox_live2d_models.addItem("未找到任何模型")

    def scan_live2d_models(self):
        """扫描2D文件夹下的Live2D模型"""
        models = []
        app_path = get_app_path()
        models_dir = os.path.join(app_path, "2D")

        if os.path.exists(models_dir):
            for folder in os.listdir(models_dir):
                folder_path = os.path.join(models_dir, folder)
                if os.path.isdir(folder_path):
                    # 检查文件夹里有没有.model3.json文件
                    for file in os.listdir(folder_path):
                        if file.endswith('.model3.json'):
                            models.append(folder)
                            break
        return models

    def scan_vrm_models(self):
        """扫描3D文件夹下的VRM 0.x模型（过滤掉VRM 1.0）"""
        vrm_models = []
        app_path = get_app_path()
        models_dir = os.path.join(app_path, "3D")

        if os.path.exists(models_dir):
            for file in os.listdir(models_dir):
                if file.lower().endswith('.vrm'):
                    filepath = os.path.join(models_dir, file)
                    if not self._is_vrm_1_0(filepath):
                        vrm_models.append(file)
                    else:
                        print(f"跳过VRM 1.0模型: {file}")
        return vrm_models

    @staticmethod
    def _is_vrm_1_0(filepath):
        """检测VRM文件是否为VRM 1.0格式（通过检查glTF JSON中的VRMC_vrm扩展）"""
        try:
            import struct
            with open(filepath, 'rb') as f:
                header = f.read(12)
                if len(header) < 12 or header[:4] != b'glTF':
                    return False
                chunk_header = f.read(8)
                if len(chunk_header) < 8:
                    return False
                chunk_length = struct.unpack('<I', chunk_header[:4])[0]
                chunk_type = struct.unpack('<I', chunk_header[4:8])[0]
                if chunk_type != 0x4E4F534A:  # "JSON"
                    return False
                json_bytes = f.read(chunk_length)
                return b'VRMC_vrm' in json_bytes
        except Exception:
            return False

    def refresh_model_list(self):
        """刷新模型列表（包含Live2D和VRM模型）"""
        self.is_loading_model_list = True  # 开始加载，忽略选择改变事件

        live2d_models = self.scan_live2d_models()
        vrm_models = self.scan_vrm_models()
        self.ui.comboBox_live2d_models.clear()

        if not live2d_models and not vrm_models:
            self.ui.comboBox_live2d_models.addItem("未找到任何模型")
            self.is_loading_model_list = False
            return

        # 添加Live2D模型
        for model in live2d_models:
            self.ui.comboBox_live2d_models.addItem(model)

        # 添加VRM模型（带[VRM]前缀区分）
        for vrm in vrm_models:
            display_name = f"[VRM] {vrm}"
            self.ui.comboBox_live2d_models.addItem(display_name)

        # 读取当前配置，恢复上次选择
        try:
            app_path = get_app_path()
            config_path = os.path.join(app_path, "config.json")
            with open(config_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)

            model_type = config_data.get('ui', {}).get('model_type', 'live2d')

            if model_type == 'vrm':
                # VRM模式：选中对应的VRM模型
                vrm_model = config_data.get('ui', {}).get('vrm_model', '')
                if vrm_model:
                    vrm_display = f"[VRM] {vrm_model}"
                    index = self.ui.comboBox_live2d_models.findText(vrm_display)
                    if index >= 0:
                        self.ui.comboBox_live2d_models.setCurrentIndex(index)
            else:
                # Live2D模式：读取main.js中的优先级设置
                main_js_path = os.path.join(app_path, "main.js")
                with open(main_js_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                match = re.search(r"const priorityFolders = \[(.*?)\]", content)
                if match:
                    priorities = [p.strip().strip("'\"") for p in match.group(1).split(',')]
                    if priorities:
                        current_model = priorities[0]
                        index = self.ui.comboBox_live2d_models.findText(current_model)
                        if index >= 0:
                            self.ui.comboBox_live2d_models.setCurrentIndex(index)
        except Exception as e:
            print(f"读取当前模型设置失败: {str(e)}")

        total = len(live2d_models) + len(vrm_models)
        msg_parts = []
        if live2d_models:
            msg_parts.append(f"{len(live2d_models)} 个Live2D模型")
        if vrm_models:
            msg_parts.append(f"{len(vrm_models)} 个VRM模型")
        self.toast.show_message(f"找到 {'，'.join(msg_parts)}", 2000)
        self.is_loading_model_list = False  # 加载完成

    def update_current_model_display(self):
        """更新当前模型显示"""
        pass  # 暂时留空

    def on_model_selection_changed(self, index):
        """模型选择改变事件（支持Live2D和VRM）"""
        # 如果正在加载模型列表，忽略此事件
        if self.is_loading_model_list:
            return

        if index < 0:
            return

        model_name = self.ui.comboBox_live2d_models.currentText()

        # 忽略"未找到任何模型"
        if model_name == "未找到任何模型":
            return

        # 检查冷却时间
        import time
        current_time = time.time()
        time_since_last_switch = current_time - self.last_model_switch_time

        if time_since_last_switch < self.model_switch_cooldown:
            remaining_time = int(self.model_switch_cooldown - time_since_last_switch)
            self.toast.show_message(f"切换太快了，请等待 {remaining_time} 秒", 1500)
            # 恢复到上一次的选择
            self.is_loading_model_list = True
            self.ui.comboBox_live2d_models.setCurrentIndex(self.last_model_index if hasattr(self, 'last_model_index') else 0)
            self.is_loading_model_list = False
            return

        # 判断是VRM模型还是Live2D模型
        is_vrm = model_name.startswith("[VRM] ")

        if is_vrm:
            vrm_file = model_name.replace("[VRM] ", "")
            try:
                import requests
                response = requests.post(
                    'http://127.0.0.1:3002/switch-model',
                    json={'model_name': vrm_file, 'model_type': 'vrm'},
                    timeout=10
                )

                if response.status_code == 200:
                    result = response.json()
                    if result.get('success'):
                        self.toast.show_message(f"正在切换到VRM模型 {vrm_file}...", 2000)
                        self.last_model_switch_time = current_time
                        self.last_model_index = index
                    else:
                        self.toast.show_message("VRM模型切换失败，桌宠未运行", 2000)
                else:
                    self.toast.show_message("VRM模型切换失败，桌宠未运行", 2000)
            except Exception as e:
                self.toast.show_message("桌宠未运行或正在重启，请稍候", 2000)
                print(f"VRM模型切换API调用异常: {e}")
        else:
            try:
                # Live2D模型：调用原有API
                import requests
                response = requests.post(
                    'http://127.0.0.1:3002/switch-model',
                    json={'model_name': model_name},
                    timeout=10
                )

                if response.status_code == 200:
                    result = response.json()
                    if result.get('success'):
                        self.toast.show_message(f"正在切换到 {model_name} 模型...", 2000)
                        self.last_model_switch_time = current_time
                        self.last_model_index = index
                    else:
                        self.toast.show_message("模型切换失败，Live2D未运行", 2000)
                else:
                    self.toast.show_message("模型切换失败，Live2D未运行", 2000)
            except Exception as e:
                self.toast.show_message("桌宠未运行或正在重启，请稍候", 2000)
                print(f"模型切换API调用异常: {e}")

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

    def show_tutorial(self):
        """打开在线教程页面"""
        webbrowser.open('http://mynewbot.com/tutorials/live-2d-README')

    def run_startup_scan(self):
        """启动时自动运行皮套动作扫描"""
        try:
            app_path = get_app_path()
            bat_file = os.path.join(app_path, "一键扫描皮套动作.bat")

            print(f"正在检查bat文件: {bat_file}")

            if os.path.exists(bat_file):
                print("找到bat文件，正在后台启动...")
                # 显示输出，但不阻塞UI
                process = subprocess.Popen(
                    bat_file,
                    shell=True,
                    cwd=app_path,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding='utf-8',
                    errors='ignore'
                )

                # 启动线程读取输出
                def read_output():
                    for line in iter(process.stdout.readline, ''):
                        if line.strip():
                            print(f"扫描输出: {line.strip()}")

                    # 进程结束后，刷新UI
                    print("扫描完成，开始刷新UI...")
                    self.scan_complete_refresh()

                from threading import Thread
                Thread(target=read_output, daemon=True).start()
                print("后台扫描进程已启动")
            else:
                print(f"未找到bat文件: {bat_file}")

        except Exception as e:
            print(f"运行皮套动作扫描失败: {str(e)}")

    def scan_complete_refresh(self):
        """扫描完成后刷新UI（在主线程中执行）"""
        # 使用 QTimer 在主线程中执行刷新，避免线程安全问题
        QTimer.singleShot(0, self.refresh_after_scan)

    def refresh_after_scan(self):
        """在主线程中刷新UI"""
        try:
            print("开始刷新UI以显示最新配置...")
            
            # 1. 重新加载动作配置
            self.load_motion_config()
            
            # 2. 重新加载表情配置
            self.load_expression_config()
            
            # # 3. 重新加载备份配置（可选，但推荐）
            # self.backup_original_config()
            # self.backup_original_config1()
            
            # 4. 刷新动作拖拽界面
            self.refresh_drag_drop_interface()
            
            # 5. 刷新表情界面
            self.refresh_expression_interface()
            
            # 6. 显示成功提示
            self.toast.show_message("皮套配置已更新", 2000)
            
            print("UI刷新完成")
            
        except Exception as e:
            print(f"刷新UI失败: {str(e)}")
            self.toast.show_message(f"配置更新失败: {str(e)}", 3000)        

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

    def refresh_tools_list(self):
        """刷新工具列表 - 卡片布局"""
        try:
            # 获取server-tools文件夹路径
            base_path = get_app_path()
            tools_path = os.path.join(base_path, "server-tools")

            # 检查文件夹是否存在
            if not os.path.exists(tools_path):
                self.toast.show_message("server-tools文件夹不存在", 3000)
                return

            # 获取容器布局
            container_layout = self.ui.scrollAreaWidgetContents_function_call.layout()

            # 清空现有的卡片
            while container_layout.count() > 0:
                item = container_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
                elif item.spacerItem():
                    pass

            # 读取文件夹中的文件
            files = os.listdir(tools_path)

            for file in files:
                file_path = os.path.join(tools_path, file)

                # 只处理文件，跳过文件夹
                if os.path.isfile(file_path):
                    status = ""

                    if file.endswith('.js'):
                        # js文件，跳过index.js
                        if file.lower() == 'index.js':
                            continue
                        # 去掉.js后缀显示
                        display_name = file[:-3]  # 移除.js
                        status_icon = "●"  # 绿色实心圆圈
                        status = "已启动"
                    elif file.endswith('.txt'):
                        # txt文件，去掉.txt后缀显示
                        display_name = file[:-4]  # 移除.txt
                        status_icon = "○"  # 空白圆圈
                        status = "未启动"
                    else:
                        # 其他文件类型，跳过
                        continue

                    # 提取工具描述
                    description = ""
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read(500)  # 只读前500字符
                            # 匹配 /** ... */ 注释
                            match = re.search(r'/\*\*\s*\n?\s*\*?\s*([^\n*]+)', content)
                            if match:
                                description = match.group(1).strip()
                    except:
                        pass

                    # 解析工具子功能
                    sub_functions = []
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                            match = re.search(r'function\s+getToolDefinitions\s*\(\)\s*\{[^}]*return\s*\[(.*?)\];', content, re.DOTALL)
                            if match:
                                funcs_text = match.group(1)
                                name_matches = re.findall(r'name:\s*["\']([^"\']+)["\']', funcs_text)
                                desc_matches = re.findall(r'description:\s*["\']([^"\']+)["\']', funcs_text)
                                for i, name in enumerate(name_matches):
                                    if i < len(desc_matches):
                                        sub_functions.append(f"{name}: {desc_matches[i]}")
                    except:
                        pass

                    # 创建主容器
                    main_container = QWidget()
                    main_container.setStyleSheet("""
                        QWidget {
                            background-color: white;
                            border-radius: 8px;
                            border: 1px solid #e0e0e0;
                        }
                    """)

                    container_v_layout = QVBoxLayout(main_container)
                    container_v_layout.setContentsMargins(0, 0, 0, 0)
                    container_v_layout.setSpacing(0)

                    # 头部区域
                    header = QWidget()
                    header.setStyleSheet("background-color: transparent; border: none;")
                    header_layout = QHBoxLayout(header)
                    header_layout.setContentsMargins(15, 12, 15, 12)
                    header_layout.setSpacing(15)

                    # 工具信息标签
                    if description:
                        label_text = f"<b>{display_name}</b>  <span style='color: #777; font-size: 9pt;'>{description}</span>"
                    else:
                        label_text = f"<b>{display_name}</b>"

                    info_label = QLabel(label_text)
                    info_label.setFont(QFont("微软雅黑", 10))
                    info_label.setWordWrap(True)
                    header_layout.addWidget(info_label, 1)

                    # 展开按钮（如果有子功能）
                    if sub_functions:
                        expand_btn = QPushButton("展开")
                        expand_btn.setMinimumSize(60, 35)
                        expand_btn.setFont(QFont("微软雅黑", 9))
                        expand_btn.setStyleSheet("""
                            QPushButton {
                                background-color: #3498db;
                                color: white;
                                border-radius: 6px;
                                border: none;
                            }
                            QPushButton:hover {
                                background-color: #5dade2;
                            }
                            QPushButton:pressed {
                                background-color: #2874a6;
                            }
                        """)
                        header_layout.addWidget(expand_btn)

                    # 右侧状态按钮
                    status_btn = QPushButton("使用中" if status == "已启动" else "未使用")
                    status_btn.setMinimumSize(80, 35)
                    status_btn.setFont(QFont("微软雅黑", 9, QFont.Bold))
                    if status == "已启动":
                        # 使用中 - 绿色
                        status_btn.setStyleSheet("""
                            QPushButton {
                                background-color: #27ae60;
                                color: white;
                                border-radius: 6px;
                                border: none;
                            }
                            QPushButton:hover {
                                background-color: #2ecc71;
                            }
                            QPushButton:pressed {
                                background-color: #1e8449;
                            }
                        """)
                    else:
                        # 未使用 - 白色(带边框)
                        status_btn.setStyleSheet("""
                            QPushButton {
                                background-color: white;
                                color: #666;
                                border-radius: 6px;
                                border: 2px solid #ddd;
                            }
                            QPushButton:hover {
                                background-color: #f5f5f5;
                                border-color: #ccc;
                            }
                            QPushButton:pressed {
                                background-color: #e8e8e8;
                            }
                        """)
                    status_btn.setProperty("tool_file", file)
                    status_btn.setProperty("tool_status", status)
                    status_btn.setProperty("tools_path", tools_path)
                    status_btn.clicked.connect(lambda checked, btn=status_btn: self.toggle_tool_from_button(btn))
                    header_layout.addWidget(status_btn)

                    container_v_layout.addWidget(header)

                    # 详情区域（子功能列表，默认隐藏）
                    if sub_functions:
                        detail_widget = QWidget()
                        detail_widget.setStyleSheet("background-color: #f8f9fa; border: none; border-top: 1px solid #e0e0e0;")
                        detail_widget.setVisible(False)
                        detail_layout = QVBoxLayout(detail_widget)
                        detail_layout.setContentsMargins(15, 15, 15, 15)
                        detail_layout.setSpacing(10)

                        # 子功能列表
                        for func in sub_functions:
                            func_label = QLabel(f"• {func}")
                            func_label.setFont(QFont("微软雅黑", 9))
                            func_label.setStyleSheet("color: #555; padding: 5px; background-color: white; border-radius: 4px;")
                            func_label.setWordWrap(True)
                            detail_layout.addWidget(func_label)

                        container_v_layout.addWidget(detail_widget)

                        # 点击展开按钮切换展开/折叠
                        expand_btn.clicked.connect(lambda checked, dw=detail_widget, btn=expand_btn: self.toggle_tool_detail(dw, btn))

                    # 添加到容器
                    container_layout.addWidget(main_container)

            # 添加底部spacer
            spacer = QSpacerItem(20, 40, QSizePolicy.Minimum, QSizePolicy.Expanding)
            container_layout.addItem(spacer)

            self.toast.show_message("工具列表已刷新", 2000)

        except Exception as e:
            error_msg = f"刷新工具列表失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.toast.show_message(error_msg, 3000)

    def toggle_tool_detail(self, detail_widget, button):
        """切换工具详情的展开/折叠"""
        if detail_widget.isVisible():
            detail_widget.setVisible(False)
            button.setText("展开")
        else:
            detail_widget.setVisible(True)
            button.setText("收起")

    def toggle_tool_from_button(self, button):
        """从按钮切换工具状态"""
        try:
            file = button.property("tool_file")
            status = button.property("tool_status")
            tools_path = button.property("tools_path")

            current_file_path = os.path.join(tools_path, file)

            if status == "已启动" and file.endswith('.js'):
                new_file = file[:-3] + '.txt'
                new_file_path = os.path.join(tools_path, new_file)
                os.rename(current_file_path, new_file_path)
                self.toast.show_message(f"{file[:-3]} 已禁用", 2000)
            elif status == "未启动" and file.endswith('.txt'):
                new_file = file[:-4] + '.js'
                new_file_path = os.path.join(tools_path, new_file)
                os.rename(current_file_path, new_file_path)
                self.toast.show_message(f"{file[:-4]} 已启用", 2000)
            else:
                self.toast.show_message("文件状态异常", 3000)
                return

            # 刷新工具列表
            self.refresh_tools_list()

        except Exception as e:
            self.toast.show_message(f"切换失败: {str(e)}", 3000)

    def refresh_mcp_tools_list(self):
        """刷新MCP工具列表 - 卡片布局"""
        try:
            # 获取mcp/tools文件夹路径
            base_path = get_app_path()
            mcp_tools_path = os.path.join(base_path, "mcp", "tools")

            # 检查文件夹是否存在
            if not os.path.exists(mcp_tools_path):
                self.toast.show_message("mcp/tools文件夹不存在", 3000)
                return

            # 获取容器布局
            container_layout = self.ui.scrollAreaWidgetContents_mcp.layout()

            # 清空现有的卡片
            while container_layout.count() > 0:
                item = container_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
                elif item.spacerItem():
                    pass

            # 读取文件夹中的文件
            files = os.listdir(mcp_tools_path)

            for file in files:
                file_path = os.path.join(mcp_tools_path, file)

                # 只处理文件，跳过文件夹
                if os.path.isfile(file_path):
                    status = ""

                    if file.endswith('.js'):
                        # js文件，跳过index.js
                        if file.lower() == 'index.js':
                            continue
                        # 去掉.js后缀显示
                        display_name = file[:-3]  # 移除.js
                        status_icon = "●"  # 绿色实心圆圈
                        status = "已启动"
                    elif file.endswith('.txt'):
                        # txt文件，去掉.txt后缀显示
                        display_name = file[:-4]  # 移除.txt
                        status_icon = "○"  # 空白圆圈
                        status = "未启动"
                    else:
                        # 其他文件类型，跳过
                        continue

                    # 提取工具描述
                    description = ""
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read(500)  # 只读前500字符
                            # 匹配注释
                            match = re.search(r'/\*\*\s*\n?\s*\*?\s*([^\n*]+)', content)
                            if match:
                                description = match.group(1).strip()
                    except:
                        pass

                    # 创建卡片widget
                    card = QWidget()
                    card.setStyleSheet("""
                        QWidget {
                            background-color: white;
                            border-radius: 8px;
                            border: 1px solid #e0e0e0;
                        }
                    """)

                    card_layout = QHBoxLayout(card)
                    card_layout.setContentsMargins(15, 12, 15, 12)
                    card_layout.setSpacing(15)

                    # 工具信息标签
                    if description:
                        label_text = f"<b>{display_name}</b>  <span style='color: #777; font-size: 9pt;'>{description}</span>"
                    else:
                        label_text = f"<b>{display_name}</b>"

                    info_label = QLabel(label_text)
                    info_label.setFont(QFont("微软雅黑", 10))
                    info_label.setWordWrap(True)
                    card_layout.addWidget(info_label, 1)

                    # 右侧状态按钮
                    status_btn = QPushButton("使用中" if status == "已启动" else "未使用")
                    status_btn.setMinimumSize(80, 35)
                    status_btn.setFont(QFont("微软雅黑", 9, QFont.Bold))
                    if status == "已启动":
                        # 使用中 - 绿色
                        status_btn.setStyleSheet("""
                            QPushButton {
                                background-color: #27ae60;
                                color: white;
                                border-radius: 6px;
                                border: none;
                            }
                            QPushButton:hover {
                                background-color: #2ecc71;
                            }
                            QPushButton:pressed {
                                background-color: #1e8449;
                            }
                        """)
                    else:
                        # 未使用 - 白色(带边框)
                        status_btn.setStyleSheet("""
                            QPushButton {
                                background-color: white;
                                color: #666;
                                border-radius: 6px;
                                border: 2px solid #ddd;
                            }
                            QPushButton:hover {
                                background-color: #f5f5f5;
                                border-color: #ccc;
                            }
                            QPushButton:pressed {
                                background-color: #e8e8e8;
                            }
                        """)
                    status_btn.setProperty("tool_file", file)
                    status_btn.setProperty("tool_status", status)
                    status_btn.setProperty("tool_type", "local")
                    status_btn.clicked.connect(lambda checked, btn=status_btn: self.toggle_mcp_tool_from_button(btn))
                    card_layout.addWidget(status_btn)

                    # 添加卡片到容器
                    container_layout.addWidget(card)

            # 从 mcp_config.json 读取外部MCP工具配置
            mcp_config_path = os.path.join(base_path, "mcp", "mcp_config.json")
            if os.path.exists(mcp_config_path):
                try:
                    with open(mcp_config_path, 'r', encoding='utf-8') as f:
                        mcp_config = json.load(f)

                    # 获取已经添加的本地工具名称
                    local_tools = set()
                    for file in files:
                        if file.endswith('.js') or file.endswith('.txt'):
                            tool_name = file.rsplit('.', 1)[0]
                            local_tools.add(tool_name)

                    # 添加外部MCP工具
                    for tool_name, config in mcp_config.items():
                        args = config.get('args', [])
                        is_local_tool = False

                        for arg in args:
                            if isinstance(arg, str) and './mcp/tools/' in arg:
                                is_local_tool = True
                                break

                        if not is_local_tool and tool_name not in local_tools:
                            command = config.get('command', '')

                            if tool_name.endswith('_disabled'):
                                display_name = tool_name[:-9]
                                status_icon = "◇"
                                status = "外部工具-未启动"
                                actual_status = "未启动"
                            else:
                                display_name = tool_name
                                status_icon = "◆"
                                status = "外部工具-已启动"
                                actual_status = "已启动"

                            # 创建外部工具卡片
                            card = QWidget()
                            card.setStyleSheet("""
                                QWidget {
                                    background-color: white;
                                    border-radius: 8px;
                                    border: 1px solid #e0e0e0;
                                }
                            """)

                            card_layout = QHBoxLayout(card)
                            card_layout.setContentsMargins(15, 12, 15, 12)
                            card_layout.setSpacing(15)

                            # 工具信息标签
                            label_text = f"<b>{display_name}</b>  <span style='color: #999; font-size: 8pt;'>(外部工具 - {command})</span>"
                            info_label = QLabel(label_text)
                            info_label.setFont(QFont("微软雅黑", 10))
                            info_label.setWordWrap(True)
                            card_layout.addWidget(info_label, 1)

                            # 右侧状态按钮
                            status_btn = QPushButton("使用中" if actual_status == "已启动" else "未使用")
                            status_btn.setMinimumSize(80, 35)
                            status_btn.setFont(QFont("微软雅黑", 9, QFont.Bold))
                            if actual_status == "已启动":
                                # 使用中 - 绿色
                                status_btn.setStyleSheet("""
                                    QPushButton {
                                        background-color: #27ae60;
                                        color: white;
                                        border-radius: 6px;
                                        border: none;
                                    }
                                    QPushButton:hover {
                                        background-color: #2ecc71;
                                    }
                                    QPushButton:pressed {
                                        background-color: #1e8449;
                                    }
                                """)
                            else:
                                # 未使用 - 白色(带边框)
                                status_btn.setStyleSheet("""
                                    QPushButton {
                                        background-color: white;
                                        color: #666;
                                        border-radius: 6px;
                                        border: 2px solid #ddd;
                                    }
                                    QPushButton:hover {
                                        background-color: #f5f5f5;
                                        border-color: #ccc;
                                    }
                                    QPushButton:pressed {
                                        background-color: #e8e8e8;
                                    }
                                """)
                            status_btn.setProperty("tool_name", tool_name)
                            status_btn.setProperty("tool_status", actual_status)
                            status_btn.setProperty("tool_type", "external")
                            status_btn.clicked.connect(lambda checked, btn=status_btn: self.toggle_mcp_tool_from_button(btn))
                            card_layout.addWidget(status_btn)

                            container_layout.addWidget(card)

                except Exception as e:
                    print(f"读取MCP配置文件失败：{str(e)}")

            # 添加底部spacer
            spacer = QSpacerItem(20, 40, QSizePolicy.Minimum, QSizePolicy.Expanding)
            container_layout.addItem(spacer)

            self.toast.show_message("MCP工具列表已刷新", 2000)

        except Exception as e:
            error_msg = f"刷新MCP工具列表失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.toast.show_message(error_msg, 3000)

    def toggle_tool_status(self, item):
        """切换工具的启动状态（js <-> txt）"""
        try:
            # 获取显示的文本和原始文件名
            item_text = item.text()
            original_filename = item.data(Qt.UserRole)  # 获取保存的原始文件名
            current_status = item.data(Qt.UserRole + 1)  # 获取保存的状态信息

            # 格式：● display_name - 状态 或 ○ display_name - 状态
            if item_text.startswith("● "):
                # 移除"● "，然后分割" - "
                remaining_text = item_text[2:]
                parts = remaining_text.split(" - ")
                if len(parts) != 2:
                    return
                display_name = parts[0]
            elif item_text.startswith("○ "):
                # 移除"○ "，然后分割" - "
                remaining_text = item_text[2:]
                parts = remaining_text.split(" - ")
                if len(parts) != 2:
                    return
                display_name = parts[0]
            else:
                return

            # 获取server-tools文件夹路径
            base_path = get_app_path()
            tools_path = os.path.join(base_path, "server-tools")
            current_file_path = os.path.join(tools_path, original_filename)

            # 检查文件是否存在
            if not os.path.exists(current_file_path):
                self.toast.show_message(f"文件不存在：{original_filename}", 3000)
                return

            # 跳过index.js文件
            if original_filename.lower() == 'index.js':
                self.toast.show_message("index.js文件不能切换状态", 3000)
                return

            # 根据当前状态决定切换方向
            if current_status == "已启动" and original_filename.endswith('.js'):
                # js -> txt (启动 -> 关闭)
                new_filename = original_filename[:-3] + '.txt'  # 移除.js，添加.txt
                new_status = "未启动"
                new_status_icon = "○"  # 空白圆圈
            elif current_status == "未启动" and original_filename.endswith('.txt'):
                # txt -> js (关闭 -> 启动)
                new_filename = original_filename[:-4] + '.js'  # 移除.txt，添加.js
                new_status = "已启动"
                new_status_icon = "●"  # 绿色实心圆圈
            else:
                self.toast.show_message("文件状态异常，无法切换", 3000)
                return

            new_file_path = os.path.join(tools_path, new_filename)

            # 重命名文件
            os.rename(current_file_path, new_file_path)

            # 更新列表中的项目文本和数据
            new_item_text = f"{new_status_icon} {display_name} - {new_status}"
            item.setText(new_item_text)
            item.setData(Qt.UserRole, new_filename)  # 更新保存的原始文件名
            item.setData(Qt.UserRole + 1, new_status)  # 更新保存的状态信息

            self.toast.show_message(f"{display_name} 已{new_status}", 2000)

        except Exception as e:
            error_msg = f"切换工具状态失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.toast.show_message(error_msg, 3000)

    def toggle_mcp_tool_status(self, item):
        """切换MCP工具的启动状态（js <-> txt 或 外部工具的 name <-> name_disabled）"""
        try:
            # 获取显示的文本和原始文件名/工具名
            item_text = item.text()
            original_name = item.data(Qt.UserRole)  # 获取保存的原始文件名/工具名
            current_status = item.data(Qt.UserRole + 1)  # 获取保存的状态信息
            tool_type = item.data(Qt.UserRole + 2)  # 获取工具类型（local/external）

            # 提取显示名称
            # 格式可能是：● name - status 或 ○ name - status 或 ◆ name - status 或 ◇ name - status
            if item_text.startswith("● ") or item_text.startswith("○ ") or item_text.startswith("◆ ") or item_text.startswith("◇ "):
                remaining_text = item_text[2:]
                parts = remaining_text.split(" - ")
                if len(parts) >= 1:
                    display_name = parts[0]
                else:
                    return
            else:
                return

            # 处理外部MCP工具
            if tool_type == "external":
                base_path = get_app_path()
                mcp_config_path = os.path.join(base_path, "mcp", "mcp_config.json")

                # 读取配置文件
                with open(mcp_config_path, 'r', encoding='utf-8') as f:
                    mcp_config = json.load(f)

                # 根据当前状态决定切换方向
                if current_status == "已启动":
                    # 启动 -> 禁用：添加 _disabled 后缀
                    new_tool_name = original_name + "_disabled"
                    new_status = "未启动"
                    new_status_icon = "◇"
                    status_action = "禁用"
                elif current_status == "未启动":
                    # 禁用 -> 启动：移除 _disabled 后缀
                    if original_name.endswith('_disabled'):
                        new_tool_name = original_name[:-9]  # 移除 _disabled
                    else:
                        self.toast.show_message("外部工具状态异常", 3000)
                        return
                    new_status = "已启动"
                    new_status_icon = "◆"
                    status_action = "启用"
                else:
                    self.toast.show_message("外部工具状态异常", 3000)
                    return

                # 在配置中重命名键
                if original_name in mcp_config:
                    tool_config = mcp_config.pop(original_name)
                    mcp_config[new_tool_name] = tool_config

                    # 写回配置文件
                    with open(mcp_config_path, 'w', encoding='utf-8') as f:
                        json.dump(mcp_config, f, indent=2, ensure_ascii=False)

                    # 更新UI列表项
                    command = tool_config.get('command', '')
                    new_status_text = f"外部工具-{new_status} ({command})" if new_status == "未启动" else f"外部工具-{new_status} ({command})"
                    new_item_text = f"{new_status_icon} {display_name} - {new_status_text}"
                    item.setText(new_item_text)
                    item.setData(Qt.UserRole, new_tool_name)  # 更新保存的工具名
                    item.setData(Qt.UserRole + 1, new_status)  # 更新状态

                    self.toast.show_message(f"外部工具 {display_name} 已{status_action}", 2000)
                else:
                    self.toast.show_message(f"配置中未找到工具：{original_name}", 3000)

            # 处理本地MCP工具
            else:
                # 获取mcp/tools文件夹路径
                base_path = get_app_path()
                mcp_tools_path = os.path.join(base_path, "mcp", "tools")
                current_file_path = os.path.join(mcp_tools_path, original_name)

                # 检查文件是否存在
                if not os.path.exists(current_file_path):
                    self.toast.show_message(f"文件不存在：{original_name}", 3000)
                    return

                # 跳过index.js文件
                if original_name.lower() == 'index.js':
                    self.toast.show_message("index.js文件不能切换状态", 3000)
                    return

                # 根据当前状态决定切换方向
                if current_status == "已启动" and original_name.endswith('.js'):
                    # js -> txt (启动 -> 关闭)
                    new_filename = original_name[:-3] + '.txt'  # 移除.js，添加.txt
                    new_status = "未启动"
                    new_status_icon = "○"  # 空白圆圈
                elif current_status == "未启动" and original_name.endswith('.txt'):
                    # txt -> js (关闭 -> 启动)
                    new_filename = original_name[:-4] + '.js'  # 移除.txt，添加.js
                    new_status = "已启动"
                    new_status_icon = "●"  # 绿色实心圆圈
                else:
                    self.toast.show_message("文件状态异常，无法切换", 3000)
                    return

                new_file_path = os.path.join(mcp_tools_path, new_filename)

                # 重命名文件
                os.rename(current_file_path, new_file_path)

                # 更新列表中的项目文本和数据
                new_item_text = f"{new_status_icon} {display_name} - {new_status}"
                item.setText(new_item_text)
                item.setData(Qt.UserRole, new_filename)  # 更新保存的原始文件名
                item.setData(Qt.UserRole + 1, new_status)  # 更新保存的状态信息

                self.toast.show_message(f"MCP {display_name} 已{new_status}", 2000)

        except Exception as e:
            error_msg = f"切换MCP工具状态失败：{str(e)}"
            print(f"错误：{error_msg}")
            self.toast.show_message(error_msg, 3000)

    def toggle_mcp_tool_from_button(self, button):
        """从卡片按钮切换MCP工具状态"""
        try:
            tool_type = button.property("tool_type")

            if tool_type == "local":
                # 本地工具
                file = button.property("tool_file")
                status = button.property("tool_status")

                base_path = get_app_path()
                mcp_tools_path = os.path.join(base_path, "mcp", "tools")
                current_file_path = os.path.join(mcp_tools_path, file)

                if status == "已启动" and file.endswith('.js'):
                    new_file = file[:-3] + '.txt'
                    new_file_path = os.path.join(mcp_tools_path, new_file)
                    os.rename(current_file_path, new_file_path)
                    self.toast.show_message(f"已停用 {file[:-3]}", 2000)
                elif status == "未启动" and file.endswith('.txt'):
                    new_file = file[:-4] + '.js'
                    new_file_path = os.path.join(mcp_tools_path, new_file)
                    os.rename(current_file_path, new_file_path)
                    self.toast.show_message(f"已启用 {file[:-4]}", 2000)
                else:
                    self.toast.show_message("文件状态异常", 3000)
                    return

            elif tool_type == "external":
                # 外部工具
                tool_name = button.property("tool_name")
                status = button.property("tool_status")

                base_path = get_app_path()
                mcp_config_path = os.path.join(base_path, "mcp", "mcp_config.json")

                with open(mcp_config_path, 'r', encoding='utf-8') as f:
                    mcp_config = json.load(f)

                if status == "已启动":
                    new_tool_name = tool_name + "_disabled"
                    status_action = "禁用"
                elif status == "未启动":
                    if tool_name.endswith('_disabled'):
                        new_tool_name = tool_name[:-9]
                    else:
                        self.toast.show_message("外部工具状态异常", 3000)
                        return
                    status_action = "启用"
                else:
                    self.toast.show_message("外部工具状态异常", 3000)
                    return

                if tool_name in mcp_config:
                    tool_config = mcp_config.pop(tool_name)
                    mcp_config[new_tool_name] = tool_config

                    with open(mcp_config_path, 'w', encoding='utf-8') as f:
                        json.dump(mcp_config, f, indent=2, ensure_ascii=False)

                    display_name = tool_name[:-9] if tool_name.endswith('_disabled') else tool_name
                    self.toast.show_message(f"外部工具 {display_name} 已{status_action}", 2000)
                else:
                    self.toast.show_message(f"配置中未找到工具：{tool_name}", 3000)
                    return

            # 刷新MCP工具列表
            self.refresh_mcp_tools_list()

        except Exception as e:
            self.toast.show_message(f"切换失败: {str(e)}", 3000)
            print(f"切换MCP工具失败: {e}")

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

    # ==================== 工具广场相关功能 ====================
    def init_tool_market_table(self):
        """初始化工具广场卡片容器"""
        try:
            # 清空现有的卡片
            layout = self.ui.scrollAreaWidgetContents_tool_market.layout()
            while layout.count():
                child = layout.takeAt(0)
                if child.widget():
                    child.widget().deleteLater()

            # 添加一个占位spacer
            spacer = QSpacerItem(20, 40, QSizePolicy.Minimum, QSizePolicy.Expanding)
            layout.addItem(spacer)

            print("工具广场卡片容器初始化成功")
        except Exception as e:
            print(f"初始化工具广场失败: {e}")
            import traceback
            traceback.print_exc()

    def refresh_tool_market(self):
        """刷新工具广场列表"""
        print("开始刷新工具广场...")
        try:
            print("正在请求API...")
            response = requests.get("http://mynewbot.com/api/get-tools", timeout=10)
            print(f"API响应状态码: {response.status_code}")
            data = response.json()
            print(f"API返回数据: {data}")

            if data.get('success'):
                tools = data.get('tools', [])
                print(f"获取到 {len(tools)} 个工具")
                self.display_tools(tools)
                self.toast.show_message(f"成功获取 {len(tools)} 个工具", 2000)
            else:
                print("API返回success=False")
                self.toast.show_message("获取工具列表失败", 3000)
        except Exception as e:
            self.toast.show_message(f"刷新失败: {str(e)}", 3000)
            print(f"刷新工具广场失败: {e}")
            import traceback
            traceback.print_exc()

    def display_tools(self, tools):
        """显示工具列表 - 卡片式布局"""
        print(f"开始显示 {len(tools)} 个工具")
        try:
            # 获取容器布局
            container_layout = self.ui.scrollAreaWidgetContents_tool_market.layout()

            # 清空现有的卡片(保留最后的spacer)
            while container_layout.count() > 0:
                item = container_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
                elif item.spacerItem():
                    pass

            # 为每个工具创建卡片
            for i, tool in enumerate(tools):
                print(f"创建第 {i+1} 个工具卡片: {tool.get('tool_name', '')}")

                # 创建卡片widget
                card = QWidget()
                card.setStyleSheet("""
                    QWidget {
                        background-color: white;
                        border-radius: 12px;
                        border: 2px solid #e0e0e0;
                    }
                    QWidget:hover {
                        border: 2px solid #4CAF50;
                    }
                """)
                card.setMinimumHeight(120)

                # 卡片布局
                card_layout = QVBoxLayout(card)
                card_layout.setContentsMargins(20, 15, 20, 15)
                card_layout.setSpacing(10)

                # 标题行
                title_layout = QHBoxLayout()

                # 工具名称
                name_label = QLabel(f"📦 {tool.get('tool_name', '')}")
                name_label.setFont(QFont("微软雅黑", 12, QFont.Bold))
                name_label.setStyleSheet("color: #2c3e50; border: none;")
                title_layout.addWidget(name_label)

                title_layout.addStretch()

                # 下载按钮
                download_btn = QPushButton("⬇ 下载")
                download_btn.setMinimumSize(100, 35)
                download_btn.setFont(QFont("微软雅黑", 10, QFont.Bold))
                download_btn.setStyleSheet("""
                    QPushButton {
                        background-color: #2196F3;
                        color: white;
                        border-radius: 6px;
                        padding: 6px 15px;
                        border: none;
                    }
                    QPushButton:hover {
                        background-color: #1976D2;
                    }
                    QPushButton:pressed {
                        background-color: #0D47A1;
                    }
                """)
                download_btn.clicked.connect(lambda checked, t=tool: self.download_tool(t))
                title_layout.addWidget(download_btn)

                card_layout.addLayout(title_layout)

                # 描述
                desc_label = QLabel(tool.get('description', ''))
                desc_label.setFont(QFont("微软雅黑", 10))
                desc_label.setStyleSheet("color: #555; border: none;")
                desc_label.setWordWrap(True)
                card_layout.addWidget(desc_label)

                # 底部信息行
                info_layout = QHBoxLayout()

                # 作者信息
                author_label = QLabel(f"👤 作者: {tool.get('uploader_email', '')}")
                author_label.setFont(QFont("微软雅黑", 9))
                author_label.setStyleSheet("color: #888; border: none;")
                info_layout.addWidget(author_label)

                info_layout.addStretch()

                card_layout.addLayout(info_layout)

                # 添加卡片到容器
                container_layout.addWidget(card)

            # 添加底部spacer
            spacer = QSpacerItem(20, 40, QSizePolicy.Minimum, QSizePolicy.Expanding)
            container_layout.addItem(spacer)

            print(f"工具卡片显示完成,共 {len(tools)} 个")

        except Exception as e:
            print(f"显示工具列表失败: {e}")
            import traceback
            traceback.print_exc()

    def download_tool(self, tool):
        """下载工具到mcp/tools目录"""
        try:
            tool_id = tool.get('id')
            filename = tool.get('file_name')

            self.toast.show_message(f"正在下载 {tool.get('tool_name')}...", 2000)

            url = f"http://mynewbot.com/api/download-tool/{tool_id}"
            response = requests.get(url, timeout=30)
            response.raise_for_status()

            # 保存到mcp/tools目录
            save_dir = Path("mcp/tools")
            save_dir.mkdir(parents=True, exist_ok=True)
            file_path = save_dir / filename

            with open(file_path, 'wb') as f:
                f.write(response.content)

            self.toast.show_message(f"✓ 下载成功: {filename}", 3000)
            print(f"工具已保存到: {file_path}")

        except Exception as e:
            self.toast.show_message(f"✗ 下载失败: {str(e)}", 3000)
            print(f"下载工具失败: {e}")

    # ==================== FC广场相关功能 ====================
    def init_fc_market_table(self):
        """初始化FC广场卡片容器"""
        try:
            # 清空现有的卡片
            layout = self.ui.scrollAreaWidgetContents_fc_market.layout()
            while layout.count():
                child = layout.takeAt(0)
                if child.widget():
                    child.widget().deleteLater()

            # 添加一个占位spacer
            spacer = QSpacerItem(20, 40, QSizePolicy.Minimum, QSizePolicy.Expanding)
            layout.addItem(spacer)

            print("FC广场卡片容器初始化成功")
        except Exception as e:
            print(f"初始化FC广场失败: {e}")
            import traceback
            traceback.print_exc()

    def refresh_fc_market(self):
        """刷新FC广场列表"""
        print("开始刷新FC广场...")
        try:
            print("正在请求FC工具API...")
            response = requests.get("http://mynewbot.com/api/get-fc-tools", timeout=10)
            print(f"FC工具API响应状态码: {response.status_code}")
            data = response.json()
            print(f"FC工具API返回数据: {data}")

            if data.get('success'):
                fc_tools = data.get('fc_tools', [])
                print(f"获取到 {len(fc_tools)} 个FC工具")
                self.display_fc_tools(fc_tools)
                self.toast.show_message(f"成功获取 {len(fc_tools)} 个FC工具", 2000)
            else:
                print("FC工具API返回success=False")
                self.toast.show_message("获取FC工具列表失败", 3000)
        except Exception as e:
            self.toast.show_message(f"刷新FC广场失败: {str(e)}", 3000)
            print(f"刷新FC广场失败: {e}")
            import traceback
            traceback.print_exc()

    def display_fc_tools(self, fc_tools):
        """显示FC工具列表 - 卡片式布局"""
        print(f"开始显示 {len(fc_tools)} 个FC工具")
        try:
            # 获取容器布局
            container_layout = self.ui.scrollAreaWidgetContents_fc_market.layout()

            # 清空现有的卡片(保留最后的spacer)
            while container_layout.count() > 0:
                item = container_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
                elif item.spacerItem():
                    pass

            # 为每个FC工具创建卡片
            for i, tool in enumerate(fc_tools):
                print(f"创建第 {i+1} 个FC工具卡片: {tool.get('tool_name', '')}")

                # 创建卡片widget
                card = QWidget()
                card.setStyleSheet("""
                    QWidget {
                        background-color: white;
                        border-radius: 12px;
                        border: 2px solid #e0e0e0;
                    }
                    QWidget:hover {
                        border: 2px solid #FF9800;
                    }
                """)
                card.setMinimumHeight(120)

                # 卡片布局
                card_layout = QVBoxLayout(card)
                card_layout.setContentsMargins(20, 15, 20, 15)
                card_layout.setSpacing(10)

                # 标题行
                title_layout = QHBoxLayout()

                # FC工具名称（使用不同的图标）
                name_label = QLabel(f"🔧 {tool.get('tool_name', '')}")
                name_label.setFont(QFont("微软雅黑", 12, QFont.Bold))
                name_label.setStyleSheet("color: #2c3e50; border: none;")
                title_layout.addWidget(name_label)

                title_layout.addStretch()

                # 下载按钮
                download_btn = QPushButton("⬇ 下载")
                download_btn.setMinimumSize(100, 35)
                download_btn.setFont(QFont("微软雅黑", 10, QFont.Bold))
                download_btn.setStyleSheet("""
                    QPushButton {
                        background-color: #FF9800;
                        color: white;
                        border-radius: 6px;
                        padding: 6px 15px;
                        border: none;
                    }
                    QPushButton:hover {
                        background-color: #F57C00;
                    }
                    QPushButton:pressed {
                        background-color: #E65100;
                    }
                """)
                download_btn.clicked.connect(lambda checked, t=tool: self.download_fc_tool(t))
                title_layout.addWidget(download_btn)

                card_layout.addLayout(title_layout)

                # 描述
                desc_label = QLabel(tool.get('description', ''))
                desc_label.setFont(QFont("微软雅黑", 10))
                desc_label.setStyleSheet("color: #555; border: none;")
                desc_label.setWordWrap(True)
                card_layout.addWidget(desc_label)

                # 底部信息行
                info_layout = QHBoxLayout()

                # 作者信息
                author_label = QLabel(f"👤 作者: {tool.get('uploader_email', '')}")
                author_label.setFont(QFont("微软雅黑", 9))
                author_label.setStyleSheet("color: #888; border: none;")
                info_layout.addWidget(author_label)

                info_layout.addStretch()

                card_layout.addLayout(info_layout)

                # 添加卡片到容器
                container_layout.addWidget(card)

            # 添加底部spacer
            spacer = QSpacerItem(20, 40, QSizePolicy.Minimum, QSizePolicy.Expanding)
            container_layout.addItem(spacer)

            print(f"FC工具卡片显示完成,共 {len(fc_tools)} 个")

        except Exception as e:
            print(f"显示FC工具列表失败: {e}")
            import traceback
            traceback.print_exc()

    def download_fc_tool(self, tool):
        """下载FC工具到server-tools目录"""
        try:
            tool_id = tool.get('id')
            filename = tool.get('file_name')

            self.toast.show_message(f"正在下载 {tool.get('tool_name')}...", 2000)

            url = f"http://mynewbot.com/api/download-fc-tool/{tool_id}"
            response = requests.get(url, timeout=30)
            response.raise_for_status()

            # 保存到server-tools目录
            save_dir = Path("server-tools")
            save_dir.mkdir(parents=True, exist_ok=True)
            file_path = save_dir / filename

            with open(file_path, 'wb') as f:
                f.write(response.content)

            self.toast.show_message(f"✓ 下载成功: {filename}", 3000)
            print(f"FC工具已保存到: {file_path}")

        except Exception as e:
            self.toast.show_message(f"✗ 下载FC工具失败: {str(e)}", 3000)
            print(f"下载FC工具失败: {e}")

    # ==================== 提示词广场相关功能 ====================
    def init_prompt_market_table(self):
        """初始化提示词广场卡片容器"""
        try:
            # 清空现有的卡片
            layout = self.ui.scrollAreaWidgetContents_prompt_market.layout()
            while layout.count():
                child = layout.takeAt(0)
                if child.widget():
                    child.widget().deleteLater()

            # 添加一个占位spacer
            spacer = QSpacerItem(20, 40, QSizePolicy.Minimum, QSizePolicy.Expanding)
            layout.addItem(spacer)

            print("提示词广场卡片容器初始化成功")
        except Exception as e:
            print(f"初始化提示词广场失败: {e}")
            import traceback
            traceback.print_exc()

    def refresh_prompt_market(self):
        """刷新提示词广场列表"""
        print("开始刷新提示词广场...")
        try:
            print("正在请求API...")
            response = requests.get("http://mynewbot.com/api/get-prompts", timeout=10)
            print(f"API响应状态码: {response.status_code}")
            data = response.json()
            print(f"API返回数据: {data}")

            if data.get('success'):
                prompts = data.get('prompts', [])
                print(f"获取到 {len(prompts)} 个提示词")
                self.display_prompts(prompts)
                self.toast.show_message(f"成功获取 {len(prompts)} 个提示词", 2000)
            else:
                print("API返回success=False")
                self.toast.show_message("获取提示词列表失败", 3000)
        except Exception as e:
            self.toast.show_message(f"刷新失败: {str(e)}", 3000)
            print(f"刷新提示词广场失败: {e}")
            import traceback
            traceback.print_exc()

    def display_prompts(self, prompts):
        """显示提示词列表 - 可折叠布局"""
        print(f"开始显示 {len(prompts)} 个提示词")
        try:
            # 获取容器布局
            container_layout = self.ui.scrollAreaWidgetContents_prompt_market.layout()

            # 清空现有的卡片(保留最后的spacer)
            while container_layout.count() > 0:
                item = container_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
                elif item.spacerItem():
                    pass

            # 为每个提示词创建可折叠的卡片
            for i, prompt in enumerate(prompts):
                print(f"创建第 {i+1} 个提示词卡片: {prompt.get('title', '')}")

                # 创建主容器
                main_container = QWidget()
                main_container.setStyleSheet("""
                    QWidget {
                        background-color: white;
                        border-radius: 8px;
                        border: 1px solid #e0e0e0;
                    }
                """)

                container_v_layout = QVBoxLayout(main_container)
                container_v_layout.setContentsMargins(0, 0, 0, 0)
                container_v_layout.setSpacing(0)

                # 头部区域（标题+简介+复制按钮）
                header = QWidget()
                header.setStyleSheet("""
                    QWidget {
                        background-color: transparent;
                        border: none;
                    }
                    QWidget:hover {
                        background-color: #f9f9f9;
                    }
                """)
                header.setCursor(Qt.PointingHandCursor)
                header_layout = QHBoxLayout(header)
                header_layout.setContentsMargins(15, 12, 15, 12)
                header_layout.setSpacing(15)

                # 左侧：标题、简介、警示标签（横向排列）
                title_and_info = QLabel()
                title_text = f"💡 <b>{prompt.get('title', '')}</b>"
                summary_text = prompt.get('summary', '')

                # 检查是否有使用要求
                prerequisites = prompt.get('prerequisites', '')
                warning_tag = ""
                if prerequisites:
                    warning_tag = ' <span style="background-color: #fef5e7; color: #e67e22; padding: 2px 8px; border-radius: 4px; font-size: 8pt;">⚠️ 有使用条件</span>'

                # 组合显示：标题 简介 警示标签
                combined_text = f'{title_text}  <span style="color: #777; font-size: 9pt;">{summary_text}</span>{warning_tag}'
                title_and_info.setText(combined_text)
                title_and_info.setFont(QFont("微软雅黑", 10))
                title_and_info.setStyleSheet("color: #2c3e50; border: none;")
                title_and_info.setWordWrap(True)
                header_layout.addWidget(title_and_info, 1)

                # 右侧：应用按钮
                apply_btn = QPushButton("应用")
                apply_btn.setMinimumSize(80, 35)
                apply_btn.setFont(QFont("微软雅黑", 9))
                apply_btn.setStyleSheet("""
                    QPushButton {
                        background-color: #8e44ad;
                        color: white;
                        border-radius: 6px;
                        border: none;
                    }
                    QPushButton:hover {
                        background-color: #9b59b6;
                    }
                    QPushButton:pressed {
                        background-color: #6c3483;
                    }
                """)
                apply_btn.clicked.connect(lambda checked, p=prompt: self.apply_prompt(p))
                header_layout.addWidget(apply_btn)

                container_v_layout.addWidget(header)

                # 详情区域（默认隐藏）
                detail_widget = QWidget()
                detail_widget.setStyleSheet("background-color: #f8f9fa; border: none; border-top: 1px solid #e0e0e0;")
                detail_widget.setVisible(False)
                detail_layout = QVBoxLayout(detail_widget)
                detail_layout.setContentsMargins(15, 15, 15, 15)
                detail_layout.setSpacing(10)

                # 使用要求
                prerequisites = prompt.get('prerequisites', '')
                if prerequisites:
                    prereq_label = QLabel(f"⚠️ 使用要求:\n{prerequisites}")
                    prereq_label.setFont(QFont("微软雅黑", 9))
                    prereq_label.setStyleSheet("color: #e67e22; padding: 10px; background-color: #fef5e7; border-radius: 6px; border: 1px solid #f39c12;")
                    prereq_label.setWordWrap(True)
                    detail_layout.addWidget(prereq_label)

                # 内容
                content_label = QLabel(prompt.get('content', ''))
                content_label.setFont(QFont("微软雅黑", 9))
                content_label.setStyleSheet("color: #555; padding: 10px; background-color: white; border-radius: 6px;")
                content_label.setWordWrap(True)
                detail_layout.addWidget(content_label)

                container_v_layout.addWidget(detail_widget)

                # 点击头部切换展开/折叠
                header.mousePressEvent = lambda event, dw=detail_widget: self.toggle_detail(dw)

                # 添加到容器
                container_layout.addWidget(main_container)

            # 添加底部spacer
            spacer = QSpacerItem(20, 40, QSizePolicy.Minimum, QSizePolicy.Expanding)
            container_layout.addItem(spacer)

            print(f"提示词卡片显示完成,共 {len(prompts)} 个")

        except Exception as e:
            print(f"显示提示词列表失败: {e}")
            import traceback
            traceback.print_exc()

    def toggle_detail(self, detail_widget):
        """切换详情显示/隐藏"""
        detail_widget.setVisible(not detail_widget.isVisible())

    def apply_prompt(self, prompt):
        """应用提示词到系统提示词输入框"""
        try:
            content = prompt.get('content', '')
            title = prompt.get('title', '')

            # 将提示词内容填入系统提示词输入框（textEdit_3）
            self.ui.textEdit_3.setPlainText(content)

            self.toast.show_message("✓ 已更新提示词！", 5000)
            print(f"已应用提示词: {title}")

        except Exception as e:
            self.toast.show_message(f"✗ 应用失败: {str(e)}", 3000)
            print(f"应用提示词失败: {e}")

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

    # ==================== 对话记录相关功能 ====================
    def open_chat_history(self):
        """打开对话记录页面并自动加载"""
        try:
            # 先切换到对话记录页面
            self.ui.stackedWidget.setCurrentIndex(12)

            # 检查是否已经创建了WebView
            # 打包后禁用 WebEngineView，直接使用 QTextEdit 避免崩溃
            if not hasattr(self, 'chat_history_webview'):
                # 检测是否是打包后的程序
                is_frozen = getattr(sys, 'frozen', False)

                if not is_frozen:  # 只在开发环境使用 WebEngineView
                    try:
                        from PyQt5.QtWebEngineWidgets import QWebEngineView
                        print("成功导入QWebEngineView")
                        # 创建WebView替换TextEdit
                        self.chat_history_webview = QWebEngineView()
                        self.chat_history_webview.setStyleSheet("""
                            QWebEngineView {
                                background-color: #fafaf8;
                                border: 1px solid rgba(0, 0, 0, 0.1);
                            }
                        """)
                        # 获取当前布局
                        layout = self.ui.textEdit_chat_history.parent().layout()
                        print(f"获取到布局: {layout}")
                        # 找到textEdit_chat_history的索引
                        for i in range(layout.count()):
                            widget = layout.itemAt(i).widget()
                            print(f"索引 {i} 的控件: {widget}")
                            if widget == self.ui.textEdit_chat_history:
                                print(f"找到textEdit_chat_history在索引 {i}")
                                # 移除旧的textEdit
                                layout.removeWidget(self.ui.textEdit_chat_history)
                                self.ui.textEdit_chat_history.hide()
                                # 添加新的webview
                                layout.insertWidget(i, self.chat_history_webview)
                                print("已插入WebView")
                                break
                        print("WebEngineView创建完成")
                    except ImportError as e:
                        print(f"PyQtWebEngine导入失败: {e}")
                        self.chat_history_webview = None
                    except Exception as e:
                        print(f"创建WebView时出错: {e}")
                        import traceback
                        traceback.print_exc()
                        self.chat_history_webview = None
                else:
                    # 打包后直接禁用 WebEngineView
                    print("打包模式：禁用WebEngineView，使用QTextEdit")
                    self.chat_history_webview = None

            # 然后加载对话记录
            self.load_chat_history()
        except Exception as e:
            # 捕获所有异常，防止程序崩溃
            print(f"打开对话记录时发生错误: {e}")
            import traceback
            traceback.print_exc()
            # 显示错误信息给用户
            try:
                error_msg = f"打开对话记录失败: {str(e)}"
                self.ui.textEdit_chat_history.setPlainText(error_msg)
            except:
                pass

    def load_chat_history(self):
        """加载对话记录"""
        print("开始加载对话记录...")
        try:
            # 对话历史文件路径
            history_file = os.path.join("AI记录室", "对话历史.jsonl")

            if not os.path.exists(history_file):
                empty_html = "<p style='text-align:center; color:#666; padding:50px;'>对话历史文件不存在</p>"
                if hasattr(self, 'chat_history_webview') and self.chat_history_webview:
                    self.chat_history_webview.setHtml(empty_html)
                else:
                    self.ui.textEdit_chat_history.setHtml(empty_html)
                print(f"对话历史文件不存在: {history_file}")
                return

            # 读取对话历史
            chat_history = []
            with open(history_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            chat_history.append(json.loads(line))
                        except json.JSONDecodeError as e:
                            print(f"解析JSON失败: {e}")
                            continue

            # 打包模式下，限制加载最近的50条对话，避免内存溢出
            is_frozen = getattr(sys, 'frozen', False)
            if is_frozen and len(chat_history) > 50:
                print(f"打包模式：限制只显示最近50条对话（共{len(chat_history)}条）")
                chat_history = chat_history[-50:]

            # 格式化显示
            if not chat_history:
                empty_html = "<p style='text-align:center; color:#666; padding:50px;'>暂无对话记录</p>"
                if hasattr(self, 'chat_history_webview') and self.chat_history_webview:
                    self.chat_history_webview.setHtml(empty_html)
                else:
                    self.ui.textEdit_chat_history.setHtml(empty_html)
                return

            # 构建HTML - 完全按照HTML查看器的样式
            html_parts = []
            html_parts.append("""
            <style>
                body {
                    margin: 0;
                    padding: 0;
                }
                .dialogue-entry {
                    margin-bottom: 25px;
                    padding-left: 10px;
                }
                .character-name {
                    font-weight: bold;
                    margin-bottom: 8px;
                    letter-spacing: 1px;
                }
                .character-name.user {
                    color: #4a90d9;
                }
                .character-name.assistant {
                    color: #d4850d;
                }
                .dialogue-text {
                    line-height: 1.8;
                    color: #333;
                    padding-left: 15px;
                    border-left: 2px solid rgba(0, 0, 0, 0.15);
                }
                .dialogue-text img {
                    display: block;
                    max-width: 100%;
                    height: auto;
                    border-radius: 8px;
                    margin: 15px 0;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    cursor: pointer;
                    transition: transform 0.2s;
                }
                .dialogue-text img:hover {
                    transform: scale(1.02);
                    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
                }
                .emotion-tag {
                    color: #e91e63;
                }
                .tool-call-box {
                    margin-top: 10px;
                    padding: 12px 15px;
                    background: rgba(100, 150, 200, 0.08);
                    border-left: 3px solid #6496c8;
                    border-radius: 4px;
                    color: #555;
                }
                .divider {
                    height: 1px;
                    background: linear-gradient(to right, transparent, rgba(0, 0, 0, 0.1), transparent);
                    margin: 20px 0;
                }
                /* 全屏图片预览遮罩层 */
                #image-preview-fullscreen {
                    display: none;
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.98);
                    z-index: 999999;
                    cursor: pointer;
                    justify-content: center;
                    align-items: center;
                }
                #image-preview-fullscreen.active {
                    display: flex !important;
                }
                #image-preview-fullscreen img {
                    max-width: 98%;
                    max-height: 98%;
                    object-fit: contain;
                    box-shadow: 0 0 50px rgba(255, 255, 255, 0.3);
                }
            </style>

            <script>
                // 图片点击放大功能
                function setupImagePreview() {
                    console.log('开始设置图片预览功能');

                    // 创建全屏遮罩层
                    var overlay = document.createElement('div');
                    overlay.id = 'image-preview-fullscreen';
                    var overlayImg = document.createElement('img');
                    overlay.appendChild(overlayImg);
                    document.body.appendChild(overlay);

                    console.log('遮罩层已创建');

                    // 点击遮罩关闭
                    overlay.onclick = function() {
                        console.log('关闭预览');
                        this.classList.remove('active');
                    };

                    // 为所有图片添加点击事件
                    var images = document.querySelectorAll('.dialogue-text img');
                    console.log('找到图片数量:', images.length);

                    images.forEach(function(img) {
                        img.onclick = function(e) {
                            console.log('图片被点击');
                            e.stopPropagation();
                            overlayImg.src = this.src;
                            overlay.classList.add('active');
                        };
                    });
                }

                // 页面加载完成后初始化
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', setupImagePreview);
                } else {
                    setupImagePreview();
                }
            </script>
            """)

            # 处理情绪标签的函数（Python版本）
            def process_emotion_tags(content):
                """将 <情绪> 标签转换为带样式的HTML"""
                import re
                # 只匹配包含中文字符的标签，排除HTML标签
                return re.sub(r'<([\u4e00-\u9fa5]+)>', r'<span class="emotion-tag">&lt;\1&gt;</span>', content)

            # 提取内容并生成HTML的函数
            def extract_content_html(content):
                """从content中提取内容并生成HTML，处理字符串或列表格式"""
                if isinstance(content, str):
                    # 如果是字符串，直接返回
                    return content
                elif isinstance(content, list):
                    # 如果是列表，提取所有文本和图片信息
                    html_parts = []
                    for item in content:
                        if isinstance(item, dict):
                            if item.get('type') == 'text':
                                html_parts.append(item.get('text', ''))
                            elif item.get('type') == 'image_url':
                                # 提取图片数据
                                image_url = item.get('image_url', {}).get('url', '')
                                if image_url and image_url.startswith('data:image'):
                                    # 检测是否是打包后的程序
                                    is_frozen = getattr(sys, 'frozen', False)

                                    if not is_frozen and hasattr(self, 'chat_history_webview') and self.chat_history_webview:
                                        # 开发环境 + WebEngineView: 使用临时文件（更快）
                                        try:
                                            import base64
                                            import tempfile
                                            import uuid

                                            header, base64_data = image_url.split(',', 1)
                                            image_format = header.split(';')[0].split('/')[1]
                                            image_bytes = base64.b64decode(base64_data)

                                            temp_dir = tempfile.gettempdir()
                                            temp_filename = f"chat_image_{uuid.uuid4().hex}.{image_format}"
                                            temp_path = os.path.join(temp_dir, temp_filename)

                                            with open(temp_path, 'wb') as f:
                                                f.write(image_bytes)

                                            file_url = f"file:///{temp_path.replace(chr(92), '/')}"
                                            html_parts.append(f'<br/><img src="{file_url}" style="max-width:100%; height:auto; display:block; margin:10px 0;" /><br/>')
                                        except Exception as e:
                                            print(f"处理图片时出错: {e}")
                                            html_parts.append(f'<br/>[图片加载失败]<br/>')
                                    else:
                                        # 打包模式 或 QTextEdit: 直接使用 base64
                                        # QTextEdit 不支持百分比宽度，需要缩小图片
                                        try:
                                            import base64
                                            from io import BytesIO
                                            from PIL import Image

                                            # 解码 base64
                                            header, base64_data = image_url.split(',', 1)
                                            image_bytes = base64.b64decode(base64_data)

                                            # 使用 PIL 缩小图片
                                            img = Image.open(BytesIO(image_bytes))

                                            # 缩放到最大宽度 800px
                                            max_width = 800
                                            if img.width > max_width:
                                                ratio = max_width / img.width
                                                new_height = int(img.height * ratio)
                                                img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)

                                            # 转回 base64
                                            buffered = BytesIO()
                                            img_format = header.split(';')[0].split('/')[1].upper()
                                            if img_format == 'JPG':
                                                img_format = 'JPEG'
                                            img.save(buffered, format=img_format)
                                            img_str = base64.b64encode(buffered.getvalue()).decode()
                                            resized_url = f"data:image/{img_format.lower()};base64,{img_str}"

                                            html_parts.append(f'<br/><img src="{resized_url}" style="display:block; margin:10px 0;" /><br/>')
                                        except Exception as e:
                                            print(f"缩放图片失败: {e}")
                                            # 如果缩放失败，直接显示原图但限制宽度
                                            html_parts.append(f'<br/><img src="{image_url}" width="800" style="display:block; margin:10px 0;" /><br/>')
                    return ''.join(html_parts)
                else:
                    return str(content)

            # 构建对话内容
            for i, msg in enumerate(chat_history):
                role = msg.get('role', 'unknown')
                content = msg.get('content', '')
                tool_calls = msg.get('tool_calls', [])

                # 角色显示
                if role == 'user':
                    role_display = "用户"
                    role_class = "user"
                elif role == 'assistant':
                    role_display = "AI"
                    role_class = "assistant"
                else:
                    role_display = role
                    role_class = "unknown"

                # 提取内容（包括文本和图片）
                content_html = extract_content_html(content)

                # 处理内容：先处理情绪标签
                processed_content = process_emotion_tags(content_html)

                # 处理工具调用（放在对话文本内部）
                tool_html = ""
                if tool_calls:
                    tool_call = tool_calls[0]  # 只取第一个工具调用
                    function_name = tool_call.get('function', {}).get('name', 'unknown')
                    arguments = tool_call.get('function', {}).get('arguments', '')

                    # 尝试解析参数
                    try:
                        arg_obj = json.loads(arguments)
                        args_text = ', '.join(str(v) for v in arg_obj.values())
                    except:
                        args_text = arguments

                    tool_html = f'<div class="tool-call-box">AI使用工具：{function_name} 输入了参数：{args_text}</div>'

                # 开始对话条目
                html_parts.append('<div class="dialogue-entry">')
                html_parts.append(f'<div class="character-name {role_class}">{role_display}</div>')
                html_parts.append(f'<div class="dialogue-text">{processed_content}{tool_html}</div>')
                html_parts.append('</div>')

                # 添加分隔线（最后一条除外）
                if i < len(chat_history) - 1:
                    html_parts.append('<div class="divider"></div>')

            # 设置HTML到文本框或WebView
            final_html = "".join(html_parts)
            if hasattr(self, 'chat_history_webview') and self.chat_history_webview:
                self.chat_history_webview.setHtml(final_html)
            else:
                self.ui.textEdit_chat_history.setHtml(final_html)
            print(f"成功加载 {len(chat_history)} 条对话记录")

        except Exception as e:
            error_html = f"<p style='color:red;'>加载对话记录失败: {str(e)}</p>"
            if hasattr(self, 'chat_history_webview') and self.chat_history_webview:
                self.chat_history_webview.setHtml(error_html)
            else:
                self.ui.textEdit_chat_history.setHtml(error_html)
            print(f"加载对话记录失败: {e}")
            import traceback
            traceback.print_exc()


if __name__ == '__main__':
    # # 分辨率自适应 - 暂时禁用，可能导致UI尺寸异常
    # QCoreApplication.setAttribute(Qt.AA_EnableHighDpiScaling)

    # 为了支持QWebEngineView，必须在创建QApplication之前设置（如果可用的话）
    try:
        QCoreApplication.setAttribute(Qt.AA_ShareOpenGLContexts)
    except:
        pass  # 如果设置失败（比如打包后没有WebEngine），忽略即可

    app = QApplication(sys.argv)
    w = set_pyqt()
    w.show()
    sys.exit(app.exec_())