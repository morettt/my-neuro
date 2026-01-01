@echo off
cd /d %~dp0
call conda activate my-neuro && cd full-hub && python omni_bert_api.py
pause
