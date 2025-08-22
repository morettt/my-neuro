# My-Neuro - AI Character Customization Platform

## Project Overview

My-Neuro is an AI character customization platform designed for individuals, aiming to create your ideal AI companion through your data footprint.

This project is inspired by Neuro-sama, hence the name My-Neuro (a community-provided name). The project supports voice training, personality customization, appearance replacement, and other features. Your imagination is the only limit to how closely the model can match your expectations. This project is more like a workbench, using packaged tools to step by step personally describe and realize your ideal AI companion.

### System Requirements

- **Operating System**: Windows 10/11 (Recommended)
- **Graphics Card**: NVIDIA GPU with at least 6GB VRAM
- **Memory**: At least 16GB RAM
- **Storage**: At least 50GB available space
- **Python**: Version 3.11
- **Conda**: Anaconda or Miniconda

### Important Notice

⚠️ **This project currently only supports NVIDIA graphics cards**. AMD graphics cards can be used but TTS functionality will report errors (no AI voice). You may try if you don't mind this limitation.

## 🔐 Security Configuration

### API Key Configuration

**Important**: Please ensure proper configuration of your API keys and do not commit keys to version control systems.

1. **Method 1: Environment Variables (Recommended)**
   ```bash
   # Windows
   set API_KEY=your_api_key_here
   set JIETU_API_KEY=your_jietu_api_key_here
   
   # Linux/Mac
   export API_KEY=your_api_key_here
   export JIETU_API_KEY=your_jietu_api_key_here
   ```

2. **Method 2: Configuration File**
   - Edit `py-my-neuro/config_mod/config.json`
   - Replace `YOUR_API_KEY_HERE` with your actual API key
   - Replace `YOUR_JIETU_API_KEY_HERE` with your screenshot API key

### Security Check

Run the security check tool to ensure project security:
```bash
python security_check.py
```

## Quick Start

### Method 1: One-Click Deployment (Recommended for Beginners)

1. **Install Anaconda**
   - Download link: https://www.anaconda.com/download/success
   - Installation tutorial: https://www.bilibili.com/video/BV1ns4y1T7AP

2. **Configure API Keys**
   - Follow the security configuration instructions above to set up API keys

3. **Run One-Click Deployment**
   - Double-click `一键部署.bat` file
   - Wait for automatic download and configuration to complete

4. **Start Services**
   - Double-click `Game-starts.bat` file
   - Wait for all services to start

5. **Launch Frontend**
   - Enter the `live-2d` folder
   - Double-click `肥牛.exe` file
   - Configure API information and start

### Method 2: Manual Deployment (Recommended for Experienced Users)

#### 1. Environment Setup

```bash
# Create virtual environment
conda create -n my-neuro python=3.11 -y

# Activate environment
conda activate my-neuro

# Install jieba_fast dependency
pip install jieba_fast-0.53-cp311-cp311-win_amd64.whl

# Install other dependencies
pip install -r requirements.txt

# Install ffmpeg
conda install ffmpeg -y

# Install CUDA version of PyTorch
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128

# Automatically download models
python Batch_Download.py
```

#### 2. Start Backend Services

```bash
# Start ASR service
bert.bat

# Start TTS service  
ASR.bat

# Start BERT service
TTS.bat

# Optional: Start RAG service (requires additional 1.5GB VRAM)
RAG.bat
```

#### 3. Launch Frontend

1. Enter the `live-2d` folder
2. Double-click `肥牛.exe` file
3. Configure API information in the LLM tab
4. Click "Launch Desktop Pet"

## Features

### ✅ Implemented Features

#### Core Features
- [x] **Ultra-low Latency**: Full local inference with conversation latency under 1 second
- [x] **Voice Customization**: Support for male, female, and various character voice switching
- [x] **Real-time Interruption**: Support for interrupting model conversation at any time
- [x] **Subtitle Synchronization**: Synchronized subtitle and voice output
- [x] **Actions and Expressions**: Display different expressions and actions based on conversation content
- [x] **Real Emotions**: Simulate real human emotional state changes
- [x] **Visual Capabilities**: Integrated image recognition with language intent judgment

#### Extended Features
- [x] **Desktop Control**: Support voice control for opening software and other operations
- [x] **AI Singing**: Support for AI singing functionality
- [x] **Live Streaming**: Can live stream on Bilibili platform
- [x] **Text Chat**: Can type and communicate with AI via keyboard
- [x] **Proactive Conversation**: Initiate conversations proactively based on context
- [x] **Internet Access**: Real-time search for latest information
- [x] **Mobile App**: Can chat on Android phones
- [x] **Sound Effects**: Play sound effects from the sound library
- [x] **Game Companion**: Model and user play cooperative games together
- [x] **Long-term Memory**: Let the model remember your key information
- [x] **AI Teaching**: Choose a topic and let AI teach you
- [x] **Web Interface**: Support for web interface
- [x] **Live2D Models**: Support for replacing various Live2D models

