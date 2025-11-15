@echo off
chcp 65001
cd /d %~dp0
echo 正在启动桌宠应用...
.\node\node.exe .\node_modules\electron\cli.js .