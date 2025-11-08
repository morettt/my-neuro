# My-neuro

<div align="center">

<a href="https://github.com/morettt/my-neuro/releases">
    <img src="https://img.shields.io/github/v/release/morettt/my-neuro" alt="latest version" /></a>

<a href="https://github.com/morettt/my-neuro/graphs/contributors">
    <img alt="GitHub contributors" src="https://img.shields.io/github/contributors/morettt/my-neuro"></a>

<a href="https://deepwiki.com/morettt/my-neuro">
    <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" /></a>

</div>

#### [English-Version](./README_English.md)


## 项目简介

本项目的目标是打造专属个人的 AI 角色,打造出逼近真人的AI伙伴 - 通过您的数据印记,塑造出心目中理想的 TA 的形象。

此项目受neuro sama启发，所以取名为my-neuro（社区提供的名称） 项目可训练声音、性格、替换形象 您的想象力有多丰富，模型就能多贴近您的期望。本项目更像是一个工作台。利用打包好的工具，一步步亲手描绘并实现心中理想的 AI 形象。

当前文档部署仅需6G显存不到，适配windows系统。同时需要有一个API-KEY 因为当前没有中转厂商来找我打广告，所以我不向各位推荐具体去哪里买API。但可以前往淘宝搜索“API”。里面有很多商家贩卖。也可以去deepseek、千问、智谱AI、硅基流动这些知名的官网购买。

如果你想用全部都用本地推理，使用本地的大语言模型（LLM）推理或者微调。不基于第三方的API的话，那可以进入LLM-studio文件夹，里面有本地模型的推理、微调指导。同时，因为本地的大语言模型需要一定的显存，要想有一个还算不错的体验，建议显卡至少保证有12G显存大小。

#### QQ群：756741478 （入群答案：自负的魔方）
## 项目部署流程、功能使用，各种内容只需看官网：[点我进项目官网](http://mynewbot.com)

## 计划清单（打✔的是已经实现的功能）

### 双模型支持
- [x] 开源模型：支持开源模型微调，本地部署
- [x] 闭源模型：支持闭源模型接入

### 核心功能
- [x] 超低延迟：全本地推理，对话延迟在1秒以下
- [x] 字幕和语音同步输出
- [x] 语音定制：支持男、女声、各种角色声线切换等
- [x] MCP支持：可使用MCP工具接入
- [x] 实时打断：支持语音、键盘打断AI说话
- [ ] 真实情感：模拟真人的情绪变化状态，有自己的情绪状态。
- [ ] 超吊的人机体验(类似真人交互设计，敬请期待)
- [x] 动作表情：根据对话内容展示不同的表情与动作
- [x] 集成视觉能力，支持图像识别，并通过语言意图判断何时启动视觉功能
- [x] 声音模型（TTS）训练支持，默认使用gpt-sovits开源项目
- [x] 字幕显示中文。音频播放是外语。可自由开启关闭（适用于TTS模型本身就是外语的角色）

