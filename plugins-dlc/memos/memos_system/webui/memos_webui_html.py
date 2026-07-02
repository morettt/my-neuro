#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MemOS WebUI HTML Version - 主应用入口
提供静态文件服务，与后端的 memos_api_server 进行通信
"""

import os
import sys
import webbrowser
import threading
import time
from flask import Flask, send_from_directory

# 获取当前脚本所在目录
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
# html_ui 目录路径
HTML_UI_DIR = os.path.join(CURRENT_DIR, 'html_ui')

app = Flask(__name__, static_folder=os.path.join(HTML_UI_DIR, 'static'))

@app.route('/')
def index():
    """提供主页"""
    return send_from_directory(HTML_UI_DIR, 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    """提供其他静态文件"""
    return send_from_directory(HTML_UI_DIR, filename)

def open_browser(port):
    time.sleep(1.5)
    webbrowser.open(f'http://localhost:{port}')

if __name__ == '__main__':
    PORT = 8004

    print(f"\n{'='*50}")
    print(f"MemOS WebUI 控制面板 (Cyberpunk Edition)")
    print(f"{'='*50}")
    print(f"访问地址：http://localhost:{PORT}")
    print(f"API 地址：http://localhost:8003")
    print(f"{'='*50}\n")

    threading.Thread(target=open_browser, args=(PORT,), daemon=True).start()

    app.run(host='0.0.0.0', port=PORT, debug=False, use_reloader=False)