#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 控制器 - 用于统一管理启动和控制各项服务
v1.4 - 修复服务状态检测和日志系统问题
"""

import os
import sys
import subprocess
import threading
import time
import json
import logging
from pathlib import Path
from flask import Flask, render_template, jsonify, request
import webbrowser
import socket
import re
import datetime

# WebUI 版本
WEBUI_VERSION = 'v1.5'

# 记录启动时间
START_TIME = datetime.datetime.now()

# 配置日志 - 使用 WARNING 级别减少输出
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# 关闭 Flask/Werkzeug 的默认日志
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

PROJECT_ROOT = Path(__file__).parent.absolute()
app = Flask(__name__, 
            template_folder=str(PROJECT_ROOT / 'templates'),
            static_folder=str(PROJECT_ROOT / 'static'))

# 服务状态跟踪
service_processes = {}
# 服务 PID 跟踪（用于检测使用 CREATE_NEW_CONSOLE 启动的进程）
service_pids = {}
# 日志文件路径
LOG_FILE_PATHS = {
    'pet': PROJECT_ROOT / 'live-2d' / 'runtime.log',  # 桌宠日志实际路径
    'tool': PROJECT_ROOT / 'live-2d' / 'runtime.log',  # 工具日志也是同一个文件，通过 [TOOL] 标记区分
}


def is_service_running(service):
    """检查服务是否正在运行
    
    由于所有服务都使用 CREATE_NEW_CONSOLE 启动，窗口标题都是 cmd.exe，
    无法通过 tasklist 可靠检测，因此只依赖 service_pids 标记。
    """
    return service_pids.get(service, False)


@app.route('/')
def dashboard():
    """主页"""
    import datetime
    start_time = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # 查找可用端口
    port = find_free_port()
    return render_template('index.html', port=port, start_time=start_time)


@app.route('/api/status')
def get_status():
    """获取所有服务的状态"""
    status = {}
    for service in service_pids.keys():
        status[service] = 'running' if service_pids.get(service, False) else 'stopped'
    return jsonify(status)


@app.route('/api/system/info')
def get_system_info():
    """获取系统信息（版本、运行时间等）"""
    uptime = datetime.datetime.now() - START_TIME
    # 格式化为人类可读的时间
    days = uptime.days
    hours, remainder = divmod(uptime.seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    uptime_str = f"{days}天{hours}小时{minutes}分钟{seconds}秒" if days > 0 else f"{hours}小时{minutes}分钟{seconds}秒"

    return jsonify({
        'version': WEBUI_VERSION,
        'uptime': uptime_str,
        'start_time': START_TIME.strftime('%Y-%m-%d %H:%M:%S'),
        'start_timestamp': START_TIME.timestamp()  # 添加时间戳用于前端计算
    })


@app.route('/api/start/<service>', methods=['POST'])
def start_service(service):
    """启动指定服务"""
    try:
        # 检查服务是否已在运行
        if is_service_running(service):
            return jsonify({'success': False, 'error': '服务已在运行中'})

        # 根据服务类型启动对应的脚本
        script_map = {
            'live2d': {
                'script': str(PROJECT_ROOT / 'live-2d' / 'go.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', 'cd /d ' + str(PROJECT_ROOT / 'live-2d') + ' && go.bat'],
                'cwd': str(PROJECT_ROOT / 'live-2d'),
                'is_python': False,
                'log_file': PROJECT_ROOT / 'live-2d' / 'runtime.log'  # 桌宠日志文件
            },
            'asr': {
                'script': str(PROJECT_ROOT / '1.ASR.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', str(PROJECT_ROOT / '1.ASR.bat')],
                'cwd': str(PROJECT_ROOT),
                'is_python': False,
                'log_file': PROJECT_ROOT / 'logs' / 'asr.log'
            },
            'tts': {
                'script': str(PROJECT_ROOT / '2.TTS.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', str(PROJECT_ROOT / '2.TTS.bat')],
                'cwd': str(PROJECT_ROOT),
                'is_python': False,
                'log_file': PROJECT_ROOT / 'logs' / 'tts.log'
            },
            'bert': {
                'script': str(PROJECT_ROOT / '3.bert.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', str(PROJECT_ROOT / '3.bert.bat')],
                'cwd': str(PROJECT_ROOT),
                'is_python': False,
                'log_file': PROJECT_ROOT / 'logs' / 'bert.log'
            },
            'memos': {
                'script': str(PROJECT_ROOT / 'MEMOS-API.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', str(PROJECT_ROOT / 'MEMOS-API.bat')],
                'cwd': str(PROJECT_ROOT),
                'is_python': False,
                'log_file': PROJECT_ROOT / 'logs' / 'memos.log'
            },
            'rag': {
                'script': str(PROJECT_ROOT / 'RAG.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', str(PROJECT_ROOT / 'RAG.bat')],
                'cwd': str(PROJECT_ROOT),
                'is_python': False,
                'log_file': PROJECT_ROOT / 'logs' / 'rag.log'
            }
        }

        if service not in script_map:
            return jsonify({'success': False, 'error': f'未知服务：{service}'})

        config = script_map[service]

        # 对于 Live2D 服务，启动前清空日志文件
        if service == 'live2d' and config.get('log_file'):
            log_file = config['log_file']
            try:
                with open(log_file, 'w', encoding='utf-8') as f:
                    f.write('')  # 清空文件
                logger.warning(f'已清空日志文件：{log_file}')
            except Exception as e:
                logger.error(f'清空日志文件失败：{e}')
        
        # 启动服务
        proc = subprocess.Popen(
            config['args'],
            cwd=config['cwd'],
            creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform.startswith('win') else 0
        )

        service_processes[service] = proc
        # 记录服务已启动（即使进程对象可能立即结束）
        service_pids[service] = True
        logger.warning(f'{service} 服务已启动 (PID: {proc.pid})')

        return jsonify({'success': True, 'pid': proc.pid})
        
    except Exception as e:
        logger.error(f'启动 {service} 服务失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/stop/<service>', methods=['POST'])
def stop_service(service):
    """停止指定服务"""
    try:
        # 检查服务是否运行
        if not is_service_running(service):
            return jsonify({'success': False, 'error': '服务未运行'})

        # 使用 PowerShell 根据命令行参数查找 PID，然后用 taskkill /T 终止进程树
        if sys.platform.startswith('win'):
            import subprocess
            
            # 构建 bat 文件名
            if service == 'live2d':
                bat_name = 'go.bat'
            elif service == 'memos':
                bat_name = 'MEMOS-API.bat'
            elif service == 'rag':
                bat_name = 'RAG.bat'
            else:
                bat_name = f'{service}.bat'
            
            # 使用 PowerShell 查找包含 bat 文件名的进程 PID
            ps_script = f"""
            $ErrorActionPreference = 'SilentlyContinue'
            $procs = Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -and $_.CommandLine -like '*{bat_name}*' }}
            foreach ($proc in $procs) {{
                Write-Output $proc.ProcessId
            }}
            """
            
            result = subprocess.run(
                ['powershell', '-Command', ps_script],
                capture_output=True, text=True, timeout=10
            )
            
            # 解析输出的 PID 列表
            pids = [line.strip() for line in result.stdout.split('\n') if line.strip().isdigit()]
            
            # 如果没有找到进程，返回错误
            if not pids:
                logger.error(f'停止 {service} 服务失败：未找到相关进程（可能已意外终止）')
                # 清除标记（即使没有找到进程）
                service_pids[service] = False
                if service in service_processes:
                    del service_processes[service]
                return jsonify({'success': False, 'error': f'未找到 {service} 服务进程，可能已意外终止'})
            
            # 对每个 PID 使用 taskkill /T 终止进程树
            killed_count = 0
            failed_pids = []
            for pid in pids:
                kill_result = subprocess.run(
                    ['taskkill', '/F', '/T', '/PID', pid],
                    capture_output=True, text=True, timeout=10
                )
                if '成功' in kill_result.stdout or '成功' in kill_result.stderr:
                    killed_count += 1
                    logger.debug(f'已终止进程树 PID: {pid}')
                else:
                    failed_pids.append(pid)
                    logger.warning(f'终止进程 PID {pid} 失败：{kill_result.stderr or kill_result.stdout}')
            
            # 检查是否有终止失败的进程
            if failed_pids and killed_count == 0:
                logger.error(f'停止 {service} 服务失败：所有进程终止失败')
                return jsonify({'success': False, 'error': f'停止服务失败：无法终止进程 (PID: {", ".join(failed_pids)})'})
            
            # 清除服务标记
            service_pids[service] = False
            if service in service_processes:
                del service_processes[service]

            logger.warning(f'{service} 服务已停止（终止了 {killed_count} 个进程树）')
            return jsonify({'success': True, 'message': f'成功终止 {killed_count} 个进程'})
        else:
            return jsonify({'success': False, 'error': '仅支持 Windows 系统'})
    except subprocess.TimeoutExpired:
        logger.error(f'停止 {service} 服务超时')
        # 即使超时也清除标记
        service_pids[service] = False
        return jsonify({'success': True, 'warning': '停止命令已发送，但可能未完全终止'})
    except Exception as e:
        logger.error(f'停止 {service} 服务失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)})


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


# ============ 配置 API 端点 ============

@app.route('/api/config/llm', methods=['GET', 'POST'])
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


@app.route('/api/settings/chat', methods=['GET', 'POST'])
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


@app.route('/api/settings/voice', methods=['GET', 'POST'])
def handle_voice_settings():
    """处理声音设置"""
    config = load_config()
    if request.method == 'GET':
        cloud_config = config.get('cloud', {})
        return jsonify({
            'tts': config.get('tts', {}),
            'asr': config.get('asr', {}),
            'cloud_tts': cloud_config.get('tts', {}),
            'aliyun_tts': cloud_config.get('aliyun_tts', {}),  # 添加阿里云 TTS
            'baidu_asr': cloud_config.get('baidu_asr', {}),
            'api_gateway': config.get('api_gateway', {})  # 添加云端肥牛网关
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
            # 保存云端配置
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
            # 保存云端肥牛网关配置
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


@app.route('/api/settings/bilibili', methods=['GET', 'POST'])
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


@app.route('/api/settings/ui', methods=['GET', 'POST'])
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
            'subtitle_enabled': subtitle_config.get('enabled', False)  # 添加字幕启用状态
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
            config['subtitle_labels']['enabled'] = data.get('subtitle_enabled', False)  # 保存字幕启用状态
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


@app.route('/api/settings/autochat', methods=['GET', 'POST'])
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


@app.route('/api/settings/advanced', methods=['GET', 'POST'])
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
            
            # 保存视觉模型配置
            if 'vision_model' in data:
                config['vision']['vision_model'] = data['vision_model']
            
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


@app.route('/api/settings/dialog', methods=['GET', 'POST'])
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


@app.route('/api/settings/tools', methods=['GET', 'POST'])
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


# ============ 插件管理 API ============

def load_enabled_plugins():
    """从 enabled_plugins.json 加载已启用的插件列表"""
    enabled_path = PROJECT_ROOT / 'live-2d' / 'plugins' / 'enabled_plugins.json'
    if not enabled_path.exists():
        return []
    try:
        with open(enabled_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('plugins', [])
    except Exception as e:
        logger.error(f'加载 enabled_plugins.json 失败：{e}')
        return []


def save_enabled_plugins(enabled_list):
    """保存已启用的插件列表到 enabled_plugins.json"""
    enabled_path = PROJECT_ROOT / 'live-2d' / 'plugins' / 'enabled_plugins.json'
    try:
        with open(enabled_path, 'w', encoding='utf-8') as f:
            json.dump({'plugins': enabled_list}, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f'保存 enabled_plugins.json 失败：{e}')
        return False


def scan_plugins_directory():
    """自动扫描插件目录（built-in 和 community）"""
    plugins = []
    plugins_base = PROJECT_ROOT / 'live-2d' / 'plugins'
    enabled_plugins = load_enabled_plugins()

    for category in ['built-in', 'community']:
        category_path = plugins_base / category
        if not category_path.exists():
            continue

        for plugin_dir in category_path.iterdir():
            if not plugin_dir.is_dir():
                continue

            metadata_path = plugin_dir / 'metadata.json'
            if not metadata_path.exists():
                continue

            try:
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)

                # 检查插件是否在 enabled_plugins.json 中
                plugin_path = f"{category}/{metadata.get('name', plugin_dir.name)}"
                plugin_enabled = plugin_path in enabled_plugins

                plugins.append({
                    'name': metadata.get('name', plugin_dir.name),
                    'display_name': metadata.get('displayName', metadata.get('name', plugin_dir.name)),
                    'description': metadata.get('description', '无描述'),
                    'version': metadata.get('version', '1.0.0'),
                    'author': metadata.get('author', 'unknown'),
                    'category': category,
                    'enabled': plugin_enabled,
                    'plugin_path': plugin_path,
                    'plugin_dir': str(plugin_dir),
                    'has_own_config': (plugin_dir / 'plugin_config.json').exists()
                })
            except Exception as e:
                logger.error(f'读取插件元数据失败 {plugin_dir.name}: {e}')

    return plugins


@app.route('/api/plugins/list')
def list_plugins():
    """获取插件列表（自动扫描）"""
    try:
        plugins = scan_plugins_directory()
        return jsonify(plugins)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/plugins/<plugin_name>/toggle', methods=['POST'])
def toggle_plugin(plugin_name):
    """切换插件启用状态（使用 enabled_plugins.json）"""
    enabled_plugins = load_enabled_plugins()
    
    # 查找插件的完整路径（built-in/xxx 或 community/xxx）
    plugin_path = None
    for category in ['built-in', 'community']:
        test_path = f"{category}/{plugin_name}"
        plugins_base = PROJECT_ROOT / 'live-2d' / 'plugins'
        category_path = plugins_base / category / plugin_name.replace('_', '-')
        if not category_path.exists():
            category_path = plugins_base / category / plugin_name
        if category_path.exists():
            # 从 metadata.json 获取正确的插件名
            metadata_path = category_path / 'metadata.json'
            if metadata_path.exists():
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                actual_name = metadata.get('name', plugin_name)
                plugin_path = f"{category}/{actual_name}"
                break
    
    if not plugin_path:
        return jsonify({'success': False, 'error': f'插件不存在：{plugin_name}'})
    
    # 切换状态
    if plugin_path in enabled_plugins:
        enabled_plugins.remove(plugin_path)
        action = 'disabled'
    else:
        enabled_plugins.append(plugin_path)
        action = 'enabled'
    
    if save_enabled_plugins(enabled_plugins):
        return jsonify({
            'success': True,
            'action': action,
            'plugin_name': plugin_name,
            'plugin_path': plugin_path
        })
    return jsonify({'success': False, 'error': '保存失败'}), 500


@app.route('/api/plugins/<plugin_name>/open-config', methods=['POST'])
def open_plugin_config(plugin_name):
    """打开插件配置文件或目录"""
    import os
    
    plugins_base = PROJECT_ROOT / 'live-2d' / 'plugins'
    plugin_config_key = plugin_name.replace('-', '_')
    
    # 查找插件目录
    plugin_dir = None
    for category in ['built-in', 'community']:
        test_path = plugins_base / category / plugin_name.replace('_', '-')
        if test_path.exists():
            plugin_dir = test_path
            break
        
        # 也尝试下划线格式
        test_path = plugins_base / category / plugin_name
        if test_path.exists():
            plugin_dir = test_path
            break
    
    if not plugin_dir:
        return jsonify({
            'success': False,
            'error': f'插件目录不存在：{plugin_name}'
        }), 404
    
    # 检查插件是否有自己的配置文件
    plugin_config = plugin_dir / 'index.js'
    if plugin_config.exists():
        # 打开插件的 index.js 文件
        try:
            os.startfile(str(plugin_config))
            return jsonify({
                'success': True,
                'config_path': str(plugin_config),
                'message': f'已打开插件主文件：{plugin_config}\n请在 config.json 中配置该插件（plugins.{plugin_config_key}）'
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'打开文件失败：{str(e)}',
                'config_path': str(plugin_config)
            })
    else:
        # 打开插件目录
        try:
            os.startfile(str(plugin_dir))
            return jsonify({
                'success': True,
                'config_path': str(plugin_dir),
                'message': f'已打开插件目录：{plugin_dir}\n请在 config.json 中配置该插件（plugins.{plugin_config_key}）'
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'打开目录失败：{str(e)}',
                'config_path': str(plugin_dir)
            })


@app.route('/api/settings/current-model', methods=['POST'])
def handle_current_model():
    """处理当前模型切换"""
    try:
        data = request.get_json()
        model_name = data.get('model', '')
        logger.info(f'切换模型到：{model_name}')
        return jsonify({'success': True, 'message': f'模型已切换为：{model_name}'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/live2d/model/reset-position', methods=['POST'])
def reset_model_position():
    """复位 Live2D 模型位置到默认值"""
    try:
        config = load_config()
        
        # 设置默认位置（与 model-interaction.js 中的默认值一致）
        default_x = 1.35  # 屏幕宽度的 135%（右边）
        default_y = 0.8   # 屏幕高度的 80%（下方）
        
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


@app.route('/api/tools/list')
def list_tools():
    """列出可用工具（已废弃，保留用于兼容）"""
    return list_all_tools()


def scan_tools_directory(dir_path, tool_type):
    """扫描工具目录，返回工具列表"""
    tools = []
    if not dir_path.exists():
        return tools
    
    # 需要跳过的文件
    skip_files = {'index.js', 'note_server.js', 'pc_control_server.js', 'music_control.js', 'search_server.js'}
    
    for file_path in dir_path.iterdir():
        if not file_path.is_file():
            continue
            
        # 检查 .js 文件（已启用）或 .txt 文件（已禁用）
        if file_path.suffix not in ['.js', '.txt']:
            continue
            
        # 跳过 index.js 等文件
        if file_path.name in skip_files:
            continue
        
        # 确定工具名称和状态
        if file_path.suffix == '.js':
            tool_name = file_path.stem
            enabled = True
        else:  # .txt
            tool_name = file_path.stem
            enabled = False
        
        description, short_desc = get_tool_description(file_path)
        
        tools.append({
            'name': tool_name,
            'description': description,
            'short_desc': short_desc,  # 简短描述（用于卡片标题旁显示）
            'enabled': enabled,
            'type': tool_type,
            'file_name': file_path.name,
            'is_external': False
        })
    
    return tools


def get_tool_description(file_path):
    """从工具文件中提取描述信息"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read(2000)

        # 优先尝试从 JS 代码中提取 name 和 description 字段（参考 test.py 的实现）
        pattern = r'name:\s*["\']([^"\']+)["\']\s*,\s*description:\s*["\']([^"\']*(?:[^"\'\\]|\\.)*)["\']'
        matches = re.findall(pattern, content, re.DOTALL)

        if matches:
            # 取第一个匹配的工具描述
            name, description = matches[0]
            # 清理描述文本
            clean_desc = re.sub(r'\s+', ' ', description.strip())
            short_desc = clean_desc.split('.')[0].split('。')[0].strip()
            if len(short_desc) > 30:
                short_desc = short_desc[:27] + '...'
            return clean_desc, short_desc

        # 如果没有找到 name/description 字段，尝试从文件头注释提取
        match = re.search(r'/\*\*(.*?)\*/', content, re.DOTALL)
        if match:
            desc = match.group(1).strip()
            # 清理注释中的 * 号和多余空白
            desc = re.sub(r'^\s*\*\s*', '', desc, flags=re.MULTILINE)
            desc = re.sub(r'\s+', ' ', desc)
            desc = desc.strip('*').strip()
            short_desc = desc.split('\n')[0].strip()
            if len(short_desc) > 30:
                short_desc = short_desc[:27] + '...'
            return desc, short_desc

        return "无描述", "无描述"
    except Exception as e:
        logger.warning(f'读取工具描述失败 {file_path}: {e}')
        return "无法读取描述", "无法读取描述"


