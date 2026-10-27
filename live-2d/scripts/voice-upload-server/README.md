# 阿里云参考音频上传

桌面控制中心入口：**云端配置 → 云端 TTS → 阿里云 → 声音克隆**。

1. 填写阿里云百炼 API Key，新建声线默认使用 `cosyvoice-v3-flash`，模型和音色 ID 不在界面展示。
2. 点击卡片选择音频，或将音频拖入卡片。校验音频后立即弹出角色命名窗口。
3. 输入 1～30 字的角色名称并点击“确定”，程序自动上传、克隆、保存并启用该声线。取消命名不会上传或创建音色，同名角色在上传前拦截。
4. “声音角色”控件始终显示，成功后显示新角色名称，也可以切换已经保存的角色。切换时同时匹配绑定模型并保存；桌宠运行时通知其重新读取配置，后续合成请求使用新声线。

处理时音频卡片显示加载动画，并随实际请求切换“上传中 / 克隆中 / 保存中”。处理期间禁用重复操作，成功或失败后结束动画。

角色名称、音色 ID 和绑定模型保存在 `config.json` 的 `cloud.aliyun_tts.voices` 数组中；名称不能重复。正在处理或尚未保存的音色在控制中心本地草稿中保留，重开界面后可继续检查状态或重试保存，避免重复创建。创建成功但尚未保存时不会覆盖当前使用的音色。

阿里云音色绑定创建时的模型，合成时必须使用同一个模型。界面只展示 API Key 和声音角色，模型与音色 ID 由程序内部管理。

音频要求：WAV（16-bit）、MP3、M4A，推荐 10～20 秒，最长 60 秒，≤10 MB，采样率 ≥16 kHz，至少 5 秒连续清晰朗读，没有背景音乐或其他人声。上传接口检查大小与文件头，其余质量要求由阿里云复刻服务检查。

## 上传配置与部署

新部署无需配置网站上传密钥：未配置网站上传时，本地音频以 Base64 Data URI 直接提交给阿里云，使用界面里填写的阿里云 API Key 完成复刻。下述网站上传配置为可选通道，仅在配置后使用；阿里云 API Key 始终不发送给网站。

服务端模块 `voice_audio.py` 放入网站的 `routes/`，在 FastAPI 的 `app` 中注册 `router`。网站继续使用原来的 `conda activate my-neuro` 和 `python app.py` 启动。

服务端 `.voice-upload-token` 保存上传密钥，仅服务器和本机使用。桌面端从项目根目录的 `.voice-upload-client.json` 读取默认配置：

```json
{
  "upload_url": "https://mynewbot.com/api/voice-audio",
  "upload_token": "<上传密钥>"
}
```

此文件已加入 Git 忽略列表，由本机后台读取，不在界面上显示上传接口或上传密钥。阿里云 API Key 与网站上传密钥是两个不同的密钥；网站不接收阿里云 API Key。

接口：`POST /api/voice-audio?format=wav`，请求头 `Authorization: Bearer <上传密钥>`，请求体是原始音频字节。返回 `url`、`expires_at` 和 `size`。`GET /api/voice-audio/{随机文件名}` 无需登录。随机链接 24 小时后停止提供下载，过期文件在后续上传时清理。

验证：

```text
node --test js/voice/aliyun-clone-ui.test.js js/voice/aliyun-voice-clone.test.js
# 在网站已有的 Python 环境中：
python test_voice_audio.py
```

阿里云接口参考：[声音复刻 HTTP API](https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api)。
