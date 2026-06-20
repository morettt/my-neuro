@echo off
chcp 65001 >nul 2>nul
setlocal

set "ROOT=%~dp0"
set "MEMOS_DIR=%ROOT%plugins-dlc\memos"

echo ================================================================
echo   MemOS 记忆系统后端 API
echo ================================================================
echo.
echo 端口: http://127.0.0.1:8003
echo 说明: 这个窗口是记忆系统的后端服务，请保持它运行。
echo.

if not exist "%MEMOS_DIR%\sync_plugin_config.py" (
    echo [ERROR] 未找到 MemOS 目录: %MEMOS_DIR%
    echo 请确认 plugins-dlc\memos 文件夹存在。
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8003/health' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
    echo [OK] MemOS API 已经在运行。
    echo 你可以直接启动主程序，或双击 5.MEMOS-WebUI.bat 打开记忆管理界面。
    echo.
    pause
    exit /b 0
)

cd /d "%MEMOS_DIR%"

if exist "%ROOT%env\python.exe" (
    echo [INFO] 使用项目自带 Python 环境。
    "%ROOT%env\python.exe" sync_plugin_config.py
    if errorlevel 1 goto error
    "%ROOT%env\python.exe" memos_system\api\memos_api_server.py
) else (
    echo [INFO] 未发现 env\python.exe，尝试使用 conda 环境: my-neuro
    call conda activate my-neuro
    if errorlevel 1 goto error
    python sync_plugin_config.py
    if errorlevel 1 goto error
    python memos_system\api\memos_api_server.py
)

goto end

:error
echo.
echo [ERROR] MemOS API 启动失败。
echo 请确认 Python 环境已安装 FastAPI、Qdrant、SentenceTransformer 等依赖。

:end
echo.
echo MemOS API 已停止。
pause
endlocal
