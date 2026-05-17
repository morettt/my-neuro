@echo off
setlocal enabledelayedexpansion
cd /d %~dp0
title My-Neuro Installer

echo.
echo  ============================================
echo          My-Neuro  One-Click Installer
echo  ============================================
echo.
echo  Checking system requirements...
echo.

set CHECK_PASS=1

:: ---- Check 1: conda ----
echo  [Check 1/3] conda...
where conda >nul 2>&1
if !errorlevel! neq 0 (
    echo  [FAIL] conda not found.
    echo         Install Anaconda or Miniconda first:
    echo         https://www.anaconda.com/download
    set CHECK_PASS=0
) else (
    for /f "tokens=*" %%v in ('conda --version 2^>^&1') do set CONDA_VER=%%v
    echo  [OK]   Found: !CONDA_VER!
)

:: ---- Check 2: NVIDIA GPU driver ----
echo.
echo  [Check 2/3] NVIDIA GPU driver...
where nvidia-smi >nul 2>&1
if !errorlevel! neq 0 (
    echo  [FAIL] NVIDIA driver not found.
    echo         Download and install NVIDIA driver:
    echo         https://www.nvidia.com/drivers
    set CHECK_PASS=0
) else (
    set GPU_NAME_SET=
    set GPU_NAME=Unknown
    for /f "tokens=*" %%a in ('nvidia-smi --query-gpu^=name --format^=csv^,noheader 2^>nul') do (
        if not defined GPU_NAME_SET (
            set GPU_NAME=%%a
            set GPU_NAME_SET=1
        )
    )
    echo  [OK]   GPU: !GPU_NAME!
)

:: ---- Check 3: VRAM >= 5 GB ----
echo.
echo  [Check 3/3] VRAM (need 5 GB+)...
if "!CHECK_PASS!"=="0" (
    echo  [SKIP] GPU driver missing, skipping VRAM check.
    goto :check_done
)

set VRAM_SET=
set VRAM_MIB=0
for /f "tokens=*" %%a in ('nvidia-smi --query-gpu^=memory.total --format^=csv^,noheader^,nounits 2^>nul') do (
    if not defined VRAM_SET (
        set VRAM_MIB=%%a
        set VRAM_SET=1
    )
)
set VRAM_MIB=!VRAM_MIB: =!
set /a VRAM_GB=!VRAM_MIB! / 1024

if !VRAM_MIB! LSS 5120 (
    echo  [FAIL] Not enough VRAM: !VRAM_GB! GB detected, need at least 5 GB.
    set CHECK_PASS=0
) else (
    echo  [OK]   VRAM: !VRAM_GB! GB
)

:check_done

echo.
echo  --------------------------------------------
if "!CHECK_PASS!"=="0" (
    echo  Requirements not met. Fix issues above and retry.
    echo  --------------------------------------------
    echo.
    pause
    exit /b 1
)
echo  All checks passed. Starting installation...
echo  --------------------------------------------
echo.

:: ---- Step 1: Create conda environment ----
echo.
echo  [1/5] Creating conda env: my-neuro2  (Python 3.11)...
echo.

conda env list | findstr /C:"my-neuro2" >nul 2>&1
if !errorlevel! equ 0 (
    echo  [SKIP] my-neuro2 already exists.
) else (
    conda create -n my-neuro2 python=3.11 -y
    if !errorlevel! neq 0 (
        echo  [ERROR] Failed to create conda environment.
        pause
        exit /b 1
    )
    echo  [OK]   Environment created.
)

call conda activate my-neuro2
if !errorlevel! neq 0 (
    echo  [ERROR] Cannot activate my-neuro2.
    echo          Try: conda init cmd.exe  then reopen this terminal.
    pause
    exit /b 1
)

:: ---- Step 2: Install PyTorch (CUDA 12.8) ----
echo.
echo  [2/5] Installing PyTorch CUDA 12.8...
echo         (May take 10-30 min depending on network speed)
echo.
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
if !errorlevel! neq 0 (
    echo  [ERROR] PyTorch installation failed. Check your network.
    pause
    exit /b 1
)
echo  [OK]   PyTorch installed.

:: ---- Step 3: Install project dependencies ----
echo.
echo  [3/5] Installing project dependencies...
echo.
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/
if !errorlevel! neq 0 (
    echo  [ERROR] Dependency installation failed.
    pause
    exit /b 1
)
echo  [OK]   Dependencies installed.

:: ---- Step 4: Install ffmpeg ----
echo.
echo  [4/5] Installing ffmpeg...
echo.
conda install ffmpeg -y
if !errorlevel! neq 0 (
    echo  [ERROR] ffmpeg installation failed.
    pause
    exit /b 1
)
echo  [OK]   ffmpeg installed.

:: ---- Step 5: Download model files ----
echo.
echo  [5/5] Downloading models (BERT / TTS / ASR / RAG / Live2D)...
echo         Large files - may take 30 min to several hours. Please wait.
echo.
python full-hub/Batch_Download.py
if !errorlevel! neq 0 (
    echo  [ERROR] Model download failed. Check network and retry.
    echo          Already downloaded files will be skipped automatically.
    pause
    exit /b 1
)

echo.
echo  ============================================
echo           Installation Complete!
echo   Double-click [launch.bat] to start all services.
echo  ============================================
echo.
pause
