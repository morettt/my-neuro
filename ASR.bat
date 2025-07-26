chcp 65001
@echo off
title 启动所有API服务
:: 使用脚本所在目录作为工作目录
cd %~dp0
start cmd /k "call conda activate my-neuro && python asr_api.py"
echo 所有API服务已启动!