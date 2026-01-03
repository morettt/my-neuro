@echo off
chcp 65001 >nul
echo ========================================
echo   启动 MemOS 记忆服务 (端口: 8003)
echo ========================================
echo.
cd /d %~dp0
call conda activate my-neuro && python memos_system\api\memos_api_server.py
pause
