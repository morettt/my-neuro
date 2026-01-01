@echo off
cd /d %~dp0
call conda activate my-neuro && cd full-hub && python run_rag.py
pause
