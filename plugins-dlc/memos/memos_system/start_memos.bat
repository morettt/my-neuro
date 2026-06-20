@echo off
cd /d "%~dp0"
call conda activate my-neuro 2>nul
powershell -ExecutionPolicy Bypass -File "start_memos.ps1"
pause
