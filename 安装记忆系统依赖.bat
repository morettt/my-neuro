@echo off
chcp 65001 >nul
echo ════════════════════════════════════════════════════════════
echo           安装 肥牛AI 记忆系统 所需依赖
echo ════════════════════════════════════════════════════════════
echo.

cd /d %~dp0

echo [1/3] 安装 Streamlit (WebUI界面)...
pip install streamlit -q

echo [2/3] 安装 Sentence-Transformers (语义搜索)...
pip install sentence-transformers -q

echo [3/3] 安装其他依赖...
pip install aiohttp pydantic -q

echo.
echo ════════════════════════════════════════════════════════════
echo                    ✅ 安装完成！
echo ════════════════════════════════════════════════════════════
echo.
echo 接下来请：
echo   1. 双击 MEMOS-API.bat 启动记忆服务
echo   2. 正常启动肥牛主程序
echo.
pause

