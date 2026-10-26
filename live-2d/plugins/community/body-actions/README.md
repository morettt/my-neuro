# 身体动作插件

让 LLM 在回复中输出英文单动作标签，调用动作服务驱动当前 VRM 或 PMX。

```text
你好呀！[wave right hand] 今天过得怎么样？
我举手啦。[raise left hand]
```

每个 `[]` 只放一个动作。`[wave right hand and bow]`、`[wave then bow]`
等明显组合指令会被忽略；多个独立标签按出现顺序执行。插件处理的 AI 回复中，
所有方括号均视为控制标签并从语音和字幕隐藏，不依赖动作是否有效、是否生成成功。
英文描述不限制动词白名单，最长 120 字符，每条回复默认最多 4 个动作。
提示词包含 Backflip、raise your hands、Dance、Spin in place、lying on the ground、
Standing high jump 六个参考动作，它们不是限定列表。

## 设置与运行

先启动动作 API，选择 VRM 或 PMX 模型，再在“当前插件”启用“身体动作插件”。
配置只有一项：`service_url`（动作服务地址），默认 `http://127.0.0.1:17880`。
如果动作 API 在另一台机器，填写那台机器可访问的 IP 和端口。
不需要在插件填写 Python 路径、模型目录、推理设备或衔接参数。
模型权重保留在动作服务所在机器，无需复制到插件或上传 GitHub。

启用后每次对话请求都会注入身体动作提示词，不再依赖 VRM 门面是否已经就绪。
插件兼容统一门面和 `global.currentModel` 模型入口；收到标签却没有可播放的 3D 模型，
会明确记录原因。动作服务无法连接时会记录服务地址，提示检查动作 API。

## 行为

插件通过 `/api/health` 和 `/api/generate` 调用本地动作服务，接收关节坐标。
按当前模型比例校准和重定向骨骼，动作淡入淡出后恢复待机。
PMX 在插件内映射日文/英文骨骼名，并通过上下半身共用的中心骨骼移动整个身体。
PMX 需要标准的上下半身、上半身2、颈部、头部和四肢骨骼；缺少骨骼会明确记录名称。
动作期间保留眨眼、音频口型、拖动和缩放，暂停身体待机与头部跟随以免覆盖动作。
动作播放期间，相机只跟随身体的水平位置，保持目标高度固定，避免把起跳、腾空和空翻的垂直位移抵消。
新消息、语音打断、插件停用会取消旧任务；卸载模型后不会把生成结果播放到新模型。

启用时，会等完整 LLM 回复经过插件过滤后再开始 TTS，
动作标签不会进入语音或字幕。播放身体动作需要已加载的 VRM 或 PMX。
字幕最终显示边界也会过滤完整或未闭合的英文控制标签；无法执行的标签不会成为台词。
动作生成与语音播放并行，首次生成会有本地推理延迟，不保证按句子中标签位置精确对齐；
同一次运行缓存最近 16 个动作以减少重复请求。动作效果取决于本地服务的输出，
插件不保证任意英文描述都能生成准确动作。身体播放支持 VRM 和标准骨架 PMX。

## 验证

```text
node --test plugins/community/body-actions/tests/protocol.test.cjs plugins/community/body-actions/tests/llm-pipeline.test.cjs plugins/community/body-actions/tests/subtitle.test.cjs plugins/community/body-actions/tests/runtime-hooks.test.cjs
node_modules/electron/dist/electron.exe plugins/community/body-actions/tests/runtime.cjs
node --test plugins/community/body-actions/tests/pmx-rig.test.cjs
```

第二项使用隐藏窗口和独立配置，调用真实本地 动作服务并生成 VRM 播放截图。
所有适配代码和测试均位于插件目录，不修改桌宠核心源码。
使用现有 `onLLMRequest`、`onLLMResponse`、`onTTSText` 钩子，配合插件内
`runtime-hooks.js` 对当前 TTS、字幕、3D 模型实例进行可恢复的运行时方法包装。
动作结束恢复骨骼/相机方法；停用插件恢复语音和字幕方法，保留其他插件后来接入的方法。
