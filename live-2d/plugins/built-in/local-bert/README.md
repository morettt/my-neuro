# 本地 BERT 服务

在插件页面找到「本地 BERT 服务」，先点击「安装 DLC」，安装完成后启用插件，再点击「配置」查看日志、启动和关闭服务。页面不提供参数设置。
BERT 不在终端控制室显示。禁用插件时停止服务，模型和公共 Python 环境保留。

- 公共环境：`my-neuro/env/python.exe`，缺失时由控制面板下载。
- 环境包临时文件、模型缓存：`live-2d/.download-cache`，与项目放在同一盘，不使用系统盘临时目录下载环境包。
- 新模型：`live-2d/plugins-dlc/local-bert/bert-hub`；已有 `my-neuro/full-hub/bert-hub` 时直接复用，无需重新下载。
- 下载源：`morelle/Omni_fn_bert`，下载脚本随插件提供。
- 接口：`http://127.0.0.1:6007/classify`，保持原有返回格式。
- 服务不自动启动；在插件的配置页面点击启动。

插件自带服务端，不再依赖 `3.bert.bat`、`omni_bert_api.py` 或 `Batch_Download.py`。
旧版 Flask WebUI 的独立启动入口保持兼容。
