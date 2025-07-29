chcp 65001
@echo off
title 启动所有API服务
:: 设备选择
:device_choice
echo 检查你的设备，如果是英伟达的显卡选择CUDA，否则选择CPU
echo 请选择第二个API服务的运行设备:
echo 1. CUDA
echo 2. CPU
choice /c 12 /n /m "请输入选择(1或2): "
if errorlevel 2 set DEVICE=cpu
if errorlevel 1 if not errorlevel 2 set DEVICE=cuda
:: 使用脚本所在目录作为工作目录
cd %~dp0
start cmd /k "call conda activate my-neuro &&cd tts-studio &&python tts_api.py -p 5000 -d %DEVICE% -s tts-model/merge.pth -dr tts-model/neuro/01.wav -dt "Hold on please, I'm busy. Okay, I think I heard him say he wants me to stream Hollow Knight on Tuesday and Thursday." -dl "en"
echo 所有API服务已启动!
