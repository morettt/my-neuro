@echo off
chcp 65001
title My-Neuro 一键部署
echo ===== My-Neuro 一键部署开始 =====

:: 使用脚本所在目录作为工作目录
cd /d %~dp0

:: 检查Python环境
echo 检查Python环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到Python环境，请先安装Python 3.11
    pause
    exit /b 1
)

:: 检查conda环境
echo 检查conda环境...
conda --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到conda环境，请先安装Anaconda
    pause
    exit /b 1
)

:: 安装基础依赖
echo 安装基础依赖...
pip install modelscope requests --quiet
if errorlevel 1 (
    echo 警告: 基础依赖安装失败，但继续执行...
)

:: 启动部署脚本
echo 启动部署脚本...
start cmd /k "python neural_deploy.py"

echo 部署脚本已启动，请查看新窗口的输出信息
echo 如果遇到问题，请查看日志文件或联系客服
pause