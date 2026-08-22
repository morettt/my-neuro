# 怎么听

电脑的麦克风只会录音。要把你说的话变成字，需要 **ASR**。过程是：声音 → ASR 识别 → 屏幕上的文字。

## 1. 在终端控制室启动 ASR

左侧栏 **终端控制室**，点 **启动 ASR**。

![终端控制室启动 ASR](/images/qt/qt-asr-terminal-start.png)

会弹出一个黑色终端窗口。加载可能要等一会儿，直到出现图上那种已经连上的提示，ASR 才能用。

![ASR 终端就绪](/images/qt/qt-asr-terminal-ready.png)

这个黑窗口不要关。用不到语音识别时再停。可以最小化。

## 2. 在对话设置里启用 ASR

打开 **对话设置** → 基础配置一类开关里勾上 **启用 ASR**。点 **更新配置**。回到 **启动**，点 **启动桌宠**。

![启用 ASR 后再启动桌宠](/images/qt/qt-asr-enable-and-pet.png)

## 3. 怎样算成功

对着麦克风说一句话。屏幕上应出现识别出来的字。第一次可能有一点延迟。

![识别成功时屏幕上的字](/images/qt/qt-asr-success.png)

## 不用本地麦克风

打开 **云端配置**，选一种云端 ASR（例如百度流式 ASR），按 [官网教程](http://mynewbot.com/tutorials) 填厂商要求的项。入口见图：

![云端 TTS / ASR 入口](/images/qt/qt-cloud-tts-asr.png)
