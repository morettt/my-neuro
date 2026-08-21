# 介绍

本站是 **my-neuro 的 WebUI 版文档**。WebUI 指用 `live-2d/启动 WebUI 控制面板.bat` 打开后，浏览器里那套「My Neuro 控制中心」。

如果你打开的是桌面上的 `肥牛.exe`，或正在跟着 [官网旧教程](http://mynewbot.com/tutorials) 里的旧界面操作，请先去那边，两边截图不是同一套控件。

::: tip
想尽快见到桌宠说话，直接进入 [快速开始](./quick-start.md)。
:::

## 什么是 my-neuro

my-neuro（社区常叫「肥牛」）是一个跑在 Windows 桌面上的 AI 虚拟伙伴。你可以说话或打字跟它聊，它会调用大模型思考，再用语音念出来，并驱动 Live2D（或其他形态）做表情和动作。

它不是又一个网页聊天框。目标是把角色的声音、性格、形象放在你自己的电脑上，用工作台的方式一点点调成你想要的样子。项目受 Neuro-sama 启发，默认角色是肥牛。

源码与发行包见 [GitHub morettt/my-neuro](https://github.com/morettt/my-neuro)。

## 本教程针对谁

| 你正在用的东西 | 该看哪份文档 |
| --- | --- |
| 浏览器「My Neuro 控制中心」，顶栏有启动、LLM 配置、云端配置 | **本站** |
| `肥牛.exe`、官网教程里的旧标签和箭头图 | [官网旧教程](http://mynewbot.com/tutorials) |

详见 [本站与官网旧教程](./which-docs.md)。

## 和普通聊天机器人差在哪

常见聊天机器人是「一句进、一句出」。肥牛把一条对话拆成几段本地/云端能力，再拼回桌面上的角色：

```
你说话或打字
    → 听（本地 ASR，或百度等云端 ASR）
    → 思考（你配置的 LLM API）
    → 说（本地 GPT-SoVITS，或阿里云 / 字节 / 其他云端 TTS）
    → 皮套（Live2D 等）做表情、出字幕
```

听和说是两套开关，可以混用。例如电脑有麦克风和本地识别，但没有 TTS 模型，就可以：**本地 ASR + 阿里云 TTS**。

有没有本地 TTS 模型包（`full-hub/tts-hub` 下是否有模型目录），决定界面差在哪，不是两套产品：

- **新版面**：没有本地 TTS 时，「启动」页只剩 Live2D 主服务卡片，侧栏也没有「声音克隆」。
- **经典版面**：标题会多出 **（云端）** 或 **（本地）** 字样。

要出声就去「云端配置」选一种云端 TTS，或装好本地 TTS 后再启动对应服务。

## 核心特性（WebUI 里能管到的）

- **语音与打字**：默认可以对着麦克风说；也可以打开文字输入框。
- **实时打断**：说话或 `Ctrl + G` 打断正在播放的语音。
- **多提供商 LLM**：OpenAI 兼容接口；对话模型和视觉模型分开选。
- **皮套**：Live2D、VRM、MMD、PNGTuber；动作/表情绑定；AI 编舞与传统动作。
- **记忆**：MemOS 长期记忆（服务端口 `8003`）。
- **视觉**：每次对话截屏，或用 BERT 判断要不要截屏。
- **工具**：Function Call 与 MCP。
- **插件**：内置 / 社区 / 广场工具屋。

更完整的功能清单在项目 [README](https://github.com/morettt/my-neuro/blob/main/README.md)。本站只保证 **WebUI 操作路径** 和当前上游界面一致。

## 开源协议

上游仓库使用 **MIT License**（Copyright 2025 xxxiu）。

::: info
项目仍在活跃开发，界面和配置字段可能变。更新前请备份 `live-2d/config.json` 以及你改过的人设、插件配置。
:::

## 建议阅读顺序

1. [快速开始](./quick-start.md) — 先跑通一次
2. [安装](/deploy/install) — 安装器勾了什么，后面就要启什么
3. [LLM](/config/llm) → [怎么听](/config/listen) → [怎么说](/config/speak) → [启动服务](/config/start-services)
4. [第一次对话](/config/first-chat)
5. 卡住时看 [常见问题](/faq)
