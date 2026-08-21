@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PY=%~dp0..\env\python.exe"
if exist "%PY%" (
    "%PY%" -c "import flask" >nul 2>&1 || "%PY%" -m pip install flask
    "%PY%" -c "import requests" >nul 2>&1 || "%PY%" -m pip install requests
    "%PY%" -c "from webui import run_app; run_app()"
) else (
    call conda activate my-neuro
    python -c "import flask" >nul 2>&1 || pip install flask
    python -c "import requests" >nul 2>&1 || pip install requests
    python -c "from webui import run_app; run_app()"
)
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" echo [ERROR] WebUI exited with code %ERR%
pause
exit /b %ERR%