### 扩展功能
- [x] 桌面控制：支持语音控制打开软件等操作
- [x] AI唱歌（功能由： [@jonnytri53](https://github.com/jonnytri53) 资金赞助开发，特此感谢）
- [ ] 国外直播平台的接入
- [x] 直播功能：可在哔哩哔哩平台直播
- [ ] AI讲课：选择一个主题，让AI给你讲课。中途可提问。偏门课程可植入资料到数据库让AI理解
- [x] 替换各类live 2d模型
- [ ] web网页界面支持（已做好，近期会接入）
- [x] 打字对话：可键盘打字和AI交流
- [x] 主动对话：根据上下文主动发起对话。目前版本V1
- [x] 联网接入，实时搜索最新信息
- [x] 手机app应用：可在安卓手机上对话的肥牛
- [x] 播放音效库中的音效，由模型自己决定播放何种音效
- [x] 游戏陪玩，模型和用户共同游玩配合、双人、解密等游戏。目前实验游戏为：你画我猜、大富翁、galgame、我的世界等游戏（当前接入：我的世界）
- [x] 长期记忆，让模型记住你的关键信息，你的个性，脾气

### 模型自己想要的功能（待定考虑）
- [ ] 变色功能：按照模型心情让屏幕变色妨碍用户
- [ ] 自由走动：模型自由在屏幕中移动



## 前期准备

确保你电脑里安装了conda 如果还没有安装，请直接点击这个下载：[conda安装包](https://github.com/morettt/my-neuro/releases/download/v4.12.0/Miniconda3-py39_4.12.0-Windows-x86_64.exe)

安装流程可以参考这个视频，讲的很详细：https://www.bilibili.com/video/BV1ns4y1T7AP  （从1分40秒开始观看）

已经有了conda环境后，就可以开始动手了！

## 🚀 正式开始

### 只需要3个步骤：1.环境模型安装 2.启动服务 3.开始使用

## 1. 按顺序依次执行以下指令（打开终端在项目路径下运行,如果有梯子建议开一下。下载会更快更稳）
```bash
conda create -n my-neuro python=3.11 -y

conda activate my-neuro

#独立安装jieba_fast依赖
pip install jieba_fast-0.53-cp311-cp311-win_amd64.whl

#独立安装pyopenjtalk依赖
pip install pyopenjtalk-0.4.1-cp311-cp311-win_amd64.whl

pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/

#安装ffmpedg
conda install ffmpeg -y

#安装cuda 默认是12.8 可以自行修改
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128

#自动下载需要的各种模型
python Batch_Download.py
```

## 2.鼠标双击这3个东西

### (开启后不要关掉！这几个bat文件是后端服务，需要保持开启状态)

```bash
bert.bat

ASR.bat

TTS.bat


```
可选（双击这个会提升模型的长期记忆功能，但是显存相对来说要增加1.5G）
```bash
RAG.bat
```


### 3.等待上面服务都输出IP后，再打开项目里面的live-2d文件夹：

<img width="1018" height="1023" alt="image" src="https://github.com/user-attachments/assets/8b71473c-1d0e-4c42-8a27-8e8d5e5baaaa" />



进去后，双击打开这个 肥牛.exe 文件

![image](https://github.com/user-attachments/assets/634240ac-da9a-4ada-9a1e-b92762e385f0)



按照箭头指示点击LLM标签，在框选的这三个地方填写你的API信息，修改好了记得点击下面的保存。（支持任何openai格式的api）

<img width="1311" height="857" alt="image" src="https://github.com/user-attachments/assets/84a35e09-37ba-45d0-b516-74b28085d0ce" />



最后返回点击"启动桌宠" 等待皮套出现，就可以开始和模型聊天了

<img width="1152" height="803" alt="image" src="https://github.com/user-attachments/assets/de87207f-00df-4acf-a03a-6944ba6acb1a" />

<img width="1541" height="1078" alt="image" src="https://github.com/user-attachments/assets/24b473ba-439c-4f57-a9da-8edd1b3bb4c5" />


### 这个UI里面的功能使用可查看这个文档来理解：
## [功能使用教程](live-2d-README.md)  


---


## 更新前端

当前端需要更新时，运行 更新前端.bat
<img width="1016" height="1024" alt="image" src="https://github.com/user-attachments/assets/85cff8c9-ee08-45b2-a935-4dd2cd629508" />


## 定制tts模型（克隆音色）

该模块由[@jdnoeg](https://github.com/jdnoeg)基于GPT-SoVITS项目制作

注：本模块需要在完成虚拟环境配置后进行

该模块可以使用一段音频一键克隆你想要的角色的音色

音频要求：长度在10min~30min之间，mp3格式，可以有背景音乐，但是只能有一个说话人

硬件要求：显存至少6G的显卡

### 1.把你的音频文件放在fine_tuning/input文件夹下，改名为"audio.mp3"，如图

<img width="1708" height="954" alt="image" src="https://github.com/user-attachments/assets/bc420b00-d3cc-45c1-894a-b8e802d3ba83" />


第一次用的时候这个位置会有一个占位符.txt，建议删掉，不删也没关系，但是会有些不影响进程的报错

### 2.这一步需要科学上网运行

双击运行 一键克隆音色.bat ，在弹出的窗口中输入你的音频使用的语言以及你的tts模型的名称（自己起一个，示例使用"1"），如图

<img width="1734" height="926" alt="image" src="https://github.com/user-attachments/assets/bef6b726-1980-444c-b8ed-e70497122f5b" />


键盘上随便按一个键就可以继续

在脚本运行期间不要关闭窗口！！！

### 3.脚本运行完成后，修改配置以使用你训练好的模型

#### 前往live-2d文件夹内打开肥牛.exe 

按照图中的顺序配置好你的音频模型

![QQ20251023-160807](https://github.com/user-attachments/assets/6a5d8994-b1c2-45f8-ae34-c05910feef5a)

最后点击“生成TTS的bat文件。会在live-2d文件夹中的Voice_Model_Factory文件夹下生成你的bat格式的文件。只需要双击运行。你训练好的tts的服务即可启动

接下来就可以启动皮套。模型就会以训练后的声音和你对话了。


## 定制AI

有定制属于自己的AI的需求，请打开LLM-studio 文件夹，在此文件夹中内有关于LLM的微调操作步骤。

目前定制化模块将逐渐增加...


### 结尾画饼

我会把这几年的经验和对技术的理解都加入到此项目中。my neuro 这个名字除了蹭neuro sama的热度以外 更多的是我对AI边界的想象和期待

希望有一个真正的能懂你，理解你，且永远不会觉得无聊的AI陪伴在身旁。难受就一起难受，开心就一起开心。让影视作品、小说。幻想中的形象来到现实里

不仅仅是简单的聊天交互。希望它可以融入生活，成为一个有感情的个体。一起开黑玩游戏、看视频、学习东西、睡前聊天、叫你起床、工作时不说话看你发呆，会偷偷记住你做了什么。有情绪，有属于自己的情感状态。会真正的生气

每天都会有自己的情绪变化，会有自己想要做的事。会对某句话难受很久。某个词开心很久。会记住和你在一起经历过的每一个时刻。持续理解你的一个存在。

不过最重要的是，它的个性、样子、声音，情感变化等。都由你决定，就像橡皮泥，我们来提供最好的工具，做好每个模块适配。但最终是怎么样的，由自己来构造。

不过，对于不想折腾的朋友。此项目也直接打包了一个角色，就是肥牛（fake neuro）它是一个抄袭neuro sama的角色，但是个性我把它设定成了一个腹黑、傲娇、搞笑、有小脾气，但偶尔也会展现温柔一面的样子。

更希望的是从neuro 那里模仿借鉴，理解。然后尝试创造新的内容。适合自己的东西。

我对此项目特别的有热情。当前项目已经实现了将近30%的功能。包括定性格、记忆。近期会围绕核心性格特征。也就是真正像人，有持续的情绪这块地方来开发。会在2个月内实现最像人的那部分，就是一个长期的情绪状态。同时开黑玩游戏、看视频、叫你起床等等这块部分等功能都会在6月1日前基本完成，达到60%的完成度。

希望能在今年可以把上述所有的想法都实现。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=morettt/my-neuro&type=Date&t=20251015)](https://www.star-history.com/#morettt/my-neuro&Date)

## 致谢

QQ群:感谢 菊花茶洋参 帮忙制作肥牛app的封面


感谢以下用户的资金赞助：
- [jonnytri53](https://github.com/jonnytri53) - 感谢您的支持！ 为本项目捐赠的50美元
- [蒜头头头](https://space.bilibili.com/92419729?spm_id_from=333.337.0.0) 感谢您的大力支持！为本项目捐赠的1000人民币
- [东方月辰DFYC](https://space.bilibili.com/670385648?spm_id_from=333.337.0.0) 感谢您的支持！！8月~10月每月持续捐赠100元 共300人民币。
- [大米若叶](https://space.bilibili.com/3546392377166058?spm_id_from=333.337.0.0) 感谢您的支持！！为本项目捐赠 68人民币
- [StrongerFatTiger](https://space.bilibili.com/28869393?spm_id_from=333.337.0.0) 感谢您的支持！！为本项目捐赠 100人民币

本项目使用接入的开源项目：

TTS：
https://github.com/RVC-Boss/GPT-SoVITS

AI玩我的世界：
https://github.com/mindcraft-bots/mindcraft






















