#### Model Features
- [x] **Color Change Function**: Change screen colors according to model's mood
- [x] **Free Movement**: Model moves freely on the screen

### 🚧 Features in Development

- [ ] **Enhanced Human-Machine Experience**: Real human-like interaction design (continuously improving)
- [ ] **International Streaming Platforms**: Support for more streaming platforms

## Troubleshooting

### Common Issues

#### 1. Environment Issues

**Problem**: Cannot find Python or conda
**Solution**: 
- Ensure Anaconda is installed
- Add Anaconda to system PATH
- Restart command line window

**Problem**: Dependency installation failed
**Solution**:
- Use domestic mirror source: `pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/`
- Check network connection
- Try installing dependencies one by one

#### 2. Model Issues

**Problem**: Model download failed
**Solution**:
- Check network connection
- Use VPN tools
- Manually download model files

**Problem**: GPU memory insufficient
**Solution**:
- Close other programs using GPU
- Lower model precision
- Use CPU mode (slower)

#### 3. Service Issues

**Problem**: Port occupied
**Solution**:
- Check if port is occupied by other programs
- Modify port number in configuration file
- Restart computer

**Problem**: Service startup failed
**Solution**:
- Check log files in `logs` folder
- Verify model files are complete
- Reinstall dependencies

#### 4. API Configuration Issues

**Problem**: Invalid API key
**Solution**:
- Check if API key is correct
- Confirm API service is available
- Check network connection

**Problem**: API quota insufficient
**Solution**:
- Check API usage
- Consider upgrading API plan
- Use local models as alternative

### Diagnostic Tools

If you encounter problems, run the diagnostic tool:

```bash
conda activate my-neuro
python diagnostic_tool.py
```

The diagnostic tool will check:
- Python version
- Dependency package status
- Conda environment
- Model files
- GPU status
- System configuration

### Security Check

Run security checks regularly:

```bash
python security_check.py
```

Security checks will detect:
- Hardcoded sensitive information
- Dangerous function usage
- File permission issues
- Dependency security vulnerabilities

## Customization Features

### Custom TTS Model (Voice Cloning)

This module is based on the GPT-SoVITS project

**Requirements**:
- Audio length: 10-30 minutes
- Format: MP3
- Content: Only one speaker, background music allowed
- Hardware: At least 6GB VRAM

**Steps**:
1. Place audio file in `fine_tuning/input` folder, rename to `audio.mp3`
2. Double-click and run `一键克隆音色.bat`
3. Input audio language and model name
4. Wait for training completion
5. Modify configuration in `run_server.py`

### Custom AI Model

If you need to customize your own AI, please refer to the fine-tuning operation steps in the `LLM-studio` folder.

## Technical Support

### QQ Group
- Group Number: 756741478
- Entry Answer: 肥牛

### Online Customer Service
- Address: http://fake-neuro.natapp1.cc
- Function: Automatic diagnosis and problem solving

### Issue Feedback
If you encounter unsolvable problems, you can:
1. Seek help in QQ group
2. Use online customer service
3. Submit Issue to GitHub

## Update Log

### Latest Version
- Fixed multiple bugs and stability issues
- Optimized code structure and error handling
- Improved documentation and installation guide
- Enhanced diagnostic and troubleshooting features
- **Security Improvements**: Removed hardcoded API keys, added security check tools

## Acknowledgments

### Open Source Projects
- **GPT-SoVITS**: https://github.com/RVC-Boss/GPT-SoVITS
- **Neuro-sama**: Source of project inspiration

### Sponsors
- [@jonnytri53](https://github.com/jonnytri53) - $50 sponsorship
- [@蒜头头头](https://space.bilibili.com/92419729) - 1000 RMB sponsorship  
- [@东方月辰DFYC](https://space.bilibili.com/670385648) - 100 RMB sponsorship

### Contributors
- QQ Group: Thanks to 菊花茶洋参 for helping create the Fat Beef app cover

## License

This project is licensed under the MIT License. See [LICENSE.txt](LICENSE.txt) file for details.

## Project Vision

My-Neuro is not just a simple chat interaction tool, but an emotional AI companion. We hope it can:

- Integrate into daily life and become an emotional individual
- Play games together, watch videos, learn things
- Chat before bed, wake you up, quietly accompany you while working
- Remember every moment experienced together with you
- Continuously understand you as a being

Most importantly, its personality, appearance, voice, emotional changes, etc. are all decided by you, like clay. We provide the best tools and module compatibility, but the final form is constructed by yourself.

For friends who don't want to tinker, this project also directly packages a character - Fat Beef (Fake Neuro). It's a character inspired by Neuro-sama, with a scheming, tsundere, funny personality with a small temper, but occasionally showing a gentle side.

The current project has implemented approximately **60%** of core features, including personality setting, memory, and basic real emotion systems. Recently, we'll focus on deep optimization of core personality traits to truly achieve human-like continuous emotions. The advanced emotional system will be implemented within 2 months, and the complete version will be finished before June 1st, reaching **85%** completion.

---

**Chinese Documentation**: [中文版本](./README.md)
