# 字节 TTS：新版 API Key

控制中心入口：云端配置 → 云端 TTS → 字节。填写新版火山 API Key 和声音 ID、启用云端 TTS 并保存即可。界面不再要求 APP ID、Access Token 或选择预设音色。

声音 ID 默认填入 `S_RCbi2PGQ1`，可以修改为其他复刻 2.0 声线的 ID；留空时使用默认值。资源为声音复刻 2.0 的 `seed-icl-2.0`。音色必须属于该 Key 可访问的火山项目。

`volcengine-config.js` 统一提供新版 `X-Api-Key` 鉴权、资源 ID、连接地址和默认音色。普通合成与实时流式播放均使用这一配置。历史预设音色配置不会覆盖新的复刻音色默认值。

字节流式口型使用 `playbackEngine.onAudioDataCallback` 的当前绑定，与普通播放共用 AvatarFacade 的模型路由。VRM 激活或模型切换后，正在播放的流式会话也会向当前模型发送口型值；结束或打断时传入 0 以闭嘴。

关闭 TTS 时，纯文本回复仍由 `TextMouthDriver` 按文字节奏驱动当前模型口型，不创建音频或发起合成。TTS 失败后的字幕回退同样保留口型；文本结束、重置或打断后归零。纯文本的 `isPlaying()` 仍返回 false，不占用音频播放状态。

Key 保存在本机 `config.json` 的 `cloud.volcengine_tts.api_key`，示例配置中为空。声音 ID 保存在 `cloud.volcengine_tts.voice_type`，界面保存时会使用填写的 ID；运行中的桌宠重新读取配置，下一次合成使用新设置。WebUI 保存其他云端设置时保留已有新版 Key。

验证命令：

```text
node --test js/voice/text-mouth-driver.test.js js/voice/volcengine-lipsync.test.js js/voice/volcengine-config.test.js js/voice/aliyun-clone-ui.test.js js/voice/aliyun-voice-clone.test.js
```

接口参考：[火山双向流式 TTS](https://docs.volcengine.com/docs/DoubaoVoice/WebSocketBidirectionalStreaming-V3?lang=zh)。
