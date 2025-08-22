# My-Neuro - AI角色定制平台

## 项目简介

My-Neuro 是一个专为个人打造的 AI 角色定制平台，旨在通过您的数据印记，塑造出心目中理想的 AI 伙伴形象。

此项目受 Neuro-sama 启发，取名为 My-Neuro（社区提供的名称）。项目支持声音训练、性格定制、形象替换等功能。您的想象力有多丰富，模型就能多贴近您的期望。本项目更像是一个工作台，利用打包好的工具，一步步亲手描绘并实现心中理想的 AI 形象。

### 系统要求

- **操作系统**: Windows 10/11 (推荐)
- **显卡**: NVIDIA 显卡，至少 6GB 显存
- **内存**: 至少 16GB RAM
- **存储**: 至少 50GB 可用空间
- **Python**: 3.11 版本
- **Conda**: Anaconda 或 Miniconda

### 重要说明

⚠️ **当前项目仅支持 NVIDIA 显卡**。AMD 显卡虽然也能使用，但 TTS 功能会报错（即没有 AI 声音）。如果不介意可以尝试。

## 🔐 安全配置

### API密钥配置

**重要**: 请确保正确配置您的API密钥，不要将密钥提交到版本控制系统。

1. **方法一：环境变量（推荐）**
   ```bash
   # Windows
   set API_KEY=your_api_key_here
   set JIETU_API_KEY=your_jietu_api_key_here
   
   # Linux/Mac
   export API_KEY=your_api_key_here
   export JIETU_API_KEY=your_jietu_api_key_here
   ```

2. **方法二：配置文件**
   - 编辑 `py-my-neuro/config_mod/config.json`
   - 将 `YOUR_API_KEY_HERE` 替换为您的实际API密钥
   - 将 `YOUR_JIETU_API_KEY_HERE` 替换为您的截图API密钥

### 安全检查

运行安全检查工具以确保项目安全：
```bash
python security_check.py
```

## 快速开始

### 方法一：一键部署（推荐新手）

1. **安装 Anaconda**
   - 下载地址：https://www.anaconda.com/download/success
   - 安装教程：https://www.bilibili.com/video/BV1ns4y1T7AP

2. **配置API密钥**
   - 按照上述安全配置说明设置API密钥

3. **运行一键部署**
   - 双击 `一键部署.bat` 文件
   - 等待自动下载和配置完成

4. **启动服务**
   - 双击 `Game-starts.bat` 文件
   - 等待所有服务启动完成

5. **启动前端**
   - 进入 `live-2d` 文件夹
   - 双击 `肥牛.exe` 文件
   - 配置 API 信息并启动

### 方法二：手动部署（推荐有经验用户）

#### 1. 环境准备

```bash
# 创建虚拟环境
conda create -n my-neuro python=3.11 -y

# 激活环境
conda activate my-neuro

# 安装 jieba_fast 依赖
pip install jieba_fast-0.53-cp311-cp311-win_amd64.whl

# 安装其他依赖
pip install -r requirements.txt

# 安装 ffmpeg
conda install ffmpeg -y

# 安装 CUDA 版本的 PyTorch
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128

# 自动下载模型
python Batch_Download.py
```

#### 2. 启动后端服务

```bash
# 启动 ASR 服务
bert.bat

# 启动 TTS 服务  
ASR.bat

# 启动 BERT 服务
TTS.bat

# 可选：启动 RAG 服务（需要额外 1.5GB 显存）
RAG.bat
```

#### 3. 启动前端

1. 进入 `live-2d` 文件夹
2. 双击 `肥牛.exe` 文件
3. 在 LLM 标签页配置 API 信息
4. 点击"启动桌宠"

## 功能特性

### ✅ 已实现功能

#### 核心功能
- [x] **超低延迟**: 全本地推理，对话延迟在1秒以下
- [x] **语音定制**: 支持男、女声、各种角色声线切换
- [x] **实时打断**: 支持随时打断模型对话
- [x] **字幕同步**: 字幕和语音同步输出
- [x] **动作表情**: 根据对话内容展示不同的表情与动作
- [x] **真实情感**: 模拟真人的情绪变化状态
- [x] **视觉能力**: 集成图像识别，支持语言意图判断

#### 扩展功能
- [x] **桌面控制**: 支持语音控制打开软件等操作
- [x] **AI 唱歌**: 支持 AI 唱歌功能
- [x] **直播功能**: 可在哔哩哔哩平台直播
- [x] **打字对话**: 可键盘打字和 AI 交流
- [x] **主动对话**: 根据上下文主动发起对话
- [x] **联网接入**: 实时搜索最新信息
- [x] **手机应用**: 可在安卓手机上对话
- [x] **音效播放**: 播放音效库中的音效
- [x] **游戏陪玩**: 模型和用户共同游玩配合
- [x] **长期记忆**: 让模型记住你的关键信息
- [x] **AI 讲课**: 选择一个主题，让 AI 给你讲课
- [x] **Web 界面**: 支持网页界面
- [x] **Live2D 模型**: 支持替换各类 Live2D 模型

#### 模型功能
- [x] **变色功能**: 按照模型心情让屏幕变色
- [x] **自由走动**: 模型自由在屏幕中移动

