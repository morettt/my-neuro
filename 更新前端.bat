@echo off
:: 使用脚本所在目录作为工作目录
cd %~dp0
start cmd /k "call conda activate my-neuro && python update.py"
echo 前端已更新到最新版本！