def get_external_mcp_tools():
    """从 mcp_config.json 读取外部 MCP 工具（排除有本地文件的工具）"""
    tools = []
    mcp_config_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'mcp_config.json'
    mcp_tools_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'tools'
    
    if not mcp_config_path.exists():
        return tools
    
    try:
        with open(mcp_config_path, 'r', encoding='utf-8') as f:
            mcp_config = json.load(f)
        
        for tool_name, config in mcp_config.items():
            # 判断是否禁用（名称包含 _disabled）
            is_disabled = tool_name.endswith('_disabled')
            actual_name = tool_name[:-9] if is_disabled else tool_name  # 移除 _disabled
            
            # 检查是否有对应的本地文件
            local_js = mcp_tools_path / f"{actual_name}.js"
            local_txt = mcp_tools_path / f"{actual_name}.txt"
            has_local_file = local_js.exists() or local_txt.exists()
            
            # 如果有本地文件，跳过（作为本地工具处理）
            if has_local_file:
                continue
            
            command = config.get('command', '')
            # 提取命令名称
            cmd_name = os.path.basename(command) if command else 'unknown'
            
            tools.append({
                'name': tool_name,
                'actual_name': actual_name,
                'description': f"外部 MCP 工具 (通过 {cmd_name} 启动)",
                'short_desc': f"外部工具 - {cmd_name}",
                'enabled': not is_disabled,
                'type': 'mcp',
                'is_external': True,
                'command': command
            })
        
        return tools
    except Exception as e:
        logger.error(f'读取外部 MCP 工具失败：{e}')
        return tools