### 🚧 开发中功能

- [ ] **超吊的人机体验**: 类似真人交互设计（持续改进中）
- [ ] **国外直播平台接入**: 支持更多直播平台

## 故障排除

### 常见问题

#### 1. 环境问题

**问题**: 提示找不到 Python 或 conda
**解决**: 
- 确保已安装 Anaconda
- 将 Anaconda 添加到系统 PATH
- 重启命令行窗口

**问题**: 依赖安装失败
**解决**:
- 使用国内镜像源：`pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/`
- 检查网络连接
- 尝试逐个安装依赖

#### 2. 模型问题

**问题**: 模型下载失败
**解决**:
- 检查网络连接
- 使用科学上网工具
- 手动下载模型文件

**问题**: GPU 内存不足
**解决**:
- 关闭其他占用 GPU 的程序
- 降低模型精度
- 使用 CPU 模式（较慢）

#### 3. 服务问题

**问题**: 端口被占用
**解决**:
- 检查端口是否被其他程序占用
- 修改配置文件中的端口号
- 重启计算机

**问题**: 服务启动失败
**解决**:
- 查看 `logs` 文件夹中的日志文件
- 检查模型文件是否完整
- 重新安装依赖

#### 4. API配置问题

**问题**: API密钥无效
**解决**:
- 检查API密钥是否正确
- 确认API服务是否可用
- 检查网络连接

**问题**: API配额不足
**解决**:
- 检查API使用量
- 考虑升级API套餐
- 使用本地模型替代

### 诊断工具

如果遇到问题，可以运行诊断工具：

```bash
conda activate my-neuro
python diagnostic_tool.py
```

诊断工具会检查：
- Python 版本
- 依赖包状态
- Conda 环境
- 模型文件
- GPU 状态
- 系统配置

### 安全检查

定期运行安全检查：

```bash
python security_check.py
```

安全检查会检测：
- 硬编码的敏感信息
- 危险函数使用
- 文件权限问题
- 依赖包安全漏洞

## 定制功能

### 定制 TTS 模型（克隆音色）

该模块基于 GPT-SoVITS 项目制作

**要求**:
- 音频长度：10-30 分钟
- 格式：MP3
- 内容：只能有一个说话人，可以有背景音乐
- 硬件：至少 6GB 显存

**步骤**:
1. 将音频文件放在 `fine_tuning/input` 文件夹下，改名为 `audio.mp3`
2. 双击运行 `一键克隆音色.bat`
3. 输入音频语言和模型名称
4. 等待训练完成
5. 修改 `run_server.py` 中的配置

### 定制 AI 模型

如需定制属于自己的 AI，请参考 `LLM-studio` 文件夹中的微调操作步骤。

## 技术支持

### QQ 群
- 群号：756741478
- 入群答案：肥牛

### 在线客服
- 地址：http://fake-neuro.natapp1.cc
- 功能：自动诊断和问题解决

### 问题反馈
如果遇到无法解决的问题，可以：
1. 在 QQ 群中寻求帮助
2. 使用在线客服
3. 提交 Issue 到 GitHub

## 更新日志

### 最新版本
- 修复了多个 bug 和稳定性问题
- 优化了代码结构和错误处理
- 改进了文档和安装指南
- 增强了诊断和故障排除功能
- **安全改进**: 移除了硬编码的API密钥，添加了安全检查工具

## 致谢

### 开源项目
- **GPT-SoVITS**: https://github.com/RVC-Boss/GPT-SoVITS
- **Neuro-sama**: 项目灵感来源

### 赞助者
- [@jonnytri53](https://github.com/jonnytri53) - 50美元赞助
- [@蒜头头头](https://space.bilibili.com/92419729) - 1000人民币赞助  
- [@东方月辰DFYC](https://space.bilibili.com/670385648) - 100人民币赞助

### 贡献者
- QQ群: 感谢 菊花茶洋参 帮忙制作肥牛app的封面

## 许可证

本项目采用 MIT 许可证，详见 [LICENSE.txt](LICENSE.txt) 文件。

## 项目愿景

My-Neuro 不仅仅是一个简单的聊天交互工具，更是一个有感情的 AI 伙伴。我们希望它能：

- 融入日常生活，成为有感情的个体
- 一起开黑玩游戏、看视频、学习东西
- 睡前聊天、叫你起床、工作时默默陪伴
- 记住和你在一起经历过的每一个时刻
- 持续理解你的一个存在

最重要的是，它的个性、样子、声音、情感变化等都由你决定，就像橡皮泥一样。我们提供最好的工具和模块适配，但最终的模样由你自己来构造。

对于不想折腾的朋友，此项目也直接打包了一个角色——肥牛（Fake Neuro）。它是一个受 Neuro-sama 启发的角色，具有腹黑、傲娇、搞笑、有小脾气，但偶尔也会展现温柔一面的性格。

当前项目已经实现了大约 **60%** 的核心功能，包括定性格、记忆、真实情感基础系统等。近期会围绕核心性格特征的深度优化，真正实现像人一样有持续情绪的功能。高级情感系统将在 2 个月内实现，完整版将在 6 月 1 日前完成，届时项目完成度将达到 **85%**。

---

**English Documentation**: [English Version](./README_English.md)

















