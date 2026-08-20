# -*- coding: utf-8 -*-
"""QQ 群入口组件：标题栏 QQ 图标按钮 + 点击弹出群二维码。

资源文件位于 qt_ui/assets/：
    qrcode.jpg  群二维码（必需）
    qq.png / qq.jpg / qq_logo.png / qq_logo.jpg / qq.ico  QQ 图标（可选，
        存在任一即用作按钮图标，否则按钮显示企鹅 emoji 🐧）
"""
import os
import sys

from PyQt5.QtCore import QSize, Qt
from PyQt5.QtGui import QIcon, QPixmap
from PyQt5.QtWidgets import (
    QDialog, QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget,
)


def _assets_dir():
    """qt_ui/assets 目录路径，兼容开发环境与 PyInstaller 打包。"""
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, 'qt_ui', 'assets')
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets')


def qr_code_path():
    """群二维码图片路径。"""
    return os.path.join(_assets_dir(), 'qrcode.jpg')


def _find_qq_logo():
    """在 assets 中查找可用的 QQ 图标文件，找不到返回 None。"""
    for name in ('qq.png', 'qq.jpg', 'qq_logo.png', 'qq_logo.jpg', 'qq.ico'):
        path = os.path.join(_assets_dir(), name)
        if os.path.exists(path):
            return path
    return None


class QrCodeDialog(QDialog):
    """群二维码弹窗：无边框圆角样式，与主窗口风格统一。

    按住空白处可拖拽移动；按 Esc 或点击右上角 × 关闭。
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        # 无边框 + 透明背景（实现圆角效果），不显示系统标题栏
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.Dialog)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setModal(True)
        self._drag_pos = None

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)

        # 容器：与主窗口一致的米色渐变 + 圆角
        container = QWidget(self)
        container.setObjectName('qrContainer')
        container.setStyleSheet("""
            QWidget#qrContainer {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 rgba(235, 233, 225, 255),
                    stop:1 rgba(230, 228, 220, 255));
                border-radius: 25px;
            }
            QLabel {
                color: rgb(114, 95, 77);
                font-family: "Microsoft YaHei";
                background: transparent;
            }
        """)
        outer.addWidget(container)

        layout = QVBoxLayout(container)
        layout.setContentsMargins(24, 14, 14, 18)
        layout.setSpacing(10)

        # 顶部行：标题 + 关闭按钮（样式对齐主窗口标题栏）
        top_row = QHBoxLayout()
        top_row.setContentsMargins(0, 0, 0, 0)
        title = QLabel('QQ群二维码')
        title.setStyleSheet('font-size: 16px; font-weight: bold;')
        close_btn = QPushButton('×')
        close_btn.setFixedSize(40, 34)
        close_btn.setCursor(Qt.PointingHandCursor)
        close_btn.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                border: none;
                font-size: 20px;
                font-weight: bold;
                color: rgb(114, 95, 77);
            }
            QPushButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 rgba(255, 182, 193, 255),
                    stop:1 rgba(255, 160, 122, 255));
                color: rgb(139, 69, 19);
                border-radius: 5px;
            }
        """)
        close_btn.clicked.connect(self.reject)
        top_row.addWidget(title)
        top_row.addStretch()
        top_row.addWidget(close_btn)
        layout.addLayout(top_row)

        # 二维码图片（白色圆角底板）
        self.image_label = QLabel()
        self.image_label.setAlignment(Qt.AlignCenter)
        self.image_label.setStyleSheet("""
            QLabel {
                background-color: white;
                border-radius: 15px;
                padding: 12px;
            }
        """)
        pixmap = QPixmap(qr_code_path())
        if not pixmap.isNull():
            scaled = pixmap.scaled(
                QSize(420, 420), Qt.KeepAspectRatio, Qt.SmoothTransformation)
            self.image_label.setPixmap(scaled)
        else:
            self.image_label.setText(
                '未找到二维码图片：\n' + qr_code_path())
        layout.addWidget(self.image_label)

        tip = QLabel('扫码加入 QQ 群 · 按 Esc 或点击 × 关闭')
        tip.setAlignment(Qt.AlignCenter)
        tip.setStyleSheet('font-size: 12px; color: rgb(150, 135, 120);')
        layout.addWidget(tip)

    def mousePressEvent(self, event):
        """按住空白处开始拖拽弹窗。"""
        if event.button() == Qt.LeftButton:
            self._drag_pos = event.globalPos() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        """拖拽移动弹窗。"""
        if event.buttons() == Qt.LeftButton and self._drag_pos is not None:
            self.move(event.globalPos() - self._drag_pos)
            event.accept()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.reject()
        else:
            super().keyPressEvent(event)


class QqGroupButton(QPushButton):
    """标题栏 QQ 群按钮：有 QQ 图标则用图标，否则显示企鹅 emoji。"""

    def __init__(self, parent=None):
        super().__init__(parent)
        logo = _find_qq_logo()
        if logo:
            self.setIcon(QIcon(logo))
            self.setIconSize(QSize(30, 30))
        else:
            self.setText('🐧')
        self.setToolTip('QQ群')
        self.setCursor(Qt.PointingHandCursor)
        self.clicked.connect(self.show_qr_code)

    def show_qr_code(self):
        """弹出群二维码（以主窗口为父窗口，自动居中于其上方）。"""
        QrCodeDialog(self.window()).exec_()
