@echo off
echo ========================================
echo   Starting MemOS memory service (port: 8003)
echo ========================================
echo.
cd /d %~dp0
call conda activate my-neuro
python sync_plugin_config.py
cd /d "%~dp0memos_system"
powershell -ExecutionPolicy Bypass -File "start_memos.ps1"
pause
