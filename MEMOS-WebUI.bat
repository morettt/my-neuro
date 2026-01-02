@echo off
chcp 65001 >nul
echo ========================================
echo   启动 MemOS 记忆管理界面 (端口: 8501)
echo ========================================
echo.
echo 浏览器将自动打开 http://localhost:8501
echo.
cd /d %~dp0
call conda activate my-neuro && streamlit run memos_system\webui\memos_webui.py --server.port 8501
pause

