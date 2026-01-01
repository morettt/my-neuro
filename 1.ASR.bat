@echo off
cd %~dp0
call conda activate my-neuro && cd full-hub && python asr_api.py
pause