@echo off
cd /d %~dp0
if exist %~dp0env\python.exe (
    cd full-hub
    %~dp0env\python.exe omni_bert_api.py
) else (
    call conda activate my-neuro && cd full-hub && python omni_bert_api.py
)
pause
