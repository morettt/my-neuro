# 怎么说

大多数聊天模型只出文字。要让桌宠开口，需要 **TTS**（给角色用的发音，不是你的麦克风）。

## 1. 在终端控制室启动 TTS

左侧栏 **终端控制室**，点 **启动 TTS**。

![终端控制室启动 TTS](/images/qt/qt-tts-terminal-start.png)

同样会弹出黑窗口。等到出现图上标出的那一行，再去开桌宠。

![TTS 终端就绪](/images/qt/qt-tts-terminal-ready.png)

黑窗口不要关，可最小化。

## 2. 启动桌宠，听一声

回到 **启动**，点 **启动桌宠**。等角色打完招呼，对它说一句或打一句。能听到声音，这一项就过了。第一次合成可能较慢。

![听到回复](/images/qt/qt-tts-success.png)

## 换声音、改用语种

- 已经有本地 TTS 模型、只想换音色：按 [官网教程](http://mynewbot.com/tutorials)
- 没有本地 TTS 模型：到 **云端配置** 选一种云端 TTS，同样参照官网填 Key
- 嘴里要外语、字幕要中文：先改 TTS 语言，再启用同声传译插件，并给翻译填一套模型 / URL / Key，见 [在肥牛.exe 里用插件](/qt/plugins/)

![TTS 语言](/images/qt/qt-tts-language.png)
