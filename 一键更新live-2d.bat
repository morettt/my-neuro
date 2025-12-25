@echo off
cd %~dp0
start cmd /k "call conda activate my-neuro && python update.py"
echo 前端已更新到最新版本！