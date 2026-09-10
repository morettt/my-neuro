# 启动服务

**启动** 页是桌宠和本地语音的电源面板。

![启动页全景](/images/webui-services.png)

## 各服务是什么

| 界面名称 | 作用 | 默认端口 / 入口 |
| --- | --- | --- |
| Live2D 主服务 | 桌宠窗口 | `live-2d/go.bat`，也可只在本页点启动 |
| ASR 语音识别 | 本地听 | `1.ASR.bat` · 1000 |
| TTS 语音合成 | 本地说 | `2.TTS.bat` → `full-hub/tts-hub/GPT-SoVITS-Bundle` · 5000 |
| 记忆系统 | MemOS | `4.MEMOS-API.bat` 一类入口 · 8003 |
| RAG | 资料库相关 | `RAG.bat` |
| BERT | 智能截图判断 | `3.bert.bat` |

没装本地语音模型时，除 Live2D 主服务以外的卡片都不显示，对照见 [介绍](/guide/introduction)。

![一键启动与一键停止](/images/webui-oneclick.png)

## 一键启动会做什么

顺序是：

1. 依次启动 ASR、TTS、记忆系统、RAG、BERT（已经在跑的会跳过）
2. 等待 ASR / TTS / 记忆系统的端口就绪，最多大约 **90 秒**
3. 再启动 Live2D

缺模型、端口起不来时，日志会报失败，但超时后仍可能尝试拉起桌宠。

::: tip
只想打字 + 云端发音的话，不必强求一键启动成功。手动启动 Live2D 就够了，云端声音不走 5000 端口。
:::

## Live2D 启动门控

如果你 **已经点过** ASR / TTS / 记忆系统的启动，但端口还没监听，Live2D 的启动按钮会暂时不可用，并提示在等这些端口。大约 90 秒后仍没就绪，会放开让你手动启动，同时提示可能失败。

没启动过那些服务时不会被这个门控拦住。

![记忆系统](/images/webui-service-memos.png)

![RAG](/images/webui-service-rag.png)

![BERT](/images/webui-service-bert.png)

## 日志

ASR、TTS、记忆系统在启动页下方有日志区。启动失败先看这里，再看 `live-2d/runtime.log`。

![日志区](/images/webui-logs.png)

![总览看板](/images/webui-overview.png)
