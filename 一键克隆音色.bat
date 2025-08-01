chcp 65001
@echo off
REM 数据处理流程脚本（带参数输入和Conda环境管理）
echo 数据处理流程开始...
echo.

:: 进入虚拟环境
call conda activate my-neuro

:: 获取当前bat文件所在目录
set "current_dir=%~dp0"

:: 拼接fine_tuning/tools路径
set "package_path=%current_dir%fine_tuning"

:: 添加到PYTHONPATH
set PYTHONPATH=%PYTHONPATH%;%package_path%

setlocal enabledelayedexpansion

:: 获取当前脚本所在目录
set "scriptDir=%~dp0"

:: 定义要清空的子文件夹路径
set "outputDir=%current_dir%fine_tuning\output\"
set "folders=asr sliced uvr5"

:: 检查输出目录是否存在
if not exist "%outputDir%" (
    echo 错误：目录不存在 - %outputDir%
    pause
    exit /b 1
)

:: 遍历每个子文件夹并清空内容
for %%f in (%folders%) do (
    set "currentFolder=%outputDir%%%f\"

    if exist "!currentFolder!" (
        echo 正在清空文件夹: !currentFolder!

        :: 删除文件夹内所有文件和子文件夹
        del /q "!currentFolder!*" >nul 2>&1
        for /d %%d in ("!currentFolder!*") do (
            rd /s /q "%%d" >nul 2>&1
        )

        echo 已清空 !currentFolder!
    ) else (
        echo 警告：文件夹不存在 - !currentFolder!
    )
)

REM 1. 检查conda是否可用
where conda >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误：未找到conda命令，请确保Anaconda/Miniconda已安装并配置
    pause
    exit /b
)

REM 2. 获取语言参数
:input_language
set /p language=请输入语言代码（en/zh）:
if "%language%"=="" (
    echo 语言代码不能为空！
    goto input_language
)
if not "%language%"=="en" if not "%language%"=="zh" (
    echo 无效的语言代码，请输入en或zh！
    goto input_language
)

REM 3. 获取模型名称参数
:input_model
set /p model_name=请输入TTS模型名称:
if "%model_name%"=="" (
    echo 模型名称不能为空！
    goto input_model
)

echo.
echo 参数设置完成：
echo 语言: %language%
echo 模型名称: %model_name%
echo.
pause

REM 4. 运行uvr_pipe.py
echo 正在运行 uvr_pipe.py...
call conda activate my-neuro && python fine_tuning/tools/uvr5/uvr_pipe.py "cuda" True
if %errorlevel% neq 0 (
    echo uvr_pipe.py 执行失败，错误码: %errorlevel%
    pause
    exit /b %errorlevel%
)

REM 5. 运行slicer_pipe.py
echo 正在运行 slicer_pipe.py...
call conda activate my-neuro && python fine_tuning/tools/slicer_pipe.py
if %errorlevel% neq 0 (
    echo slicer_pipe.py 执行失败，错误码: %errorlevel%
    pause
    exit /b %errorlevel%
)

REM 6. 运行asr_pipe.py
echo 正在运行 asr_pipe.py（语言: %language%）...
call conda activate my-neuro && python fine_tuning/tools/asr_pipe.py -l %language%
if %errorlevel% neq 0 (
    echo asr_pipe.py 执行失败，错误码: %errorlevel%
    pause
    exit /b %errorlevel%
)

REM 7. 运行format_pipe.py
echo 正在运行 format_pipe.py（模型: %model_name%）...
call conda activate my-neuro && python fine_tuning/format_pipe.py -n "%model_name%"
if %errorlevel% neq 0 (
    echo format_pipe.py 执行失败，错误码: %errorlevel%
    pause
    exit /b %errorlevel%
)

REM 8. 运行trainer_pipe.py
echo 正在运行 trainer_pipe.py（模型: %model_name%）...
call conda activate my-neuro && python fine_tuning/trainer_pipe.py -n "%model_name%"
if %errorlevel% neq 0 (
    echo trainer_pipe.py 执行失败，错误码: %errorlevel%
    pause
    exit /b %errorlevel%
)

REM 9. 运行afterprocess_pipe.py
echo 正在运行 afterprocess_pipe.py（模型: %model_name%）...
call conda activate my-neuro && python fine_tuning/afterprocess_pipe.py -n "%model_name%"
if %errorlevel% neq 0 (
    echo afterprocess_pipe.py 执行失败，错误码: %errorlevel%
    pause
    exit /b %errorlevel%
)

echo.
echo 所有脚本执行完成！
pause