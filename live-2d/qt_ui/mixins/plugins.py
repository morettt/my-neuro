# -*- coding: utf-8 -*-
"""插件页面与插件市场：安装、启用、详情配置、DLC。"""
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


class PluginsMixin:
    """插件页面与插件市场：安装、启用、详情配置、DLC。"""

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
            bat_file = meta.get('bat')
            if bat_file:
                bat_btn = QPushButton('启动')
                bat_btn.setFont(self._ui_font())
                bat_btn.setMinimumSize(60, 30)
                bat_btn.setStyleSheet("""
                    QPushButton { background-color: #4CAF50; color: white; border-radius: 6px; border: none; padding: 4px 8px; }
                    QPushButton:hover { background-color: #388E3C; }
                    QPushButton:pressed { background-color: #2E7D32; }
                """)
                bat_btn.clicked.connect(lambda checked=False, pn=plugin_name, bf=bat_file: self._launch_plugin_bat(pn, bf))
                card_layout.addWidget(bat_btn)
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
            self._clear_config_dirty()
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


    def _launch_plugin_bat(self, plugin_name, bat_file):
        """启动插件DLC目录下的bat文件，弹出独立cmd窗口"""
        dlc_path = os.path.join(get_base_path(), 'plugins-dlc', plugin_name)
        bat_path = os.path.join(dlc_path, bat_file)
        if not os.path.isfile(bat_path):
            QMessageBox.warning(self, '启动失败', f'找不到启动文件：{bat_path}')
            return
        import subprocess
        subprocess.Popen(
            [bat_path],
            cwd=os.path.dirname(bat_path),
            creationflags=subprocess.CREATE_NEW_CONSOLE
        )


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


    def refresh_plugin_market(self):
        RAW_URL = "https://raw.githubusercontent.com/morettt/my-neuro/main/live-2d/plugins/plugin-house/plugin_hub.json"
        print("开始刷新插件广场...")
        if getattr(self, "_plugin_market_loading", False):
            self.toast.show_message("插件广场正在加载中...", 1500)
            return

        self._plugin_market_loading = True
        self.toast.show_message("正在加载插件广场...", 1500)

        def _worker():
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
                self.plugin_market_loaded.emit(plugins)
            except Exception as e:
                self.plugin_market_failed.emit(str(e))

        Thread(target=_worker, daemon=True).start()


    def _on_plugin_market_loaded(self, plugins):
        self._plugin_market_loading = False
        self._display_plugin_market(plugins)
        self.toast.show_message(f"插件广场已加载，共 {len(plugins)} 个插件", 2000)


    def _on_plugin_market_failed(self, error):
        self._plugin_market_loading = False
        print(f"拉取插件列表失败: {error}")
        self.toast.show_message(f"获取插件列表失败: {error}", 3000)


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

        worker = _ZipInstallWorker(repo_url, target_dir)

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
        if not hasattr(self, '_install_workers'):
            self._install_workers = []
        self._install_workers.append(worker)
