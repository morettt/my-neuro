# -*- coding: utf-8 -*-
"""加载 MCP 工具的名称与描述（供日志增强显示）。"""
import glob
import json
import os
import re

from .paths import get_app_path


def load_tool_descriptions():
    """加载所有工具的名称和描述"""
    tool_descriptions = {}
    mcp_tools = set()  # MCP工具集合

    try:
        # 获取server-tools目录路径
        app_path = get_app_path()

        # 加载MCP工具描述（mcp/tools目录）
        mcp_tools_path = os.path.join(app_path, "mcp", "tools")
        if os.path.exists(mcp_tools_path):
            mcp_js_files = glob.glob(os.path.join(mcp_tools_path, "*.js"))

            for file_path in mcp_js_files:
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()

                    # MCP工具使用不同的格式：name: "tool_name", description: "描述"
                    pattern = r'name:\s*["\']([^"\']+)["\']\s*,\s*description:\s*["\']([^"\']*(?:[^"\'\\]|\\.)*)["\']'
                    matches = re.findall(pattern, content, re.DOTALL)

                    file_tools = []
                    for name, description in matches:
                        clean_description = re.sub(r'\s+', ' ', description.strip())
                        tool_descriptions[name] = clean_description
                        mcp_tools.add(name)  # 记录为MCP工具
                        file_tools.append(name)

                    if file_tools:
                        filename = os.path.basename(file_path)
                        print(f"MCP文件 {filename} 包含工具: {', '.join(file_tools)}")

                except Exception as e:
                    print(f"读取MCP工具文件失败 {file_path}: {e}")

        # 从 mcp_config.json 读取外部MCP工具配置（如playwright）
        mcp_config_path = os.path.join(app_path, "mcp", "mcp_config.json")
        if os.path.exists(mcp_config_path):
            try:
                with open(mcp_config_path, 'r', encoding='utf-8') as f:
                    mcp_config = json.load(f)

                for tool_name, config in mcp_config.items():
                    # 跳过禁用的工具
                    if tool_name.endswith('_disabled'):
                        continue

                    # 检查配置的args，判断是否指向本地文件
                    args = config.get('args', [])
                    is_local_tool = False

                    # 如果args中包含 ./mcp/tools/ 路径，说明是本地工具
                    for arg in args:
                        if isinstance(arg, str) and './mcp/tools/' in arg:
                            is_local_tool = True
                            break

                    # 只添加真正的外部工具（非本地文件）
                    if not is_local_tool and tool_name not in mcp_tools:
                        # 为外部MCP工具添加默认描述
                        command = config.get('command', '')
                        description = f"外部MCP工具 (通过 {command} 启动)"

                        tool_descriptions[tool_name] = description
                        mcp_tools.add(tool_name)
                        print(f"从配置加载外部MCP工具: {tool_name} - {description}")

            except Exception as e:
                print(f"读取MCP配置文件失败 {mcp_config_path}: {e}")

    except Exception as e:
        print(f"加载工具描述失败: {e}")

    return tool_descriptions, mcp_tools
