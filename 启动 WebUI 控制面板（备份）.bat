@echo off
echo.
echo ========================================
echo  My Neuro WebUI Control Panel v3.4
echo ========================================
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python not found!
    pause
    exit /b 1
)

echo Checking Flask...
python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo Installing Flask...
    pip install flask
) 

echo.
echo Starting WebUI...
echo.

python webui_controller.py
pause
