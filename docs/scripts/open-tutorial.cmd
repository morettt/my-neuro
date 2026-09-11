@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
cd /d "%~dp0..\.."

if /i "%~1"=="--error" goto :show_error
if not defined MY_NEURO_DOCS_LOG_DIR exit /b 1
if not exist "%MY_NEURO_DOCS_LOG_DIR%\" exit /b 1
if /i "%~1"=="--server" goto :server

call :launch >"%MY_NEURO_DOCS_LOG_DIR%\launcher.log" 2>&1
exit /b %errorlevel%

:launch
if exist "docs\.vitepress\dist\index.html" (
    start "" "%cd%\docs\.vitepress\dist\index.html"
    if errorlevel 1 (
        echo [错误] 无法打开已经构建的教程页面。
        exit /b 1
    )
    exit /b 0
)

where.exe node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js。请先安装 Node.js 20 或更新版本。
    exit /b 1
)

where.exe npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 npm。请检查 Node.js 安装是否完整。
    exit /b 1
)

if not exist "docs\package.json" (
    echo [错误] 未找到 docs\package.json。
    exit /b 1
)

where.exe curl.exe >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 curl.exe，无法检查教程站是否就绪。
    exit /b 1
)

if not exist "docs\node_modules\.bin\vitepress.cmd" (
    echo 首次打开或文档依赖不完整，正在安装 vitepress...
    pushd docs
    call npm.cmd install
    if errorlevel 1 (
        popd
        echo [错误] 文档依赖安装失败。请检查网络后重试。
        exit /b 1
    )
    popd
)

if not exist "docs\node_modules\.bin\vitepress.cmd" (
    echo [错误] 安装结束后仍未找到 vitepress，请检查上面的安装输出。
    exit /b 1
)

set "MY_NEURO_DOCS_URL=http://localhost:5173/"
curl.exe --fail --silent --output nul --max-time 2 "%MY_NEURO_DOCS_URL%" >nul 2>&1
if not errorlevel 1 goto :open_browser

echo 正在后台启动教程站...
start "" /b "%ComSpec%" /d /c docs\scripts\open-tutorial.cmd --server <nul
if errorlevel 1 (
    echo [错误] 无法启动教程服务进程。
    exit /b 1
)

set /a _attempt=0 >nul
:wait_docs
if exist "%MY_NEURO_DOCS_LOG_DIR%\server-exit.txt" (
    echo [错误] 教程服务在就绪前已经退出。退出码:
    type "%MY_NEURO_DOCS_LOG_DIR%\server-exit.txt"
    exit /b 1
)
curl.exe --fail --silent --output nul --max-time 2 "%MY_NEURO_DOCS_URL%" >nul 2>&1
if not errorlevel 1 goto :open_browser
set /a _attempt+=1 >nul
if %_attempt% geq 60 (
    echo [错误] 等待教程站就绪超时，请查看下面的服务日志。
    exit /b 1
)
ping 127.0.0.1 -n 2 >nul
goto :wait_docs

:open_browser
start "" "%MY_NEURO_DOCS_URL%"
if errorlevel 1 (
    echo [错误] 教程站已就绪，但无法打开默认浏览器。
    exit /b 1
)
exit /b 0

:server
call :serve >"%MY_NEURO_DOCS_LOG_DIR%\server.log" 2>&1
set "_server_exit=%errorlevel%"
>"%MY_NEURO_DOCS_LOG_DIR%\server-exit.txt" echo %_server_exit%
exit /b %_server_exit%

:serve
cd /d "%cd%\docs"
call npm.cmd run docs:dev -- --host localhost --port 5173 --strictPort
exit /b %errorlevel%

:show_error
title my-neuro tutorial error
echo [错误] 教程网页未能打开。
echo.
if defined MY_NEURO_DOCS_BOOTSTRAP_ERROR echo 后台启动失败，Windows 错误码: %MY_NEURO_DOCS_BOOTSTRAP_ERROR%
if not defined MY_NEURO_DOCS_LOG_DIR goto :no_log
echo 日志目录:
echo "%MY_NEURO_DOCS_LOG_DIR%"
echo.
if exist "%MY_NEURO_DOCS_LOG_DIR%\launcher.log" (
    echo 启动记录:
    type "%MY_NEURO_DOCS_LOG_DIR%\launcher.log"
)
if exist "%MY_NEURO_DOCS_LOG_DIR%\server.log" (
    echo.
    echo 服务记录:
    type "%MY_NEURO_DOCS_LOG_DIR%\server.log"
)
echo.
echo 修正问题后可重新双击打开教程网页.bat。日志已保留，可关闭此窗口。
exit /b 1

:no_log
echo 无法创建启动日志，请检查临时目录是否可写，以及 Windows Script Host 是否可用。
exit /b 1
