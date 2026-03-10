#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 广场与资源模块
负责提示词广场、插件广场、工具广场的下载功能
"""

import json
import urllib.request
import urllib.error
from flask import Blueprint, request, jsonify

from .utils import PROJECT_ROOT, logger

# 创建广场模块蓝图
market_bp = Blueprint('market', __name__)


# ============ 提示词广场 ============

@market_bp.route('/api/market/prompts', methods=['GET'])
def get_prompt_market():
    """获取提示词广场列表（从远程服务器）"""
    try:
        req = urllib.request.Request('http://mynewbot.com/api/get-prompts')
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

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


@market_bp.route('/api/market/prompts/apply', methods=['POST'])
def apply_prompt():
    """应用提示词到 AI 人设"""
    try:
        data = request.get_json()
        prompt_content = data.get('content', '')
        
        # 更新 config.json 中的 system_prompt
        from .config_manager import load_config, save_config
        config = load_config()
        if 'llm' not in config:
            config['llm'] = {}
        config['llm']['system_prompt'] = prompt_content
        
        if save_config(config):
            return jsonify({'success': True, 'message': '提示词已应用到 AI 人设'})
        return jsonify({'success': False, 'error': '保存失败'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ 插件广场 ============

@market_bp.route('/api/market/plugins', methods=['GET'])
def get_plugin_market():
    """获取插件广场列表（从本地 plugin_hub.json 文件）"""
    try:
        plugin_hub_path = PROJECT_ROOT / 'live-2d' / 'plugins' / 'plugin-house' / 'plugin_hub.json'
        
        if not plugin_hub_path.exists():
            return jsonify({
                'success': False,
                'error': '插件商店数据文件不存在'
            }), 500
        
        with open(plugin_hub_path, 'r', encoding='utf-8') as f:
            plugins_data = json.load(f)
        
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


@market_bp.route('/api/market/plugins/download', methods=['POST'])
def download_plugin():
    """下载插件"""
    try:
        data = request.get_json()
        plugin_name = data.get('plugin_name', '')
        plugin_url = data.get('download_url', '')

        if not plugin_name or not plugin_url:
            return jsonify({'success': False, 'error': '缺少参数'}), 400

        # 下载插件到 community 目录
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


# ============ 工具广场 ============

@market_bp.route('/api/market/tools', methods=['GET'])
def get_tool_market():
    """获取工具广场列表（从远程服务器）"""
    try:
        req = urllib.request.Request('http://mynewbot.com/api/get-tools')
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        if data.get('success'):
            # 处理工具数据，确保每个工具都有download_url
            tools = data.get('tools', [])
            processed_tools = []
            for tool in tools:
                # 如果没有download_url或为空，尝试构建
                download_url = tool.get('download_url')
                if not download_url:  # 处理 None、空字符串、undefined
                    # 优先使用 filename（服务器上的实际文件名），其次用 id 或 name
                    filename = tool.get('filename')  # 服务器上的实际文件名
                    tool_id = tool.get('id')
                    tool_name = tool.get('name') or tool.get('tool_name')
                    
                    if filename:
                        # 使用 filename 构建下载URL
                        tool['download_url'] = f"http://mynewbot.com/api/download-tool/{filename}"
                        logger.info(f'使用 filename 构建下载URL: {tool["download_url"]}')
                    elif tool_id and tool_id > 0:
                        tool['download_url'] = f"http://mynewbot.com/api/download-tool/{tool_id}"
                        logger.info(f'使用 id 构建下载URL: {tool["download_url"]}')
                    else:
                        logger.warning(f'工具缺少 download_url、filename 和有效 id: {tool}')
                
                processed_tools.append(tool)
            
            return jsonify({
                'success': True,
                'tools': processed_tools
            })
        else:
            return jsonify({
                'success': False,
                'error': '获取工具列表失败'
            }), 500
    except Exception as e:
        logger.error(f'获取工具列表失败: {str(e)}')
        return jsonify({
            'success': False,
            'error': f'网络请求失败：{str(e)}'
        }), 500


@market_bp.route('/api/market/tools/download', methods=['POST'])
def download_tool():
    """下载工具到 mcp/tools 目录"""
    try:
        data = request.get_json()
        tool_name = data.get('tool_name', '')
        # 兼容两种参数名：download_url 和 tool_url
        tool_url = data.get('download_url', '') or data.get('tool_url', '')
        file_name = data.get('file_name', '')

        if not tool_name or not tool_url:
            logger.error(f'下载工具失败：缺少参数 - tool_name={tool_name}, tool_url={tool_url}')
            return jsonify({'success': False, 'error': '缺少参数：tool_name 和 download_url'}), 400

        # 下载工具文件到 mcp/tools 目录
        mcp_tools_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'tools'
        mcp_tools_path.mkdir(parents=True, exist_ok=True)

        file_path = mcp_tools_path / f'{tool_name}.js'

        req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                content_type = response.headers.get('Content-Type', '')
                if 'text/html' in content_type:
                    return jsonify({'success': False, 'error': '下载链接返回 HTML 页面，请检查 URL 是否正确'}), 500

                content = response.read()

                if content.startswith(b'<!DOCTYPE') or content.startswith(b'<!doctype') or content.startswith(b'<html'):
                    return jsonify({'success': False, 'error': '下载内容为 HTML 格式，请检查 URL 是否正确'}), 500

                with open(file_path, 'wb') as f:
                    f.write(content)
        except urllib.error.HTTPError as e:
            return jsonify({'success': False, 'error': f'下载失败：HTTP {e.code} {e.reason}'}), 500
        except urllib.error.URLError as e:
            return jsonify({'success': False, 'error': f'下载失败：网络错误 - {e.reason}'}), 500

        return jsonify({'success': True, 'message': f'工具 {tool_name} 已下载到 mcp/tools 目录'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ FC 工具广场 ============

@market_bp.route('/api/market/fc-tools', methods=['GET'])
def get_fc_market():
    """获取 FC 广场列表（从远程服务器）"""
    try:
        req = urllib.request.Request('http://mynewbot.com/api/get-fc-tools')
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        if data.get('success'):
            # 处理FC工具数据，确保每个工具都有download_url
            fc_tools = data.get('fc_tools', [])
            processed_tools = []
            for tool in fc_tools:
                # 如果没有download_url或为空，尝试从id构建
                download_url = tool.get('download_url')
                if not download_url:  # 处理 None、空字符串、undefined
                    tool_id = tool.get('id') or tool.get('tool_id') or tool.get('name')
                    if tool_id:
                        tool['download_url'] = f"http://mynewbot.com/api/download-fc-tool/{tool_id}"
                    else:
                        logger.warning(f'FC工具缺少 download_url 和 id: {tool.get("name", "未知")}')
                processed_tools.append(tool)
            
            return jsonify({
                'success': True,
                'fc_tools': processed_tools
            })
        else:
            return jsonify({
                'success': False,
                'error': '获取 FC 工具列表失败'
            }), 500
    except Exception as e:
        logger.error(f'获取 FC 工具列表失败: {str(e)}')
        return jsonify({
            'success': False,
            'error': f'网络请求失败：{str(e)}'
        }), 500


@market_bp.route('/api/market/fc-tools/download', methods=['POST'])
def download_fc_tool():
    """下载 FC 工具"""
    try:
        data = request.get_json()
        tool_name = data.get('tool_name', '')
        tool_url = data.get('download_url', '')

        if not tool_name or not tool_url:
            return jsonify({'success': False, 'error': '缺少参数'}), 400

        # 下载工具文件到 server-tools 目录
        server_tools_path = PROJECT_ROOT / 'live-2d' / 'server-tools'
        server_tools_path.mkdir(parents=True, exist_ok=True)

        file_path = server_tools_path / f'{tool_name}.js'
        
        req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                content_type = response.headers.get('Content-Type', '')
                if 'text/html' in content_type:
                    return jsonify({'success': False, 'error': '下载链接返回 HTML 页面，请检查 URL 是否正确'}), 500
                
                content = response.read()
                
                if content.startswith(b'<!DOCTYPE') or content.startswith(b'<!doctype') or content.startswith(b'<html'):
                    return jsonify({'success': False, 'error': '下载内容为 HTML 格式，请检查 URL 是否正确'}), 500
                
                with open(file_path, 'wb') as f:
                    f.write(content)
        except urllib.error.HTTPError as e:
            return jsonify({'success': False, 'error': f'下载失败：HTTP {e.code} {e.reason}'}), 500
        except urllib.error.URLError as e:
            return jsonify({'success': False, 'error': f'下载失败：网络错误 - {e.reason}'}), 500

        return jsonify({'success': True, 'message': f'FC 工具 {tool_name} 已下载'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
