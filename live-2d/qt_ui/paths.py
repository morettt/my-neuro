# -*- coding: utf-8 -*-
"""路径工具：兼容开发环境与打包后的 exe。

原 test.py 中的 get_base_path()/get_app_path() 依赖 __file__ 的相对位置，
本模块迁至 qt_ui/ 后通过 TEST_PY_DIR 锚点常量保持完全一致的路径语义。
"""
import os
import sys
from pathlib import Path


# 原 test.py 所在目录的锚点：本文件位于 <app>/qt_ui/paths.py，
# 向上两级即为原 test.py 所在目录；打包后 PyInstaller 保持相同相对结构。
TEST_PY_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_base_path():
    """获取程序基础路径，兼容开发环境和打包后的exe"""
    if getattr(sys, 'frozen', False):
        # 如果是打包后的exe，获取exe所在目录的上级目录
        exe_dir = os.path.dirname(sys.executable)
        return os.path.dirname(exe_dir)  # 返回上级目录
    else:
        # 如果是开发环境，返回Python文件所在目录的上级目录
        return os.path.dirname(TEST_PY_DIR)


def get_app_path():
    """获取程序运行的主目录，无论是开发环境还是打包后的exe"""
    if getattr(sys, 'frozen', False):
        # 如果是打包后的exe，获取exe所在的目录
        return os.path.dirname(sys.executable)
    else:
        # 如果是开发环境，返回Python文件所在的目录
        return TEST_PY_DIR


# 云端版本检测：tts-hub 不存在或内部无子文件夹则为云端版本
_tts_hub_path = Path(get_base_path()) / 'full-hub' / 'tts-hub'
IS_CLOUD_VERSION = not _tts_hub_path.is_dir() or not any(p.is_dir() for p in _tts_hub_path.iterdir())
