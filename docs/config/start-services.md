# 启动服务

**启动** 页是桌宠和本地语音的电源面板（语言包加载后叫「启动」，不是「服务控制」）。

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

没有本地 TTS 模型时，TTS / ASR / 记忆 / RAG / BERT 卡片和声音克隆会被藏起。Live2D 主服务仍在。

![一键启动与一键停止](/images/webui-oneclick.png)

## 一键启动会做什么

新版 **一键启动** 的顺序是：

1. 依次启动 ASR、TTS、记忆系统、RAG、BERT（已经在跑的会跳过）
2. 等待 ASR / TTS / 记忆系统的端口就绪，最多大约 **90 秒**
3. 再启动 Live2D

缺模型、端口起不来时，日志会报失败，但仍可能在超时后尝试拉起桌宠。

::: tip
只想打字 + 云端 TTS：不必强求一键启动成功。手动启动 Live2D，云端声音不走 5000 端口。
:::

## Live2D 启动门控

若你 **已经点过** ASR / TTS / 记忆系统的启动，但端口还没监听，Live2D 的启动按钮会暂时不可用，提示等待这些端口。大约 90 秒后仍没就绪，会允许你手动启动，并提示可能失败。

没有点过那些服务时，不会因为「当前没 ASR 卡片」就一直灰掉。

![记忆系统](/images/webui-service-memos.png)

![RAG](/images/webui-service-rag.png)

![BERT](/images/webui-service-bert.png)

## 日志

ASR、TTS、记忆系统在启动页下方有日志区。启动失败先看这里，再看 `live-2d/runtime.log`。

![日志区](/images/webui-logs.png)

![总览看板](/images/webui-overview.png)
