@echo off
cd /d %~dp0
if exist %~dp0env\python.exe (
    cd full-hub
    %~dp0env\python.exe asr_api.py
) else (
    call conda activate my-neuro && cd full-hub && python asr_api.py
)
pause