@app.route('/api/tools/list/all')
def list_all_tools():
    """列出所有工具（FC + MCP）"""
    try:
        server_tools_path = PROJECT_ROOT / 'live-2d' / 'server-tools'
        mcp_tools_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'tools'
        
        fc_tools = scan_tools_directory(server_tools_path, 'fc')
        mcp_tools = scan_tools_directory(mcp_tools_path, 'mcp')
        
        return jsonify({
            'fc_tools': fc_tools,
            'mcp_tools': mcp_tools
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tools/list/fc')
def list_fc_tools():
    """列出 Function Call 工具（server-tools 目录）"""
    try:
        server_tools_path = PROJECT_ROOT / 'live-2d' / 'server-tools'
        tools = scan_tools_directory(server_tools_path, 'fc')
        return jsonify({'tools': tools})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tools/list/mcp')
def list_mcp_tools():
    """列出 MCP 工具（mcp/tools 目录 + 外部工具）"""
    try:
        mcp_tools_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'tools'
        tools = scan_tools_directory(mcp_tools_path, 'mcp')
        
        # 添加外部 MCP 工具
        external_tools = get_external_mcp_tools()
        tools.extend(external_tools)
        
        return jsonify({'tools': tools})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/market/prompts', methods=['GET'])
def get_prompt_market():
    """获取提示词广场列表（从远程服务器）"""
    try:
        import urllib.request
        import json as json_module

        # 从远程服务器获取提示词列表
        req = urllib.request.Request('http://mynewbot.com/api/get-prompts')
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json_module.loads(response.read().decode('utf-8'))

        if data.get('success'):
            return jsonify({
                'success': True,
                'prompts': data.get('prompts', [])
            })
        else:
            return jsonify({
                'success': False,
                'error': '获取提示词列表失败'
            }), 500
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'网络请求失败：{str(e)}'
        }), 500


