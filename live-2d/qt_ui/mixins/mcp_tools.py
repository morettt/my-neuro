# -*- coding: utf-8 -*-
"""MCP 工具列表刷新与开关。"""
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


class McpToolsMixin:
    """MCP 工具列表刷新与开关。"""

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
