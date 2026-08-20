# -*- coding: utf-8 -*-
"""日志读取、清洗与工具日志增强。"""
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


class LogsMixin:
    """日志读取、清洗与工具日志增强。"""

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
            '工具调用', '函数调用',
            'tool_calls', 'function_name',
            'tool executed', 'tool execution',
            'handleToolCalls', 'callTool',
            '正在执行工具', '工具执行',
            'server-tools'
        ]

        return any(keyword in log_line for keyword in actual_tool_keywords)


    def clear_logs(self):
        """清空日志功能"""
        # 清空桌宠日志
        self.ui.textEdit_2.clear()
        # 清空工具日志
        self.ui.textEdit.clear()
        # 显示提示
        self.toast.show_message("日志已清空", 1500)
