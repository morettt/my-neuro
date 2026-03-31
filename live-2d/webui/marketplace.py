#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 广场与资源模块
负责提示词广场、插件广场、工具广场的下载功能
"""

import json
import os
import zipfile
import subprocess
import sys
import threading
import shutil
import urllib.request
import urllib.error
from pathlib import Path
from flask import Blueprint, request, jsonify

from .utils import PROJECT_ROOT, logger

# 尝试导入 requests 库，如果不可用则使用 urllib
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    logger.warning('requests 库未安装，将使用 urllib.request 进行下载（功能受限）')

# 创建广场模块蓝图
market_bp = Blueprint('market', __name__)

# 存储正在进行的安装任务
installing_tasks = {}

# 与桌面版 test.py.refresh_plugin_market 一致：上游插件目录索引
PLUGIN_HUB_RAW_URL = (
    'https://raw.githubusercontent.com/morettt/my-neuro/main/'
    'live-2d/plugins/plugin-house/plugin_hub.json'
)


def load_plugin_hub_catalog():
    """优先从 GitHub Raw 拉取 plugin_hub.json，失败则读取本地（与桌面版逻辑一致）。"""
    plugin_hub_path = PROJECT_ROOT / 'plugins' / 'plugin-house' / 'plugin_hub.json'
    remote_err = None

    if HAS_REQUESTS:
        try:
            resp = requests.get(PLUGIN_HUB_RAW_URL, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            remote_err = str(e)
            logger.warning('远程 plugin_hub.json 拉取失败，将尝试本地：%s', e)
    else:
        try:
            req = urllib.request.Request(PLUGIN_HUB_RAW_URL)
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.loads(response.read().decode('utf-8'))
        except Exception as e:
            remote_err = str(e)
            logger.warning('远程 plugin_hub.json 拉取失败，将尝试本地：%s', e)

    if plugin_hub_path.exists():
        with open(plugin_hub_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    raise FileNotFoundError(
        f'无法加载插件商店：远程不可用 ({remote_err})，且本地不存在 {plugin_hub_path}'
    )


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
    """应用提示词到 AI 人设（仅返回内容，由前端设置到输入框）"""
    try:
        data = request.get_json()
        prompt_content = data.get('content', '')

        # 返回提示词内容，由前端设置到输入框
        # 不再直接修改 config.json，让用户在 LLM 配置中手动保存
        return jsonify({'success': True, 'content': prompt_content})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ 插件广场 ============

@market_bp.route('/api/market/plugins', methods=['GET'])
def get_plugin_market():
    """获取插件广场列表（优先远程 Raw，与桌面版一致；失败则用本地 plugin_hub.json）"""
    try:
        plugins_data = load_plugin_hub_catalog()

        # 转换为列表格式，并检测安装状态
        plugins = []
        community_path = PROJECT_ROOT / 'plugins' / 'community'
        
        for key, value in plugins_data.items():
            # 检测是否已安装
            plugin_dir = community_path / key
            is_installed = plugin_dir.exists() and any(plugin_dir.iterdir())
            
            plugins.append({
                'name': key,
                'display_name': value.get('display_name', key),
                'description': value.get('desc', '无描述'),
                'author': value.get('author', '未知'),
                'repo': value.get('repo', ''),
                'download_url': value.get('repo', '') + '/archive/refs/heads/main.zip',
                'installed': is_installed,
                'installing': key in installing_tasks  # 是否正在安装中
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
    """下载插件（异步，自动解压和安装依赖）"""
    try:
        data = request.get_json()
        plugin_name = data.get('plugin_name', '')
        plugin_url = data.get('download_url', '')

        if not plugin_name or not plugin_url:
            return jsonify({'success': False, 'error': '缺少参数'}), 400

        # 检查是否正在安装中
        if plugin_name in installing_tasks:
            return jsonify({'success': False, 'error': '该插件正在安装中'}), 400

        # 检查是否已安装
        community_path = PROJECT_ROOT / 'plugins' / 'community'
        plugin_dir = community_path / plugin_name
        if plugin_dir.exists() and any(plugin_dir.iterdir()):
            return jsonify({'success': False, 'error': '插件已安装'}), 400

        # 创建插件目录
        community_path.mkdir(parents=True, exist_ok=True)
        plugin_dir.mkdir(parents=True, exist_ok=True)

        # 启动后台线程进行下载和安装
        thread = threading.Thread(
            target=_install_plugin_worker,
            args=(plugin_name, plugin_url, plugin_dir),
            daemon=True
        )
        thread.start()

        return jsonify({
            'success': True,
            'message': f'插件 {plugin_name} 开始安装，请稍候...'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def _install_plugin_worker(plugin_name, plugin_url, plugin_dir):
    """后台安装插件的工作线程"""
    try:
        installing_tasks[plugin_name] = {'status': 'downloading', 'progress': 0}
        logger.info(f'开始下载插件：{plugin_name}')

        # 下载 zip 文件
        zip_path = plugin_dir / f'{plugin_name}.zip'
        
        if HAS_REQUESTS:
            # 使用 requests 库（支持进度显示）
            response = requests.get(plugin_url, stream=True, timeout=120)
            response.raise_for_status()
            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0
            
            with open(zip_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_size > 0:
                            installing_tasks[plugin_name]['progress'] = int(downloaded / total_size * 50)
        else:
            # 使用 urllib（无进度显示）
            urllib.request.urlretrieve(plugin_url, zip_path)
            installing_tasks[plugin_name]['progress'] = 50

        logger.info(f'插件下载完成：{plugin_name}')
        installing_tasks[plugin_name]['status'] = 'extracting'

        # 解压 zip 文件
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # 获取 zip 内所有文件的根目录名（通常是 repo-name-branch 格式）
            zip_info_list = zip_ref.namelist()
            if zip_info_list:
                # 找到根目录
                root_dir = zip_info_list[0].split('/')[0]
                
                # 解压所有文件到临时目录
                temp_extract_dir = plugin_dir / 'temp_extract'
                zip_ref.extractall(temp_extract_dir)
                
                # 将根目录内容移动到插件目录
                source_dir = temp_extract_dir / root_dir
                if source_dir.exists():
                    for item in source_dir.iterdir():
                        dest = plugin_dir / item.name
                        if dest.exists():
                            if dest.is_dir():
                                shutil.rmtree(dest)
                            else:
                                dest.unlink()
                        shutil.move(str(item), str(plugin_dir))
                    
                    # 清理临时目录
                    shutil.rmtree(temp_extract_dir)

        # 删除 zip 文件
        zip_path.unlink()
        logger.info(f'插件解压完成：{plugin_name}')
        installing_tasks[plugin_name]['status'] = 'installing_deps'
        installing_tasks[plugin_name]['progress'] = 75

        # 检测并安装依赖
        req_path = plugin_dir / 'requirements.txt'
        if req_path.exists():
            logger.info(f'正在安装插件依赖：{plugin_name}')
            try:
                result = subprocess.run(
                    [sys.executable, '-m', 'pip', 'install', '-r', str(req_path)],
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                if result.returncode != 0:
                    logger.warning(f'插件依赖安装失败：{plugin_name}, {result.stderr}')
                    installing_tasks[plugin_name]['status'] = 'completed_with_warning'
                else:
                    logger.info(f'插件依赖安装完成：{plugin_name}')
            except subprocess.TimeoutExpired:
                logger.warning(f'插件依赖安装超时：{plugin_name}')
                installing_tasks[plugin_name]['status'] = 'completed_with_warning'
        else:
            logger.info(f'插件无需安装依赖：{plugin_name}')

        installing_tasks[plugin_name]['status'] = 'completed'
        installing_tasks[plugin_name]['progress'] = 100
        logger.info(f'插件安装完成：{plugin_name}')
        
        # 清理任务记录（让刷新列表时能正确显示已安装状态）
        import time
        time.sleep(0.3)  # 短暂等待，确保文件写入完成
        if plugin_name in installing_tasks:
            del installing_tasks[plugin_name]

    except Exception as e:
        logger.error(f'插件安装失败：{plugin_name}, {str(e)}')
        installing_tasks[plugin_name]['status'] = 'failed'
        installing_tasks[plugin_name]['error'] = str(e)
        
        # 失败时也清理任务记录
        import time
        time.sleep(0.3)
        if plugin_name in installing_tasks:
            del installing_tasks[plugin_name]
    
    finally:
        # 确保任务被清理
        pass


@market_bp.route('/api/market/plugins/install-status/<plugin_name>', methods=['GET'])
def get_install_status(plugin_name):
    """获取插件安装状态"""
    if plugin_name in installing_tasks:
        task = installing_tasks[plugin_name]
        return jsonify({
            'success': True,
            'installing': True,
            'status': task.get('status', 'unknown'),
            'progress': task.get('progress', 0),
            'error': task.get('error', '')
        })
    else:
        # 检查是否已安装完成
        community_path = PROJECT_ROOT / 'plugins' / 'community'
        plugin_dir = community_path / plugin_name
        is_installed = plugin_dir.exists() and any(plugin_dir.iterdir())
        
        return jsonify({
            'success': True,
            'installing': False,
            'installed': is_installed
        })


@market_bp.route('/api/market/plugins/check-installed/<plugin_name>', methods=['GET'])
def check_plugin_installed(plugin_name):
    """检查插件是否已安装（直接检测目录）"""
    community_path = PROJECT_ROOT / 'plugins' / 'community'
    plugin_dir = community_path / plugin_name
    
    is_installed = plugin_dir.exists() and any(plugin_dir.iterdir())
    
    return jsonify({
        'success': True,
        'installed': is_installed
    })


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
                # 如果没有download_url或为空，尝试使用数字ID构建
                download_url = tool.get('download_url')
                if not download_url:  # 处理 None、空字符串、undefined
                    # 服务器API期望 tool_id 是整数，只能使用数字ID构建URL
                    tool_id = tool.get('id')
                    
                    # 允许 id = 0，只要是整数类型就有效
                    if tool_id is not None and isinstance(tool_id, int):
                        tool['download_url'] = f"http://mynewbot.com/api/download-tool/{tool_id}"
                        logger.info(f'使用 id 构建下载URL: {tool["download_url"]}')
                    else:
                        logger.warning(f'工具缺少有效的数字 id，无法构建下载URL: {tool.get("tool_name", "未知")}')
                
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
    """下载工具到 mcp/tools 目录（参考 test.py 实现）"""
    try:
        data = request.get_json()
        tool_name = data.get('tool_name', '')
        tool_url = data.get('download_url', '') or data.get('tool_url', '')
        file_name = data.get('file_name', '')  # 保存的文件名

        logger.info(f'收到工具下载请求: tool_name={tool_name}, tool_url={tool_url}, file_name={file_name}')

        if not tool_url:
            logger.error(f'下载工具失败：缺少 download_url')
            return jsonify({'success': False, 'error': '缺少下载URL'}), 400

        # 使用 file_name 作为保存文件名，如果没有则使用 tool_name
        save_filename = file_name if file_name else f'{tool_name}.js'
        
        # 下载工具文件到 mcp/tools 目录
        mcp_tools_path = PROJECT_ROOT / 'mcp' / 'tools'
        mcp_tools_path.mkdir(parents=True, exist_ok=True)

        file_path = mcp_tools_path / save_filename
        logger.info(f'准备下载到: {file_path}')

        # 使用 requests 或 urllib 下载
        if HAS_REQUESTS:
            response = requests.get(tool_url, timeout=30)
            response.raise_for_status()
            content_type = response.headers.get('Content-Type', '')
            content = response.content
        else:
            # 回退到 urllib
            req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                content_type = resp.headers.get('Content-Type', '')
                content = resp.read()

        logger.info(f'远程服务器响应 Content-Type: {content_type}')

        # 检查是否为 HTML 内容
        if content.startswith(b'<!DOCTYPE') or content.startswith(b'<!doctype') or content.startswith(b'<html'):
            logger.error(f'下载内容为 HTML 格式，URL: {tool_url}')
            return jsonify({'success': False, 'error': '下载内容为 HTML 格式，请检查 URL 是否正确'}), 500

        with open(file_path, 'wb') as f:
            f.write(content)
        
        logger.info(f'工具 {save_filename} 已成功保存到 {file_path}')
        return jsonify({'success': True, 'message': f'工具 {save_filename} 已下载到 mcp/tools 目录'})

    except urllib.error.HTTPError as e:
        logger.error(f'HTTP 错误: {e}, URL: {tool_url}')
        return jsonify({'success': False, 'error': f'下载失败：HTTP {e.code}'}), 500
    except urllib.error.URLError as e:
        logger.error(f'网络错误: {e}, URL: {tool_url}')
        return jsonify({'success': False, 'error': f'下载失败：网络错误 - {e.reason}'}), 500
    except Exception as e:
        logger.error(f'下载工具时发生未捕获异常: {str(e)}', exc_info=True)
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
                # 如果没有download_url或为空，尝试使用数字ID构建
                download_url = tool.get('download_url')
                if not download_url:  # 处理 None、空字符串、undefined
                    # 服务器API期望 tool_id 是整数，只能使用数字ID构建URL
                    tool_id = tool.get('id')
                    
                    # 允许 id = 0，只要是整数类型就有效
                    if tool_id is not None and isinstance(tool_id, int):
                        tool['download_url'] = f"http://mynewbot.com/api/download-fc-tool/{tool_id}"
                        logger.info(f'FC工具使用 id 构建下载URL: {tool["download_url"]}')
                    else:
                        logger.warning(f'FC工具缺少有效的数字 id，无法构建下载URL: {tool.get("tool_name", "未知")}')
                
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
    """下载 FC 工具（参考 test.py 实现）"""
    try:
        data = request.get_json()
        tool_name = data.get('tool_name', '')
        tool_url = data.get('download_url', '')
        file_name = data.get('file_name', '')  # 保存的文件名

        logger.info(f'收到FC工具下载请求: tool_name={tool_name}, tool_url={tool_url}, file_name={file_name}')

        if not tool_url:
            logger.error(f'FC工具下载失败：缺少 download_url')
            return jsonify({'success': False, 'error': '缺少下载URL'}), 400

        # 使用 file_name 作为保存文件名，如果没有则使用 tool_name
        save_filename = file_name if file_name else f'{tool_name}.js'
        
        # 下载工具文件到 server-tools 目录
        server_tools_path = PROJECT_ROOT / 'server-tools'
        server_tools_path.mkdir(parents=True, exist_ok=True)

        file_path = server_tools_path / save_filename
        logger.info(f'准备下载FC工具到: {file_path}')

        # 使用 requests 或 urllib 下载
        if HAS_REQUESTS:
            response = requests.get(tool_url, timeout=30)
            response.raise_for_status()
            content_type = response.headers.get('Content-Type', '')
            content = response.content
        else:
            # 回退到 urllib
            req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                content_type = resp.headers.get('Content-Type', '')
                content = resp.read()

        logger.info(f'FC工具远程服务器响应 Content-Type: {content_type}')

        # 检查是否为 HTML 内容
        if content.startswith(b'<!DOCTYPE') or content.startswith(b'<!doctype') or content.startswith(b'<html'):
            logger.error(f'FC工具下载内容为 HTML 格式，URL: {tool_url}')
            return jsonify({'success': False, 'error': '下载内容为 HTML 格式，请检查 URL 是否正确'}), 500

        with open(file_path, 'wb') as f:
            f.write(content)
        
        logger.info(f'FC工具 {save_filename} 已成功保存到 {file_path}')
        return jsonify({'success': True, 'message': f'FC 工具 {save_filename} 已下载到 server-tools 目录'})

    except urllib.error.HTTPError as e:
        logger.error(f'FC工具HTTP错误: {e}, URL: {tool_url}')
        return jsonify({'success': False, 'error': f'下载失败：HTTP {e.code}'}), 500
    except urllib.error.URLError as e:
        logger.error(f'FC工具网络错误: {e}, URL: {tool_url}')
        return jsonify({'success': False, 'error': f'下载失败：网络错误 - {e.reason}'}), 500
    except Exception as e:
        logger.error(f'下载FC工具时发生未捕获异常: {str(e)}', exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