@app.route('/api/market/plugins', methods=['GET'])
def get_plugin_market():
    """获取插件广场列表（从本地 plugin_hub.json 文件）"""
    try:
        import json as json_module
        
        # 从本地文件获取插件列表
        plugin_hub_path = PROJECT_ROOT / 'live-2d' / 'plugins' / 'plugin-house' / 'plugin_hub.json'
        
        if not plugin_hub_path.exists():
            return jsonify({
                'success': False,
                'error': '插件商店数据文件不存在'
            }), 500
        
        with open(plugin_hub_path, 'r', encoding='utf-8') as f:
            plugins_data = json_module.load(f)
        
        # 转换为列表格式
        plugins = []
        for key, value in plugins_data.items():
            plugins.append({
                'name': key,
                'display_name': value.get('display_name', key),
                'description': value.get('desc', '无描述'),
                'author': value.get('author', '未知'),
                'repo': value.get('repo', ''),
                'download_url': value.get('repo', '') + '/archive/refs/heads/main.zip'
            })
        
        return jsonify({
            'success': True,
            'plugins': plugins
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'加载插件商店数据失败：{str(e)}'
        }), 500


@app.route('/api/market/plugins/download', methods=['POST'])
def download_plugin():
    """下载插件"""
    try:
        data = request.get_json()
        plugin_name = data.get('plugin_name', '')
        plugin_url = data.get('download_url', '')

        if not plugin_name or not plugin_url:
            return jsonify({'success': False, 'error': '缺少参数'}), 400

        # 下载插件到 community 目录
        import urllib.request
        plugins_base = PROJECT_ROOT / 'live-2d' / 'plugins' / 'community'
        plugins_base.mkdir(parents=True, exist_ok=True)

        plugin_dir = plugins_base / plugin_name
        plugin_dir.mkdir(parents=True, exist_ok=True)

        # 下载插件文件（假设是 zip 格式）
        zip_path = plugin_dir / f'{plugin_name}.zip'
        urllib.request.urlretrieve(plugin_url, zip_path)

        return jsonify({
            'success': True,
            'message': f'插件 {plugin_name} 已下载，请解压后使用'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/market/tools', methods=['GET'])
def get_tool_market():
    """获取工具广场列表（从远程服务器）"""
    try:
        import urllib.request
        import json as json_module

        # 从远程服务器获取工具列表
        req = urllib.request.Request('http://mynewbot.com/api/get-tools')
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json_module.loads(response.read().decode('utf-8'))

        if data.get('success'):
            return jsonify({
                'success': True,
                'tools': data.get('tools', [])
            })
        else:
            return jsonify({
                'success': False,
                'error': '获取工具列表失败'
            }), 500
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'网络请求失败：{str(e)}'
        }), 500


