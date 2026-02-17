# webui_common.py - MemOS WebUI 公共模块（精简版）
# 只保留 API 函数和工具函数，不包含任何 CSS 或 UI 渲染代码

import requests
import json
import os
import tempfile
from datetime import datetime

# 尝试导入 pyvis（用于知识图谱可视化）
try:
    from pyvis.network import Network
    PYVIS_AVAILABLE = True
except ImportError:
    PYVIS_AVAILABLE = False

# API 配置
MEMOS_API_URL = "http://127.0.0.1:8003"

# 记忆类型中英文映射
MEMORY_TYPE_LABELS = {
    'general': '通用',
    'preference': '偏好',
    'fact': '事实',
    'semantic': '语义',
    'episodic': '情景',
    'procedural': '程序性',
    'document': '文档',
    'image': '图片',
    'tool': '工具'
}

# 记忆类型对应的 emoji
MEMORY_TYPE_EMOJI = {
    'general': '📝',
    'preference': '💜',
    'fact': '💡',
    'semantic': '🧠',
    'episodic': '📅',
    'procedural': '⚙️',
    'document': '📄',
    'image': '🖼️',
    'tool': '🔧'
}

def get_type_label(memory_type):
    """获取记忆类型的中文标签"""
    return MEMORY_TYPE_LABELS.get(memory_type, memory_type)

def get_type_emoji(memory_type):
    """获取记忆类型的 emoji"""
    return MEMORY_TYPE_EMOJI.get(memory_type, '📝')


# ═══════════════════════════════════════════════════════════════
#                        API 函数
# ═══════════════════════════════════════════════════════════════

def check_service_status():
    """检查服务状态"""
    try:
        response = requests.get(f"{MEMOS_API_URL}/health", timeout=2)
        return response.status_code == 200, response.json() if response.status_code == 200 else {}
    except:
        return False, {}

def api_get(endpoint, params=None, timeout=5):
    """GET 请求封装"""
    try:
        r = requests.get(f"{MEMOS_API_URL}{endpoint}", params=params, timeout=timeout)
        return r.json() if r.status_code == 200 else None
    except:
        return None

def api_post(endpoint, data=None, timeout=10):
    """POST 请求封装"""
    try:
        r = requests.post(f"{MEMOS_API_URL}{endpoint}", json=data, timeout=timeout)
        return r.status_code, r.json() if r.status_code == 200 else r.text
    except Exception as e:
        return 500, str(e)

def api_put(endpoint, data=None, timeout=10):
    """PUT 请求封装"""
    try:
        r = requests.put(f"{MEMOS_API_URL}{endpoint}", json=data, timeout=timeout)
        return r.status_code, r.json() if r.status_code == 200 else r.text
    except Exception as e:
        return 500, str(e)

def api_delete(endpoint, timeout=5):
    """DELETE 请求封装"""
    try:
        r = requests.delete(f"{MEMOS_API_URL}{endpoint}", timeout=timeout)
        return r.status_code == 200
    except:
        return False
