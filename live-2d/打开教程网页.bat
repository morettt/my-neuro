@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" "%~dp0docs\index.html"
echo 已在浏览器中打开教程中心。
timeout /t 2 >nul
