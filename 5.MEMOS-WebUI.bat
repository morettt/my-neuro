@echo off
chcp 65001 >nul 2>nul
setlocal

set "ROOT=%~dp0"
set "MEMOS_DIR=%ROOT%plugins-dlc\memos"
set "WEBUI_SCRIPT=%MEMOS_DIR%\memos_system\webui\memos_webui_html.py"

echo ================================================================
echo   MemOS 记忆系统 WebUI 控制台
echo ================================================================
echo.
echo WebUI: http://127.0.0.1:8004
echo API:   http://127.0.0.1:8003
echo.

if not exist "%WEBUI_SCRIPT%" (
    echo [ERROR] 未找到 WebUI 启动文件: %WEBUI_SCRIPT%
    echo 请确认 plugins-dlc\memos 文件夹完整。
    echo.
    pause
    exit /b 1
)

echo [INFO] 正在检查 MemOS API 后端...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8003/health' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
    echo.
    echo [WARNING] MemOS API 后端还没有启动。
    echo 请先双击 4.MEMOS-API.bat，等待后端服务启动后，再运行本文件。
    echo.
    pause
    exit /b 1
)

echo [OK] 后端已连接。
echo [INFO] 浏览器会自动打开记忆管理界面。
echo.

powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 8004); $c.Close(); exit 0 } catch { exit 1 }"
if not errorlevel 1 (
    echo [WARNING] 端口 8004 已被占用。
    echo 如果 WebUI 已经打开，请直接访问 http://127.0.0.1:8004
    echo 如需重启，请先关闭旧的 WebUI 窗口。
    echo.
    pause
    exit /b 0
)

cd /d "%MEMOS_DIR%"

if exist "%ROOT%env\python.exe" (
    echo [INFO] 使用项目自带 Python 环境。
    "%ROOT%env\python.exe" "%WEBUI_SCRIPT%"
) else (
    echo [INFO] 未发现 env\python.exe，尝试使用 conda 环境: my-neuro
    call conda activate my-neuro
    if errorlevel 1 goto error
    python "%WEBUI_SCRIPT%"
)

goto end

:error
echo.
echo [ERROR] MemOS WebUI 启动失败。
echo 请确认 Python 环境已安装 Flask，并且 4.MEMOS-API.bat 正在运行。

:end
echo.
echo MemOS WebUI 已停止。
pause
endlocal
