"""
工具管理 - 处理工具相关 API
"""
import json
import logging
import sys
from pathlib import Path

from flask import Blueprint, request, jsonify

# 设置项目根目录
PROJECT_ROOT = Path(__file__).parent.parent.absolute()

tool_bp = Blueprint('tool', __name__)


def scan_tools_directory(tools_path, tool_type='fc'):
    """扫描工具目录，返回工具列表"""
    tools = []
    if not tools_path.exists():
        return tools

    for file in tools_path.iterdir():
        if file.suffix in ['.js', '.txt']:
            is_enabled = file.suffix == '.js'
            tools.append({
                'name': file.stem,
                'description': get_tool_description(file),
                'short_desc': get_tool_short_description(file),
                'enabled': is_enabled,
                'type': tool_type,
                'is_external': False
            })

    return tools


def get_tool_description(file_path):
    """从工具文件读取描述信息"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            # 查找注释中的描述
            lines = content.split('\n')
            for line in lines:
                if line.startswith('//') or line.startswith('/*') or line.startswith('*'):
                    desc = line.lstrip('/').lstrip('*').strip()
                    if desc and not desc.startswith('@'):
                        return desc
        return "无描述"
    except Exception as e:
        return f"无法读取描述：{e}"


def get_tool_short_description(file_path):
    """从工具文件读取简短描述（第一行注释）"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            lines = content.split('\n')
            for line in lines:
                if line.startswith('//'):
                    desc = line[2:].strip()
                    if desc and not desc.startswith('@'):
                        return desc
        return "无描述"
    except Exception as e:
        return "无法读取描述"


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
                'name': actual_name,  # 使用实际名称（不含 _disabled）
                'config_key': tool_name,  # 保存原始配置键名
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


import os

@tool_bp.route('/api/tools/list')
def list_tools():
    """列出可用工具（已废弃，保留用于兼容）"""
    return list_all_tools()


@tool_bp.route('/api/tools/list/all')
def list_all_tools():
    """列出所有工具（FC + MCP）"""
    try:
        fc_tools_path = PROJECT_ROOT / 'server-tools'
        fc_tools = scan_tools_directory(fc_tools_path, 'fc')

        mcp_tools_path = PROJECT_ROOT / 'mcp' / 'tools'
        mcp_tools = scan_tools_directory(mcp_tools_path, 'mcp')

        # 添加外部 MCP 工具
        external_tools = get_external_mcp_tools()
        mcp_tools.extend(external_tools)

        return jsonify({
            'fc_tools': fc_tools,
            'mcp_tools': mcp_tools
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@tool_bp.route('/api/tools/list/fc')
def list_fc_tools():
    """列出 FC 工具"""
    try:
        fc_tools_path = PROJECT_ROOT / 'server-tools'
        tools = scan_tools_directory(fc_tools_path, 'fc')
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

            # 查找实际名称对应的配置键（可能是 name 或 name_disabled）
            disabled_key = tool_name + '_disabled'
            is_disabled = disabled_key in mcp_config
            config_key = disabled_key if is_disabled else tool_name

            if is_disabled:
                # 当前是禁用状态，启用它
                tool_config = mcp_config.pop(disabled_key)
                mcp_config[tool_name] = tool_config
                action = 'enabled'
            else:
                # 当前是启用状态，禁用它
                tool_config = mcp_config.pop(tool_name)
                mcp_config[disabled_key] = tool_config
                action = 'disabled'

            with open(mcp_config_path, 'w', encoding='utf-8') as f:
                json.dump(mcp_config, f, indent=2, ensure_ascii=False)

            return jsonify({
                'success': True,
                'action': action,
                'enabled': action == 'enabled'
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
    """列出可用模型（扫描 2D 目录下的模型文件夹）"""
    try:
        models_path = PROJECT_ROOT / '2D'
        models = []

        if models_path.exists():
            for model_dir in models_path.iterdir():
                if model_dir.is_dir():
                    models.append(model_dir.name)

        return jsonify({'models': models})
    except Exception as e:
        logger.error(f'获取模型列表失败：{e}')
        return jsonify({'error': str(e)}), 500
