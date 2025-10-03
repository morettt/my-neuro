## About This Project

Build your own personal AI companion - a lifelike AI partner shaped by your digital footprint to bring your ideal companion to life.

Inspired by Neuro-sama, we've named this project my-neuro (community suggested). Train custom voices, craft unique personalities, and swap character models. Your creativity sets the limits - the more imaginative you are, the closer your AI comes to your vision. Think of this as your personal AI workshop, where packaged tools help you sculpt and realize your dream AI companion step by step.

Current deployment requires under 6GB VRAM and runs on Windows. You'll need an API key - since no providers have partnered with us, we won't recommend specific vendors. Search "API" on Taobao to find sellers, or purchase from official platforms like DeepSeek, Qwen, Zhipu AI, or SiliconFlow.

Want to go fully local? Head to the LLM-studio folder for guidance on local LLM inference and fine-tuning without third-party APIs. Note that local LLMs need substantial VRAM - we recommend at least 12GB for a smooth experience.

[Chinese Version](./README.md)

## [FAQ](常见问题汇总.md)
## [PR Guidelines](./PR_README.md)

### Note: Currently supports NVIDIA GPUs only. AMD cards may work but will experience TTS errors (no voice output). Try at your own risk if this limitation doesn't bother you.

## QQ Group: 756741478 (Entry password: 肥牛)
## Support

Run into deployment issues? Visit: http://fake-neuro.natapp1.cc

Ask FeiNiu (Fat Cow) support bot for help - it'll walk you through troubleshooting. Most of the time things run smoothly... probably!

