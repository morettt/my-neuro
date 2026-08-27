@echo off
setlocal
cd /d "%~dp0electron-installer"

if not exist "package.json" (
    echo [ERROR] electron-installer\package.json was not found.
    echo.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found. Install Node.js 20 or newer first.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Installing preview dependencies for the first run...
    echo.
    call npm install
    if errorlevel 1 goto :failed
)

echo Starting the current Electron installer UI...
echo This does not build an installer package.
echo.
call npm start
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" goto :failed_code
exit /b 0

:failed
set "ERR=%ERRORLEVEL%"

:failed_code
echo.
echo [ERROR] Installer UI preview exited with code %ERR%.
pause
exit /b %ERR%
