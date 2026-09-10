# 更新

## 更新前端（桌宠 / live-2d）

仓库根目录有 **`一键更新live-2d.bat`**。它会打开一个命令窗口，尝试 `conda activate my-neuro` 后运行 `update.py`。

::: warning
整合包若没有 conda 环境 `my-neuro`、而是用目录里的 `env\python.exe`，这条 bat 可能跑失败。那时用安装目录自带的更新方式，或到 [Releases](https://github.com/morettt/my-neuro/releases) 换新包，并先备份 `live-2d/config.json`。
:::

更新前建议：

1. 在 WebUI 里一键停止服务
2. 复制一份 `live-2d/config.json`
3. 再跑更新

## 更新本地模型

本地 ASR / TTS / BERT 模型仍由安装器或 `full-hub/Batch_Download.py` 管理。前端更新不会自动把 GPT-SoVITS 换成另一版。

## 配置兼容

WebUI 字段会变，例如 LLM 从单组 Key 变成了多提供商。更新后先打开控制面板，逐页确认 Key 还在，缺了再补。

## 排查

- **更新窗口一闪而过**：不一定需要管理员权限。先在命令行里手动跑 `python update.py`，看具体报什么错。
- **桌宠起不来**：看启动页里的桌宠日志，以及 `live-2d/runtime.log`。
- **改完配置没变化**：点右上角 **保存配置**，再重启 Live2D 主服务。
