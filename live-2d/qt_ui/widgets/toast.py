# -*- coding: utf-8 -*-
"""自定义 Toast 提示控件。"""
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
