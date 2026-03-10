@echo off
chcp 65001 >nul
echo.
echo ========================================
echo  广场下载 API 独立测试服务器
echo ========================================
echo.
echo 正在启动...
echo.

python market_download_api.py

pause
