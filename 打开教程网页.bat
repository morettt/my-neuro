@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
cd /d "%~dp0"

if not exist "docs\scripts\open-tutorial.vbs" goto :missing_helper
if not exist "docs\scripts\open-tutorial.cmd" goto :missing_helper
if not exist "%SystemRoot%\System32\wscript.exe" goto :missing_host

start "" /b "%SystemRoot%\System32\wscript.exe" //nologo "docs\scripts\open-tutorial.vbs"
if errorlevel 1 goto :launch_failed
exit /b 0

:missing_helper
echo [错误] 教程启动文件不完整。请同时下载 docs\scripts 下的启动辅助文件。
goto :failed

:missing_host
echo [错误] 未找到 Windows Script Host，无法在后台打开教程。
goto :failed

:launch_failed
echo [错误] 无法启动教程后台程序。

:failed
pause
exit /b 1
