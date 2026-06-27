@echo off
chcp 65001 >nul

REM 获取脚本所在目录并设置为工作目录
cd /d "%~dp0"

REM 设置环境名称
set CONDA_ENV_NAME=my-neuro

REM 检查 Flask 并启动程序
echo 启动 WebUI 控制面板...
if exist %~dp0..\env\python.exe (
    %~dp0..\env\python.exe -c "import flask" >nul 2>&1 || (
        echo Flask 未安装，正在安装...
        %~dp0..\env\python.exe -m pip install flask
    )
    %~dp0..\env\python.exe -c "import requests" >nul 2>&1 || (
        echo requests 未安装，正在安装...
        %~dp0..\env\python.exe -m pip install requests
    )
    %~dp0..\env\python.exe -c "from webui import run_app; run_app()"
) else (
    call conda activate my-neuro
    python -c "import flask" >nul 2>&1 || (
        echo Flask 未安装，正在安装...
        pip install flask
    )
    python -c "import requests" >nul 2>&1 || (
        echo requests 未安装，正在安装...
        pip install requests
    )
    python -c "from webui import run_app; run_app()"
)

echo.
pause
