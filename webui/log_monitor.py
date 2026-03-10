#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 日志与监控模块
负责日志读取、心情状态监控和 Live2D 动作管理
"""

import json
import datetime
import urllib.request
from collections import deque
from flask import Blueprint, request, jsonify

from .utils import PROJECT_ROOT, logger

# 创建日志监控蓝图
log_bp = Blueprint('log', __name__)


# ============ 日志 API ============

@log_bp.route('/api/logs/<log_type>')
def get_logs(log_type):
    """获取指定类型的日志（优化版：只读取最后 100 行）"""
    try:
        log_file = PROJECT_ROOT / 'live-2d' / 'runtime.log'
        if not log_file.exists():
            return jsonify({'logs': [], 'error': '日志文件不存在'})

        try:
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                last_lines = deque(f, maxlen=100)

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


@log_bp.route('/api/logs/tail/<log_type>')
def tail_logs(log_type):
    """获取日志的最新内容（增量）"""
    try:
        log_file = PROJECT_ROOT / 'live-2d' / 'runtime.log'
        if not log_file.exists():
            return jsonify({'logs': [], 'error': '日志文件不存在'})

        try:
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                last_lines = deque(f, maxlen=10)

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


# ============ 心情状态 API ============

@log_bp.route('/api/mood/status')
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


# ============ Live2D 动作管理 API ============

@log_bp.route('/api/live2d/singing/start', methods=['POST'])
def start_singing():
    """开始唱歌"""
    try:
        live2d_api_url = 'http://127.0.0.1:3000/api/singing/start'
        req = urllib.request.Request(live2d_api_url, method='POST')
        with urllib.request.urlopen(req, timeout=5) as response:
            pass
        return jsonify({'success': True, 'message': '已开始唱歌'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'启动失败：{str(e)}'}), 500


@log_bp.route('/api/live2d/singing/stop', methods=['POST'])
def stop_singing():
    """停止唱歌"""
    try:
        live2d_api_url = 'http://127.0.0.1:3000/api/singing/stop'
        req = urllib.request.Request(live2d_api_url, method='POST')
        with urllib.request.urlopen(req, timeout=5) as response:
            pass
        return jsonify({'success': True, 'message': '已停止唱歌'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'停止失败：{str(e)}'}), 500


@log_bp.route('/api/live2d/motion/reset', methods=['POST'])
def reset_motion():
    """复位动作"""
    try:
        live2d_api_url = 'http://127.0.0.1:3000/api/motion/reset'
        req = urllib.request.Request(live2d_api_url, method='POST')
        with urllib.request.urlopen(req, timeout=5) as response:
            pass
        return jsonify({'success': True, 'message': '已复位动作'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'复位失败：{str(e)}'}), 500


@log_bp.route('/api/live2d/motion/preview', methods=['POST'])
def preview_motion():
    """预览动作"""
    try:
        data = request.get_json()
        motion_name = data.get('motion', '')
        
        live2d_api_url = 'http://127.0.0.1:3000/api/motion/preview'
        json_data = json.dumps({'motion': motion_name}).encode('utf-8')
        req = urllib.request.Request(live2d_api_url, data=json_data, method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=5) as response:
            pass
        return jsonify({'success': True, 'message': f'正在预览动作：{motion_name}'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'预览失败：{str(e)}'}), 500


@log_bp.route('/api/live2d/motions/uncategorized', methods=['GET'])
def get_uncategorized_motions():
    """获取未分类动作列表"""
    try:
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


@log_bp.route('/api/live2d/motions/save', methods=['POST'])
def save_motions():
    """保存动作配置"""
    try:
        data = request.get_json()
        categories = data.get('categories', [])
        
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

@log_bp.route('/api/voice-clone/generate-bat', methods=['POST'])
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
