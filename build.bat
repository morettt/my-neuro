@echo off
setlocal
cd /d "%~dp0electron-installer"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js was not found. Install Node.js 20 or newer first.
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing Electron build dependencies...
    call npm install
    if errorlevel 1 goto :failed
)

call npm run build
if errorlevel 1 goto :failed

copy /y "dist\My-Neuro-Installer.exe" "..\My-Neuro-Installer.exe" >nul
if errorlevel 1 goto :failed

echo Cleaning build dependencies and intermediate files...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0electron-installer\cleanup-build.ps1"
if errorlevel 1 goto :cleanup_failed

echo Done. Output: My-Neuro-Installer.exe
pause
exit /b 0

:cleanup_failed
echo Build succeeded, but cleanup failed. Output: My-Neuro-Installer.exe
pause
exit /b 1

:failed
echo Build failed.
pause
exit /b 1
