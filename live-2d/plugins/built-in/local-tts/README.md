# 本地 TTS 服务

在插件卡片点击「安装 DLC」，完成后启用插件。「配置」页提供日志、启动、关闭及声音克隆入口，保留原有声音模型选择和启动脚本生成功能。声音克隆按钮不放在插件卡片上。

- 新包：`live-2d/plugins-dlc/local-tts/tts-hub/GPT-SoVITS-Bundle`；原 `my-neuro/full-hub/tts-hub/GPT-SoVITS-Bundle` 完整时直接复用。
- TTS 使用包内 `runtime/python.exe`；公共 `my-neuro/env` 仅用于 DLC 下载，不用于 TTS 合成服务。
- 下载、解压及运行缓存均位于项目盘，解压前检查可用空间；完整解压并验证后才显示安装完成。
- 维持标准包及 RTX 50 系专用包的自动选择，默认声音和原 `2.TTS.bat` 相同。运行时自动检测 CUDA，不可用时使用 CPU。
- 语音接口仍为 `http://127.0.0.1:5000`。云端 TTS 设置、语音播放、口型及字幕链路不变。
- 声音克隆生成的脚本兼容新 DLC 与旧包目录，模型参数保存为 JSON，不将参考文本拼入批处理命令。

无需 `2.TTS.bat` 或 `Batch_Download.py`。旧 Flask WebUI 独立入口保留。
