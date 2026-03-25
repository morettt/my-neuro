#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 主应用入口
负责 Flask 应用初始化、蓝图注册和启动函数
"""

import datetime
import threading
import time
import webbrowser
from flask import Flask, render_template, jsonify, send_from_directory

from .utils import PROJECT_ROOT, WEBUI_VERSION, logger, find_free_port, service_pids

# 记录启动时间
START_TIME = datetime.datetime.now()


def create_app():
    """创建并配置 Flask 应用"""
    app = Flask(__name__,
                template_folder=str(PROJECT_ROOT / 'webui' / 'templates'),
                static_folder=str(PROJECT_ROOT / 'webui' / 'static'))

    # 注册各个功能蓝图
    from .service_controller import service_bp
    from .config_manager import config_bp
    from .plugin_manager import plugin_bp
    from .tool_manager import tool_bp
    from .marketplace import market_bp
    from .log_monitor import log_bp
    from .live2d_manager import live2d_bp

    app.register_blueprint(service_bp)
    app.register_blueprint(config_bp)
    app.register_blueprint(plugin_bp)
    app.register_blueprint(tool_bp)
    app.register_blueprint(market_bp)
    app.register_blueprint(log_bp)
    app.register_blueprint(live2d_bp)
    
    # 注册首页路由（必须在蓝图之后，确保根路径被正确处理）
    @app.route('/')
    def dashboard():
        """主页"""
        start_time_str = START_TIME.strftime('%Y-%m-%d %H:%M:%S')
        port = find_free_port()
        return render_template('index.html', port=port, start_time=start_time_str)

    # 提供 live-2d 目录的静态文件访问（路由保持 /live-2d/ 不变，但路径指向 PROJECT_ROOT）
    @app.route('/live-2d/<path:filename>')
    def serve_live2d_file(filename):
        """提供 live-2d 目录的文件访问"""
        return send_from_directory(PROJECT_ROOT, filename)

    return app


def run_app():
    """运行 Flask 应用"""
    app = create_app()
    port = find_free_port()
    
    print(f"\n{'='*50}")
    print(f"WebUI 控制面板 {WEBUI_VERSION}")
    print(f"{'='*50}")
    print(f"访问地址：http://localhost:{port}")
    print(f"{'='*50}\n")
    '''
    # 打印已注册的路由（调试用）
    ##print("已注册的 API 路由:")
    for rule in app.url_map.iter_rules():
        if rule.endpoint != 'static':
            methods = ','.join(sorted(rule.methods - {'HEAD', 'OPTIONS'}))
            print(f"  {methods:10} {rule}")
    print()
'''
    # 自动打开浏览器
    def open_browser():
        time.sleep(1.5)
        webbrowser.open(f'http://localhost:{port}')

    threading.Thread(target=open_browser, daemon=True).start()
    
    # 运行 Flask 应用
    app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)