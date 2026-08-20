# -*- coding: utf-8 -*-
"""Live2D/VRM 模型列表、桌宠开关、VMC 与情绪/表情触发。"""
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


class Live2DControlMixin:
    """Live2D/VRM 模型列表、桌宠开关、VMC 与情绪/表情触发。"""

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


    def toggle_live_2d(self):
        """切换桌宠启动/关闭状态"""
        if self.live2d_running:
            # 当前正在运行，执行关闭操作
            self.close_live_2d()
            self.live2d_running = False
            self.update_toggle_button_style(False)
        else:
            # 当前未运行，执行启动操作
            if not self._confirm_discard_unsaved_config("启动前保存配置"):
                return
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

        # 重新加载工具描述，确保显示最新的工具列表
        self.tool_descriptions, self.mcp_tools = load_tool_descriptions()

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
            # 只有MCP功能启用时才显示详细信息
            if not self.mcp_enabled:
                return

            tools_path = ".\\server-tools"

            # 检查工具目录是否存在（已迁移到插件系统，目录不存在时静默跳过）
            if not os.path.exists(tools_path):
                return

            # 扫描工具模块
            js_files = [f for f in os.listdir(tools_path) if f.endswith('.js') and f != 'server.js']

            # 显示MCP工具状态
            if hasattr(self, 'tool_descriptions') and self.tool_descriptions:
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
            # 模型热复位在http-server.js中采用同样的相对比例
            default_x = 1.35  # 屏幕宽度的 135%（右边）
            default_y = 0.8   # 屏幕高度的 80%（下方）

            if 'ui' not in config:
                config['ui'] = {}
            if 'model_position' not in config['ui']:
                config['ui']['model_position'] = {}

            config['ui']['model_position']['x'] = default_x
            config['ui']['model_position']['y'] = default_y
            config['ui']['model_position']['remember_position'] = True
            config['ui']['model_scale'] = 0.65

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


    def adjust_subtitle_position(self):
        """调整字幕位置 - 通过API通知前端进入调整模式"""
        try:
            import requests
            response = requests.post('http://127.0.0.1:3002/adjust-subtitle-position', timeout=2)
            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    self.toast.show_message("已进入字幕调整模式", 3000)
                else:
                    self.toast.show_message("调整失败，请重启桌宠", 2000)
            else:
                self.toast.show_message("调整失败，请确保桌宠已启动", 2000)
        except Exception as e:
            self.toast.show_message("请先启动桌宠再调整字幕位置", 2000)


    def open_gateway_website(self):
        """打开云端肥牛官网获取API KEY"""
        try:
            webbrowser.open('http://mynewbot.com')
            self.toast.show_message("正在打开云端肥牛官网...", 2000)
        except Exception as e:
            self.toast.show_message(f"打开网页失败: {e}", 3000)


    def toggle_cloud_preview(self):
        """切换本地/云端侧边栏样式预览"""
        self._previewing_local = not self._previewing_local
        if self._previewing_local:
            self.ui.pushButton_terminal.show()
            self.ui.pushButton_voice_clone.show()
        else:
            self.ui.pushButton_terminal.hide()
            self.ui.pushButton_voice_clone.hide()
        self._update_cloud_preview_button()
        self._update_title_cloud_tag()


    def _update_cloud_preview_button(self):
        """同步按钮文字到当前预览状态"""
        if self._previewing_local:
            self.ui.pushButton_toggle_cloud_preview.setText('☁️ 切回云端样式')
        else:
            self.ui.pushButton_toggle_cloud_preview.setText('👁️ 预览本地样式')


    def _update_title_cloud_tag(self):
        """同步标题栏的云端/本地标签"""
        version = self.config.get('version', '')
        version_str = f'  {version}' if version else ''
        tag = '(本地)' if self._previewing_local else '(云端)'
        self.title_bar.title_label.setText(f'My-Neuro {tag}{version_str}')


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
