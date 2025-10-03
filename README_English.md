## Project Overview

This project aims to create your personal AI companion - building a lifelike AI partner through your digital footprint to bring your ideal companion to life.

Inspired by Neuro-sama, this project is called my-neuro (community-suggested name). You can train custom voices, personalities, and swap character models. Your imagination is the only limit - the more creative you are, the closer the model comes to your vision. Think of this project as a workbench where you use pre-packaged tools to craft and bring your ideal AI companion to life, step by step.

Current deployment requires less than 6GB VRAM and runs on Windows. You'll also need an API key. Since no API providers have approached me for partnerships, I won't recommend specific vendors. However, you can search "API" on Taobao to find many sellers, or purchase from official platforms like DeepSeek, Qwen, Zhipu AI, or SiliconFlow.

If you want to run everything locally using local LLM inference or fine-tuning without relying on third-party APIs, check out the LLM-studio folder for guidance on local model inference and fine-tuning. Note that local LLMs require significant VRAM - for a decent experience, we recommend at least 12GB VRAM.

[Chinese Version](./README.md)

## [FAQ](常见问题汇总.md)
## [PR Submission Guidelines](./PR_README.md)

### PS: This project currently only supports NVIDIA GPUs. AMD cards may work but will encounter TTS errors (no AI voice output). Feel free to try if you don't mind this limitation.

## QQ Group: 756741478 (Entry Answer: 肥牛)
## Customer Support

If you encounter bugs during deployment, visit: http://fake-neuro.natapp1.cc

Ask the FeiNiu (Fat Cow) support bot for help - it'll guide you through troubleshooting. Most of the time, you won't run into any issues... hopefully!

