@echo off
chcp 65001 >nul
cd /d %~dp0

REM ============================================================
REM   MemOS WebUI Cyberpunk Edition - HTML/JS/CSS (port 8004)
REM   备选入口 - 推荐双击外层 plugins-dlc\memos\MEMOS-WebUI.bat
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

REM 清理 8004 端口
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8004 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>nul
)

echo ============================================================
echo   MEMOS WebUI Cyberpunk Edition - http://localhost:8004
echo ============================================================
echo.

"%PY%" webui\memos_webui_html.py

pause
