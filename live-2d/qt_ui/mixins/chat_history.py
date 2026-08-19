# -*- coding: utf-8 -*-
"""聊天记录查看。"""
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


class ChatHistoryMixin:
    """聊天记录查看。"""

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
            history_file = os.path.join("..", "AI记录室", "对话历史.jsonl")

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
