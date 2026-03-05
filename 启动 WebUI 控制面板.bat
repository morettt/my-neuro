@echo off
chcp 65001 >nul
echo 正在启动 My Neuro WebUI...

REM 设置环境名称
set CONDA_ENV_NAME=my-neuro

REM 检查 Python（已经在 base 环境中）
python --version >nul 2>&1 || (
    echo 错误：Python 未找到
    pause
    exit /b 1
)

REM 检查 Flask
python -c "import flask" >nul 2>&1 || (
    echo Flask 未安装，正在安装...
    pip install flask
)

REM 启动程序
echo 启动 WebUI 控制面板...
python webui_controller.py

echo.
pause