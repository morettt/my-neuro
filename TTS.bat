@echo off
:: 使用脚本所在目录作为工作目录
cd %~dp0tts-hub\GPT-SoVITS-Bundle
set "PATH=%~dp0tts-hub\GPT-SoVITS-Bundle\runtime;%PATH%"
runtime\python.exe api.py -p 5000 -d cuda -s role_voice_api/neuro/merge.pth -dr role_voice_api/neuro/01.wav -dt "Hold on please, I'm busy. Okay, I think I heard him say he wants me to stream Hollow Knight on Tuesday and Thursday." -dl "en"
pause
