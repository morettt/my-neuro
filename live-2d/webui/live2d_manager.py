#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Live2D 设置管理模块
整合所有 Live2D 设置相关的 API，包括：
- 唱歌控制
- 模型配置
- 动作管理
- 表情管理
"""

import json
import urllib.request
import re
from flask import Blueprint, request, jsonify

from .utils import PROJECT_ROOT, logger

# 创建 Live2D 管理蓝图
live2d_bp = Blueprint('live2d', __name__)

# 固定的情绪分类键名
EMOTION_CATEGORIES = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮']


def get_current_model():
    """读取当前模型名称（v2：来源 config.ui.live2d_model；兼容旧版 main.js priorityFolders）"""
    try:
        from .config_manager import load_config
        config = load_config()
        name = (config.get('ui') or {}).get('live2d_model')
        if name:
            return name
    except Exception:
        pass
    # 旧版兼容：从 main.js 的 priorityFolders 读取（v2 已移除该机制）
    main_js_path = PROJECT_ROOT / 'main.js'
    if main_js_path.exists():
        content = main_js_path.read_text(encoding='utf-8')
        match = re.search(r"const priorityFolders = \['([^']+)'", content)
        if match:
            return match.group(1)
    return '肥牛'  # 默认角色


def load_emotion_actions():
    """加载 emotion_actions.json 配置"""
    config_path = PROJECT_ROOT / 'emotion_actions.json'
    if config_path.exists():
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_emotion_actions(data):
    """保存 emotion_actions.json 配置"""
    config_path = PROJECT_ROOT / 'emotion_actions.json'
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _read_json(path, default=None):
    try:
        if path.exists():
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        logger.warning(f'Failed to read JSON {path}: {e}')
    return {} if default is None else default


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _notify_runtime_config_reload():
    try:
        req = urllib.request.Request('http://localhost:3002/reload-config', data=b'{}', method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=1.5) as response:
            return response.status == 200
    except Exception as e:
        logger.warning(f'Failed to notify Live2D runtime config reload: {e}')
        return False


def _model_dir(model_name=None):
    return PROJECT_ROOT / '2D' / (model_name or get_current_model())


def _find_model_json(model_name=None):
    root = _model_dir(model_name)
    if not root.exists():
        return None
    matches = sorted(root.rglob('*.model3.json'))
    return matches[0] if matches else None


def _project_rel(path):
    try:
        return path.relative_to(PROJECT_ROOT).as_posix()
    except Exception:
        return str(path).replace('\\', '/')


def _sidecar_path(model_name=None):
    return _model_dir(model_name) / 'emotion_mapping.json'


def _read_model3(model_name=None):
    model_path = _find_model_json(model_name)
    if not model_path:
        return None, {}
    return model_path, _read_json(model_path, {})


def _model_rel(model_name, path, base=None):
    base = base or _model_dir(model_name)
    try:
        return path.relative_to(base).as_posix()
    except Exception:
        return str(path).replace('\\', '/')


def _friendly_name_from_file(path, suffix):
    name = path.rsplit('/', 1)[-1]
    if name.lower().endswith(suffix):
        name = name[:-len(suffix)]
    return name or path


def _looks_like_idle_motion(path):
    stem = path.rsplit('/', 1)[-1].lower()
    return any(token in stem for token in ('idle', '待机', 'standby', 'breath'))


def _model_motion_groups(model_name=None):
    model_name = model_name or get_current_model()
    model_path, model3 = _read_model3(model_name)
    asset_base = model_path.parent if model_path else _model_dir(model_name)
    motions = ((model3.get('FileReferences') or {}).get('Motions') or {})
    result = {}
    seen = set()
    for group, defs in motions.items():
        if not isinstance(defs, list):
            continue
        result[group] = []
        for index, item in enumerate(defs):
            if isinstance(item, dict) and item.get('File'):
                seen.add(item.get('File'))
                result[group].append({
                    'group': group,
                    'index': index,
                    'file': item.get('File'),
                    'source': 'model3'
                })
    for motion_path in sorted(_model_dir(model_name).rglob('*.motion3.json')):
        rel = _model_rel(model_name, motion_path, asset_base)
        if rel in seen:
            continue
        group = 'Idle' if _looks_like_idle_motion(rel) else 'TapBody'
        result.setdefault(group, [])
        result[group].append({
            'group': group,
            'index': len(result[group]),
            'file': rel,
            'source': 'scan'
        })
        seen.add(rel)
    return result


def _model_expression_files(model_name=None):
    model_name = model_name or get_current_model()
    model_path, model3 = _read_model3(model_name)
    asset_base = model_path.parent if model_path else _model_dir(model_name)
    expressions = ((model3.get('FileReferences') or {}).get('Expressions') or [])
    result = []
    seen = set()
    for index, item in enumerate(expressions):
        if isinstance(item, dict) and item.get('File'):
            seen.add(item.get('File'))
            result.append({
                'index': index,
                'name': item.get('Name') or f'expression{index + 1}',
                'file': item.get('File'),
                'source': 'model3'
            })
    for expr_path in sorted(_model_dir(model_name).rglob('*.exp3.json')):
        rel = _model_rel(model_name, expr_path, asset_base)
        if rel in seen:
            continue
        result.append({
            'index': len(result),
            'name': _friendly_name_from_file(rel, '.exp3.json'),
            'file': rel,
            'source': 'scan'
        })
        seen.add(rel)
    return result


def _asset_file_exists(model_name, rel_path):
    if not rel_path:
        return False
    rel = str(rel_path).replace('/', '\\')
    model_path = _find_model_json(model_name)
    candidates = []
    if model_path:
        candidates.append(model_path.parent / rel)
    candidates.append(_model_dir(model_name) / rel)
    try:
        return any(candidate.is_file() for candidate in candidates)
    except Exception:
        return False


def _filter_existing_files(config, model_name):
    result = {}
    if isinstance(config, dict):
        for key, files in config.items():
            if not isinstance(files, list):
                continue
            existing = [file for file in files if _asset_file_exists(model_name, file)]
            result[key] = existing
    return result


def _merge_unique(existing, additions):
    merged = list(existing or [])
    for item in additions or []:
        if item not in merged:
            merged.append(item)
    return merged


def _auto_motion_emotions(model_name):
    mapping = {
        '开心': ('开心', '高兴', 'happy'),
        '生气': ('生气', 'angry'),
        '难过': ('难过', '悲伤', 'sad'),
        '惊讶': ('惊讶', 'surprise'),
        '害羞': ('害羞', 'shy'),
        '俏皮': ('俏皮', 'playful')
    }
    result = _empty_emotion_map()
    for item in [motion for group in _model_motion_groups(model_name).values() for motion in group]:
        name = item['file'].lower()
        for emotion, tokens in mapping.items():
            if any(token.lower() in name for token in tokens):
                result[emotion].append(item['file'])
                break
    return result


def _auto_expression_emotions(model_name):
    mapping = {
        '开心': ('开心', '高兴', 'happy'),
        '生气': ('生气', 'angry'),
        '难过': ('难过', '悲伤', 'sad'),
        '惊讶': ('惊讶', 'surprise'),
        '害羞': ('害羞', 'shy'),
        '俏皮': ('俏皮', 'playful')
    }
    result = _empty_emotion_map()
    for item in _model_expression_files(model_name):
        name = item['file'].lower()
        for emotion, tokens in mapping.items():
            if any(token.lower() in name for token in tokens):
                result[emotion].append(item['file'])
                break
    return result


def _empty_emotion_map():
    return {emotion: [] for emotion in EMOTION_CATEGORIES}


def _legacy_actions(model_name):
    entry = load_emotion_actions().get(model_name, {})
    return entry.get('emotion_actions', {}) if isinstance(entry, dict) else {}


def _legacy_expressions(model_name):
    data = _read_json(PROJECT_ROOT / 'emotion_expressions.json', {})
    entry = data.get(model_name, {})
    return entry.get('emotion_expressions', {}) if isinstance(entry, dict) else {}


def _split_named_and_emotions(config):
    emotions = _empty_emotion_map()
    named = {}
    if isinstance(config, dict):
        for key, files in config.items():
            if not isinstance(files, list):
                continue
            if key in EMOTION_CATEGORIES:
                emotions[key] = files
            else:
                named[key] = files
    return emotions, named


def _default_motion_names(model_name):
    named = {}
    motion_groups = _model_motion_groups(model_name)
    tap = motion_groups.get('TapBody') or []
    fallback = tap or [item for group in motion_groups.values() for item in group]
    for index, item in enumerate(fallback, start=1):
        named.setdefault(f'动作{index}', [item['file']])
    return named


def _default_expression_names(model_name):
    named = {}
    for index, item in enumerate(_model_expression_files(model_name), start=1):
        named.setdefault(f'表情{index}', [item['file']])
    return named


def _read_profile(model_name=None):
    """Return the merged Live2D emotion/motion/expression profile for WebUI."""
    model_name = model_name or get_current_model()
    model_path, _ = _read_model3(model_name)
    sidecar = _read_json(_sidecar_path(model_name), None)

    motion_emotions = _empty_emotion_map()
    expression_emotions = _empty_emotion_map()
    named_motions = {}
    named_expressions = {}
    idle_group = 'Idle'
    idle_expression = ''

    using_sidecar = isinstance(sidecar, dict) and bool(sidecar)
    if using_sidecar:
        for emotion, entry in (sidecar.get('emotions') or {}).items():
            if isinstance(entry, dict):
                if isinstance(entry.get('motions'), list):
                    motion_emotions[emotion] = entry.get('motions')
                if isinstance(entry.get('expressions'), list):
                    expression_emotions[emotion] = entry.get('expressions')
        for key, files in (sidecar.get('actions') or {}).items():
            if isinstance(files, list):
                named_motions[key] = files
        for key, files in (sidecar.get('expressions_named') or {}).items():
            if isinstance(files, list):
                named_expressions[key] = files
        idle_config = sidecar.get('idle') or {}
        if 'group' in idle_config:
            idle_group = idle_config.get('group') or ''
        idle_expression = idle_config.get('expression') or ''
    else:
        motion_emotions, named_motions = _split_named_and_emotions(_legacy_actions(model_name))
        expression_emotions, named_expressions = _split_named_and_emotions(_legacy_expressions(model_name))

    motion_emotions = _filter_existing_files(motion_emotions, model_name)
    expression_emotions = _filter_existing_files(expression_emotions, model_name)
    named_motions = _filter_existing_files(named_motions, model_name)
    named_expressions = _filter_existing_files(named_expressions, model_name)
    if idle_expression and not _asset_file_exists(model_name, idle_expression):
        idle_expression = ''

    auto_motion_emotions = _auto_motion_emotions(model_name)
    auto_expression_emotions = _auto_expression_emotions(model_name)
    for emotion in EMOTION_CATEGORIES:
        motion_emotions[emotion] = _merge_unique(motion_emotions.get(emotion, []), auto_motion_emotions.get(emotion, []))
        expression_emotions[emotion] = _merge_unique(
            expression_emotions.get(emotion, []),
            auto_expression_emotions.get(emotion, [])
        )

    for key, files in _default_motion_names(model_name).items():
        named_motions.setdefault(key, files)
    for key, files in _default_expression_names(model_name).items():
        named_expressions.setdefault(key, files)

    motion_groups = _model_motion_groups(model_name)
    idle_defs = motion_groups.get(idle_group) or [] if idle_group else []
    if idle_group and not idle_defs and motion_groups:
        first_group = next(iter(motion_groups.keys()))
        idle_group = first_group
        idle_defs = motion_groups.get(first_group) or []

    return {
        'model_name': model_name,
        'model_path': _project_rel(model_path) if model_path else '',
        'using_sidecar': using_sidecar,
        'sidecar_path': _project_rel(_sidecar_path(model_name)),
        'motion_emotions': motion_emotions,
        'expression_emotions': expression_emotions,
        'named_motions': named_motions,
        'named_expressions': named_expressions,
        'motion_groups': motion_groups,
        'expressions': _model_expression_files(model_name),
        'idle': {
            'group': idle_group,
            'motions': idle_defs,
            'file': idle_defs[0]['file'] if idle_defs else '',
            'expression': idle_expression
        }
    }


def _write_profile(model_name, motion_emotions=None, expression_emotions=None, idle_group=None,
                   idle_expression=None,
                   named_motions=None, named_expressions=None):
    profile = _read_profile(model_name)
    motion_emotions = motion_emotions if motion_emotions is not None else profile['motion_emotions']
    expression_emotions = expression_emotions if expression_emotions is not None else profile['expression_emotions']
    idle_group = idle_group if idle_group is not None else profile['idle']['group']
    idle_expression = idle_expression if idle_expression is not None else profile['idle'].get('expression', '')

    sidecar = _read_json(_sidecar_path(model_name), {})
    if not isinstance(sidecar, dict):
        sidecar = {}
    sidecar['emotions'] = sidecar.get('emotions') if isinstance(sidecar.get('emotions'), dict) else {}
    for emotion in EMOTION_CATEGORIES:
        entry = sidecar['emotions'].get(emotion)
        if not isinstance(entry, dict):
            entry = {}
        entry['motions'] = motion_emotions.get(emotion, [])
        entry['expressions'] = expression_emotions.get(emotion, [])
        sidecar['emotions'][emotion] = entry
    sidecar['actions'] = named_motions if named_motions is not None else profile['named_motions']
    sidecar['expressions_named'] = named_expressions if named_expressions is not None else profile['named_expressions']
    sidecar['idle'] = sidecar.get('idle') if isinstance(sidecar.get('idle'), dict) else {}
    sidecar['idle']['group'] = idle_group if idle_group is not None else 'Idle'
    sidecar['idle']['expression'] = idle_expression or ''
    _write_json(_sidecar_path(model_name), sidecar)


@live2d_bp.route('/api/live2d/preview/info', methods=['GET'])
def get_preview_info():
    """Preview workbench metadata for the current Live2D model."""
    try:
        profile = _read_profile()
        return jsonify({'success': True, **profile})
    except Exception as e:
        logger.error(f'Failed to build Live2D preview info: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@live2d_bp.route('/api/live2d/idle/config', methods=['GET'])
def get_idle_config():
    try:
        profile = _read_profile()
        return jsonify({
            'success': True,
            'idle': profile['idle'],
            'motion_groups': profile['motion_groups'],
            'expressions': profile['expressions']
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@live2d_bp.route('/api/live2d/idle/save', methods=['POST'])
def save_idle_config():
    try:
        data = request.get_json() or {}
        group = data.get('group')
        if group is None:
            group = 'Idle'
        expression = data.get('expression') or ''
        model_name = get_current_model()
        profile = _read_profile(model_name)
        if group and group not in profile['motion_groups']:
            return jsonify({'success': False, 'error': f'Unknown motion group: {group}'}), 400
        if expression and not _asset_file_exists(model_name, expression):
            return jsonify({'success': False, 'error': f'Unknown expression file: {expression}'}), 400
        _write_profile(model_name, idle_group=group, idle_expression=expression)
        runtime_reloaded = _notify_runtime_config_reload()
        return jsonify({
            'success': True,
            'message': 'Idle motion saved',
            'idle': _read_profile(model_name)['idle'],
            'runtime_reloaded': runtime_reloaded
        })
    except Exception as e:
        logger.error(f'Failed to save idle config: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ 唱歌控制 ============

@live2d_bp.route('/api/live2d/singing/start', methods=['POST'])
def start_singing():
    """开始唱歌"""
    try:
        json_data = json.dumps({'action': 'trigger_emotion', 'emotion_name': '唱歌'}).encode('utf-8')
        req = urllib.request.Request('http://localhost:3002/control-motion', data=json_data, method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=2) as response:
            if response.status == 200:
                return jsonify({'success': True, 'message': '已开始唱歌'})
        return jsonify({'success': True, 'message': '唱歌请求已发送'})
    except Exception as e:
        logger.warning(f'开始唱歌 HTTP 请求失败：{e}')
        return jsonify({'success': True, 'message': '唱歌请求已发送'})


@live2d_bp.route('/api/live2d/singing/stop', methods=['POST'])
def stop_singing():
    """停止唱歌"""
    try:
        json_data = json.dumps({'action': 'trigger_emotion', 'emotion_name': '停止'}).encode('utf-8')
        req = urllib.request.Request('http://localhost:3002/control-motion', data=json_data, method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=2) as response:
            if response.status == 200:
                return jsonify({'success': True, 'message': '已停止唱歌'})
        return jsonify({'success': True, 'message': '停止请求已发送'})
    except Exception as e:
        logger.warning(f'停止唱歌 HTTP 请求失败：{e}')
        return jsonify({'success': True, 'message': '停止请求已发送'})


# ============ 模型配置 ============

@live2d_bp.route('/api/live2d/model/save', methods=['POST'])
def save_live2d_model():
    """保存 Live2D 模型选择（v2：模型选择由 config.ui.live2d_model 驱动，不再改写 main.js）"""
    try:
        data = request.get_json()
        model_name = data.get('model', '')

        if not model_name:
            return jsonify({'success': False, 'error': '未提供模型名称'})

        # 优先通知运行中的桌宠热切换（会同时把选择持久化到 config.ui.live2d_model）
        try:
            payload = json.dumps({'model_name': model_name, 'model_type': 'live2d'}).encode('utf-8')
            req = urllib.request.Request(
                'http://localhost:3002/switch-model', data=payload, method='POST')
            req.add_header('Content-Type', 'application/json')
            with urllib.request.urlopen(req, timeout=5) as resp:
                result = json.loads(resp.read().decode('utf-8'))
            if result.get('success'):
                logger.info(f'已热切换当前模型为：{model_name}')
                return jsonify({'success': True, 'message': f'已应用模型：{model_name}'})
            logger.warning(f'桌宠热切换返回失败：{result}')
        except Exception as e:
            logger.info(f'桌宠未运行或热切换失败（{e}），直接写入 config')

        # 桌宠未运行时：直接写 config.ui.live2d_model，下次启动生效
        from .config_manager import load_config, save_config
        config = load_config()
        if 'ui' not in config:
            config['ui'] = {}
        config['ui']['live2d_model'] = model_name
        if save_config(config):
            return jsonify({'success': True, 'message': f'已保存模型选择：{model_name}（启动桌宠后生效）'})
        return jsonify({'success': False, 'error': '保存配置失败'}), 500
    except Exception as e:
        logger.error(f'保存模型失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


@live2d_bp.route('/api/live2d/model/position/save', methods=['POST'])
def save_model_position():
    """保存 Live2D 模型位置"""
    try:
        from .config_manager import load_config, save_config

        data = request.get_json()
        x = data.get('x')
        y = data.get('y')

        config = load_config()
        if 'ui' not in config:
            config['ui'] = {}
        if 'model_position' not in config['ui']:
            config['ui']['model_position'] = {}

        config['ui']['model_position']['x'] = x
        config['ui']['model_position']['y'] = y
        config['ui']['model_position']['remember_position'] = True

        if save_config(config):
            return jsonify({'success': True, 'message': '皮套位置已保存，请重启桌宠生效'})
        return jsonify({'error': '保存失败'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@live2d_bp.route('/api/live2d/model/reset-position', methods=['POST'])
def reset_model_position():
    """复位 Live2D 模型位置到默认值"""
    try:
        from .config_manager import load_config, save_config

        config = load_config()

        if 'ui' not in config:
            config['ui'] = {}
        if 'model_position' not in config['ui']:
            config['ui']['model_position'] = {}

        config['ui']['model_position']['x'] = None
        config['ui']['model_position']['y'] = None
        config['ui']['model_position']['remember_position'] = True

        if save_config(config):
            return jsonify({'success': True, 'message': '皮套位置已保存，请重启桌宠生效'})
        return jsonify({'error': '保存失败'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ 字幕位置调整 ============

@live2d_bp.route('/api/live2d/subtitle/adjust-position', methods=['POST'])
def adjust_subtitle_position():
    """让桌宠进入字幕调整模式（需要桌宠正在运行）"""
    try:
        req = urllib.request.Request('http://localhost:3002/adjust-subtitle-position', data=b'{}', method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=2) as response:
            result = json.loads(response.read().decode('utf-8'))
        if result.get('success'):
            return jsonify({'success': True, 'message': '已进入字幕调整模式，请到桌宠窗口拖动调整'})
        return jsonify({'success': False, 'error': result.get('message', '进入调整模式失败，请重启桌宠后再试')})
    except Exception as e:
        logger.warning(f'进入字幕调整模式失败：{e}')
        return jsonify({'success': False, 'error': '无法连接桌宠，请先启动桌宠'})


@live2d_bp.route('/api/live2d/subtitle/reset-position', methods=['POST'])
def reset_subtitle_position():
    """复位字幕位置：桌宠运行中则实时复位，否则直接清除配置"""
    # 优先通知运行中的桌宠实时复位（渲染端会同步清除 config.json 中的配置）
    try:
        req = urllib.request.Request('http://localhost:3002/reset-subtitle-position', data=b'{}', method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=2) as response:
            result = json.loads(response.read().decode('utf-8'))
        if result.get('success'):
            return jsonify({'success': True, 'message': '字幕位置已复位'})
    except Exception as e:
        logger.warning(f'实时复位字幕失败，回退为直接清除配置：{e}')

    # 桌宠未运行：直接清除 config.json 中保存的字幕位置
    try:
        from .config_manager import load_config, save_config

        config = load_config()
        if 'ui' in config and 'subtitle_position' in config['ui']:
            config['ui'].pop('subtitle_position', None)
            if not save_config(config):
                return jsonify({'error': '保存失败'}), 500
        return jsonify({'success': True, 'message': '字幕位置已复位，重启桌宠后生效'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ 动作管理 ============

@live2d_bp.route('/api/live2d/motions/categorized', methods=['GET'])
def get_categorized_motions():
    """获取已分类的动作列表（返回情绪分类及其绑定的文件路径）"""
    try:
        categorized = _read_profile()['motion_emotions']

        return jsonify({'success': True, 'categorized': categorized})
    except Exception as e:
        logger.error(f'获取已分类动作失败：{str(e)}')
        return jsonify({'success': True, 'categorized': {}})


@live2d_bp.route('/api/live2d/motions/uncategorized', methods=['GET'])
def get_uncategorized_motions():
    """获取未分类的动作列表（返回键名和文件路径的映射）"""
    try:
        motion_map = {}
        for key, motions in _read_profile()['named_motions'].items():
            if motions:
                motion_map[key] = motions[0]

        return jsonify({'success': True, 'motions': motion_map})
    except Exception as e:
        logger.error(f'获取动作列表失败：{str(e)}')
        return jsonify({'success': True, 'motions': {}})


@live2d_bp.route('/api/live2d/motions/save', methods=['POST'])
def save_motions_config():
    """保存动作配置"""
    try:
        data = request.get_json()
        categories = data.get('categories', [])
        model_name = get_current_model()

        motion_emotions = _read_profile(model_name)['motion_emotions']
        for category in categories:
            name = category.get('name')
            motions = category.get('motions', [])

            if name in EMOTION_CATEGORIES:
                motion_emotions[name] = motions

        _write_profile(model_name, motion_emotions=motion_emotions)
        logger.info(f'已保存动作配置（模型：{model_name}）')

        return jsonify({'success': True, 'message': '动作配置已保存'})
    except Exception as e:
        logger.error(f'保存动作配置失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


@live2d_bp.route('/api/live2d/motion/reset', methods=['POST'])
def reset_motion_config():
    """复位动作配置（从备份恢复）"""
    try:
        model_name = get_current_model()
        backup_path = PROJECT_ROOT / 'character_backups.json'
        config_path = PROJECT_ROOT / 'emotion_actions.json'

        if backup_path.exists():
            with open(backup_path, 'r', encoding='utf-8') as f:
                backup = json.load(f)

            # 读取现有配置（保留其他模型的数据）
            existing_config = load_emotion_actions()

            # 从备份中提取当前模型的动作配置
            if model_name in backup:
                model_backup = backup[model_name]
                if 'original_config' in model_backup:
                    emotion_actions = model_backup['original_config'].get('emotion_actions', {})
                    existing_config[model_name] = {
                        'emotion_actions': emotion_actions
                    }
                else:
                    existing_config[model_name] = model_backup

                save_emotion_actions(existing_config)
                reset_actions = existing_config.get(model_name, {}).get('emotion_actions', {})
                motion_emotions, named_motions = _split_named_and_emotions(reset_actions)
                _write_profile(model_name, motion_emotions=motion_emotions, named_motions=named_motions)
                logger.info(f'动作配置已从备份恢复（模型：{model_name}）')
                return jsonify({'success': True, 'message': '动作配置已重置'})
            else:
                logger.warning(f'备份中没有模型 {model_name} 的数据')
                return jsonify({'success': False, 'error': '备份中没有该模型的数据'})
        else:
            logger.error(f'备份文件不存在：{backup_path}')
            return jsonify({'success': False, 'error': '备份文件不存在'})
    except Exception as e:
        logger.error(f'重置动作配置失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


@live2d_bp.route('/api/live2d/motion/preview', methods=['POST'])
def preview_motion():
    """预览动作"""
    try:
        data = request.get_json()
        motion_name = data.get('motion', '')

        if not motion_name:
            return jsonify({'success': False, 'error': '未提供动作名称'})

        # 使用 trigger_emotion action 来触发情绪对应的动作
        json_data = json.dumps({
            'action': 'trigger_emotion',
            'emotion_name': motion_name
        }).encode('utf-8')
        req = urllib.request.Request('http://localhost:3002/control-motion', data=json_data, method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=2) as response:
            if response.status == 200:
                return jsonify({'success': True, 'message': f'正在预览动作：{motion_name}'})

        return jsonify({'success': True, 'message': f'预览请求已发送：{motion_name}'})
    except Exception as e:
        logger.error(f'预览动作失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ 表情管理 ============

def get_current_model_for_expressions():
    """从 main.js 读取当前模型名称（用于表情配置）"""
    return get_current_model()


@live2d_bp.route('/api/live2d/expressions/config', methods=['GET'])
def get_expressions_config():
    """获取 Live2D 表情配置（从 emotion_expressions.json 读取当前模型的配置）"""
    try:
        profile = _read_profile(get_current_model_for_expressions())
        available_expressions = {}
        for key, files in profile['named_expressions'].items():
            if files:
                available_expressions[key] = files[0]
        return jsonify({
            'expressions': profile['expression_emotions'],
            'available_expressions': available_expressions
        })
    except Exception as e:
        logger.error(f'获取表情配置失败：{str(e)}')
        return jsonify({'error': str(e)}), 500


@live2d_bp.route('/api/live2d/expressions/save', methods=['POST'])
def save_expressions():
    """保存 Live2D 表情配置到 emotion_expressions.json"""
    try:
        data = request.get_json()
        expressions = data.get('expressions', {})
        current_model = get_current_model_for_expressions()
        expression_emotions = _read_profile(current_model)['expression_emotions']
        for emotion in EMOTION_CATEGORIES:
            if emotion in expressions:
                expression_emotions[emotion] = expressions[emotion]
        _write_profile(current_model, expression_emotions=expression_emotions)
        
        logger.info(f'已保存表情配置（模型：{current_model}）')
        return jsonify({'success': True, 'message': '表情配置已保存'})
    except Exception as e:
        logger.error(f'保存表情配置失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


@live2d_bp.route('/api/live2d/expressions/reset', methods=['POST'])
def reset_expressions():
    """重置 Live2D 表情配置（从 character_backups.json 恢复）"""
    try:
        # 获取当前模型
        current_model = get_current_model_for_expressions()
        
        backup_path = PROJECT_ROOT / 'character_backups.json'
        config_path = PROJECT_ROOT / 'emotion_expressions.json'
        
        if backup_path.exists():
            with open(backup_path, 'r', encoding='utf-8') as f:
                backup = json.load(f)
            
            # 读取现有配置（保留其他模型的数据）
            existing_config = {}
            if config_path.exists():
                with open(config_path, 'r', encoding='utf-8') as f:
                    existing_config = json.load(f)
            
            # 从备份中提取当前模型的表情配置
            if current_model in backup:
                model_backup = backup[current_model]
                if 'original_config' in model_backup:
                    emotion_expressions = model_backup['original_config'].get('emotion_expressions', {})
                    existing_config[current_model] = {
                        'emotion_expressions': emotion_expressions
                    }
                else:
                    # 兼容旧格式
                    existing_config[current_model] = model_backup
                
                # 保存配置
                with open(config_path, 'w', encoding='utf-8') as f:
                    json.dump(existing_config, f, indent=2, ensure_ascii=False)
                reset_expressions_data = existing_config.get(current_model, {}).get('emotion_expressions', {})
                expression_emotions, named_expressions = _split_named_and_emotions(reset_expressions_data)
                _write_profile(
                    current_model,
                    expression_emotions=expression_emotions,
                    named_expressions=named_expressions
                )
                
                logger.info(f'表情配置已从备份恢复（模型：{current_model}）')
                return jsonify({'success': True, 'message': '表情配置已重置'})
            else:
                logger.warning(f'备份中没有模型 {current_model} 的数据')
                return jsonify({'success': False, 'error': '备份中没有该模型的数据'})
        else:
            logger.error(f'备份文件不存在：{backup_path}')
            return jsonify({'success': False, 'error': '备份文件不存在'})
    except Exception as e:
        logger.error(f'重置表情配置失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


@live2d_bp.route('/api/live2d/expression/preview', methods=['POST'])
def preview_expression():
    """预览表情"""
    try:
        data = request.get_json()
        expression = data.get('expression', '')

        if not expression:
            return jsonify({'success': False, 'error': '未提供表情名称'})

        json_data = json.dumps({
            'action': 'trigger_expression',
            'expression_name': expression
        }).encode('utf-8')
        req = urllib.request.Request('http://localhost:3002/control-expression', data=json_data, method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=2) as response:
            if response.status == 200:
                return jsonify({'success': True, 'message': f'正在预览表情：{expression}'})

        return jsonify({'success': True, 'message': f'预览请求已发送：{expression}'})
    except Exception as e:
        logger.error(f'预览表情失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500
