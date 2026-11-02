@echo off
setlocal
cd /d "%~dp0"
echo Building Electron control panel...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\package-electron-ui.ps1"
if errorlevel 1 goto failed
echo.
echo Build complete. The small launcher EXE is in this directory.
echo Keep the EXE alongside control-main.js and the existing project files.
echo The launcher uses node_modules\electron\dist\electron.exe directly.
pause
exit /b 0

:failed
echo.
echo Build failed. Check the error above for details.
pause
exit /b 1