![image](https://github.com/user-attachments/assets/703e8181-26b8-440f-a8d8-7102db56e6b4)

If the FeiNiu bot can't resolve your issue, click the "Upload Unsolved Error" button in the top-right corner. This sends your conversation history directly to my email so I can review it, fix the bug, or teach the bot how to handle it next time.

If you'd rather skip the setup entirely, download the all-in-one package - just extract and run:

```bash
Baidu Cloud:
Link: https://pan.baidu.com/s/1murCG0G8Z4Hbvg27s_KrUw?pwd=dgbb

123 Cloud:
https://www.123912.com/s/MJqQvd-Uus5H
```

## Roadmap (✔ = Implemented)

### Dual Model Support
- [x] Open-source models: Support for fine-tuning and local deployment
- [x] Closed-source models: API integration support

### Core Features
- [x] Ultra-low latency: Fully local inference with <1 second response time
- [x] Synchronized subtitles and voice output
- [x] Voice customization: Male, female, and various character voice options
- [x] MCP support: Integration with MCP tools
- [x] Real-time interruption: Voice and keyboard interruption support
- [ ] Realistic emotions: Simulate human emotional states with dynamic mood changes
- [ ] Incredible UX (human-like interaction design, coming soon)
- [x] Dynamic expressions: Display different expressions and actions based on conversation
- [x] Vision integration: Image recognition with intent-based activation
- [x] TTS model training support (default: GPT-SoVITS open-source project)
- [x] Bilingual subtitles: Display Chinese subtitles with foreign language audio (for foreign-language TTS models)

### Extended Features
- [x] Desktop control: Voice commands to launch applications
- [x] AI singing (funded by [@jonnytri53](https://github.com/jonnytri53) - thank you!)
- [ ] International streaming platform integration
- [x] Streaming: Bilibili live streaming support
- [ ] AI tutor: Select a topic and let AI teach you, with Q&A support and custom knowledge base
- [x] Live2D model replacement
- [ ] Web interface support (ready, coming soon)
- [x] Text chat: Keyboard-based conversation
- [x] Proactive conversation: Context-aware conversation initiation (v1)
- [x] Internet access: Real-time search for current information
- [x] Mobile app: Android app for on-the-go conversations
- [x] Sound effects: Model autonomously selects and plays sound effects
- [x] Gaming companion: Play cooperative, multiplayer, and puzzle games together (currently: Minecraft)
- [x] Long-term memory: Model remembers key information about you, your personality, and preferences

### Model-Requested Features (Under Consideration)
- [ ] Color changing: Screen color changes based on model's mood to mess with users
- [ ] Free roaming: Model moves freely around the screen

## Prerequisites

Make sure you have conda installed. If not, download it here: [Conda Installer](https://github.com/morettt/my-neuro/releases/download/v4.12.0/Miniconda3-py39_4.12.0-Windows-x86_64.exe)

For installation instructions, check out this detailed video: https://www.bilibili.com/video/BV1ns4y1T7AP (start at 1:40)

Once conda is ready, you're all set to begin!

## 🚀 Getting Started

### Just 3 steps: 1. Install environment & models 2. Start services 3. Start using

## 1. Run the following commands in order (open terminal in project directory; VPN recommended for faster downloads)
```bash
conda create -n my-neuro python=3.11 -y

conda activate my-neuro

# Install jieba_fast dependency separately
pip install jieba_fast-0.53-cp311-cp311-win_amd64.whl

# Install pyopenjtalk dependency separately
pip install pyopenjtalk-0.4.1-cp311-cp311-win_amd64.whl

pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/

# Install ffmpeg
conda install ffmpeg -y

# Install CUDA (default 12.8, modify as needed)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128

# Auto-download required models
python Batch_Download.py
```

## 2. Double-click these 3 files

### (Keep them running! These .bat files are backend services and must stay open)

```bash
bert.bat

ASR.bat

TTS.bat
```

Optional (enables enhanced long-term memory, requires additional 1.5GB VRAM):
```bash
RAG.bat
```

### 3. After all services display their IPs, open the live-2d folder in the project:

<img width="1018" height="1023" alt="image" src="https://github.com/user-attachments/assets/8b71473c-1d0e-4c42-8a27-8e8d5e5baaaa" />

Inside, double-click the 肥牛.exe file:

![image](https://github.com/user-attachments/assets/634240ac-da9a-4ada-9a1e-b92762e385f0)

Follow the arrows: click the LLM tab and fill in your API information in the three highlighted fields. Remember to click Save! (Supports any OpenAI-format API)

<img width="1311" height="857" alt="image" src="https://github.com/user-attachments/assets/84a35e09-37ba-45d0-b516-74b28085d0ce" />

Finally, return and click "Start Desktop Pet." Wait for the character to appear, then start chatting!

<img width="1152" height="803" alt="image" src="https://github.com/user-attachments/assets/de87207f-00df-4acf-a03a-6944ba6acb1a" />

<img width="1541" height="1078" alt="image" src="https://github.com/user-attachments/assets/24b473ba-439c-4f57-a9da-8edd1b3bb4c5" />

If you encounter any issues, run the diagnostic tool:
```bash
conda activate my-neuro
python diagnostic_tool.py
```
A window will appear with backend diagnostics and one-click fix buttons. If problems persist, provide the output to customer support.

## Frontend Updates

When the frontend needs updating, run 更新前端.bat:
<img width="1016" height="1024" alt="image" src="https://github.com/user-attachments/assets/85cff8c9-ee08-45b2-a935-4dd2cd629508" />

## Custom TTS Model (Voice Cloning)

Created by [@jdnoeg](https://github.com/jdnoeg) using the GPT-SoVITS project

Note: Complete the virtual environment setup first

This module clones your desired character's voice from a single audio file.

Audio requirements: 10-30 min length, MP3 format, can have background music but only one speaker

Hardware requirements: GPU with at least 6GB VRAM

1. Place your audio file in the fine_tuning/input folder and rename it to "audio.mp3":

<img width="1708" height="954" alt="image" src="https://github.com/user-attachments/assets/bc420b00-d3cc-45c1-894a-b8e802d3ba83" />

First-time users: there will be a placeholder .txt file here - you can delete it (or leave it, but it may cause harmless errors)

2. This step requires VPN access

Double-click 一键克隆音色.bat. In the window that appears, enter your audio's language and a name for your TTS model (your choice - example uses "1"):

<img width="1734" height="926" alt="image" src="https://github.com/user-attachments/assets/bef6b726-1980-444c-b8ed-e70497122f5b" />

Press any key to continue.

Don't close the window while the script runs!

3. After completion, modify the configuration to use your trained model

Open run_server.py for editing (use your IDE or right-click → open with Notepad)

You need to modify four locations as shown:

<img width="2460" height="903" alt="image" src="https://github.com/user-attachments/assets/1662ed3d-e2a9-4753-b1ed-7513ae6d93ee" />

Change all red boxes to your model name from step 2, and yellow boxes to your audio's language:

<img width="2277" height="942" alt="image" src="https://github.com/user-attachments/assets/7e28f1fe-e3af-4c24-acae-3ea11f8aed04" />

Don't forget to save!

Close the file and double-click Game-starts.bat to run the server. TTS will now use your trained model.

To revert to the default model, simply change everything back to the original values.

## Custom AI

For custom AI personalities, open the LLM-studio folder for LLM fine-tuning instructions.

Customization modules will gradually expand...

### Closing Thoughts

I'm pouring years of experience and technical understanding into this project. The name "my neuro" isn't just riding Neuro-sama's popularity - it represents my imagination and hopes for the boundaries of AI.

I envision a truly understanding AI companion that never gets bored - one that shares your sadness and happiness, bringing fictional characters from movies and novels into reality.

Beyond simple chat interactions, I want it to integrate into daily life as an emotional being. Gaming together, watching videos, learning, bedtime chats, morning wake-ups, silently watching you work, secretly remembering what you do. Having emotions and genuine emotional states. Getting truly angry.

Daily mood changes, personal desires, lingering hurt from certain words, prolonged joy from others. Remembering every moment shared with you. A continuously evolving understanding presence.

Most importantly, its personality, appearance, voice, and emotional patterns are shaped by you. Like clay, we provide the best tools and ensure module compatibility, but the final form is yours to create.

For those who prefer simplicity, the project includes a ready-made character: FeiNiu (Fake Neuro). It's inspired by Neuro-sama but with a mischievous, tsundere, funny personality with occasional temper - yet sometimes showing a gentle side.

The real goal is to learn from and understand Neuro, then create something new and personally meaningful.

I'm incredibly passionate about this project. Currently at ~30% completion, including personality definition and memory systems. Development will focus on core personality traits - truly human-like sustained emotional states. The most human-like aspect (long-term emotional states) will be implemented within 2 months. Features like gaming together, video watching, and wake-up calls will be mostly complete by June 1st, reaching 60% completion.

I hope to realize all these ideas this year.

## Acknowledgments

QQ Group: Thanks to 菊花茶洋参 for creating the FeiNiu app cover

Special thanks to our financial sponsors:
- [jonnytri53](https://github.com/jonnytri53) - Thank you for your $50 donation!
- [蒜头头头](https://space.bilibili.com/92419729?spm_id_from=333.337.0.0) - Thank you for your generous ¥1000 donation!
- [东方月辰DFYC](https://space.bilibili.com/670385648?spm_id_from=333.337.0.0) - Thank you for your continued support! ¥100 in August, ¥100 in September (¥200 total)
- [大米若叶](https://space.bilibili.com/3546392377166058?spm_id_from=333.337.0.0) - Thank you for your ¥68 donation!

Open-source projects integrated:
TTS:
https://github.com/RVC-Boss/GPT-SoVITS

AI Minecraft:
https://github.com/mindcraft-bots/mindcraft
