#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
广场下载 API 独立测试模块
不依赖 webui_controller.py 的其他功能
"""

from flask import Flask, request, jsonify, make_response
import urllib.request
import urllib.error
from pathlib import Path

# 创建独立的 Flask 应用
app = Flask(__name__)

# 手动设置 CORS 头
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# 项目根目录
PROJECT_ROOT = Path(__file__).parent

# ============ 广场下载 API ============

@app.route('/api/market/tools/download', methods=['POST'])
def download_tool():
    """下载工具到 mcp/tools 目录"""
    try:
        data = request.get_json()
        tool_name = data.get('tool_name', '')
        tool_url = data.get('download_url', '')
        file_name = data.get('file_name', '')

        if not tool_name or not tool_url:
            return jsonify({'success': False, 'error': '缺少参数'}), 400

        # 下载工具文件到 mcp/tools 目录
        mcp_tools_path = PROJECT_ROOT / 'live-2d' / 'mcp' / 'tools'
        mcp_tools_path.mkdir(parents=True, exist_ok=True)

        # 使用传入的文件名，如果没有则从 tool_name 生成
        if not file_name:
            file_name = f'{tool_name}.js'
        file_path = mcp_tools_path / file_name

        print(f'[下载工具] {tool_name} -> {file_path}')
        print(f'[下载 URL] {tool_url}')

        # 下载文件
        req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                # 检查 Content-Type
                content_type = response.headers.get('Content-Type', '')
                if 'text/html' in content_type:
                    return jsonify({'success': False, 'error': '下载链接返回 HTML 页面'}), 500

                # 读取内容
                content = response.read()

                # 检查内容是否以 HTML 开头
                if content.startswith(b'<!DOCTYPE') or content.startswith(b'<!doctype') or content.startswith(b'<html'):
                    return jsonify({'success': False, 'error': '下载内容为 HTML 格式'}), 500

                # 写入文件
                with open(file_path, 'wb') as f:
                    f.write(content)
            
            print(f'[下载成功] {file_path}')
            return jsonify({'success': True, 'message': f'工具 {tool_name} 已下载'})
        except urllib.error.HTTPError as e:
            return jsonify({'success': False, 'error': f'HTTP 错误：{e.code} {e.reason}'}), 500
        except urllib.error.URLError as e:
            return jsonify({'success': False, 'error': f'网络错误：{e.reason}'}), 500
    except Exception as e:
        print(f'[下载失败] {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/market/prompts/apply', methods=['POST'])
def apply_prompt():
    """应用提示词到 AI 人设"""
    try:
        import json
        data = request.get_json()
        prompt_content = data.get('content', '')

        # 更新 config.json 中的 system_prompt
        config_path = PROJECT_ROOT / 'live-2d' / 'config.json'
        if not config_path.exists():
            return jsonify({'success': False, 'error': '配置文件不存在'}), 500

        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)

        if 'llm' not in config:
            config['llm'] = {}
        config['llm']['system_prompt'] = prompt_content

        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)

        print(f'[应用提示词] 已更新 AI 人设')
        return jsonify({'success': True, 'message': '提示词已应用到 AI 人设'})
    except Exception as e:
        print(f'[应用失败] {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/market/fc-tools/download', methods=['POST'])
def download_fc_tool():
    """下载 FC 工具到 server-tools 目录"""
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

        print(f'[下载 FC 工具] {tool_name} -> {file_path}')
        print(f'[下载 URL] {tool_url}')

        # 下载文件
        req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                content_type = response.headers.get('Content-Type', '')
                if 'text/html' in content_type:
                    return jsonify({'success': False, 'error': '下载链接返回 HTML 页面'}), 500

                content = response.read()

                if content.startswith(b'<!DOCTYPE') or content.startswith(b'<!doctype') or content.startswith(b'<html'):
                    return jsonify({'success': False, 'error': '下载内容为 HTML 格式'}), 500

                with open(file_path, 'wb') as f:
                    f.write(content)
            
            print(f'[下载成功] {file_path}')
            return jsonify({'success': True, 'message': f'FC 工具 {tool_name} 已下载'})
        except urllib.error.HTTPError as e:
            return jsonify({'success': False, 'error': f'HTTP 错误：{e.code} {e.reason}'}), 500
        except urllib.error.URLError as e:
            return jsonify({'success': False, 'error': f'网络错误：{e.reason}'}), 500
    except Exception as e:
        print(f'[下载失败] {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ 健康检查 API ============

@app.route('/api/health', methods=['GET'])
def health_check():
    """健康检查"""
    return jsonify({'status': 'ok', 'message': '广场下载 API 运行正常'})


# ============ 启动应用 ============

if __name__ == '__main__':
    import json
    
    print("=" * 70)
    print("广场下载 API 独立测试模块")
    print("=" * 70)
    print(f"项目根目录：{PROJECT_ROOT}")
    print(f"工具下载目录：{PROJECT_ROOT / 'live-2d' / 'mcp' / 'tools'}")
    print(f"FC 工具下载目录：{PROJECT_ROOT / 'live-2d' / 'server-tools'}")
    print()
    print("已注册的 API 路由:")
    for rule in app.url_map.iter_rules():
        if 'market' in str(rule) or 'health' in str(rule):
            methods = ','.join(sorted(rule.methods - {'HEAD', 'OPTIONS'}))
            print(f"  {methods:10} {rule}")
    print()
    print("=" * 70)
    print("启动服务器...")
    print("访问地址：http://localhost:5001")
    print("=" * 70)
    
    app.run(host='0.0.0.0', port=5001, debug=False, use_reloader=False)