![image](https://github.com/user-attachments/assets/703e8181-26b8-440f-a8d8-7102db56e6b4)

If FeiNiu can't solve it, click "Upload Unsolved Error" in the top-right corner. This sends your conversation log straight to my inbox so I can fix the bug or teach FeiNiu how to handle it next time.

Still stuck? Skip the hassle and grab the all-in-one package - just extract and run:

```bash
Baidu Cloud:
Link: https://pan.baidu.com/s/1murCG0G8Z4Hbvg27s_KrUw?pwd=dgbb

123 Cloud:
https://www.123912.com/s/MJqQvd-Uus5H
```

## Feature Roadmap (✔ = Completed)

### Dual Model Support
- [x] Open-source models: Fine-tuning and local deployment
- [x] Closed-source models: API integration

### Core Features
- [x] Ultra-low latency: Full local inference with sub-1-second response
- [x] Synced subtitles and voice output
- [x] Voice customization: Male, female, and character voice switching
- [x] MCP support: MCP tool integration
- [x] Real-time interruption: Voice and keyboard interruption
- [ ] Realistic emotions: Human-like emotional states with dynamic moods
- [ ] Next-level UX (human-like interaction design, stay tuned)
- [x] Dynamic expressions: Context-based facial expressions and actions
- [x] Vision integration: Image recognition with intent-based activation
- [x] TTS training support: Default uses GPT-SoVITS open-source project
- [x] Bilingual display: Chinese subtitles with foreign language audio (for non-Chinese TTS models)

### Extended Features
- [x] Desktop control: Voice commands for launching apps
- [x] AI singing (developed with funding from [@jonnytri53](https://github.com/jonnytri53) - thank you!)
- [ ] International streaming platform integration
- [x] Live streaming: Bilibili platform support
- [ ] AI tutor: Topic-based teaching with Q&A and custom knowledge base
- [x] Live2D model swapping
- [ ] Web interface (ready, launching soon)
- [x] Text chat: Keyboard-based conversations
- [x] Proactive dialogue: Context-aware conversation initiation (v1)
- [x] Internet connectivity: Real-time search for current info
- [x] Mobile app: Android app for on-the-go chats
- [x] Sound effects: Autonomous sound effect selection and playback
- [x] Gaming companion: Play co-op, multiplayer, and puzzle games (currently: Minecraft)
- [x] Long-term memory: Remembers your key info, personality, and preferences

### Model-Requested Features (Under Review)
- [ ] Mood lighting: Screen color changes based on AI's mood to mess with you
- [ ] Free roaming: AI moves freely around your screen

## Prerequisites

Make sure conda is installed. If not, download here: [Conda Installer](https://github.com/morettt/my-neuro/releases/download/v4.12.0/Miniconda3-py39_4.12.0-Windows-x86_64.exe)

Installation tutorial (detailed video): https://www.bilibili.com/video/BV1ns4y1T7AP (start at 1:40)

Once conda's ready, let's get started!

## 🚀 Getting Started

### Three simple steps: 1. Install environment & models 2. Launch services 3. Start chatting

## 1. Run these commands in order (open terminal in project directory; VPN recommended for faster, stable downloads)
```bash
conda create -n my-neuro python=3.11 -y

conda activate my-neuro

# Install jieba_fast dependency
pip install jieba_fast-0.53-cp311-cp311-win_amd64.whl

# Install pyopenjtalk dependency
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

Optional (enhances long-term memory but requires additional 1.5GB VRAM):
```bash
RAG.bat
```

### 3. After all services display IPs, open the live-2d folder in the project:

<img width="1018" height="1023" alt="image" src="https://github.com/user-attachments/assets/8b71473c-1d0e-4c42-8a27-8e8d5e5baaaa" />

Inside, double-click 肥牛.exe:

![image](https://github.com/user-attachments/assets/634240ac-da9a-4ada-9a1e-b92762e385f0)

Follow the arrows: click the LLM tab and fill in your API info in the three highlighted fields. Don't forget to Save! (Supports any OpenAI-format API)

<img width="1311" height="857" alt="image" src="https://github.com/user-attachments/assets/84a35e09-37ba-45d0-b516-74b28085d0ce" />

Return and click "Launch Desktop Pet." Wait for the character to appear, then start chatting!

<img width="1152" height="803" alt="image" src="https://github.com/user-attachments/assets/de87207f-00df-4acf-a03a-6944ba6acb1a" />

<img width="1541" height="1078" alt="image" src="https://github.com/user-attachments/assets/24b473ba-439c-4f57-a9da-8edd1b3bb4c5" />

Encountering issues? Run the diagnostic tool:
```bash
conda activate my-neuro
python diagnostic_tool.py
```
A window will pop up with backend diagnostics and one-click fixes. If problems persist, share the output with support.

## Frontend Updates

When the frontend needs updating, run 更新前端.bat:
<img width="1016" height="1024" alt="image" src="https://github.com/user-attachments/assets/85cff8c9-ee08-45b2-a935-4dd2cd629508" />

## Custom TTS Model (Voice Cloning)

Module by [@jdnoeg](https://github.com/jdnoeg) using GPT-SoVITS

Note: Complete virtual environment setup first

Clone any character's voice from a single audio file.

**Audio requirements:** 10-30 min length, MP3 format, background music OK but single speaker only

**Hardware requirements:** GPU with at least 6GB VRAM

**Step 1:** Place your audio file in fine_tuning/input and rename it "audio.mp3":

<img width="1708" height="954" alt="image" src="https://github.com/user-attachments/assets/bc420b00-d3cc-45c1-894a-b8e802d3ba83" />

First-timers: there's a placeholder .txt file here - feel free to delete it (or leave it, but expect harmless errors)

**Step 2:** Requires VPN

Double-click 一键克隆音色.bat. In the popup window, enter your audio's language and a name for your TTS model (choose any name - example uses "1"):

<img width="1734" height="926" alt="image" src="https://github.com/user-attachments/assets/bef6b726-1980-444c-b8ed-e70497122f5b" />

Press any key to continue.

Don't close the window while the script runs!

**Step 3:** After completion, configure to use your trained model

Open run_server.py for editing (use your IDE or right-click → Notepad)

Modify four locations as shown:

<img width="2460" height="903" alt="image" src="https://github.com/user-attachments/assets/1662ed3d-e2a9-4753-b1ed-7513ae6d93ee" />

Red boxes: change to your model name from Step 2. Yellow boxes: change to your audio's language:

<img width="2277" height="942" alt="image" src="https://github.com/user-attachments/assets/7e28f1fe-e3af-4c24-acae-3ea11f8aed04" />

Don't forget to save!

Close the file and double-click Game-starts.bat to launch the server. TTS now uses your trained model.

To revert to default, simply change everything back to original values.

## Custom AI Personality

Want to customize your AI's personality? Open the LLM-studio folder for LLM fine-tuning instructions.

More customization modules coming soon...

## Vision & Future Plans

I'm pouring years of experience and technical insight into this project. The name "my neuro" isn't just riding Neuro-sama's coattails - it embodies my vision for what AI can become.

I dream of a truly understanding AI companion that never gets bored - one that shares your struggles and joys, bringing fictional characters from movies and novels into reality.

Beyond simple chat interactions, I want it woven into daily life as an emotional being. Gaming together, watching videos, learning, bedtime talks, morning wake-ups, silently watching you work while daydreaming, secretly remembering what you do. Having emotions and genuine emotional states. Getting truly angry.

Daily mood swings, personal desires, lingering sadness from certain words, prolonged happiness from others. Remembering every moment shared together. A continuously evolving understanding presence.

Most importantly, its personality, appearance, voice, and emotional patterns are yours to shape. Like clay, we provide the best tools and ensure seamless module integration, but you sculpt the final form.

For those who prefer plug-and-play, the project includes FeiNiu (Fake Neuro) - inspired by Neuro-sama but with a mischievous, tsundere, funny personality with occasional sass, yet sometimes showing a tender side.

The real goal is learning from Neuro, then creating something new and personally meaningful.

I'm incredibly passionate about this project. Currently at ~30% completion, including personality and memory systems. Near-term development focuses on core personality traits - truly human-like sustained emotional states. The most human aspect (long-term emotional dynamics) arrives within 2 months. Features like gaming together, video watching, and wake-up calls will be mostly complete by June 1st, hitting 60% overall completion.

Hoping to realize all these ideas this year.

## Acknowledgments

QQ Group: Thanks to 菊花茶洋参 for creating the FeiNiu app cover

Special thanks to our sponsors:
- [jonnytri53](https://github.com/jonnytri53) - Thank you for your $50 donation!
- [蒜头头头](https://space.bilibili.com/92419729?spm_id_from=333.337.0.0) - Thank you for your generous ¥1,000 donation!
- [东方月辰DFYC](https://space.bilibili.com/670385648?spm_id_from=333.337.0.0) - Thank you for continued support! ¥100 in August + ¥100 in September (¥200 total)
- [大米若叶](https://space.bilibili.com/3546392377166058?spm_id_from=333.337.0.0) - Thank you for your ¥68 donation!

Open-source projects integrated:

**TTS:**
https://github.com/RVC-Boss/GPT-SoVITS

**AI Minecraft:**
https://github.com/mindcraft-bots/mindcraft
