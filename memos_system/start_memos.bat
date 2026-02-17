@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "start_memos.ps1"
pause
