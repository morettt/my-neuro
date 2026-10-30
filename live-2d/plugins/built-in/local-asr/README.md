# 本地 ASR 服务

插件卡片点击「安装 DLC」，安装完成后启用插件。点击「配置」查看日志、启动和关闭服务，不提供额外参数设置。
ASR 不再显示在终端控制室。禁用时关闭服务，模型文件保留。

- 公共 Python 环境：`my-neuro/env`，与 BERT 共用。
- 新模型：`live-2d/plugins-dlc/local-asr/asr-hub`；旧的 `my-neuro/full-hub/asr-hub` 完整时直接复用，部分完整时复用对应组件。
- 临时文件和模型缓存：`live-2d/.download-cache`，不使用 C 盘临时目录下载模型或环境包。
- DLC 包含 Silero VAD、SeACo-Paraformer 识别模型及标点模型，下载源和标点模型版本与旧版一致。
- 服务接口保留 `ws://127.0.0.1:1000/v1/ws/vad` 和 `http://127.0.0.1:1000/v1/upload_audio`。
- 启用百度或 SiliconFlow 云端识别时，只运行本地 VAD，不加载本地识别和标点模型；云端识别设置仍在对话设置中管理。
- 原有 `full-hub/hotwords.txt` 继续使用，保留 `/hotwords` 和 `/hotwords/reload`。
- 初始化权重使用内存映射读取，避免 FunASR 对整份权重深拷贝导致的内存峰值；只在此插件的初始化期间替换加载器，不修改公共环境中的库文件。

启动不再下载资源，模型缺失时提示返回插件安装 DLC。无需 `1.ASR.bat`、`VAD.bat` 或 `Batch_Download.py`。旧 Flask WebUI 的独立入口保留。
