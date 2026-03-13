#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 工具管理模块
负责 FC 工具和 MCP 工具的扫描、启用/禁用管理
"""

import re
import json
from flask import Blueprint, request, jsonify

from .utils import PROJECT_ROOT, logger

# 创建工具管理蓝图
tool_bp = Blueprint('tool', __name__)

# 需要跳过的文件
SKIP_FILES = {'index.js', 'note_server.js', 'pc_control_server.js', 'music_control.js', 'search_server.js'}


def scan_tools_directory(dir_path, tool_type):
    """扫描工具目录，返回工具列表"""
    tools = []
    if not dir_path.exists():
        return tools
    
    for file_path in dir_path.iterdir():
        if not file_path.is_file():
            continue
            
        # 检查 .js 文件（已启用）或 .txt 文件（已禁用）
        if file_path.suffix not in ['.js', '.txt']:
            continue
            
        # 跳过 index.js 等文件
        if file_path.name in SKIP_FILES:
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
            'short_desc': short_desc,
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

        # 优先尝试从 JS 代码中提取 name 和 description 字段
        pattern = r'name:\s*["\']([^"\']+)["\']\s*,\s*description:\s*["\']([^"\']*(?:[^"\'\\]|\\.)*)["\']'
        matches = re.findall(pattern, content, re.DOTALL)

        if matches:
            name, description = matches[0]
            clean_desc = re.sub(r'\s+', ' ', description.strip())
            short_desc = clean_desc.split('.')[0].split('。')[0].strip()
            if len(short_desc) > 30:
                short_desc = short_desc[:27] + '...'
            return clean_desc, short_desc

        # 如果没有找到 name/description 字段，尝试从文件头注释提取
        match = re.search(r'/\*\*(.*?)\*/', content, re.DOTALL)
        if match:
            desc = match.group(1).strip()
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
    mcp_config_path = PROJECT_ROOT / 'mcp' / 'mcp_config.json'
    mcp_tools_path = PROJECT_ROOT / 'mcp' / 'tools'
    
    if not mcp_config_path.exists():
        return tools
    
    try:
        with open(mcp_config_path, 'r', encoding='utf-8') as f:
            mcp_config = json.load(f)
        
        for tool_name, config in mcp_config.items():
            is_disabled = tool_name.endswith('_disabled')
            actual_name = tool_name[:-9] if is_disabled else tool_name
            
            # 检查是否有对应的本地文件
            local_js = mcp_tools_path / f"{actual_name}.js"
            local_txt = mcp_tools_path / f"{actual_name}.txt"
            has_local_file = local_js.exists() or local_txt.exists()
            
            if has_local_file:
                continue
            
            command = config.get('command', '')
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


@tool_bp.route('/api/tools/list')
def list_tools():
    """列出可用工具（已废弃，保留用于兼容）"""
    return list_all_tools()


@tool_bp.route('/api/tools/list/all')
def list_all_tools():
    """列出所有工具（FC + MCP）"""
    try:
        server_tools_path = PROJECT_ROOT / 'server-tools'
        mcp_tools_path = PROJECT_ROOT / 'mcp' / 'tools'
        
        fc_tools = scan_tools_directory(server_tools_path, 'fc')
        mcp_tools = scan_tools_directory(mcp_tools_path, 'mcp')
        
        return jsonify({
            'fc_tools': fc_tools,
            'mcp_tools': mcp_tools
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@tool_bp.route('/api/tools/list/fc')
def list_fc_tools():
    """列出 Function Call 工具（server-tools 目录）"""
    try:
        server_tools_path = PROJECT_ROOT / 'server-tools'
        tools = scan_tools_directory(server_tools_path, 'fc')
        return jsonify({'tools': tools})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@tool_bp.route('/api/tools/list/mcp')
def list_mcp_tools():
    """列出 MCP 工具（mcp/tools 目录 + 外部工具）"""
    try:
        mcp_tools_path = PROJECT_ROOT / 'mcp' / 'tools'
        tools = scan_tools_directory(mcp_tools_path, 'mcp')
        
        # 添加外部 MCP 工具
        external_tools = get_external_mcp_tools()
        tools.extend(external_tools)
        
        return jsonify({'tools': tools})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


import os

@tool_bp.route('/api/tools/toggle', methods=['POST'])
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
            mcp_config_path = PROJECT_ROOT / 'mcp' / 'mcp_config.json'
            
            if not mcp_config_path.exists():
                return jsonify({'success': False, 'error': 'MCP 配置文件不存在'}), 404
            
            with open(mcp_config_path, 'r', encoding='utf-8') as f:
                mcp_config = json.load(f)
            
            is_disabled = tool_name.endswith('_disabled')
            actual_name = tool_name[:-9] if is_disabled else tool_name
            
            if is_disabled:
                new_name = actual_name
                tool_config = mcp_config.pop(tool_name)
                mcp_config[new_name] = tool_config
                action = 'enabled'
            else:
                new_name = tool_name + '_disabled'
                tool_config = mcp_config.pop(tool_name)
                mcp_config[new_name] = tool_config
                action = 'disabled'
            
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
            dir_path = PROJECT_ROOT / 'server-tools'
        elif tool_type == 'mcp':
            dir_path = PROJECT_ROOT / 'mcp' / 'tools'
        else:
            return jsonify({'success': False, 'error': '无效的工具类型'}), 400
        
        js_file = dir_path / f"{tool_name}.js"
        txt_file = dir_path / f"{tool_name}.txt"
        
        if js_file.exists():
            js_file.rename(txt_file)
            action = 'disabled'
        elif txt_file.exists():
            txt_file.rename(js_file)
            action = 'enabled'
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


@tool_bp.route('/api/models/list')
def list_models():
    """列出可用的 Live2D 模型"""
    try:
        models_path = PROJECT_ROOT / '2D'
        models = []
        if models_path.exists():
            for folder in models_path.iterdir():
                if folder.is_dir():
                    for file in folder.iterdir():
                        # 使用 name.endswith() 而不是 suffix 来匹配 .model3.json 文件
                        if file.name.endswith('.model3.json'):
                            models.append(folder.name)
                            break
        return jsonify(models)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ Live2D 动作/表情管理 API ============

def get_current_model():
    """获取当前模型名称"""
    try:
        config_path = PROJECT_ROOT / 'config.json'
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                return config.get('current_model', '肥牛')
    except Exception as e:
        logger.warning(f'读取当前模型失败: {e}')
    return '肥牛'


@tool_bp.route('/api/live2d/motions/categorized')
def get_categorized_motions():
    """获取已分类的动作列表"""
    try:
        import re
        # 从 main.js 读取当前模型名
        main_js_path = PROJECT_ROOT / 'main.js'
        model_name = '肥牛'  # 默认
        
        if main_js_path.exists():
            with open(main_js_path, 'r', encoding='utf-8') as f:
                content = f.read()
            match = re.search(r"const priorityFolders = \['([^']+)'", content)
            if match:
                model_name = match.group(1)
        actions_path = PROJECT_ROOT / 'emotion_actions.json'
        
        if not actions_path.exists():
            return jsonify({'categorized': {}})
        
        with open(actions_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        model_data = data.get(model_name, {})
        emotion_actions = model_data.get('emotion_actions', {})
        
        emotion_categories = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮']
        categorized = {}
        
        for emotion in emotion_categories:
            motions = emotion_actions.get(emotion, [])
            categorized[emotion] = motions
        
        return jsonify({'categorized': categorized})
    except Exception as e:
        logger.error(f'获取已分类动作失败: {e}')
        return jsonify({'error': str(e)}), 500


@tool_bp.route('/api/live2d/motions/uncategorized')
def get_uncategorized_motions():
    """获取未分类的动作列表"""
    try:
        model_name = get_current_model()
        actions_path = PROJECT_ROOT / 'emotion_actions.json'
        
        if not actions_path.exists():
            return jsonify({'motions': []})
        
        with open(actions_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        model_data = data.get(model_name, {})
        emotion_actions = model_data.get('emotion_actions', {})
        
        emotion_categories = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮']
        
        categorized_motions = set()
        for emotion in emotion_categories:
            motions = emotion_actions.get(emotion, [])
            categorized_motions.update(motions)
        
        uncategorized = []
        for key, motions in emotion_actions.items():
            if key not in emotion_categories:
                for motion in motions:
                    if motion not in categorized_motions:
                        uncategorized.append(motion)
        
        return jsonify({'motions': uncategorized})
    except Exception as e:
        logger.error(f'获取未分类动作失败: {e}')
        return jsonify({'error': str(e)}), 500


@tool_bp.route('/api/live2d/motions/save', methods=['POST'])
def save_motions():
    """保存动作配置"""
    try:
        import re
        
        data = request.get_json()
        categories = data.get('categories', [])
        
        # 从 main.js 读取当前模型名
        main_js_path = PROJECT_ROOT / 'main.js'
        model_name = '肥牛'  # 默认
        
        if main_js_path.exists():
            with open(main_js_path, 'r', encoding='utf-8') as f:
                js_content = f.read()
            match = re.search(r"const priorityFolders = \['([^']+)'", js_content)
            if match:
                model_name = match.group(1)
        
        actions_path = PROJECT_ROOT / 'emotion_actions.json'
        
        # 读取现有配置（保留其他模型的数据）
        existing_config = {}
        if actions_path.exists():
            with open(actions_path, 'r', encoding='utf-8') as f:
                existing_config = json.load(f)
        else:
            existing_config = {}
        
        # 确保模型配置存在
        if model_name not in existing_config:
            existing_config[model_name] = {'emotion_actions': {}}
        
        # 保留现有的所有动作（包括自定义动作）
        existing_actions = existing_config[model_name].get('emotion_actions', {})
        
        # 只更新 6 个标准情绪分类
        emotion_categories = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮']
        for category in categories:
            name = category.get('name')
            motions = category.get('motions', [])
            if name in emotion_categories:
                existing_actions[name] = motions
        
        # 更新配置
        existing_config[model_name]['emotion_actions'] = existing_actions
        
        with open(actions_path, 'w', encoding='utf-8') as f:
            json.dump(existing_config, f, indent=2, ensure_ascii=False)
        return jsonify({'success': True, 'message': '动作配置已保存'})
    except Exception as e:
        logger.error(f'保存动作配置失败：{e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@tool_bp.route('/api/live2d/expressions/config')
def get_expression_config():
    """获取表情配置"""
    try:
        model_name = get_current_model()
        expressions_path = PROJECT_ROOT / 'emotion_expressions.json'
        
        if not expressions_path.exists():
            return jsonify({'expressions': {}, 'available_expressions': {}})
        
        with open(expressions_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        model_data = data.get(model_name, {})
        emotion_expressions = model_data.get('emotion_expressions', {})

        emotion_categories = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮']
        expressions = {}
        available_expressions = {}  # 改为映射：{键名：文件路径}

        for key, exprs in emotion_expressions.items():
            if key in emotion_categories:
                expressions[key] = exprs
            else:
                # 自定义键名，添加到可用表情映射
                if exprs:
                    available_expressions[key] = exprs[0]  # 取第一个文件路径

        return jsonify({
            'expressions': expressions,
            'available_expressions': available_expressions
        })
    except Exception as e:
        logger.error(f'获取表情配置失败: {e}')
        return jsonify({'error': str(e)}), 500


@tool_bp.route('/api/live2d/expressions/save', methods=['POST'])
def save_expressions():
    """保存表情配置"""
    try:
        data = request.get_json()
        expressions = data.get('expressions', {})
        
        model_name = get_current_model()
        expressions_path = PROJECT_ROOT / 'emotion_expressions.json'
        
        if expressions_path.exists():
            with open(expressions_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
        else:
            config = {}
        
        if model_name not in config:
            config[model_name] = {'emotion_expressions': {}}
        
        # 更新表情配置
        for emotion, exprs in expressions.items():
            config[model_name]['emotion_expressions'][emotion] = exprs
        
        with open(expressions_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        return jsonify({'success': True, 'message': '表情配置已保存'})
    except Exception as e:
        logger.error(f'保存表情配置失败: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@tool_bp.route('/api/live2d/expressions/reset', methods=['POST'])
def reset_expressions():
    """重置表情配置"""
    try:
        model_name = get_current_model()
        expressions_path = PROJECT_ROOT / 'emotion_expressions.json'
        
        if expressions_path.exists():
            with open(expressions_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
        else:
            config = {}
        
        if model_name not in config:
            config[model_name] = {'emotion_expressions': {}}
        
        # 清空情绪分类的表情
        emotion_categories = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮']
        for emotion in emotion_categories:
            config[model_name]['emotion_expressions'][emotion] = []
        
        with open(expressions_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        return jsonify({'success': True, 'message': '表情配置已重置'})
    except Exception as e:
        logger.error(f'重置表情配置失败: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500
