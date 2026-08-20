# -*- coding: utf-8 -*-
"""新手教程气泡/高亮与启动扫描。"""
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


class TutorialMixin:
    """新手教程气泡/高亮与启动扫描。"""

    def show_tutorial(self):
        """启动应用内分步新手引导。"""
        self._stop_tutorial()
        self._tutorial_edition = None

        if not self._show_tutorial_welcome_dialog():
            return

        self._tutorial_step = 2
        self._highlight_tutorial_widgets([self.ui.pushButton])
        self._show_tutorial_bubble(
            "<b style='font-size:20px'>← 首先我们点击这个地方</b><br>"
            "点击左侧的 <b>LLM配置</b>，进入大模型设置页面。"
        )


    def _show_tutorial_welcome_dialog(self):
        """显示与主界面风格一致的欢迎卡片。"""
        dialog = QDialog(self)
        dialog.setObjectName("tutorialWelcomeDialog")
        dialog.setWindowFlags(Qt.Dialog | Qt.FramelessWindowHint)
        dialog.setAttribute(Qt.WA_TranslucentBackground)
        dialog.setModal(True)
        dialog.setFixedSize(500, 300)
        dialog.setStyleSheet("QDialog#tutorialWelcomeDialog { background: transparent; border: none; }")

        outer_layout = QVBoxLayout(dialog)
        outer_layout.setContentsMargins(22, 22, 22, 22)

        card = QFrame(dialog)
        card.setObjectName("tutorialWelcomeCard")
        card.setStyleSheet("""
            QFrame#tutorialWelcomeCard {
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                            stop:0 #ffffff, stop:1 #f8faff);
                border: 1px solid #dfe7f5;
                border-radius: 20px;
            }
            QLabel#tutorialWelcomeTitle {
                color: #111827;
                font-family: "Microsoft YaHei";
                font-size: 25px;
                font-weight: bold;
                background: transparent;
                border: none;
            }
            QLabel#tutorialWelcomeText {
                color: #3f4b61;
                font-family: "Microsoft YaHei";
                font-size: 18px;
                font-weight: 500;
                background: transparent;
                border: none;
            }
            QLabel#tutorialEditionLabel {
                color: #4b5870;
                font-family: "Microsoft YaHei";
                font-size: 17px;
                font-weight: bold;
                background: transparent;
                border: none;
            }
            QPushButton#tutorialEditionButton {
                min-height: 52px;
                color: #526078;
                background-color: #f7f9fc;
                border: 1px solid #dce3ee;
                border-radius: 11px;
                font-family: "Microsoft YaHei";
                font-size: 18px;
                font-weight: bold;
            }
            QPushButton#tutorialEditionButton:hover {
                color: #315bea;
                background-color: #f1f5ff;
                border: 1px solid #a9bfff;
            }
            QPushButton#tutorialEditionButton:checked {
                color: #315bea;
                background-color: #edf2ff;
                border: 2px solid #426cf5;
                font-weight: bold;
            }
            QPushButton#tutorialCloseButton {
                color: #98a2b3;
                background: transparent;
                border: none;
                border-radius: 8px;
                font-size: 22px;
            }
            QPushButton#tutorialCloseButton:hover {
                color: #344054;
                background-color: #f2f4f7;
            }
            QPushButton#tutorialNextButton {
                min-width: 112px;
                min-height: 40px;
                color: white;
                background-color: #426cf5;
                border: none;
                border-radius: 11px;
                font-family: "Microsoft YaHei";
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton#tutorialNextButton:hover {
                background-color: #315bea;
            }
            QPushButton#tutorialNextButton:pressed {
                background-color: #3159cc;
            }
            QPushButton#tutorialNextButton:disabled {
                color: #aab2c0;
                background-color: #e9edf3;
            }
        """)
        shadow = QGraphicsDropShadowEffect(card)
        shadow.setBlurRadius(32)
        shadow.setOffset(0, 8)
        shadow.setColor(QColor(35, 55, 95, 65))
        card.setGraphicsEffect(shadow)
        outer_layout.addWidget(card)

        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(34, 22, 34, 28)
        card_layout.setSpacing(0)

        header_layout = QHBoxLayout()
        title = QLabel("欢迎使用 <span style='color:#426cf5'>My Neuro</span>")
        title.setObjectName("tutorialWelcomeTitle")
        title.setTextFormat(Qt.RichText)
        close_button = QPushButton("×")
        close_button.setObjectName("tutorialCloseButton")
        close_button.setFixedSize(34, 34)
        close_button.setCursor(Qt.PointingHandCursor)
        header_layout.addWidget(title)
        header_layout.addStretch()
        header_layout.addWidget(close_button)
        card_layout.addLayout(header_layout)
        card_layout.addSpacing(22)

        description = QLabel("接下来我将指导你如何使用！")
        description.setObjectName("tutorialWelcomeText")
        description.setAlignment(Qt.AlignLeft)
        card_layout.addWidget(description)
        card_layout.addSpacing(18)

        edition_label = QLabel("请选择你正在使用的版本")
        edition_label.setObjectName("tutorialEditionLabel")
        card_layout.addWidget(edition_label)
        card_layout.addSpacing(9)

        edition_layout = QHBoxLayout()
        edition_layout.setSpacing(12)
        local_button = QPushButton("本地版本")
        cloud_button = QPushButton("云端版本")
        for edition_button in (local_button, cloud_button):
            edition_button.setObjectName("tutorialEditionButton")
            edition_button.setCheckable(True)
            edition_button.setCursor(Qt.PointingHandCursor)
            edition_layout.addWidget(edition_button)
        edition_group = QButtonGroup(dialog)
        edition_group.setExclusive(True)
        edition_group.addButton(local_button)
        edition_group.addButton(cloud_button)
        card_layout.addLayout(edition_layout)
        card_layout.addStretch()

        close_button.clicked.connect(dialog.reject)

        def start_local_tutorial():
            self._tutorial_edition = 'local'
            dialog.accept()

        def show_cloud_unavailable():
            self._tutorial_edition = 'cloud'
            title.setText("云端版本教程")
            description.setText("云端版本教程还没有制作好，请耐心等待。")
            edition_label.hide()
            local_button.hide()
            cloud_button.hide()

        local_button.clicked.connect(start_local_tutorial)
        cloud_button.clicked.connect(show_cloud_unavailable)
        accepted = dialog.exec_() == QDialog.Accepted
        return accepted


    def _tutorial_on_llm_clicked(self):
        """第二步必须由用户亲自点击 LLM 配置后才继续。"""
        if self._tutorial_step != 2:
            return
        self._clear_tutorial_highlights()
        self._tutorial_step = 3
        QTimer.singleShot(0, self._show_llm_api_tutorial)


    def _show_llm_api_tutorial(self):
        self._highlight_tutorial_widgets([self.ui.lineEdit, self.ui.lineEdit_2])
        self._show_tutorial_bubble(
            "<b style='font-size:20px'>↑ 填写 API Key 和 API URL</b><br><br>"
            "<b>API Key</b>：类似登录密码，用来连接 AI 服务，请不要分享给别人。<br><br>"
            "<b>API URL</b>：AI 服务的连接地址。<br><br>"
            "从服务商后台复制这两项，填到上面即可。"
        )


    def _show_llm_model_tutorial(self):
        """介绍模型列表功能，不要求用户先填写任何配置。"""
        self._clear_tutorial_highlights()
        self._tutorial_step = 4
        self._highlight_tutorial_widgets([
            self.ui.comboBox_llm_model,
            self.ui.pushButton_fetch_llm_models
        ])
        self._show_tutorial_bubble(
            "<b style='font-size:20px'>↑ 获取并选择模型</b><br><br>"
            "点击 <b>获取模型</b>，程序会根据刚才填写的 API Key 和 API URL "
            "读取服务商提供的模型列表。<br><br>"
            "获取成功后，在 <b>模型名称</b> 下拉框中选择你想使用的模型。"
        )


    def _tutorial_advance(self):
        if self._tutorial_step == 3:
            self._show_llm_model_tutorial()
        elif self._tutorial_step == 4:
            self._show_start_page_tutorial()


    def _show_start_page_tutorial(self):
        self._clear_tutorial_highlights()
        self._tutorial_step = 5
        self._highlight_tutorial_widgets([self.ui.pushButton_3])
        self._show_tutorial_bubble(
            "<b style='font-size:20px'>← 接下来点击“启动”</b><br>"
            "进入启动页面，准备运行桌宠。"
        )


    def _tutorial_on_start_page_clicked(self):
        if self._tutorial_step != 5:
            return
        self._clear_tutorial_highlights()
        self._tutorial_step = 6
        QTimer.singleShot(0, self._show_pet_start_tutorial)


    def _show_pet_start_tutorial(self):
        self._highlight_tutorial_widgets([self.ui.pushButton_toggle_live2d])
        self._show_tutorial_bubble(
            "<b style='font-size:20px'>↑ 点击“启动桌宠”</b><br>"
            "点击这个按钮，启动你的桌面角色。"
        )


    def _tutorial_on_pet_toggle_clicked(self):
        if self._tutorial_step == 6:
            self._stop_tutorial()


    def _tutorial_on_model_selected(self, _index):
        if self._tutorial_step == 4:
            self._stop_tutorial()


    def _show_tutorial_bubble(self, text):
        if self._tutorial_bubble is None:
            self._tutorial_bubble = QLabel(self)
            self._tutorial_bubble.setObjectName("tutorialGuideBubble")
            self._tutorial_bubble.setWordWrap(True)
            self._tutorial_bubble.setTextFormat(Qt.RichText)
            self._tutorial_bubble.setAttribute(Qt.WA_TransparentForMouseEvents, True)
            self._tutorial_bubble.setStyleSheet("""
                QLabel#tutorialGuideBubble {
                    color: #172033;
                    background-color: rgba(255, 255, 255, 248);
                    border: 3px solid #4f8cff;
                    border-radius: 14px;
                    padding: 18px;
                    font-family: "Microsoft YaHei";
                    font-size: 18px;
                }
            """)
        if self._tutorial_next_button is None:
            self._tutorial_next_button = QPushButton(self)
            self._tutorial_next_button.setCursor(Qt.PointingHandCursor)
            self._tutorial_next_button.setFixedSize(112, 40)
            self._tutorial_next_button.setStyleSheet("""
                QPushButton {
                    color: white;
                    background-color: #426cf5;
                    border: none;
                    border-radius: 9px;
                    font-family: "Microsoft YaHei";
                    font-size: 16px;
                    font-weight: bold;
                }
                QPushButton:hover { background-color: #315bea; }
                QPushButton:pressed { background-color: #264bc7; }
            """)
            self._tutorial_next_button.clicked.connect(self._tutorial_advance)

        if self._tutorial_close_button is None:
            self._tutorial_close_button = QPushButton("×", self)
            self._tutorial_close_button.setCursor(Qt.PointingHandCursor)
            self._tutorial_close_button.setFixedSize(28, 28)
            self._tutorial_close_button.setToolTip("退出教程")
            self._tutorial_close_button.setStyleSheet("""
                QPushButton {
                    color: #8a94a6;
                    background-color: transparent;
                    border: none;
                    border-radius: 7px;
                    font-family: Arial;
                    font-size: 21px;
                }
                QPushButton:hover {
                    color: #344054;
                    background-color: #edf1f7;
                }
                QPushButton:pressed { background-color: #e1e7f0; }
            """)
            self._tutorial_close_button.clicked.connect(self._stop_tutorial)

        has_next = self._tutorial_step in (3, 4)
        self._tutorial_bubble.setText(text + ("<br><br><br>" if has_next else ""))
        self._tutorial_bubble.setFixedWidth(520 if self._tutorial_step in (3, 4) else 420)
        self._tutorial_bubble.adjustSize()
        self._tutorial_bubble.show()
        self._tutorial_close_button.show()
        if has_next:
            self._tutorial_next_button.setText("下一步  →" if self._tutorial_step == 3 else "完成")
            self._tutorial_next_button.show()
        else:
            self._tutorial_next_button.hide()
        self._position_tutorial_bubble()
        self._tutorial_bubble.raise_()
        self._tutorial_close_button.raise_()
        if has_next:
            self._tutorial_next_button.raise_()


    def _position_tutorial_bubble(self):
        bubble = self._tutorial_bubble
        if bubble is None or not bubble.isVisible():
            return

        margin = 18
        if self._tutorial_step == 2:
            target = self.ui.pushButton
            top_left = target.mapTo(self, QPoint(0, 0))
            x = top_left.x() + target.width() + margin
            y = top_left.y() + (target.height() - bubble.height()) // 2
        elif self._tutorial_step == 5:
            target = self.ui.pushButton_3
            top_left = target.mapTo(self, QPoint(0, 0))
            x = top_left.x() + target.width() + margin
            y = top_left.y() + (target.height() - bubble.height()) // 2
        elif self._tutorial_step == 3:
            first_pos = self.ui.lineEdit.mapTo(self, QPoint(0, 0))
            second_pos = self.ui.lineEdit_2.mapTo(self, QPoint(0, 0))
            left = min(first_pos.x(), second_pos.x())
            right = max(first_pos.x() + self.ui.lineEdit.width(),
                        second_pos.x() + self.ui.lineEdit_2.width())
            bottom = max(first_pos.y() + self.ui.lineEdit.height(),
                         second_pos.y() + self.ui.lineEdit_2.height())
            x = left + (right - left - bubble.width()) // 2
            y = bottom + margin
        elif self._tutorial_step == 4:
            first_pos = self.ui.comboBox_llm_model.mapTo(self, QPoint(0, 0))
            second_pos = self.ui.pushButton_fetch_llm_models.mapTo(self, QPoint(0, 0))
            left = min(first_pos.x(), second_pos.x())
            right = max(first_pos.x() + self.ui.comboBox_llm_model.width(),
                        second_pos.x() + self.ui.pushButton_fetch_llm_models.width())
            bottom = max(first_pos.y() + self.ui.comboBox_llm_model.height(),
                         second_pos.y() + self.ui.pushButton_fetch_llm_models.height())
            x = left + (right - left - bubble.width()) // 2
            y = bottom + margin
        elif self._tutorial_step == 6:
            target = self.ui.pushButton_toggle_live2d
            top_left = target.mapTo(self, QPoint(0, 0))
            x = top_left.x() + (target.width() - bubble.width()) // 2
            y = top_left.y() + target.height() + margin
        else:
            return

        x = max(10, min(x, self.width() - bubble.width() - 10))
        y = max(10, min(y, self.height() - bubble.height() - 10))
        bubble.move(x, y)
        bubble.raise_()
        if self._tutorial_close_button is not None and self._tutorial_close_button.isVisible():
            self._tutorial_close_button.move(
                bubble.x() + bubble.width() - self._tutorial_close_button.width() - 8,
                bubble.y() + 8
            )
            self._tutorial_close_button.raise_()
        if self._tutorial_next_button is not None and self._tutorial_next_button.isVisible():
            self._tutorial_next_button.move(
                bubble.x() + bubble.width() - self._tutorial_next_button.width() - 16,
                bubble.y() + bubble.height() - self._tutorial_next_button.height() - 14
            )
            self._tutorial_next_button.raise_()


    def _highlight_tutorial_widgets(self, widgets):
        self._clear_tutorial_highlights()
        for widget in widgets:
            self._tutorial_original_styles[widget] = widget.styleSheet()
            widget.setStyleSheet(widget.styleSheet() + """
                border: 3px solid #ff9f1c;
                border-radius: 8px;
                background-color: #fff7df;
            """)


    def _clear_tutorial_highlights(self):
        for widget, style in self._tutorial_original_styles.items():
            widget.setStyleSheet(style)
        self._tutorial_original_styles.clear()


    def _stop_tutorial(self):
        self._tutorial_step = 0
        self._clear_tutorial_highlights()
        if self._tutorial_bubble is not None:
            self._tutorial_bubble.hide()
        if self._tutorial_next_button is not None:
            self._tutorial_next_button.hide()
        if self._tutorial_close_button is not None:
            self._tutorial_close_button.hide()


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
