@echo off
chcp 65001 >nul
cd /d %~dp0

REM ============================================================
REM   MemOS API 服务（备选入口 - 直接启动后端不做 plugin 同步）
REM   推荐双击外层 plugins-dlc\memos\MEMOS-API.bat（会自动同步配置）
REM ============================================================

set "PY=%~dp0..\..\..\env\python.exe"
if not exist "%PY%" (
    echo [错误] 未检测到 env\python.exe
    echo 请先在 my-neuro 根目录运行 installer.py 安装 Python 环境
    pause
    exit /b 1
)

echo ============================================================
echo   MemOS Memory System v2.0
echo   API: http://127.0.0.1:8003
echo   Docs: http://127.0.0.1:8003/docs
echo ============================================================
echo.

REM 清理可能残留的 qdrant 锁
if exist "data\qdrant\.lock" del /f /q "data\qdrant\.lock" >nul 2>nul

"%PY%" api\memos_api_server_v2.py

pause
