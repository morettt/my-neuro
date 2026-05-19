@echo off
cd /d %~dp0

pip show pyinstaller >nul 2>&1
if errorlevel 1 pip install pyinstaller -q

pip show modelscope >nul 2>&1
if errorlevel 1 pip install modelscope -q

for /f "delims=" %%i in ('python -c "import sys; print(sys.prefix)"') do set PYPREFIX=%%i

pyinstaller --onedir --noconsole --name "My-Neuro-Installer" --collect-all modelscope --hidden-import tkinter --hidden-import tkinter.ttk --hidden-import tkinter.scrolledtext --hidden-import tkinter.messagebox --exclude-module PyQt5 --exclude-module PyQt6 --exclude-module PySide2 --exclude-module PySide6 --add-data "%PYPREFIX%\tcl\tcl8.6;tcl8.6" --add-data "%PYPREFIX%\tcl\tk8.6;tk8.6" --runtime-hook rthook_tkinter.py installer.py

if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

echo Done. Output: dist\My-Neuro-Installer\
pause
