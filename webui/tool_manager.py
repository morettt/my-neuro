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
    mcp_config_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'mcp_config.json'
    mcp_tools_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'tools'
    
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


@tool_bp.route('/api/tools/list/fc')
def list_fc_tools():
    """列出 Function Call 工具（server-tools 目录）"""
    try:
        server_tools_path = PROJECT_ROOT / 'live-2d' / 'server-tools'
        tools = scan_tools_directory(server_tools_path, 'fc')
        return jsonify({'tools': tools})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@tool_bp.route('/api/tools/list/mcp')
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
            mcp_config_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'mcp_config.json'
            
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
            dir_path = PROJECT_ROOT / 'live-2d' / 'server-tools'
        elif tool_type == 'mcp':
            dir_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'tools'
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
