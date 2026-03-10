#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 共享工具函数
提供各模块共享的工具函数和常量
"""

import os
import sys
import logging
from pathlib import Path

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.parent.absolute()

# WebUI 版本
WEBUI_VERSION = 'v2.0'

# 配置日志 - 使用 WARNING 级别减少输出
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# 关闭 Flask/Werkzeug 的默认日志
werkzeug_log = logging.getLogger('werkzeug')
werkzeug_log.setLevel(logging.ERROR)

# 服务状态跟踪（全局变量，供各模块使用）
service_processes = {}
service_pids = {}

# 日志文件路径配置
LOG_FILE_PATHS = {
    'pet': PROJECT_ROOT / 'live-2d' / 'runtime.log',
    'tool': PROJECT_ROOT / 'live-2d' / 'runtime.log',
}


def find_free_port():
    """查找可用端口"""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


def is_service_running(service):
    """检查服务是否正在运行
    
    由于所有服务都使用 CREATE_NEW_CONSOLE 启动，窗口标题都是 cmd.exe，
    无法通过 tasklist 可靠检测，因此只依赖 service_pids 标记。
    """
    return service_pids.get(service, False)