@app.route('/api/market/fc-tools', methods=['GET'])
def get_fc_market():
    """获取 FC 广场列表（从远程服务器）"""
    try:
        import urllib.request
        import json as json_module

        # 从远程服务器获取 FC 工具列表
        req = urllib.request.Request('http://mynewbot.com/api/get-fc-tools')
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json_module.loads(response.read().decode('utf-8'))

        if data.get('success'):
            return jsonify({
                'success': True,
                'fc_tools': data.get('fc_tools', [])
            })
        else:
            return jsonify({
                'success': False,
                'error': '获取 FC 工具列表失败'
            }), 500
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'网络请求失败：{str(e)}'
        }), 500


@app.route('/api/tools/toggle', methods=['POST'])
def toggle_tool():
    """切换工具启用状态（.js ↔ .txt 重命名 或 外部工具 name ↔ name_disabled）"""
    try:
        data = request.get_json()
        tool_name = data.get('name')
        tool_type = data.get('type')  # 'fc' 或 'mcp'
        is_external = data.get('is_external', False)
        
        if not tool_name or not tool_type:
            return jsonify({'success': False, 'error': '缺少参数'}), 400
        
        # 处理外部 MCP 工具
        if is_external:
            mcp_config_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'mcp_config.json'
            
            if not mcp_config_path.exists():
                return jsonify({'success': False, 'error': 'MCP 配置文件不存在'}), 404
            
            with open(mcp_config_path, 'r', encoding='utf-8') as f:
                mcp_config = json.load(f)
            
            # 判断当前状态
            is_disabled = tool_name.endswith('_disabled')
            actual_name = tool_name[:-9] if is_disabled else tool_name
            
            if is_disabled:
                # 当前禁用，需要启用：移除 _disabled
                new_name = actual_name
                tool_config = mcp_config.pop(tool_name)
                mcp_config[new_name] = tool_config
                action = 'enabled'
                logger.info(f'外部工具 {actual_name} 已启用')
            else:
                # 当前启用，需要禁用：添加 _disabled
                new_name = tool_name + '_disabled'
                tool_config = mcp_config.pop(tool_name)
                mcp_config[new_name] = tool_config
                action = 'disabled'
                logger.info(f'外部工具 {actual_name} 已禁用')
            
            # 保存配置
            with open(mcp_config_path, 'w', encoding='utf-8') as f:
                json.dump(mcp_config, f, indent=2, ensure_ascii=False)
            
            return jsonify({
                'success': True,
                'action': action,
                'enabled': action == 'enabled',
                'new_name': new_name
            })
        
        # 处理本地工具（.js ↔ .txt）
        if tool_type == 'fc':
            dir_path = PROJECT_ROOT / 'live-2d' / 'server-tools'
        elif tool_type == 'mcp':
            dir_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'tools'
        else:
            return jsonify({'success': False, 'error': '无效的工具类型'}), 400
        
        # 检查文件当前状态
        js_file = dir_path / f"{tool_name}.js"
        txt_file = dir_path / f"{tool_name}.txt"
        
        if js_file.exists():
            # 当前已启用，需要禁用（.js → .txt）
            js_file.rename(txt_file)
            action = 'disabled'
            logger.info(f'工具 {tool_name} 已禁用')
        elif txt_file.exists():
            # 当前已禁用，需要启用（.txt → .js）
            txt_file.rename(js_file)
            action = 'enabled'
            logger.info(f'工具 {tool_name} 已启用')
        else:
            return jsonify({'success': False, 'error': '工具文件不存在'}), 404
        
        return jsonify({
            'success': True,
            'action': action,
            'enabled': action == 'enabled'
        })
    except Exception as e:
        logger.error(f'切换工具状态失败：{e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/models/list')
