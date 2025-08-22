@echo off
chcp 65001
title My-Neuro 启动所有API服务
echo ===== My-Neuro 启动所有API服务 =====

:: 使用脚本所在目录作为工作目录
cd /d %~dp0

:: 检查conda环境
echo 检查conda环境...
conda --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到conda环境，请先安装Anaconda
    pause
    exit /b 1
)

:: 检查my-neuro环境是否存在
echo 检查my-neuro环境...
conda env list | findstr "my-neuro" >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到my-neuro环境，请先运行一键部署.bat创建环境
    pause
    exit /b 1
)

echo 正在启动API服务...
echo 启动的服务: ASR(1000端口) + TTS(5000端口) + BERT(6007端口)
echo 请等待服务启动完成...

start cmd /k "call conda activate my-neuro && python run_server.py -a '012'"

echo API服务启动命令已执行
echo 请查看新窗口的输出信息，等待所有服务启动完成
echo 如果遇到问题，请查看logs文件夹中的日志文件
pause
