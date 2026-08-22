# 安装

## 从哪里下载

以仓库 [README](https://github.com/morettt/my-neuro) 上当前给出的链接为准。常见入口：

- GitHub Releases，例如安装包标签 `m4.0` 的 `my-neuro.zip`
- README 里的新人整合包网盘链接（密码以页面为准）

解压到纯英文路径，例如 `D:\my-neuro`。

![解压后应能看到 ASR、TTS、live-2d 等入口](/images/install-folder.png)

## 安装器做什么

根目录运行 **My-Neuro-Installer**（源码是 `installer.py`，发行包里通常是安装程序）。向导顺序：欢迎 → 选择组件 → 确认 → 安装。

可勾选组件（体积是安装器上的约数）：

- ASR 语音识别，约 2 GB，默认勾选
- BERT 语言理解，约 1 GB，默认勾选
- TTS 语音合成，约 4 GB，默认勾选
- Live2D 立绘，约 200 MB，默认勾选
- RAG 长期记忆相关模型，约 2 GB，可选

另外会下载 Python 环境包到 `env\`（安装器写明约 3.6 GB）。

确认页会列出显卡名称和可用显存。检测不到 NVIDIA 驱动、或可用显存不足约 5 GB 时，**开始安装** 按钮会变成不可用（「显存不足」）。这只约束走安装器拉本地大模型这条路；你完全可以不装 TTS，改用云端发音。

![安装器欢迎页](/images/installer-welcome.png)

![安装器组件勾选](/images/installer-components.png)

![安装器确认页会检测显卡与可用显存](/images/installer-confirm.png)

模型下载走 ModelScope 上的 `full-hub/Batch_Download.py`。失败时看安装目录里的 `installer.log`。

## 勾选和界面的关系

装完后，WebUI 会看 `full-hub/tts-hub` 里有没有模型子目录，决定要不要显示本地语音相关的入口：勾过 TTS 就有 TTS 卡片和「声音克隆」页，没勾就只剩 Live2D 主服务。完整对照见 [介绍](/guide/introduction)。

不装 TTS 一样能语音聊天：配一种云端 TTS，听的一侧用本地 ASR 或百度流式 ASR 即可。

## 装完先做什么

1. 打开 [WebUI](/config/open-webui)
2. 配 [LLM](/config/llm)
3. 按你勾过的组件去 [启动服务](/config/start-services)

源码开发者还需要在 `live-2d` 里 `npm install`。整合包一般已经装好 Node 依赖。
