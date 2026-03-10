#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 控制器 - 入口点
v2.0 - 模块化重构版本

该文件作为入口点，实际的实现已移至 webui/ 模块化包中
模块结构：
  - webui/main_app.py: 主应用入口
  - webui/service_controller.py: 服务控制模块
  - webui/config_manager.py: 配置管理模块
  - webui/plugin_manager.py: 插件管理模块
  - webui/tool_manager.py: 工具管理模块
  - webui/marketplace.py: 广场与资源模块
  - webui/log_monitor.py: 日志与监控模块
  - webui/utils.py: 共享工具函数
"""

if __name__ == '__main__':
    print("启动 My Neuro 服务控制中心...")
    print("正在初始化 WebUI 控制面板...")
    
    # 从模块化包导入并运行
    from webui import run_app
    run_app()