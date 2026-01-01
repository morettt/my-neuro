@echo off
chcp 65001 >nul
echo ════════════════════════════════════════════════════════════
echo      Install MemOS Memory System Dependencies
echo      安装 肥牛AI 记忆系统 所需依赖
echo ════════════════════════════════════════════════════════════
echo.

cd /d %~dp0

echo [1/3] Installing Streamlit (WebUI)...
pip install streamlit -q

echo [2/3] Installing Sentence-Transformers (Semantic Search)...
pip install sentence-transformers -q

echo [3/3] Installing other dependencies...
pip install aiohttp pydantic -q

echo.
echo ════════════════════════════════════════════════════════════
echo                    Done! 安装完成！
echo ════════════════════════════════════════════════════════════
echo.
echo Next steps:
echo   1. Run MEMOS-API.bat to start memory service
echo   2. Start Fei Niu AI normally
echo.
pause

