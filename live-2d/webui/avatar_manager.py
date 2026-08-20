#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
皮套形态管理模块（avatar v2）
提供形态切换 / 各形态模型列表 / 模型选择的 WebUI API。

设计：桌宠运行中优先走 HTTP 3002 热接口（即时生效）；
桌宠未运行时直接写 config.json（下次启动生效）。
模型列表由本模块直接扫描文件系统（与 js/avatar/model-registry.js 同一目录约定），
不依赖桌宠在线。

注意：当前线上运行时仅接入 Live2D 与 VRM 两种形态
（main.js 的 SUPPORTED_AVATAR_TYPES 仅含这两项），
MMD / PNGTuber 尚未移植，故此处不开放，避免用户切换到无 driver 的形态。
"""

import json
import urllib.request
from flask import Blueprint, request, jsonify

from .utils import PROJECT_ROOT, logger

avatar_bp = Blueprint('avatar', __name__)

# 线上运行时仅支持这两种形态（与 main.js SUPPORTED_AVATAR_TYPES 对齐）
AVATAR_TYPES = ['live2d', 'vrm']
TYPE_CONFIG_KEYS = {
    'live2d': 'live2d_model',      # 模型目录名
    'vrm': 'vrm_model_path',       # 相对路径（3D/xx.vrm）
}
PET_BASE = 'http://localhost:3002'


def _pet_post(path, payload, timeout=8):
    """向运行中的桌宠发 POST；不可达返回 None"""
    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(f'{PET_BASE}{path}', data=data, method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        logger.info(f'桌宠接口不可达 {path}: {e}')
        return None


def _pet_running():
    try:
        req = urllib.request.Request(f'{PET_BASE}/plugins', method='GET')
        with urllib.request.urlopen(req, timeout=1.5):
            return True
    except Exception:
        return False


# ============ 模型扫描（与 js/avatar/model-registry.js 目录约定一致） ============

def _scan_live2d():
    """2D/<模型名>/**/*.model3.json -> 按目录名去重"""
    root = PROJECT_ROOT / '2D'
    results = []
    if not root.exists():
        return results
    for model_dir in sorted(root.iterdir()):
        if not model_dir.is_dir():
            continue
        if any(model_dir.rglob('*.model3.json')):
            results.append({'name': model_dir.name, 'value': model_dir.name})
    return results


def _scan_vrm():
    """3D/**/*.vrm（排除 3D/mmd）-> value 为相对路径"""
    root = PROJECT_ROOT / '3D'
    results = []
    if not root.exists():
        return results
    mmd_root = root / 'mmd'
    for vrm in sorted(root.rglob('*.vrm')):
        try:
            vrm.relative_to(mmd_root)
            continue  # 位于 3D/mmd 下，跳过
        except ValueError:
            pass
        rel = vrm.relative_to(PROJECT_ROOT).as_posix()
        results.append({'name': vrm.stem, 'value': rel})
    return results


_SCANNERS = {
    'live2d': _scan_live2d,
    'vrm': _scan_vrm,
}


# ============ API ============

@avatar_bp.route('/api/avatar/status', methods=['GET'])
def avatar_status():
    """当前形态 / 各形态已选模型 / 桌宠是否在线"""
    try:
        from .config_manager import load_config
        config = load_config()
        ui = config.get('ui') or {}
        selections = {t: ui.get(TYPE_CONFIG_KEYS[t], '') or '' for t in AVATAR_TYPES}
        return jsonify({
            'success': True,
            'model_type': (ui.get('model_type') or 'live2d').lower(),
            'selections': selections,
            'pet_running': _pet_running(),
        })
    except Exception as e:
        logger.error(f'读取皮套状态失败：{e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@avatar_bp.route('/api/avatar/models/<avatar_type>', methods=['GET'])
def avatar_models(avatar_type):
    """列出指定形态的可用模型（本地扫描，不依赖桌宠在线）"""
    t = (avatar_type or '').lower()
    scanner = _SCANNERS.get(t)
    if not scanner:
        return jsonify({'success': False, 'error': f'未知形态: {avatar_type}', 'models': []}), 400
    try:
        return jsonify({'success': True, 'models': scanner()})
    except Exception as e:
        logger.error(f'扫描 {t} 模型失败：{e}')
        return jsonify({'success': False, 'error': str(e), 'models': []}), 500


@avatar_bp.route('/api/avatar/type/save', methods=['POST'])
def save_avatar_type():
    """切换皮套形态：桌宠在线走热切换，离线写 config"""
    try:
        data = request.get_json() or {}
        t = (data.get('type') or '').lower()
        if t not in AVATAR_TYPES:
            return jsonify({'success': False, 'error': f'未知形态: {t}'}), 400

        result = _pet_post('/switch-avatar-type', {'type': t})
        if result is not None:
            if result.get('success'):
                hint = '（跨渲染引擎切换会自动重载窗口，约 20 秒）'
                return jsonify({'success': True, 'message': f'已切换到 {t} {hint}', 'hot': True})
            return jsonify({'success': False, 'error': result.get('message', '桌宠返回失败')})

        # 桌宠未运行：写 config
        from .config_manager import load_config, save_config
        config = load_config()
        if 'ui' not in config:
            config['ui'] = {}
        config['ui']['model_type'] = t
        if save_config(config):
            return jsonify({'success': True, 'message': f'已保存形态选择：{t}（启动桌宠后生效）', 'hot': False})
        return jsonify({'success': False, 'error': '保存配置失败'}), 500
    except Exception as e:
        logger.error(f'切换形态失败：{e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@avatar_bp.route('/api/avatar/model/save', methods=['POST'])
def save_avatar_model():
    """保存指定形态的模型选择：桌宠在线热应用，离线写 config"""
    try:
        data = request.get_json() or {}
        t = (data.get('type') or '').lower()
        model = data.get('model') or ''
        if t not in AVATAR_TYPES:
            return jsonify({'success': False, 'error': f'未知形态: {t}'}), 400
        if not model:
            return jsonify({'success': False, 'error': '未提供模型'}), 400

        result = _pet_post('/set-avatar-model', {'type': t, 'model_name': model})
        if result is not None:
            if result.get('success'):
                return jsonify({'success': True, 'message': result.get('message', f'已应用模型：{model}'), 'hot': True})
            return jsonify({'success': False, 'error': result.get('message', '桌宠返回失败')})

        # 桌宠未运行：写 config
        from .config_manager import load_config, save_config
        config = load_config()
        if 'ui' not in config:
            config['ui'] = {}
        config['ui'][TYPE_CONFIG_KEYS[t]] = model
        if save_config(config):
            return jsonify({'success': True, 'message': f'已保存模型选择：{model}（启动桌宠后生效）', 'hot': False})
        return jsonify({'success': False, 'error': '保存配置失败'}), 500
    except Exception as e:
        logger.error(f'保存模型选择失败：{e}')
        return jsonify({'success': False, 'error': str(e)}), 500
