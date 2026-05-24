@echo off
chcp 65001 >nul
cd /d %~dp0

REM ============================================================
REM   MemOS Memory Service (port 8003)
REM   优先使用 installer 安装的 env\python.exe
REM   否则回退到 conda 虚拟环境 my-neuro
REM ============================================================

echo ============================================================
echo   Starting MemOS Memory Service (port 8003)
echo ============================================================
echo.

set "PY=%~dp0..\..\env\python.exe"
if exist "%PY%" (
    echo [环境] 使用本地 env: %PY%
    echo.
    "%PY%" sync_plugin_config.py
    if errorlevel 1 (
        echo [警告] 插件配置同步失败，将使用 memos_config.json 现有配置启动
        echo.
    )
    "%PY%" memos_system\api\memos_api_server_v2.py
) else (
    echo [环境] 未检测到 env\python.exe，使用 conda 环境 my-neuro
    echo.
    call conda activate my-neuro
    if errorlevel 1 (
        echo [错误] conda 环境 my-neuro 不可用
        echo 请先运行 installer.py 安装 env，或创建 conda 环境 my-neuro
        echo.
        pause
        exit /b 1
    )
    python sync_plugin_config.py
    if errorlevel 1 (
        echo [警告] 插件配置同步失败，将使用 memos_config.json 现有配置启动
        echo.
    )
    python memos_system\api\memos_api_server_v2.py
)

pause