def list_models():
    """列出可用的 Live2D 模型"""
    try:
        models_path = PROJECT_ROOT / 'live-2d' / '2D'
        models = []
        if models_path.exists():
            for folder in models_path.iterdir():
                if folder.is_dir():
                    for file in folder.iterdir():
                        if file.suffix == '.model3.json':
                            models.append(folder.name)
                            break
        return jsonify(models)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/logs/<log_type>')
def get_logs(log_type):
    """获取指定类型的日志（优化版：只读取最后 50 行）"""
    try:
        log_file = PROJECT_ROOT / 'live-2d' / 'runtime.log'
        if not log_file.exists():
            return jsonify({'logs': [], 'error': '日志文件不存在'})

        # 读取最后 50 行日志（减少行数以提高响应速度）
        try:
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                # 使用 deque 高效读取最后 N 行
                from collections import deque
                last_lines = deque(f, maxlen=100)

                # 根据日志类型过滤
                logs = []
                for line in last_lines:
                    line = line.strip()
                    if line:
                        is_tool_log = '[TOOL]' in line
                        if log_type == 'tool' and is_tool_log:
                            logs.append(line)
                        elif log_type == 'pet' and not is_tool_log:
                            logs.append(line)

                return jsonify({'logs': logs})
        except Exception as e:
            return jsonify({'logs': [], 'error': str(e)})
    except Exception as e:
        return jsonify({'logs': [], 'error': str(e)})


@app.route('/api/logs/tail/<log_type>')
def tail_logs(log_type):
    """获取日志的最新内容（增量）"""
    try:
        log_file = PROJECT_ROOT / 'live-2d' / 'runtime.log'
        if not log_file.exists():
            return jsonify({'logs': [], 'error': '日志文件不存在'})

        # 读取最后 10 行日志（使用 deque 高效读取）
        try:
            from collections import deque
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                last_lines = deque(f, maxlen=10)

                # 根据日志类型过滤
                logs = []
                for line in last_lines:
                    line = line.strip()
                    if line:
                        is_tool_log = '[TOOL]' in line
                        if log_type == 'tool' and is_tool_log:
                            logs.append(line)
                        elif log_type == 'pet' and not is_tool_log:
                            logs.append(line)

                return jsonify({'logs': logs})
        except Exception as e:
            return jsonify({'logs': [], 'error': str(e)})
    except Exception as e:
        return jsonify({'logs': [], 'error': str(e)})


@app.route('/api/settings/mood-chat', methods=['GET', 'POST'])
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


