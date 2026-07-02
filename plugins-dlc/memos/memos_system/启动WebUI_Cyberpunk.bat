@echo off
chcp 65001 >nul 2>nul
call conda activate my-neuro 2>nul

echo ================================================================
echo   MEMOS WebUI Cyberpunk Edition - HTML/JS/CSS
echo ================================================================
echo.

REM Check API service
echo Checking API service...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8003/health' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }"

if %errorlevel% neq 0 (
    echo.
    echo [WARNING] API service is not running!
    echo           Please run start_memos.bat first
    echo.
    pause
    exit /b 1
)

echo [OK] API service is running
echo.

REM Check and kill existing port 8004
echo Checking port 8004...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8004 ^| findstr LISTENING 2^>nul') do (
    echo Stopping existing process on port 8004...
    taskkill /F /PID %%a >nul 2>nul
)

echo.
echo Starting WebUI...
echo.

cd /d "%~dp0webui"
python memos_webui_html.py

pause