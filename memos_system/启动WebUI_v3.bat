@echo off
chcp 65001 >nul 2>nul

echo ================================================================
echo   MEMOS WebUI v3.0 - Full Featured Memory Center
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

REM Check and kill existing port 8501
echo Checking port 8501...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8501 ^| findstr LISTENING 2^>nul') do (
    echo Stopping existing process on port 8501...
    taskkill /F /PID %%a >nul 2>nul
)

echo.
echo Starting WebUI on port 8501...
echo URL: http://localhost:8501
echo.

REM Auto open browser after 3 seconds
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:8501"

echo Press Ctrl+C to stop
echo ================================================================
echo.

cd /d "%~dp0webui"
streamlit run memos_webui_v3.py --server.port 8501 --server.headless true

pause
