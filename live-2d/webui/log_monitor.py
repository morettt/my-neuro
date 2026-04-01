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

from .utils import PROJECT_ROOT, DATA_ROOT, logger

# 创建日志监控蓝图
log_bp = Blueprint('log', __name__)


# ============ 日志 API ============

@log_bp.route('/api/logs/<log_type>')
def get_logs(log_type):
    """获取指定类型的日志（优化版：只读取最后 100 行）"""
    try:
        log_file = PROJECT_ROOT / 'runtime.log'
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
        log_file = PROJECT_ROOT / 'runtime.log'
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


# ============ Live2D 动作管理 API ============
# 注意：这些 API 已在 config_manager.py 中定义，此处注释掉避免冲突

# @log_bp.route('/api/live2d/singing/start', methods=['POST'])
# def start_singing():
#     """开始唱歌"""
#     try:
#         try:
#             json_data = json.dumps({'action': 'trigger_emotion', 'emotion_name': '唱歌'}).encode('utf-8')
#             req = urllib.request.Request('http://localhost:3002/control-motion', data=json_data, method='POST')
#             req.add_header('Content-Type', 'application/json')
#             with urllib.request.urlopen(req, timeout=2) as response:
#                 if response.status == 200:
#                     return jsonify({'success': True, 'message': '已开始唱歌'})
#         except Exception:
#             pass
#         return jsonify({'success': True, 'message': '唱歌请求已发送'})
#     except Exception as e:
#         return jsonify({'error': str(e)}), 500
#
#
# @log_bp.route('/api/live2d/singing/stop', methods=['POST'])
# def stop_singing():
#     """停止唱歌"""
#     try:
#         try:
#             json_data = json.dumps({'action': 'trigger_emotion', 'emotion_name': '停止'}).encode('utf-8')
#             req = urllib.request.Request('http://localhost:3002/control-motion', data=json_data, method='POST')
#             req.add_header('Content-Type', 'application/json')
#             with urllib.request.urlopen(req, timeout=2) as response:
#                 if response.status == 200:
#                     return jsonify({'success': True, 'message': '已停止唱歌'})
#         except Exception:
#             pass
#         return jsonify({'success': True, 'message': '停止请求已发送'})
#     except Exception as e:
#         return jsonify({'error': str(e)}), 500
#
#
# @log_bp.route('/api/live2d/motion/reset', methods=['POST'])
# def reset_motion():
#     """复位动作配置（从备份恢复）"""
#     try:
#         import re
#         
#         # 从 main.js 读取当前模型名
#         live2d_path = PROJECT_ROOT / 'live-2d'
#         main_js_path = live2d_path / 'main.js'
#         model_name = '肥牛'  # 默认
#         
#         if main_js_path.exists():
#             with open(main_js_path, 'r', encoding='utf-8') as f:
#                 content = f.read()
#             match = re.search(r"const priorityFolders = \['([^']+)'", content)
#             if match:
#                 model_name = match.group(1)
#         
#         # 从备份配置恢复
#         backup_path = live2d_path / 'character_backups.json'
#         config_path = live2d_path / 'emotion_actions.json'
#
#         if backup_path.exists():
#             with open(backup_path, 'r', encoding='utf-8') as f:
#                 backup = json.load(f)
#
#             # 读取现有配置（保留其他模型的数据）
#             existing_config = {}
#             if config_path.exists():
#                 with open(config_path, 'r', encoding='utf-8') as f:
#                     existing_config = json.load(f)
#
#             # 从备份中提取当前模型的动作配置
#             if model_name in backup:
#                 model_backup = backup[model_name]
#                 if 'original_config' in model_backup:
#                     emotion_actions = model_backup['original_config'].get('emotion_actions', {})
#                     existing_config[model_name] = {
#                         'emotion_actions': emotion_actions
#                     }
#                 else:
#                     existing_config[model_name] = model_backup
#
#             with open(config_path, 'w', encoding='utf-8') as f:
#                 json.dump(existing_config, f, ensure_ascii=False, indent=2)
#
#             logger.info(f'动作配置已从备份恢复（模型：{model_name}）')
#             return jsonify({'success': True, 'message': '动作配置已重置'})
#         else:
#             logger.error(f'备份文件不存在：{backup_path}')
#             return jsonify({'success': False, 'error': '备份文件不存在'})
#     except Exception as e:
#         logger.error(f'重置动作配置失败：{str(e)}')
#         return jsonify({'success': False, 'error': str(e)}), 500
#
#
# @log_bp.route('/api/live2d/motion/preview', methods=['POST'])
# def preview_motion():
#     """预览动作"""
#     try:
#         data = request.get_json()
#         motion_name = data.get('motion', '')
#         
#         # 使用 trigger_emotion action 来触发情绪对应的动作
#         try:
#             json_data = json.dumps({
#                 'action': 'trigger_emotion',
#                 'emotion_name': motion_name
#             }).encode('utf-8')
#             req = urllib.request.Request('http://localhost:3002/control-motion', data=json_data, method='POST')
#             req.add_header('Content-Type', 'application/json')
#             with urllib.request.urlopen(req, timeout=2) as response:
#                 if response.status == 200:
#                     return jsonify({'success': True, 'message': f'正在预览动作：{motion_name}'})
#         except Exception as http_error:
#             logger.warning(f'HTTP 请求失败：{http_error}')
#
#         return jsonify({'success': True, 'message': f'预览请求已发送：{motion_name}'})
#     except Exception as e:
#         return jsonify({'error': str(e)}), 500


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
        voice_model_dir = PROJECT_ROOT / 'Voice_Model_Factory'
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


# ============ 对话历史 API ============

@log_bp.route('/api/chat-history')
def get_chat_history():
    """获取对话历史记录（支持分页）"""
    try:
        # 获取分页参数
        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 50, type=int)
        
        # 对话历史文件路径
        history_file = DATA_ROOT / 'AI记录室' / '对话历史.jsonl'
        
        if not history_file.exists():
            return jsonify({'messages': [], 'has_more': False, 'has_prev': False, 'total': 0})

        # 读取所有对话
        messages = []
        with open(history_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        messages.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue

        total = len(messages)

        # 分页：返回指定范围的对话（保持原文件顺序，旧→新）
        # 第一页返回最早的对话，最后一页返回最新的对话
        start = (page - 1) * page_size
        end = start + page_size
        page_messages = messages[start:end]

        return jsonify({
            'messages': page_messages,
            'has_more': end < total,  # 是否有下一页（更新的对话）
            'has_prev': page > 1,     # 是否有上一页（更早的对话）
            'total': total
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@log_bp.route('/api/chat-history/clear', methods=['POST'])
def clear_chat_history():
    """清空对话历史记录"""
    try:
        history_file = DATA_ROOT / 'AI记录室' / '对话历史.jsonl'
        
        if history_file.exists():
            # 清空文件内容
            with open(history_file, 'w', encoding='utf-8') as f:
                pass
        
        return jsonify({'success': True, 'message': '对话历史已清空'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
