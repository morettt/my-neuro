@echo off
setlocal
cd /d "%~dp0"
echo Building Electron control panel...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\package-electron-ui.ps1"
if errorlevel 1 goto failed
echo.
echo Build complete. The single portable EXE is in this directory.
echo Keep the EXE alongside control-main.js and the existing project files.
pause
exit /b 0

:failed
echo.
echo Build failed. Check the error above, close the packaged UI and retry.
pause
exit /b 1