@app.route('/api/mood/status')
def get_mood_status():
    """获取当前心情分状态"""
    try:
        mood_file = PROJECT_ROOT / 'AI 记录室' / 'mood_status.json'
        if not mood_file.exists():
            return jsonify({
                'score': 0,
                'interval': 0,
                'waitingResponse': False,
                'status': '未启动'
            })
        
        with open(mood_file, 'r', encoding='utf-8') as f:
            mood_data = json.load(f)
        
        score = mood_data.get('score', 0)
        interval = mood_data.get('interval', 0)
        waiting = mood_data.get('waitingResponse', False)
        
        # 根据心情分确定状态文本
        if score >= 90:
            status = '兴奋😄'
        elif score >= 80:
            status = '正常😊'
        elif score >= 60:
            status = '低落😐'
        else:
            status = '沉默😔'
        
        if waiting:
            status += ' 等待回应...'
        
        return jsonify({
            'score': score,
            'interval': interval,
            'waitingResponse': waiting,
            'status': status
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def find_free_port():
    """查找可用端口"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


def run_app():
    """运行 Flask 应用"""
    port = find_free_port()
    print(f"\n{'='*50}")
    print(f"WebUI 控制面板")
    print(f"{'='*50}")
    print(f"访问地址：http://localhost:{port}")
    print(f"{'='*50}\n")

    # 自动打开浏览器
    def open_browser():
        time.sleep(1.5)
        webbrowser.open(f'http://localhost:{port}')

    threading.Thread(target=open_browser, daemon=True).start()
    
    # 使用安静的日志级别运行

# ============ 广场下载 API ============

@app.route('/api/market/prompts/apply', methods=['POST'])
def apply_prompt():
    """应用提示词到 AI 人设"""
    try:
        data = request.get_json()
        prompt_content = data.get('content', '')
        
        # 更新 config.json 中的 system_prompt
        config = load_config()
        if 'llm' not in config:
            config['llm'] = {}
        config['llm']['system_prompt'] = prompt_content
        
        if save_config(config):
            return jsonify({'success': True, 'message': '提示词已应用到 AI 人设'})
        return jsonify({'success': False, 'error': '保存失败'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/market/tools/download', methods=['POST'])
def download_tool():
    """下载工具到 mcp/tools 目录"""
    try:
        data = request.get_json()
        tool_name = data.get('tool_name', '')
        tool_url = data.get('download_url', '')

        if not tool_name or not tool_url:
            return jsonify({'success': False, 'error': '缺少参数'}), 400

        # 下载工具文件到 mcp/tools 目录
        import urllib.request
        import urllib.error

        mcp_tools_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'tools'
        mcp_tools_path.mkdir(parents=True, exist_ok=True)

        file_path = mcp_tools_path / f'{tool_name}.js'

        # 先检查 URL 是否可访问，并验证返回内容
        req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                # 检查 Content-Type
                content_type = response.headers.get('Content-Type', '')
                if 'text/html' in content_type:
                    return jsonify({'success': False, 'error': '下载链接返回 HTML 页面，请检查 URL 是否正确'}), 500

                # 读取内容
                content = response.read()

                # 检查内容是否以 HTML 开头
                if content.startswith(b'<!DOCTYPE') or content.startswith(b'<!doctype') or content.startswith(b'<html'):
                    return jsonify({'success': False, 'error': '下载内容为 HTML 格式，请检查 URL 是否正确'}), 500

                # 写入文件
                with open(file_path, 'wb') as f:
                    f.write(content)
        except urllib.error.HTTPError as e:
            return jsonify({'success': False, 'error': f'下载失败：HTTP {e.code} {e.reason}'}), 500
        except urllib.error.URLError as e:
            return jsonify({'success': False, 'error': f'下载失败：网络错误 - {e.reason}'}), 500

        return jsonify({'success': True, 'message': f'工具 {tool_name} 已下载到 mcp/tools 目录'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/market/fc-tools/download', methods=['POST'])
def download_fc_tool():
    """下载 FC 工具"""
    try:
        data = request.get_json()
        tool_name = data.get('tool_name', '')
        tool_url = data.get('download_url', '')

        if not tool_name or not tool_url:
            return jsonify({'success': False, 'error': '缺少参数'}), 400

        # 下载工具文件到 server-tools 目录
        import urllib.request
        import urllib.error
        
        server_tools_path = PROJECT_ROOT / 'live-2d' / 'server-tools'
        server_tools_path.mkdir(parents=True, exist_ok=True)

        file_path = server_tools_path / f'{tool_name}.js'
        
        # 先检查 URL 是否可访问，并验证返回内容
        req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                # 检查 Content-Type
                content_type = response.headers.get('Content-Type', '')
                if 'text/html' in content_type:
                    return jsonify({'success': False, 'error': '下载链接返回 HTML 页面，请检查 URL 是否正确'}), 500
                
                # 读取内容
                content = response.read()
                
                # 检查内容是否以 HTML 开头
                if content.startswith(b'<!DOCTYPE') or content.startswith(b'<!doctype') or content.startswith(b'<html'):
                    return jsonify({'success': False, 'error': '下载内容为 HTML 格式，请检查 URL 是否正确'}), 500
                
                # 写入文件
                with open(file_path, 'wb') as f:
                    f.write(content)
        except urllib.error.HTTPError as e:
            return jsonify({'success': False, 'error': f'下载失败：HTTP {e.code} {e.reason}'}), 500
        except urllib.error.URLError as e:
            return jsonify({'success': False, 'error': f'下载失败：网络错误 - {e.reason}'}), 500

        return jsonify({'success': True, 'message': f'FC 工具 {tool_name} 已下载'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500



    app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)


if __name__ == '__main__':
    print("启动 My Neuro 服务控制中心...")
    print("正在初始化 WebUI 控制面板...")
    run_app()


# ============ Live2D 动作管理 API ============

@app.route('/api/live2d/singing/start', methods=['POST'])
def start_singing():
    """开始唱歌"""
    try:
        # 调用 Live2D 唱歌 API（需要根据实际实现调整）
        live2d_api_url = 'http://127.0.0.1:3000/api/singing/start'
        import urllib.request
        req = urllib.request.Request(live2d_api_url, method='POST')
        with urllib.request.urlopen(req, timeout=5) as response:
            pass
        return jsonify({'success': True, 'message': '已开始唱歌'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'启动失败：{str(e)}'}), 500


@app.route('/api/live2d/singing/stop', methods=['POST'])
def stop_singing():
    """停止唱歌"""
    try:
        live2d_api_url = 'http://127.0.0.1:3000/api/singing/stop'
        import urllib.request
        req = urllib.request.Request(live2d_api_url, method='POST')
        with urllib.request.urlopen(req, timeout=5) as response:
            pass
        return jsonify({'success': True, 'message': '已停止唱歌'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'停止失败：{str(e)}'}), 500


@app.route('/api/live2d/motion/reset', methods=['POST'])
def reset_motion():
    """复位动作"""
    try:
        live2d_api_url = 'http://127.0.0.1:3000/api/motion/reset'
        import urllib.request
        req = urllib.request.Request(live2d_api_url, method='POST')
        with urllib.request.urlopen(req, timeout=5) as response:
            pass
        return jsonify({'success': True, 'message': '已复位动作'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'复位失败：{str(e)}'}), 500


@app.route('/api/live2d/motion/preview', methods=['POST'])
def preview_motion():
    """预览动作"""
    try:
        data = request.get_json()
        motion_name = data.get('motion', '')
        
        # 调用 Live2D API 预览动作
        live2d_api_url = 'http://127.0.0.1:3000/api/motion/preview'
        import urllib.request
        import json as json_module
        json_data = json_module.dumps({'motion': motion_name}).encode('utf-8')
        req = urllib.request.Request(live2d_api_url, data=json_data, method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=5) as response:
            pass
        return jsonify({'success': True, 'message': f'正在预览动作：{motion_name}'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'预览失败：{str(e)}'}), 500


@app.route('/api/live2d/motions/uncategorized', methods=['GET'])
def get_uncategorized_motions():
    """获取未分类动作列表"""
    try:
        # 从 live-2d 目录扫描未分类的动作文件
        motions_dir = PROJECT_ROOT / 'live-2d' / 'motions'
        if not motions_dir.exists():
            return jsonify({'motions': []})
        
        motions = []
        for file_path in motions_dir.iterdir():
            if file_path.suffix == '.json' and 'motion' in file_path.name.lower():
                motions.append(file_path.name)
        
        return jsonify({'motions': motions})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/live2d/motions/save', methods=['POST'])
def save_motions():
    """保存动作配置"""
    try:
        data = request.get_json()
        categories = data.get('categories', [])
        
        # 保存动作配置到文件
        motion_config_path = PROJECT_ROOT / 'live-2d' / 'motion_config.json'
        config = {
            'categories': categories,
            'updated_at': datetime.datetime.now().isoformat()
        }
        
        with open(motion_config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        
        return jsonify({'success': True, 'message': '动作配置已保存'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ 声音克隆 API ============

@app.route('/api/voice-clone/generate-bat', methods=['POST'])
def generate_tts_bat():
    """生成 TTS 的 bat 文件"""
    try:
        # 获取上传的文件
        model_file = request.files.get('model_file')
        audio_file = request.files.get('audio_file')
        role_name = request.form.get('role_name', '')
        language = request.form.get('language', 'zh')
        text = request.form.get('text', '')
        
        if not model_file or not audio_file or not role_name or not text:
            return jsonify({'success': False, 'error': '缺少必要参数'}), 400
        
        # 保存到 Voice_Model_Factory 目录
        voice_model_dir = PROJECT_ROOT / 'live-2d' / 'Voice_Model_Factory'
        voice_model_dir.mkdir(parents=True, exist_ok=True)
        
        # 保存模型文件
        model_filename = f'{role_name}.pth'
        model_path = voice_model_dir / model_filename
        model_file.save(model_path)
        
        # 保存音频文件
        audio_filename = f'{role_name}.wav'
        audio_path = voice_model_dir / audio_filename
        audio_file.save(audio_path)
        
        # 生成 bat 文件
        bat_content = f'''@echo off
chcp 65001 >nul
echo.
echo ========================================
echo  TTS 声音克隆 - {role_name}
echo ========================================
echo.
echo 正在生成 TTS...
echo.

python -m tools.tts_inference \\
    --model_path "Voice_Model_Factory/{model_filename}" \\
    --audio_path "Voice_Model_Factory/{audio_filename}" \\
    --language {language} \\
    --text "{text}"

echo.
echo 生成完成！
echo.
pause
'''
        
        bat_path = voice_model_dir / f'{role_name}.bat'
        with open(bat_path, 'w', encoding='utf-8') as f:
            f.write(bat_content)
        
        return jsonify({
            'success': True,
            'message': f'已生成 TTS 的 bat 文件：{role_name}.bat',
            'bat_path': str(bat_path)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
