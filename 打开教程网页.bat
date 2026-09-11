@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if exist "docs\.vitepress\dist\index.html" (
    start "" "%~dp0docs\.vitepress\dist\index.html"
    echo 已打开构建好的 WebUI 教程站。
    ping 127.0.0.1 -n 2 >nul
    exit /b 0
)

echo 未找到构建产物。正在准备本地预览（需要 Node.js）...

where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js。请先安装 Node.js 20 或更新版本。
    echo 官网旧教程仍在: http://mynewbot.com/tutorials
    pause
    exit /b 1
)

if not exist "docs\package.json" (
    echo [错误] 未找到 docs\package.json
    pause
    exit /b 1
)

if not exist "docs\node_modules\.bin\vitepress.cmd" (
    echo 首次打开或文档依赖不完整，正在安装 vitepress...
    pushd docs
    call npm install
    if errorlevel 1 (
        popd
        echo [错误] 文档依赖安装失败。请检查网络后重试。
        pause
        exit /b 1
    )
    popd
)

curl.exe -s -o nul -m 2 http://localhost:5173/ >nul 2>&1
if not errorlevel 1 goto :open_browser

echo 正在启动教程站...
cd /d "%~dp0docs"
start "my-neuro-docs" cmd /k "npm run docs:dev"

echo 正在等待教程站就绪，随后会自动弹出浏览器...
set /a _n=0
:wait_docs
ping 127.0.0.1 -n 2 >nul
set /a _n+=1
curl.exe -s -o nul -m 2 http://localhost:5173/ >nul 2>&1
if not errorlevel 1 goto :open_browser
if %_n% geq 60 (
    echo [错误] 教程站启动超时。请查看 my-neuro-docs 窗口里的报错。
    echo 官网旧教程仍在: http://mynewbot.com/tutorials
    pause
    exit /b 1
)
goto :wait_docs

:open_browser
start "" "http://localhost:5173/"
echo 已自动打开教程网页: http://localhost:5173/
exit /b 0