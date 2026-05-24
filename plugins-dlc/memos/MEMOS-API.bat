@echo off
chcp 65001 >nul
cd /d %~dp0

REM ============================================================
REM   MemOS Memory Service (port 8003)
REM   依赖：installer.py 装出来的 env\python.exe（位于 my-neuro 根目录）
REM ============================================================

set "PY=%~dp0..\..\env\python.exe"
if not exist "%PY%" (
    echo [错误] 未检测到 env\python.exe
    echo 请先在 my-neuro 根目录运行 installer.py 安装 Python 环境
    echo.
    pause
    exit /b 1
)

echo ============================================================
echo   Starting MemOS Memory Service (port 8003)
echo ============================================================
echo.

REM 1. 同步插件配置（从 live-2d/plugins/built-in/memos/plugin_config.json 同步到 memos_config.json）
"%PY%" sync_plugin_config.py
if errorlevel 1 (
    echo [警告] 插件配置同步失败，将使用 memos_config.json 现有配置启动
    echo.
)

REM 2. 启动 API 服务
"%PY%" memos_system\api\memos_api_server_v2.py

pause
