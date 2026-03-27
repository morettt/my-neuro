#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 主模块入口
导出 create_app 函数供外部使用
"""

from .main_app import create_app, run_app
from .utils import PROJECT_ROOT, logger

__version__ = '2.0.0'
__all__ = ['create_app', 'run_app', 'PROJECT_ROOT', 'logger']