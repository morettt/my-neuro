@echo off
echo ========================================
echo   Starting MemOS memory service (port: 8003)
echo ========================================
echo.
cd /d %~dp0
call conda activate my-neuro && python memos_system\api\memos_api_server.py
pause
