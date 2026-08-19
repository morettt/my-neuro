# -*- coding: utf-8 -*-
"""动作/表情配置：扫描、拖拽绑定、分页、存档备份。"""
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


class MotionExpressionMixin:
    """动作/表情配置：扫描、拖拽绑定、分页、存档备份。"""

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
