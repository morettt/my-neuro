<h1 align="center">My-neuro</h1>

<div align="center">

<a href="https://github.com/morettt/my-neuro/releases">
    <img src="https://img.shields.io/github/v/release/morettt/my-neuro" alt="latest version" /></a>

<a href="https://github.com/morettt/my-neuro/graphs/contributors">
    <img alt="GitHub contributors" src="https://img.shields.io/github/contributors/morettt/my-neuro"></a>

<a href="https://deepwiki.com/morettt/my-neuro">
    <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" /></a>

</div>

<p align="center">
  <a href="./README_English.md">English</a> | <a href="./README.md">中文</a>
</p>



## 本项目部署流程请看官网：[点我进官网](http://mynewbot.com/tutorials)



#### my-neuro的目标是打造专属个人的 AI 角色,打造出逼近真人的AI伙伴 - 通过您的数据印记,塑造出心目中理想的 TA 的形象。

#### 此项目受neuro sama启发，所以取名为my-neuro（社区提供的名称） 项目可训练声音、性格、替换形象 您的想象力有多丰富，模型就能多贴近您的期望。本项目更像是一个工作台。利用打包好的工具，一步步亲手描绘并实现心中理想的 AI 形象。

#### 如果你想用全部都用本地推理，使用本地的大语言模型（LLM）推理或者微调。不基于第三方的API的话，那可以进入LLM-studio文件夹，里面有本地模型的推理、微调指导。

### 如果想用闭源AI模型，推荐使用 [DMXAPI](https://www.dmxapi.cn)
### 支持市面上大部分主流AI模型的统一调用。

<img src="./image/dmx1.png" width="300" />


### 计划清单

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
- [x] AI讲课：选择一个主题，让AI给你讲课。中途可提问。偏门课程可植入资料到数据库让AI理解
- [x] 替换各类live 2d模型
- [ ] web网页界面支持（已做好，近期会接入）
- [x] 打字对话：可键盘打字和AI交流
- [x] 主动对话：根据上下文主动发起对话。目前版本V1
- [x] 联网接入，实时搜索最新信息
- [x] 手机app应用：可在安卓手机上对话的肥牛
- [x] 播放音效库中的音效，由模型自己决定播放何种音效
- [x] 游戏陪玩，模型和用户共同游玩配合、双人、解密等游戏。目前实验游戏为：你画我猜、大富翁、galgame、我的世界等游戏（当前接入：我的世界、galgame）
- [x] 长期记忆，让模型记住你的关键信息，你的个性，脾气

### 模型自己想要的功能（待定考虑）
- [ ] 变色功能：按照模型心情让屏幕变色妨碍用户
- [ ] 自由走动：模型自由在屏幕中移动


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



