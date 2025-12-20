@echo off
:: 先激活conda环境，再设置编码
cd %~dp0
call conda activate my-neuro
chcp 65001 >nul
echo 开始测试...
python sample.py