# 身体动作插件

让 LLM 在回复中输出英文单动作标签，调用本地动作服务驱动当前 VRM。

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

在插件面板启用“身体动作插件”，选择 VRM 模型，然后在插件设置中填写：

- `service_url`：本地动作服务地址，默认 `http://127.0.0.1:17880`。
- `auto_start`：是否在后台自动启动本地服务。
- `backend_directory`：含 `web.py` 和 `weights/` 的本地服务目录。
- `python_executable`：已经安装推理依赖的 Python 完整路径。
- `device`：`cpu`、`cuda` 或 `auto`。
- `timeout_ms`、`max_actions`、`blend_seconds`：超时、动作数量、衔接时间。

也可以先运行模型包的 `启动网页.bat`，再关闭插件的自动启动。插件复用现有服务，
停用时只关闭自己启动的进程。模型权重保留在原目录，无需复制到插件或上传 GitHub。

## 行为

插件通过 `/api/health` 和 `/api/generate` 调用本地动作服务，接收关节坐标。
按当前 VRM 比例校准和重定向骨骼，动作淡入淡出后恢复待机。
动作期间保留眨眼、音频口型、拖动和缩放，暂停身体待机与头部跟随以免覆盖动作。
动作播放期间，相机只跟随身体的水平位置，保持目标高度固定，避免把起跳、腾空和空翻的垂直位移抵消。
新消息、语音打断、插件停用会取消旧任务；卸载模型后不会把生成结果播放到新模型。

启用且使用 VRM 时，会等完整 LLM 回复经过插件过滤后再开始 TTS，
动作标签不会进入语音或字幕。其他形态仍使用原有流式语音。
字幕最终显示边界也会过滤完整或未闭合的英文控制标签；无法执行的标签不会成为台词。
动作生成与语音播放并行，首次生成会有本地推理延迟，不保证按句子中标签位置精确对齐；
同一次运行缓存最近 16 个动作以减少重复请求。动作效果取决于本地服务的输出，
插件不保证任意英文描述都能生成准确动作。目前身体播放仅支持 VRM。

## 验证

```text
node --test plugins/community/body-actions/tests/protocol.test.cjs plugins/community/body-actions/tests/llm-pipeline.test.cjs plugins/community/body-actions/tests/subtitle.test.cjs plugins/community/body-actions/tests/runtime-hooks.test.cjs
node_modules/electron/dist/electron.exe plugins/community/body-actions/tests/runtime.cjs
```

第二项使用隐藏窗口和独立配置，调用真实本地 动作服务并生成 VRM 播放截图。
所有适配代码和测试均位于插件目录，不修改桌宠核心源码。
使用现有 `onLLMRequest`、`onLLMResponse`、`onTTSText` 钩子，配合插件内
`runtime-hooks.js` 对当前 TTS、字幕、VRM 实例进行可恢复的运行时方法包装。
动作结束恢复骨骼/相机方法；停用插件恢复语音和字幕方法，保留其他插件后来接入的方法。
