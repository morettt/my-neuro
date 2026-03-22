#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 配置管理模块
负责配置文件的读写和所有配置相关的 API
"""

import json
import urllib.request
from flask import Blueprint, request, jsonify

from .utils import PROJECT_ROOT, logger

# 创建配置管理蓝图
config_bp = Blueprint('config', __name__)


def load_config():
    """加载配置文件"""
    config_path = PROJECT_ROOT / 'config.json'
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f'加载配置文件失败：{str(e)}')
        return {}


def save_config(config):
    """保存配置文件"""
    config_path = PROJECT_ROOT / 'config.json'
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
            'provider': cloud_config.get('provider', 'siliconflow'),
            'api_key': cloud_config.get('api_key', ''),
            'cloud_tts': cloud_config.get('tts', {}),
            'aliyun_tts': cloud_config.get('aliyun_tts', {}),
            'baidu_asr': cloud_config.get('baidu_asr', {}),
            'api_gateway': config.get('api_gateway', {})
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            # 更新 cloud 配置
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
                    'voice': data['cloud_tts'].get('voice', ''),
                    'response_format': data['cloud_tts'].get('response_format', 'wav'),
                    'speed': data['cloud_tts'].get('speed', 1.0)
                }
            if 'aliyun_tts' in data:
                config['cloud']['aliyun_tts'] = {
                    'enabled': data['aliyun_tts'].get('enabled', False),
                    'api_key': data['aliyun_tts'].get('api_key', ''),
                    'model': data['aliyun_tts'].get('model', 'cosyvoice-v3-flash'),
                    'voice': data['aliyun_tts'].get('voice', ''),
                    'sample_rate': data['aliyun_tts'].get('sample_rate', 48000),
                    'volume': data['aliyun_tts'].get('volume', 50),
                    'rate': data['aliyun_tts'].get('rate', 1),
                    'pitch': data['aliyun_tts'].get('pitch', 1)
                }
            if 'baidu_asr' in data:
                config['cloud']['baidu_asr'] = {
                    'enabled': data['baidu_asr'].get('enabled', False),
                    'url': data['baidu_asr'].get('url', 'ws://vop.baidu.com/realtime_asr'),
                    'appid': data['baidu_asr'].get('appid', 0),
                    'appkey': data['baidu_asr'].get('appkey', ''),
                    'dev_pid': data['baidu_asr'].get('dev_pid', 0)
                }
            # 更新 api_gateway 配置（独立顶层配置）
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
            # vision_enabled 已移除，不再使用
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
            
            # vision_enabled 已移除，不再使用
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

@config_bp.route('/api/settings/current-model', methods=['GET', 'POST'])
def handle_current_model():
    """处理当前模型切换"""
    try:
        import re
        
        main_js_path = PROJECT_ROOT / 'main.js'
        
        # GET 请求：读取当前模型
        if request.method == 'GET':
            if main_js_path.exists():
                with open(main_js_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                match = re.search(r"const priorityFolders = \['([^']+)'", content)
                if match:
                    current_model = match.group(1)
                    return jsonify({'success': True, 'model': current_model})
            return jsonify({'success': True, 'model': '肥牛'})
        
        # POST 请求：设置模型
        data = request.get_json()
        model_name = data.get('model', '')
        
        if not model_name:
            return jsonify({'success': False, 'error': '未提供模型名称'})
        
        # 更新 main.js 的 priorityFolders
        if main_js_path.exists():
            with open(main_js_path, 'r', encoding='utf-8') as f:
                main_content = f.read()
            
            # 将选中的模型放在第一位
            new_priority = f"const priorityFolders = ['{model_name}', 'Hiyouri', 'Default', 'Main']"
            main_content = re.sub(r"const priorityFolders = \[.*?\]", new_priority, main_content)
            
            with open(main_js_path, 'w', encoding='utf-8') as f:
                f.write(main_content)
            
            logger.info(f'已设置当前模型为：{model_name}')
            return jsonify({'success': True, 'model': model_name})
        else:
            logger.error(f'main.js 不存在：{main_js_path}')
            return jsonify({'success': False, 'error': 'main.js 文件不存在'})
    except Exception as e:
        logger.error(f'设置模型失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ 工具设置 ============
