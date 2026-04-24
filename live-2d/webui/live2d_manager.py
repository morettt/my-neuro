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
    """从 main.js 读取当前模型名称"""
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
    """保存 Live2D 模型选择"""
    try:
        data = request.get_json()
        model_name = data.get('model', '')

        if not model_name:
            return jsonify({'success': False, 'error': '未提供模型名称'})

        main_js_path = PROJECT_ROOT / 'main.js'
        if main_js_path.exists():
            with open(main_js_path, 'r', encoding='utf-8') as f:
                main_content = f.read()

            # 将选中的模型放在第一位
            new_priority = f"const priorityFolders = ['{model_name}', 'Hiyouri', 'Default', 'Main']"
            main_content = re.sub(r"const priorityFolders = \[.*?\]", new_priority, main_content)

            with open(main_js_path, 'w', encoding='utf-8') as f:
                f.write(main_content)

            logger.info(f'已设置当前模型为：{model_name}')
            return jsonify({'success': True, 'message': f'已应用模型：{model_name}'})
        else:
            logger.error(f'main.js 不存在：{main_js_path}')
            return jsonify({'success': False, 'error': 'main.js 文件不存在'})
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


# ============ 动作管理 ============

@live2d_bp.route('/api/live2d/motions/categorized', methods=['GET'])
def get_categorized_motions():
    """获取已分类的动作列表（返回情绪分类及其绑定的文件路径）"""
    try:
        current_model = get_current_model()
        all_data = load_emotion_actions()

        categorized = {}
        if current_model in all_data:
            emotion_actions = all_data[current_model].get('emotion_actions', {})
            for emotion in EMOTION_CATEGORIES:
                if emotion in emotion_actions:
                    categorized[emotion] = emotion_actions[emotion]

        return jsonify({'success': True, 'categorized': categorized})
    except Exception as e:
        logger.error(f'获取已分类动作失败：{str(e)}')
        return jsonify({'success': True, 'categorized': {}})


@live2d_bp.route('/api/live2d/motions/uncategorized', methods=['GET'])
def get_uncategorized_motions():
    """获取未分类的动作列表（返回键名和文件路径的映射）"""
    try:
        current_model = get_current_model()
        all_data = load_emotion_actions()

        motion_map = {}
        if current_model in all_data:
            emotion_actions = all_data[current_model].get('emotion_actions', {})
            for key, motions in emotion_actions.items():
                if key not in EMOTION_CATEGORIES and motions:
                    motion_map[key] = motions[0]  # 取第一个文件路径

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

        # 读取现有配置
        all_data = load_emotion_actions()

        # 初始化当前模型的数据
        if model_name not in all_data:
            all_data[model_name] = {}
        if 'emotion_actions' not in all_data[model_name]:
            all_data[model_name]['emotion_actions'] = {}

        # 更新情绪分类
        for category in categories:
            name = category.get('name')
            emotion = category.get('emotion')
            motions = category.get('motions', [])

            if name in EMOTION_CATEGORIES:
                all_data[model_name]['emotion_actions'][name] = motions

        save_emotion_actions(all_data)
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
    main_js_path = PROJECT_ROOT / 'main.js'
    if main_js_path.exists():
        content = main_js_path.read_text(encoding='utf-8')
        match = re.search(r"const priorityFolders = \['([^']+)'", content)
        if match:
            return match.group(1)
    return '肥牛'  # 默认角色


@live2d_bp.route('/api/live2d/expressions/config', methods=['GET'])
def get_expressions_config():
    """获取 Live2D 表情配置（从 emotion_expressions.json 读取当前模型的配置）"""
    try:
        config_path = PROJECT_ROOT / 'emotion_expressions.json'
        
        # 获取当前模型
        current_model = get_current_model_for_expressions()
        
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                all_data = json.load(f)
            
            if current_model in all_data:
                model_data = all_data[current_model]
                emotion_expressions = model_data.get('emotion_expressions', {})
                
                # 分离情绪分类和可用表情
                expressions = {}
                available_expressions = {}
                
                for key, files in emotion_expressions.items():
                    if key in ['开心', '生气', '难过', '惊讶', '害羞', '俏皮']:
                        expressions[key] = files
                    else:
                        # 自定义表情（如"表情 1"）放入 available_expressions
                        if files:
                            available_expressions[key] = files[0]
                
                return jsonify({
                    'expressions': expressions,
                    'available_expressions': available_expressions
                })
        
        return jsonify({'expressions': {}, 'available_expressions': {}})
    except Exception as e:
        logger.error(f'获取表情配置失败：{str(e)}')
        return jsonify({'error': str(e)}), 500


@live2d_bp.route('/api/live2d/expressions/save', methods=['POST'])
def save_expressions():
    """保存 Live2D 表情配置到 emotion_expressions.json"""
    try:
        data = request.get_json()
        expressions = data.get('expressions', {})
        
        # 获取当前模型
        current_model = get_current_model_for_expressions()
        
        # 读取现有配置
        config_path = PROJECT_ROOT / 'emotion_expressions.json'
        all_data = {}
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                all_data = json.load(f)
        
        # 初始化当前模型的数据
        if current_model not in all_data:
            all_data[current_model] = {}
        if 'emotion_expressions' not in all_data[current_model]:
            all_data[current_model]['emotion_expressions'] = {}
        
        # 合并情绪分类和自定义表情
        emotion_categories = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮']
        
        # 保存情绪分类
        for emotion in emotion_categories:
            if emotion in expressions:
                all_data[current_model]['emotion_expressions'][emotion] = expressions[emotion]
        
        # 保存自定义表情（从 available_expressions 或 expressions 中提取）
        available_expressions = data.get('available_expressions', {})
        for key, files in expressions.items():
            if key not in emotion_categories and files:
                all_data[current_model]['emotion_expressions'][key] = files
        
        # 保存额外提供的 available_expressions
        for key, files in available_expressions.items():
            if isinstance(files, str):
                files = [files]
            all_data[current_model]['emotion_expressions'][key] = files
        
        # 保存配置
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(all_data, f, indent=2, ensure_ascii=False)
        
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


# ============ 显示器管理 ============

@live2d_bp.route('/api/live2d/display/list', methods=['GET'])
def get_display_list():
    """获取显示器列表（转发到 Electron）"""
    try:
        req = urllib.request.Request('http://localhost:3002/get-displays', method='GET')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode('utf-8'))
            return jsonify(data)
    except urllib.error.URLError:
        logger.warning('获取显示器列表失败：Electron 服务未启动')
        return jsonify({'success': False, 'displays': [], 'error': 'Electron 服务未启动'})
    except Exception as e:
        logger.warning(f'获取显示器列表失败：{e}')
        return jsonify({'success': False, 'displays': [], 'error': str(e)})


@live2d_bp.route('/api/live2d/display/switch', methods=['POST'])
def switch_display():
    """切换显示器（转发到 Electron）"""
    try:
        data = request.get_json()
        display_index = data.get('display_index', 0)
        
        json_data = json.dumps({'display_index': display_index}).encode('utf-8')
        req = urllib.request.Request('http://localhost:3002/switch-display', data=json_data, method='POST')
        req.add_header('Content-Type', 'application/json')
        
        with urllib.request.urlopen(req, timeout=3) as response:
            result = json.loads(response.read().decode('utf-8'))
            return jsonify(result)
    except urllib.error.URLError:
        logger.warning('切换显示器失败：Electron 服务未启动')
        return jsonify({'success': False, 'error': 'Electron 服务未启动'})
    except Exception as e:
        logger.error(f'切换显示器失败：{e}')
        return jsonify({'success': False, 'error': str(e)})
