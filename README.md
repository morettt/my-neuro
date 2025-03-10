## 项目简介

本项目旨在几乎全方位复刻 Neuro-sama，同时向社区收集各种新奇有趣功能添加实现，由于其不错的训练代码。可以非常轻松的将少量数据集训练出非常好的效果。这一点是整个AI的核心。项目的目标是帮助用户打造专属的 AI 角色 - 通过您的数据印记,塑造出心目中理想的 AI 形象。

考虑到项目涉及多个复杂组件和严格的环境依赖，为了让更多开发者能够轻松部署和使用，我会设计每一个操作步骤和使用文档，也是为了让大家有一个更好的体验。 

以下功能会一一添加。

## 计划清单（打✔的是已经实现的功能）

### 双模型支持
- [x] 开源模型：基于开源模型微调，支持本地部署
- [x] 闭源模型：基于商业模型的 prompt 优化

### 核心功能
- [x] 超低延迟：模型回应仅需1.5秒左右
- [ ] 语音定制：支持男/女声切换，语速调节等
- [ ] 实时打断：支持随时打断模型对话
- [ ] 超吊的人机体验(类似真人交互设计，敬请期待)
- [ ] 丰富表情：根据对话内容展示不同的表情与动作

### 扩展功能
- [ ] 桌面控制：支持语音控制打开软件等操作
- [x] 集成视觉能力，支持图像识别，并通过语言意图判断何时启动视觉功能
- [ ] 主动对话：根据上下文主动发起对话
- [x] 字幕和语音同步输出

## 🚀 快速开始

### 启动步骤

1. 创建并激活虚拟环境
```bash
conda create -n my-neuro python=3.10 -y

##linux系统
source activate my-neuro

##win系统
conda activate my-neuro
```

2. 安装依赖
```bash
pip install -r requirements.txt

#安装ffmpedg
conda install ffmpeg

#安装cuda 默认是11.8 可以自行修改
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```


3. 启动ASR服务
```bash
##第一次运行，会自动下载需要的模型
python asr_api.py
```

4.启动TTS服务
```bash
#下载模型
modelscope download --model morelle/fake_neuro_V1 --local_dir ./model
#启动TTS服务
python tts_api.py -p 5000 -d cuda -s model/FKTTS/fake_neuro.pth -dr model/FKTTS/sama.wav -dt "Hold on please, I'm busy. Okay, I think I heard him say he wants me to stream Hollow Knight on Tuesday and Thursday." -dl "英文"
```






## 🔧 模型训练

完成基础配置后，可以进入 finetune 文件夹进行模型微调。详细的训练流程和参数设置请参考训练文档。

