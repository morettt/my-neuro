@echo off
chcp 65001
cd /d %~dp0
echo 正在启动桌宠应用...

if exist ".\node\node.exe" (
    echo 使用项目自带的 Node.js 环境
    .\node\node.exe .\node_modules\electron\cli.js .
) else (
    echo 未找到项目自带的 Node.js，使用系统环境的 Node.js
    node .\node_modules\electron\cli.js .
)