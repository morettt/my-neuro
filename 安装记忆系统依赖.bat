@echo off
chcp 65001 >nul
echo.
echo ================================================
echo Installing Dependencies for Feiniu AI Memory System
echo ================================================
echo.

cd /d "%~dp0"

set "CONDA_ENV=my-neuro"
set "CONDA_ACTIVATE=C:\Users\21621\miniconda3\Scripts\activate.bat"

if not exist "%CONDA_ACTIVATE%" (
    echo [ERROR] Conda activate script not found: %CONDA_ACTIVATE%
    pause
    exit /b 1
)

call "%CONDA_ACTIVATE%" %CONDA_ENV%
if errorlevel 1 (
    echo [ERROR] Failed to activate environment: %CONDA_ENV%
    pause
    exit /b 1
)
echo [INFO] Environment activated: %CONDA_ENV%
echo.

echo [1/3] Installing Streamlit...
pip install streamlit -q
if errorlevel 1 goto install_error

echo [2/3] Installing Sentence-Transformers...
pip install sentence-transformers -q
if errorlevel 1 goto install_error

echo [3/3] Installing aiohttp and pydantic...
pip install aiohttp pydantic -q
if errorlevel 1 goto install_error

echo.
echo ================================================
echo [SUCCESS] All dependencies installed successfully!
echo ================================================
echo.
echo Next steps:
echo 1. Double-click MEMOS-API.bat to start the memory service.
echo 2. Start the main Feiniu program as usual.
echo.
pause
exit /b 0

:install_error
echo.
echo ================================================
echo [ERROR] Installation failed!
echo ================================================
echo Please check your network connection or error messages above.
pause
exit /b 1