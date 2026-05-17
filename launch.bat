@echo off
cd /d %~dp0
title My-Neuro Launcher

echo.
echo  ============================================
echo           My-Neuro  Launcher
echo  ============================================
echo.
echo  Starting all backend services...
echo  Keep the 3 windows that open - do NOT close them!
echo.

start "My-Neuro BERT" 3.bert.bat
timeout /t 1 /nobreak >nul

start "My-Neuro ASR" 1.ASR.bat
timeout /t 1 /nobreak >nul

start "My-Neuro TTS" 2.TTS.bat

echo  [OK]  3 service windows launched.
echo.
echo  Notes:
echo    - BERT and ASR load models on first start (~30-60 sec)
echo    - TTS is ready when you see "Uvicorn running"
echo    - To stop: close those 3 windows
echo.
pause
