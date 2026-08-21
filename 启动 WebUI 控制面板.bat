@echo off
setlocal
cd /d "%~dp0"

set "PY=%~dp0env\python.exe"
if not exist "%PY%" (
    echo [ERROR] env\python.exe not found:
    echo   %PY%
    echo Copy the env folder to this repo root, then try again.
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0live-2d" (
    echo [ERROR] live-2d folder not found next to this script.
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0live-2d"
echo Starting WebUI...
echo Python: %PY%
echo.
"%PY%" -c "from webui import run_app; run_app()"
set "ERR=%ERRORLEVEL%"

echo.
if not "%ERR%"=="0" (
    echo [ERROR] WebUI exited with code %ERR%
)
pause
exit /b %ERR%