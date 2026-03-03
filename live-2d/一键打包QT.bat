@echo off
chcp 65001 >nul
echo ========================================
echo Fake Neuro Live2D Pack Tool
echo ========================================
echo.

cd /d "%~dp0"

echo [1/4] Checking Python...
python --version
if errorlevel 1 (
    echo ERROR: Python not found
    pause
    exit /b 1
)

echo.
echo [2/4] Checking dependencies...
pip show pyyaml >nul 2>&1
if errorlevel 1 (
    echo Installing PyYAML...
    pip install pyyaml
) else (
    echo PyYAML OK
)

pip show pyinstaller >nul 2>&1
if errorlevel 1 (
    echo Installing PyInstaller...
    pip install pyinstaller
) else (
    echo PyInstaller OK
)

echo.
echo [3/4] Checking PyQt5...
pip show PyQt5 >nul 2>&1
if errorlevel 1 (
    echo Installing PyQt5...
    pip install PyQt5
) else (
    echo PyQt5 OK
)

echo.
echo [4/4] Building...
echo Please wait...
echo.

pyinstaller --onefile --windowed --icon=fake_neuro.ico --distpath . --name fake_neuro test.py

if exist fake_neuro.spec del fake_neuro.spec

echo.
echo ========================================
if exist fake_neuro.exe (
    echo Build SUCCESS!
    echo Output: %~dp0fake_neuro.exe
) else (
    echo Build FAILED
)
echo ========================================
pause
