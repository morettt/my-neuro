@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "docs\.vitepress\dist\index.html" (
    start "" "%~dp0docs\.vitepress\dist\index.html"
    echo 已打开构建好的 WebUI 教程站。
    timeout /t 2 >nul
    exit /b 0
)
echo 未找到构建产物。正在启动本地预览（需要 Node.js）...
echo 浏览器打开终端里显示的 localhost 地址即可。
echo 官网旧教程仍在: http://mynewbot.com/tutorials
cd /d "%~dp0docs"
start "my-neuro-docs" cmd /k "npm run docs:dev"
exit /b 0
