# -*- coding: utf-8 -*-
"""工具市场与提示词市场。"""
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


class MarketMixin:
    """工具市场与提示词市场。"""

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
