@echo off
chcp 65001 >nul
cd /d %~dp0

REM ============================================================
REM   MemOS WebUI v3 (备选入口 - 直接启动 WebUI)
REM   推荐双击外层 plugins-dlc\memos\MEMOS-WebUI.bat（会自动检查 API）
REM ============================================================

set "PY=%~dp0..\..\..\env\python.exe"
if not exist "%PY%" (
    echo [错误] 未检测到 env\python.exe
    echo 请先在 my-neuro 根目录运行 installer.py 安装 Python 环境
    pause
    exit /b 1
)

REM 检查 API
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8003/health' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel% neq 0 (
    echo [警告] API 服务未启动 - 请先启动 start_memos.bat
    echo.
    pause
    exit /b 1
)

REM 清理 8501 端口
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8501 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>nul
)

echo ============================================================
echo   MEMOS WebUI v3.0 - http://localhost:8501
echo ============================================================
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:8501"

"%PY%" -m streamlit run webui\memos_webui_v3.py --server.port 8501 --server.headless true

pause
