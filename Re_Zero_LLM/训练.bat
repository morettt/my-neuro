@echo off
cd %~dp0
call conda activate my-neuro
chcp 65001
echo 启动训练脚本...
python train.py
