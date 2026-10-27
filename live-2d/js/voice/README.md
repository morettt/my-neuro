# 字节 TTS：新版 API Key

控制中心入口：云端配置 → 云端 TTS → 字节。填写新版火山 API Key、启用云端 TTS 并保存即可。界面不再要求 APP ID、Access Token 或选择预设音色。

默认复刻音色为 `S_RCbi2PGQ1`，资源为声音复刻 2.0 的 `seed-icl-2.0`。此音色必须属于该 Key 可访问的火山项目。

`volcengine-config.js` 统一提供新版 `X-Api-Key` 鉴权、资源 ID、连接地址和默认音色。普通合成与实时流式播放均使用这一配置。历史预设音色配置不会覆盖新的复刻音色默认值。

Key 保存在本机 `config.json` 的 `cloud.volcengine_tts.api_key`，示例配置中为空。界面保存时会写入默认复刻音色和资源；运行中的桌宠重新读取配置，下一次合成使用新设置。WebUI 保存其他云端设置时保留已有新版 Key。

验证命令：

```text
node --test js/voice/volcengine-config.test.js js/voice/aliyun-clone-ui.test.js js/voice/aliyun-voice-clone.test.js
```

接口参考：[火山双向流式 TTS](https://docs.volcengine.com/docs/DoubaoVoice/WebSocketBidirectionalStreaming-V3?lang=zh)。
