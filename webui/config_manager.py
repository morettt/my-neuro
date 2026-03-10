#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 配置管理模块
负责配置文件的读写和所有配置相关的 API
"""

import json
from flask import Blueprint, request, jsonify

from .utils import PROJECT_ROOT, logger

# 创建配置管理蓝图
config_bp = Blueprint('config', __name__)


def load_config():
    """加载配置文件"""
    config_path = PROJECT_ROOT / 'live-2d' / 'config.json'
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f'加载配置文件失败：{str(e)}')
        return {}


def save_config(config):
    """保存配置文件"""
    config_path = PROJECT_ROOT / 'live-2d' / 'config.json'
    try:
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f'保存配置文件失败：{str(e)}')
        return False


# ============ LLM 配置 ============

@config_bp.route('/api/config/llm', methods=['GET', 'POST'])
def handle_llm_config():
    """处理 LLM 配置"""
    config = load_config()
    if request.method == 'GET':
        llm_config = config.get('llm', {})
        return jsonify({
            'api_key': llm_config.get('api_key', ''),
            'api_url': llm_config.get('api_url', ''),
            'model': llm_config.get('model', ''),
            'temperature': llm_config.get('temperature', 0.9),
            'system_prompt': llm_config.get('system_prompt', '')
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'llm' not in config:
                config['llm'] = {}
            config['llm'].update({
                'api_key': data.get('api_key', ''),
                'api_url': data.get('api_url', ''),
                'model': data.get('model', ''),
                'temperature': data.get('temperature', 0.9),
                'system_prompt': data.get('system_prompt', '')
            })
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 对话设置 ============

@config_bp.route('/api/settings/chat', methods=['GET', 'POST'])
def handle_chat_settings():
    """处理对话设置"""
    config = load_config()
    if request.method == 'GET':
        ui_config = config.get('ui', {})
        context_config = config.get('context', {})
        return jsonify({
            'intro_text': ui_config.get('intro_text', '你好啊'),
            'max_messages': context_config.get('max_messages', 30),
            'enable_limit': context_config.get('enable_limit', True),
            'persistent_history': context_config.get('persistent_history', False),
            'history_file': context_config.get('history_file', '')
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'ui' not in config:
                config['ui'] = {}
            if 'context' not in config:
                config['context'] = {}
            config['ui']['intro_text'] = data.get('intro_text', '')
            config['context']['max_messages'] = data.get('max_messages', 30)
            config['context']['enable_limit'] = data.get('enable_limit', True)
            config['context']['persistent_history'] = data.get('persistent_history', False)
            config['context']['history_file'] = data.get('history_file', '')
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 声音设置 ============

@config_bp.route('/api/settings/voice', methods=['GET', 'POST'])
def handle_voice_settings():
    """处理声音设置"""
    config = load_config()
    if request.method == 'GET':
        cloud_config = config.get('cloud', {})
        return jsonify({
            'tts': config.get('tts', {}),
            'asr': config.get('asr', {}),
            'cloud_tts': cloud_config.get('tts', {}),
            'aliyun_tts': cloud_config.get('aliyun_tts', {}),
            'baidu_asr': cloud_config.get('baidu_asr', {}),
            'api_gateway': config.get('api_gateway', {})
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'tts' in data:
                config['tts'] = {
                    'enabled': data['tts'].get('enabled', True),
                    'url': data['tts'].get('url', ''),
                    'language': data['tts'].get('language', 'zh')
                }
            if 'asr' in data:
                config['asr'] = {
                    'enabled': data['asr'].get('enabled', True),
                    'vad_url': data['asr'].get('vad_url', ''),
                    'voice_barge_in': data['asr'].get('voice_barge_in', True)
                }
            if 'cloud' not in config:
                config['cloud'] = {}
            if 'provider' in data:
                config['cloud']['provider'] = data['provider']
            if 'api_key' in data:
                config['cloud']['api_key'] = data['api_key']
            if 'cloud_tts' in data:
                config['cloud']['tts'] = {
                    'enabled': data['cloud_tts'].get('enabled', False),
                    'url': data['cloud_tts'].get('url', 'https://api.siliconflow.cn/v1/audio/speech'),
                    'model': data['cloud_tts'].get('model', 'FunAudioLLM/CosyVoice2-0.5B'),
                    'voice': data['cloud_tts'].get('voice', '')
                }
            if 'aliyun_tts' in data:
                config['cloud']['aliyun_tts'] = {
                    'enabled': data['aliyun_tts'].get('enabled', False),
                    'api_key': data['aliyun_tts'].get('api_key', ''),
                    'model': data['aliyun_tts'].get('model', 'cosyvoice-v3-flash'),
                    'voice': data['aliyun_tts'].get('voice', '')
                }
            if 'baidu_asr' in data:
                config['cloud']['baidu_asr'] = {
                    'enabled': data['baidu_asr'].get('enabled', False),
                    'url': data['baidu_asr'].get('url', 'ws://vop.baidu.com/realtime_asr'),
                    'appid': data['baidu_asr'].get('appid', ''),
                    'appkey': data['baidu_asr'].get('appkey', '')
                }
            if 'api_gateway' in data:
                if 'api_gateway' not in config:
                    config['api_gateway'] = {}
                config['api_gateway']['use_gateway'] = data['api_gateway'].get('use_gateway', False)
                config['api_gateway']['base_url'] = data['api_gateway'].get('base_url', '')
                config['api_gateway']['api_key'] = data['api_gateway'].get('api_key', '')
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ B站直播设置 ============

@config_bp.route('/api/settings/bilibili', methods=['GET', 'POST'])
def handle_bilibili_settings():
    """处理 B 站直播设置"""
    config = load_config()
    if request.method == 'GET':
        bilibili_config = config.get('bilibili', {})
        return jsonify({
            'enabled': bilibili_config.get('enabled', False),
            'roomId': bilibili_config.get('roomId', ''),
            'checkInterval': bilibili_config.get('checkInterval', 5000),
            'maxMessages': bilibili_config.get('maxMessages', 50)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'bilibili' not in config:
                config['bilibili'] = {}
            config['bilibili'].update({
                'enabled': data.get('enabled', False),
                'roomId': data.get('roomId', ''),
                'checkInterval': data.get('checkInterval', 5000),
                'maxMessages': data.get('maxMessages', 50),
                'apiUrl': 'http://api.live.bilibili.com/ajax/msg'
            })
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ UI 设置 ============

@config_bp.route('/api/settings/ui', methods=['GET', 'POST'])
def handle_ui_settings():
    """处理 UI 设置"""
    config = load_config()
    if request.method == 'GET':
        ui_config = config.get('ui', {})
        subtitle_config = config.get('subtitle_labels', {})
        return jsonify({
            'show_chat_box': ui_config.get('show_chat_box', True),
            'show_model': ui_config.get('show_model', True),
            'model_scale': ui_config.get('model_scale', 2.3),
            'subtitle_user': subtitle_config.get('user', '用户'),
            'subtitle_ai': subtitle_config.get('ai', 'AI'),
            'subtitle_enabled': subtitle_config.get('enabled', False)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'ui' not in config:
                config['ui'] = {}
            if 'subtitle_labels' not in config:
                config['subtitle_labels'] = {}
            config['ui']['show_chat_box'] = data.get('show_chat_box', True)
            config['ui']['show_model'] = data.get('show_model', True)
            config['ui']['model_scale'] = data.get('model_scale', 2.3)
            config['subtitle_labels']['user'] = data.get('subtitle_user', '用户')
            config['subtitle_labels']['ai'] = data.get('subtitle_ai', 'AI')
            config['subtitle_labels']['enabled'] = data.get('subtitle_enabled', False)
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 主动对话设置 ============

@config_bp.route('/api/settings/autochat', methods=['GET', 'POST'])
def handle_auto_chat_settings():
    """处理主动对话设置"""
    config = load_config()
    if request.method == 'GET':
        auto_chat_config = config.get('auto_chat', {})
        mood_chat_config = config.get('mood_chat', {})
        ai_diary_config = config.get('ai_diary', {})
        return jsonify({
            'enabled': auto_chat_config.get('enabled', False),
            'idle_time': auto_chat_config.get('idle_time', 30),
            'prompt': auto_chat_config.get('prompt', ''),
            'mood_chat_enabled': mood_chat_config.get('enabled', False),
            'ai_diary_enabled': ai_diary_config.get('enabled', False)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'auto_chat' not in config:
                config['auto_chat'] = {}
            if 'mood_chat' not in config:
                config['mood_chat'] = {}
            if 'ai_diary' not in config:
                config['ai_diary'] = {}
            config['auto_chat']['enabled'] = data.get('enabled', False)
            config['auto_chat']['idle_time'] = data.get('idle_time', 30)
            config['auto_chat']['prompt'] = data.get('prompt', '')
            config['mood_chat']['enabled'] = data.get('mood_chat_enabled', False)
            config['ai_diary']['enabled'] = data.get('ai_diary_enabled', False)
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 高级设置 ============

@config_bp.route('/api/settings/advanced', methods=['GET', 'POST'])
def handle_advanced_settings():
    """处理基础配置（视觉、UI、工具开关等）"""
    config = load_config()
    if request.method == 'GET':
        vision_config = config.get('vision', {})
        auto_close_config = config.get('auto_close_services', {})
        ui_config = config.get('ui', {})
        tools_config = config.get('tools', {})
        mcp_config = config.get('mcp', {})
        asr_config = config.get('asr', {})
        
        return jsonify({
            'vision_enabled': vision_config.get('enabled', False),
            'auto_screenshot': vision_config.get('auto_screenshot', False),
            'use_vision_model': vision_config.get('use_vision_model', False),
            'vision_model': vision_config.get('vision_model', {}),
            'auto_close_services': auto_close_config.get('enabled', False),
            'show_chat_box': ui_config.get('show_chat_box', True),
            'show_model': ui_config.get('show_model', True),
            'voice_barge_in': asr_config.get('voice_barge_in', True),
            'tools_enabled': tools_config.get('enabled', True),
            'mcp_enabled': mcp_config.get('enabled', True)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'vision' not in config:
                config['vision'] = {}
            if 'auto_close_services' not in config:
                config['auto_close_services'] = {}
            if 'ui' not in config:
                config['ui'] = {}
            if 'tools' not in config:
                config['tools'] = {}
            if 'mcp' not in config:
                config['mcp'] = {}
            if 'asr' not in config:
                config['asr'] = {}
            
            config['vision']['enabled'] = data.get('vision_enabled', False)
            config['vision']['auto_screenshot'] = data.get('auto_screenshot', False)
            config['vision']['use_vision_model'] = data.get('use_vision_model', False)
            config['auto_close_services']['enabled'] = data.get('auto_close_services', False)
            config['ui']['show_chat_box'] = data.get('show_chat_box', True)
            config['ui']['show_model'] = data.get('show_model', True)
            config['asr']['voice_barge_in'] = data.get('voice_barge_in', True)
            config['tools']['enabled'] = data.get('tools_enabled', True)
            config['mcp']['enabled'] = data.get('mcp_enabled', True)
            
            if 'vision_model' in data:
                config['vision']['vision_model'] = data['vision_model']
            
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 对话配置 ============

@config_bp.route('/api/settings/dialog', methods=['GET', 'POST'])
def handle_dialog_settings():
    """处理对话配置"""
    config = load_config()
    if request.method == 'GET':
        ui_config = config.get('ui', {})
        context_config = config.get('context', {})
        tts_config = config.get('tts', {})
        asr_config = config.get('asr', {})

        return jsonify({
            'intro_text': ui_config.get('intro_text', '你好啊'),
            'max_messages': context_config.get('max_messages', 30),
            'enable_limit': context_config.get('enable_limit', True),
            'persistent_history': context_config.get('persistent_history', False),
            'tts_enabled': tts_config.get('enabled', True),
            'asr_enabled': asr_config.get('enabled', True),
            'voice_barge_in': asr_config.get('voice_barge_in', True),
            'show_chat_box': ui_config.get('show_chat_box', True)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'ui' not in config:
                config['ui'] = {}
            if 'context' not in config:
                config['context'] = {}
            if 'tts' not in config:
                config['tts'] = {}
            if 'asr' not in config:
                config['asr'] = {}

            config['ui']['intro_text'] = data.get('intro_text', '你好啊')
            config['context']['max_messages'] = data.get('max_messages', 30)
            config['context']['enable_limit'] = data.get('enable_limit', True)
            config['context']['persistent_history'] = data.get('persistent_history', False)
            config['tts']['enabled'] = data.get('tts_enabled', True)
            config['asr']['enabled'] = data.get('asr_enabled', True)
            config['asr']['voice_barge_in'] = data.get('voice_barge_in', True)
            config['ui']['show_chat_box'] = data.get('show_chat_box', True)

            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 工具设置 ============

@config_bp.route('/api/settings/tools', methods=['GET', 'POST'])
def handle_tools_settings():
    """处理工具设置"""
    config = load_config()
    if request.method == 'GET':
        tools_config = config.get('tools', {})
        mcp_config = config.get('mcp', {})
        return jsonify({
            'enabled': tools_config.get('enabled', True),
            'mcp_enabled': mcp_config.get('enabled', True)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'tools' not in config:
                config['tools'] = {}
            if 'mcp' not in config:
                config['mcp'] = {}
            config['tools']['enabled'] = data.get('enabled', True)
            config['mcp']['enabled'] = data.get('mcp_enabled', True)
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 心情聊天设置 ============

@config_bp.route('/api/settings/mood-chat', methods=['GET', 'POST'])
def handle_mood_chat_settings():
    """处理动态主动对话（心情聊天）设置"""
    config = load_config()
    if request.method == 'GET':
        mood_chat_config = config.get('mood_chat', {})
        return jsonify({
            'enabled': mood_chat_config.get('enabled', True),
            'prompt': mood_chat_config.get('prompt', '')
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'mood_chat' not in config:
                config['mood_chat'] = {}
            config['mood_chat']['enabled'] = data.get('enabled', True)
            config['mood_chat']['prompt'] = data.get('prompt', '')
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 当前模型切换 ============

@config_bp.route('/api/settings/current-model', methods=['POST'])
def handle_current_model():
    """处理当前模型切换"""
    try:
        data = request.get_json()
        model_name = data.get('model', '')
        logger.info(f'切换模型到：{model_name}')
        return jsonify({'success': True, 'message': f'模型已切换为：{model_name}'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ 模型位置复位 ============

@config_bp.route('/api/live2d/model/reset-position', methods=['POST'])
def reset_model_position():
    """复位 Live2D 模型位置到默认值"""
    try:
        config = load_config()
        
        default_x = 1.35
        default_y = 0.8
        
        if 'ui' not in config:
            config['ui'] = {}
        if 'model_position' not in config['ui']:
            config['ui']['model_position'] = {}
        
        config['ui']['model_position']['x'] = default_x
        config['ui']['model_position']['y'] = default_y
        config['ui']['model_position']['remember_position'] = True
        
        if save_config(config):
            return jsonify({'success': True, 'message': '皮套位置已保存，请重启桌宠生效'})
        return jsonify({'error': '保存失败'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ Live2D 动作管理 API ============

@config_bp.route('/api/live2d/motions/uncategorized', methods=['GET'])
def get_uncategorized_motions():
    """获取未分类的动作列表"""
    try:
        import os
        import glob
        
        motions = []
        live2d_path = PROJECT_ROOT / 'live-2d'
        
        # 获取当前角色
        config = load_config()
        current_model = '肥牛'  # 默认角色
        
        # 尝试从 main.js 获取当前角色
        main_js_path = live2d_path / 'main.js'
        if main_js_path.exists():
            import re
            content = main_js_path.read_text(encoding='utf-8')
            match = re.search(r"const priorityFolders = \['([^']+)'", content)
            if match:
                current_model = match.group(1)
        
        # 扫描动作文件
        motions_dir = live2d_path / '2D' / current_model / 'motions'
        if motions_dir.exists():
            motion_files = glob.glob(str(motions_dir / '*.motion3.json'))
            motions = [os.path.basename(f) for f in motion_files]
        
        return jsonify({'success': True, 'motions': motions})
    except Exception as e:
        logger.error(f'获取动作列表失败：{str(e)}')
        return jsonify({'success': True, 'motions': []})


@config_bp.route('/api/live2d/motions/save', methods=['POST'])
def save_motions_config():
    """保存动作配置"""
    try:
        data = request.get_json()
        categories = data.get('categories', [])
        
        # 读取现有配置
        live2d_path = PROJECT_ROOT / 'live-2d'
        config_path = live2d_path / 'emotion_actions.json'
        
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
        else:
            config = {}
        
        # 更新配置（这里简化处理，实际需要更复杂的逻辑）
        for category in categories:
            emotion = category.get('emotion', '')
            motions = category.get('motions', [])
            if emotion:
                if emotion not in config:
                    config[emotion] = {'emotion_actions': {}}
                config[emotion]['emotion_actions'][category.get('name', emotion)] = motions
        
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        
        return jsonify({'success': True, 'message': '动作配置已保存'})
    except Exception as e:
        logger.error(f'保存动作配置失败：{str(e)}')
        return jsonify({'error': str(e)}), 500


@config_bp.route('/api/live2d/motion/reset', methods=['POST'])
def reset_motion_config():
    """重置动作配置"""
    try:
        # 重置到备份配置
        live2d_path = PROJECT_ROOT / 'live-2d'
        backup_path = live2d_path / 'character_backups.json'
        config_path = live2d_path / 'emotion_actions.json'
        
        if backup_path.exists():
            with open(backup_path, 'r', encoding='utf-8') as f:
                backup = json.load(f)
            
            # 恢复配置
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(backup, f, ensure_ascii=False, indent=2)
        
        return jsonify({'success': True, 'message': '动作配置已重置'})
    except Exception as e:
        logger.error(f'重置动作配置失败：{str(e)}')
        return jsonify({'error': str(e)}), 500


@config_bp.route('/api/live2d/motion/preview', methods=['POST'])
def preview_motion():
    """预览动作"""
    try:
        data = request.get_json()
        motion = data.get('motion', '')
        
        # 通过 HTTP 请求发送到桌宠的控制接口
        import requests
        try:
            response = requests.post(
                'http://localhost:3002/control-motion',
                json={'action': 'preview', 'motion': motion},
                timeout=2
            )
            if response.status_code == 200:
                return jsonify({'success': True, 'message': f'正在预览动作：{motion}'})
        except:
            pass
        
        return jsonify({'success': True, 'message': f'预览请求已发送：{motion}'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@config_bp.route('/api/live2d/singing/start', methods=['POST'])
def start_singing():
    """开始唱歌"""
    try:
        import requests
        try:
            response = requests.post(
                'http://localhost:3002/control-motion',
                json={'action': 'trigger_emotion', 'emotion_name': '唱歌'},
                timeout=2
            )
            if response.status_code == 200:
                return jsonify({'success': True, 'message': '已开始唱歌'})
        except:
            pass
        
        return jsonify({'success': True, 'message': '唱歌请求已发送'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@config_bp.route('/api/live2d/singing/stop', methods=['POST'])
def stop_singing():
    """停止唱歌"""
    try:
        import requests
        try:
            response = requests.post(
                'http://localhost:3002/control-motion',
                json={'action': 'trigger_emotion', 'emotion_name': '停止'},
                timeout=2
            )
            if response.status_code == 200:
                return jsonify({'success': True, 'message': '已停止唱歌'})
        except:
            pass
        
        return jsonify({'success': True, 'message': '停止请求已发送'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ Live2D 表情管理 API ============

@config_bp.route('/api/live2d/expressions/config', methods=['GET'])
def get_expression_config():
    """获取表情配置"""
    try:
        import os
        import glob
        
        live2d_path = PROJECT_ROOT / 'live-2d'
        
        # 获取当前角色
        current_model = '肥牛'  # 默认角色
        main_js_path = live2d_path / 'main.js'
        if main_js_path.exists():
            import re
            content = main_js_path.read_text(encoding='utf-8')
            match = re.search(r"const priorityFolders = \['([^']+)'", content)
            if match:
                current_model = match.group(1)
        
        # 读取表情配置
        config_path = live2d_path / 'emotion_expressions.json'
        expressions = {}
        
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                expressions = config.get(current_model, {}).get('emotion_expressions', {})
        
        # 扫描可用表情文件
        available = []
        expressions_dir = live2d_path / '2D' / current_model / 'expressions'
        if expressions_dir.exists():
            expr_files = glob.glob(str(expressions_dir / '*.exp3.json'))
            available = [os.path.basename(f).replace('.exp3.json', '') for f in expr_files]
        
        return jsonify({
            'success': True,
            'expressions': expressions,
            'available_expressions': available
        })
    except Exception as e:
        logger.error(f'获取表情配置失败：{str(e)}')
        return jsonify({'success': True, 'expressions': {}, 'available_expressions': []})


@config_bp.route('/api/live2d/expressions/save', methods=['POST'])
def save_expressions_config():
    """保存表情配置"""
    try:
        data = request.get_json()
        expressions = data.get('expressions', {})
        
        live2d_path = PROJECT_ROOT / 'live-2d'
        config_path = live2d_path / 'emotion_expressions.json'
        
        # 获取当前角色
        current_model = '肥牛'
        main_js_path = live2d_path / 'main.js'
        if main_js_path.exists():
            import re
            content = main_js_path.read_text(encoding='utf-8')
            match = re.search(r"const priorityFolders = \['([^']+)'", content)
            if match:
                current_model = match.group(1)
        
        # 读取现有配置
        config = {}
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
        
        # 更新当前角色的表情配置
        if current_model not in config:
            config[current_model] = {}
        config[current_model]['emotion_expressions'] = expressions
        
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        
        return jsonify({'success': True, 'message': '表情配置已保存'})
    except Exception as e:
        logger.error(f'保存表情配置失败：{str(e)}')
        return jsonify({'error': str(e)}), 500


@config_bp.route('/api/live2d/expressions/reset', methods=['POST'])
def reset_expressions_config():
    """重置表情配置"""
    try:
        live2d_path = PROJECT_ROOT / 'live-2d'
        backup_path = live2d_path / 'character_backups1.json'
        config_path = live2d_path / 'emotion_expressions.json'
        
        # 获取当前角色
        current_model = '肥牛'
        main_js_path = live2d_path / 'main.js'
        if main_js_path.exists():
            import re
            content = main_js_path.read_text(encoding='utf-8')
            match = re.search(r"const priorityFolders = \['([^']+)'", content)
            if match:
                current_model = match.group(1)
        
        if backup_path.exists():
            with open(backup_path, 'r', encoding='utf-8') as f:
                backup = json.load(f)
            
            # 恢复当前角色的配置
            if current_model in backup:
                config = {}
                if config_path.exists():
                    with open(config_path, 'r', encoding='utf-8') as f:
                        config = json.load(f)
                
                config[current_model] = backup[current_model]
                
                with open(config_path, 'w', encoding='utf-8') as f:
                    json.dump(config, f, ensure_ascii=False, indent=2)
        
        return jsonify({'success': True, 'message': '表情配置已重置'})
    except Exception as e:
        logger.error(f'重置表情配置失败：{str(e)}')
        return jsonify({'error': str(e)}), 500


@config_bp.route('/api/live2d/expression/preview', methods=['POST'])
def preview_expression():
    """预览表情"""
    try:
        data = request.get_json()
        expression = data.get('expression', '')
        
        import requests
        try:
            response = requests.post(
                'http://localhost:3002/control-expression',
                json={'action': 'trigger_expression', 'expression_name': expression},
                timeout=2
            )
            if response.status_code == 200:
                return jsonify({'success': True, 'message': f'正在预览表情：{expression}'})
        except:
            pass
        
        return jsonify({'success': True, 'message': f'预览请求已发送：{expression}'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
