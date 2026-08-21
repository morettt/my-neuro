# 线上 AI 编舞与自动表情移植计划

> 文档状态：实施完成，待提交、推送与创建 Pull Request
> 编写日期：2026-08-20
> 最后更新：2026-08-21
> 线上基线：`morettt/my-neuro` 的 `main`，提交 `83e883de40c74fe111db54f43abc5d3d7129c72b`
> 本地参考项目：`K:\neruo\my-neuro-main`，只读，不允许修改
> 临时工作目录：`K:\neruo\tmp\my-neuro-ai-expression-upstream`
> 计划目标分支：`codex/ai-choreography-auto-expression-main-api`

## 0. 实施中修订记录

### 2026-08-20：保留线上模型目录零写入契约

实施自动表情差异测试时发现，线上已有
`live-2d/scripts/test-avatar-switch-transaction.js` 明确要求：

- 自动表情启动时不得在模型目录生成 `expression_profile.json`。
- 缺少 sidecar 时必须直接使用内存中的默认 AU 配置。

本地参考项目包含“缺少 sidecar 时尝试写入默认种子”的增强，但该行为会违反线上现有保护测试，也会带来以下风险：

- 只读模型目录报错。
- 用户模型目录被运行时静默改写。
- Git 工作区出现生成文件。
- 切换或预览模型时产生非预期持久化副作用。

因此计划修订为：

- 不移植运行时自动写入 `expression_profile.json` 的行为。
- 保留线上“无 sidecar 时使用内存默认值”的实现。
- 自动表情移植范围只包含必要算法差异、模式门控、TTS 生命周期和测试。
- 只有用户通过专门的配置编辑器主动保存时，才允许创建或修改模型 sidecar；本任务不新增该编辑器写入流程。

AI 编舞、三档模式和主对话 API 复用范围保持不变。

### 2026-08-21：实施与自动化验收记录

已在临时功能分支完成以下实现：

- 新增 `motion-director.js`，负责 body/face 双通道编舞、参数目录白名单、范围裁剪、流式解析、超时、取消和本地 fallback。
- 新增 `motion-directives.js`，负责点头、摇头、歪头、眨单眼、脸红等显式动作指令。
- 编舞请求只读取 `config.llm.api_url`、`config.llm.api_key` 和 `config.llm.model`，没有新增编舞专用 provider、Key、模型或 embedding 请求。
- `blend` 保留自动 AU 表情并启用 AI 编舞；`legacy` 保留旧动作与自动表情且不发编舞请求；`director` 关闭旧情绪触发，仅使用 ParamDirector 编舞和口型链路。
- 主模型流式回调在编舞模式下不提前送入 TTS；最终回复确定后先准备编舞，`director` 最多等待配置的首帧上限，再启动 TTS。
- 普通 TTS 和字节流式 TTS 都会推进 ParamDirector 字符进度；新输入、用户打断和 TTS 中断会取消旧时间线。
- 缺失 `expression_profile.json` 时仍只使用内存默认 AU，不向模型目录写入 sidecar。
- 编舞 HTTP 错误日志只保留状态码，不回显服务端错误正文。

已通过的自动化测试：

```text
node live-2d/scripts/test-avatar-switch-transaction.js
node live-2d/scripts/test-au-expression-solver.js
node live-2d/scripts/test-motion-director-modules.js
node live-2d/scripts/test-motion-director-main-api.js
node live-2d/scripts/test-motion-director-runtime.js
node live-2d/scripts/test-avatar-voice-chat-binding.js
node live-2d/scripts/test-llm-motion-tts-order.js
```

另外，所有目标 JavaScript 文件均已通过 `node --check`，并通过 `git diff --check`。

本轮没有读取或使用真实付费 API 凭据，因此真实线上 API、可见 Live2D 画面和真实 TTS 服务的验收尚未完成；当前结果应称为“已实现、已完成 mock/运行时集成测试、待部署环境实测”，不能称为真实线上验收完成。

## 1. 计划目标

本计划用于把本地项目中已经形成的 Live2D AI 动作编舞能力移植到当前线上 `main`，同时校准线上已经存在的自动表情系统，使线上最终具备以下三档明确行为：

1. `blend`
   - 自动表情继续工作。
   - AI 动作编舞同时工作。
   - 自动表情负责按情绪标签现场组合眼睛、眉毛、脸颊、视线、嘴型等 AU 参数。
   - AI 编舞负责生成随回复文本推进的身体和脸部关键帧时间线。

2. `legacy`
   - 自动表情继续工作。
   - 身体动作继续使用已有 `.motion3.json` 等传统动作文件和旧降级动作。
   - 不发送 AI 编舞请求。

3. `director`
   - 只使用 AI 编舞时间线和新版参数导演。
   - 不触发传统情绪动作及其旧表情路径。
   - 在可接受的等待上限内，优先等到首个可用编舞帧后再开始 TTS。

AI 编舞产生的模型请求必须复用线上当前主对话模型配置：

- `config.llm.api_url`
- `config.llm.api_key`
- `config.llm.model`

不得为编舞新增第二套 API 地址、API Key、provider ID 或模型选择。

自动表情本身是本地 AU 求解器，不需要额外请求模型。它使用同一轮主对话回复中已有的情绪标签作为输入，因此“复用主对话模型 API”在自动表情链路中的准确含义是：

- 情绪来源于主对话模型已经生成的回复。
- 自动表情不再发起第二次情绪判断请求。
- 不引入独立表情模型、embedding 模型或额外付费端点。

## 2. 用户约束

本任务必须始终满足以下约束：

1. 不得修改 `K:\neruo\my-neuro-main` 中的任何文件。
2. 不得在本地参考项目中创建分支、提交、stash、临时补丁或生成测试文件。
3. 不得在本地参考项目中运行会改写配置、模型目录或运行时缓存的程序。
4. 本地项目只允许执行只读操作，例如：
   - 读取文件。
   - 查看 Git 状态和历史。
   - 比较文件差异。
   - 计算文件哈希。
5. 所有正式代码修改必须发生在：
   - `K:\neruo\tmp\my-neuro-ai-expression-upstream`
6. 所有测试产生的缓存、日志和临时配置必须留在临时目录或系统临时目录。
7. 所有 Git commit、push 和 Pull Request 操作必须从临时克隆执行。
8. 不得把本地项目中的真实 API Key、令牌、对话记录、角色配置或其它私有运行数据复制到临时克隆。
9. 未经用户批准本计划前，不得开始实现、创建功能分支、提交或推送。
10. 未经明确授权，不得直接推送到 `morettt/my-neuro` 的 `main`。

## 3. 当前真实现状

### 3.1 线上基线

当前线上 `main` 已经包含较完整的 Avatar V2 运行时底座：

- `live-2d/js/avatar/motion-mode.js`
- `live-2d/js/avatar/live2d/param-director.js`
- `live-2d/js/avatar/live2d/facs-mapper.js`
- `live-2d/js/avatar/live2d/emotion-archetypes.js`
- `live-2d/js/avatar/live2d/vad-state.js`
- `live-2d/js/avatar/live2d/face-micro-motion.js`
- `live-2d/js/avatar/live2d/idle-action-scheduler.js`
- `live-2d/js/avatar/live2d/motion-style-presets.js`
- `live-2d/js/avatar/live2d/expression/semantic-actions.js`
- `live-2d/js/avatar/live2d/expression/expression-units.js`
- `live-2d/js/avatar/live2d/expression/expression-solver.js`
- `live-2d/js/avatar/live2d/expression/au-driver.js`
- `live-2d/js/avatar/live2d/emotion-engine.js`
- `live-2d/js/avatar/live2d/runtime.js`

线上 WebUI 也已经提供三档动作与表情模式：

- `blend`：自动表情 + AI 编舞
- `legacy`：自动表情 + 传统动作
- `director`：仅 AI 编舞

线上还已经具备：

- `ParamDirector` 参数目录扫描。
- body、face、default、idle 时间线通道。
- 按字幕/TTS 字符进度消费关键帧。
- VAD 状态和动作风格预设。
- AU 表情与口型、眨眼、参数导演的运行时混合顺序。

因此，线上不是完全没有自动表情或参数导演。

### 3.2 线上真正缺失的部分

当前线上 `main` 不存在：

- `live-2d/js/ai/motion-director.js`
- `live-2d/js/ai/motion-directives.js`
- 对 AI 回复执行 `motionDirector.choreograph(...)` 的调用
- body/face 编舞模型请求
- 编舞 NDJSON/JSON 关键帧解析
- 编舞模型失败后的完整本地时间线兜底
- 编舞 API 解析、超时和可观测性测试

线上 `llm-handler.js` 目前只创建普通主对话 `LLMClient`，最终回复处理完成后直接进入插件和 TTS 流程。

因此，线上虽然显示“AI 编舞”模式，但没有完整的“回复文本 -> 编舞请求 -> body/face 帧 -> ParamDirector”的生成链路。

### 3.3 线上自动表情的真实状态

线上自动表情主要由以下链路组成：

```text
主对话回复中的 <开心>/<害羞>/... 标签
  -> TTS 文本预处理
  -> EmotionEngine
  -> AuDriver
  -> ExpressionSolver
  -> SemanticAction 到 Live2D 参数映射
  -> runtime 每帧写入
```

该链路已经在线上存在，默认条件为：

- `ui.expression_engine` 缺失时按 `au` 处理。
- `expression_solver.enabled` 缺失时按启用处理。
- `director` 模式关闭传统情绪标签路径。
- `blend` 和 `legacy` 模式保留自动表情路径。

本地参考项目与线上自动表情核心文件整体接近。

目前已确认的一项本地差异是：

- 当模型目录不存在 `expression_profile.json` 时，本地版本会尝试写入默认 AU 配置种子。
- 线上版本只在内存中使用默认值，不主动创建该 sidecar。
- 根据本计划第 0 节修订，该本地差异不移植，保留线上零写入行为。

实施时必须逐项比较自动表情相关差异，只移植确定属于该功能的改动，不得把本地 `runtime.js`、`tts-playback-engine.js` 等文件中的其它无关功能一起带入线上。

### 3.4 本地参考实现与线上 API 架构不同

本地参考项目的 AI 编舞实现依赖：

- `llmProviderManager`
- `provider_id`
- `model_id`
- `llm_providers.json`
- `PromptCachePolicy`
- 可选 embedding 情绪分类器

当前线上 `main` 使用的是直接配置：

- `config.llm.api_url`
- `config.llm.api_key`
- `config.llm.model`

所以不得整文件照搬本地 `motion-director.js`。

必须保留本地算法和输出契约，但重新适配线上现有 API 配置结构。

### 3.5 自动表情不应新增 API 请求

本地可选的 `emotion-classifier.js` 支持 `/embeddings` 请求，但这不符合本次“只用主对话模型 API”的限制，原因包括：

- 主对话模型不一定支持 `/embeddings`。
- embedding 通常需要另一个模型名。
- 它会引入额外端点、额外消费和初始化缓存。
- 它不是自动表情正常运行的必要条件。

因此本次不移植 embedding 情绪分类器。

没有情绪标签时，允许使用本地正则、关键词、VAD 中性值和已有 fallback；不得为了补标签再发送一次独立情绪分类请求。

## 4. 目标运行流程

### 4.1 `blend` 模式

```text
用户消息
  -> 主对话模型正常回复
  -> 得到最终回复文本
  -> 保留回复中的情绪标签
  -> 启动 MotionDirector
     -> 立即生成本地 body/face fallback
     -> 使用主对话 API 生成 body/face 结构化帧
     -> 流式接受有效帧并替换对应 fallback 后半段
  -> TTS 播放
     -> 情绪标签触发 AuDriver 自动表情
     -> 字符进度驱动 ParamDirector 时间线
  -> AuDriver 对正在控制的脸部参数拥有更高的最终写入优先级
```

目标体验：

- 自动表情可立即响应明确情绪标签。
- AI 编舞失败时仍有本地动作。
- AI face 帧与 AU 表情冲突时，不得覆盖正在生效的 AU 表情峰值。
- 口型始终拥有最终嘴部开合控制权。

### 4.2 `legacy` 模式

```text
用户消息
  -> 主对话模型正常回复
  -> TTS 播放
  -> 情绪标签触发 AuDriver 自动表情
  -> 传统动作文件或旧参数动作
  -> 不调用 MotionDirector
  -> 不发送额外编舞 API 请求
```

目标体验：

- 与当前线上行为兼容。
- 升级后不会因为新增 AI 编舞代码而增加 API 消费。
- 旧模型和旧动作文件仍然可用。

### 4.3 `director` 模式

```text
用户消息
  -> 主对话模型正常回复
  -> 得到最终回复文本
  -> 启动 MotionDirector
     -> 准备 fallback 时间线
     -> 使用主对话 API 生成 body/face 帧
  -> 等待首帧，最长不超过配置上限
  -> 启动 TTS
  -> 字符进度驱动 AI 编舞
  -> 不触发传统情绪动作和自动表情旧路径
```

目标体验：

- 不会因为等待完整 body/face 请求而长时间卡住 TTS。
- 首帧超时后继续播放本地 fallback。
- body 或 face 任一通道失败时，另一通道仍可继续。

## 5. 工作范围

### 5.1 AI 编舞核心

新增并适配：

- `live-2d/js/ai/motion-director.js`
- `live-2d/js/ai/motion-directives.js`

必须保留或实现：

- 回复标签提取。
- 显式动作指令提取，例如点头、摇头、歪头、靠近、眨眼、脸红。
- body 和 face 双通道。
- body 关键帧校验。
- AU face 帧到 Live2D 参数的映射。
- 参数目录过滤。
- 时间位置 `at` 归一化。
- transition、hold、release 时长限制。
- 本地 fallback 时间线。
- 流式 NDJSON 逐行接受。
- 非流式 JSON/NDJSON 兼容解析。
- 单通道失败隔离。
- AbortController 超时。
- 首帧 gate。
- 禁止写入口型开合参数。
- 模型不支持的参数自动丢弃。

必须删除或重写的本地依赖：

- 不使用 `llmProviderManager`。
- 不使用 `provider_id`。
- 不使用 `model_id`。
- 不依赖 `llm_providers.json`。
- 不依赖 `PromptCachePolicy`。
- 不依赖 embedding 情绪分类器。

### 5.2 主对话 API 复用

AI 编舞请求解析必须只允许以下来源：

```text
api_url = config.llm.api_url
api_key = config.llm.api_key
model   = config.llm.model
```

`motion_director` 配置中不得出现：

- `api_url`
- `api_key`
- `provider_id`
- `model_id`
- `body.api_url`
- `body.api_key`
- `body.model`
- `face.api_url`
- `face.api_key`
- `face.model`

编舞仍可拥有独立运行参数：

- `enabled`
- `stream`
- `timeout_ms`
- `temperature`
- `max_tokens`
- `min_keyframes`
- `max_keyframes`
- `wait_before_tts`
- `fallback_enabled`
- body/face 是否启用
- VAD 参数
- 动作风格
- 幅度和时长限制

API 复用验收必须证明：

- 普通对话与编舞请求使用同一个规范化 API URL。
- 普通对话与编舞请求使用同一个模型名。
- 编舞请求的 Authorization 来自主对话配置。
- 日志绝不打印 API Key。
- WebUI 不新增编舞 API Key 输入框。

### 5.3 自动表情校准

线上已有自动表情代码不得被整套替换。

实施步骤必须是：

1. 对以下本地和线上文件逐个进行语义差异比较：
   - `semantic-actions.js`
   - `expression-units.js`
   - `expression-solver.js`
   - `au-driver.js`
   - `emotion-engine.js`
   - `runtime.js`
   - `tts-playback-engine.js`
2. 忽略换行符、格式化和无关功能差异。
3. 只移植属于自动表情的修复。
4. 为每项移植写对应测试。

当前明确保留的自动表情行为：

- 模型目录没有 `expression_profile.json` 时直接使用内存默认种子。
- 启动、切换模型和预览模型时不写入模型目录。
- 测试使用系统临时目录，并断言没有生成 sidecar。
- 已存在的合法 sidecar 仍按原有逻辑读取。

自动表情必须继续满足：

- `blend`、`legacy` 启用。
- `director` 不通过旧情绪标签路径触发。
- TTS 结束或被打断时释放 AU 参数。
- 最短保持时间生效。
- 眨眼、视线、嘴型和口型之间不互相破坏。
- 模型缺少某个参数时安全跳过。

### 5.4 对话完成后的接入点

修改：

- `live-2d/js/ai/llm-handler.js`

接入位置必须满足：

1. 只处理最终回复，不处理工具调用中间文本。
2. 在思考内容过滤完成后运行。
3. 在 `onLLMResponse` 插件修改最终文本后运行。
4. 在最终 TTS 开始前启动。
5. 传入最终用于 TTS 的文本，而不是未过滤原始内容。
6. 传入本轮用户消息，供动作指令分析使用。
7. 编舞异常不得让普通回复失败。
8. 用户打断时不得残留上一轮时间线。
9. 纯文本模式或明确跳过 TTS 的回复不启动编舞。

建议调用契约：

```js
const work = motionDirector.choreograph(responseObj.text, config, {
    userMessage: prompt
});
```

`director` 模式：

- 等待 `work.firstFrameLoaded`。
- 最大等待时间默认 1500ms。
- 超时后立即继续 TTS。
- 后续 body/face 帧继续异步加载。

`blend` 模式：

- 立即启动本地 fallback。
- 不等待完整 API 返回。
- 编舞任务后台继续。

`legacy` 模式：

- 不创建编舞任务。

### 5.5 TTS 与时间线同步

必须验证以下两类 TTS：

- 普通非流式 TTS。
- 当前项目已有的流式 TTS 路径。

处理原则：

- `director` 若配置等待首帧，不得在首帧 gate 之前把流式文本提前送入 TTS。
- `blend` 可保留低延迟行为，但必须在 TTS 开始前至少完成 `prepareSpeech()` 和 fallback 时间线装载。
- 字幕字符推进继续调用 `paramDirector.noteSpeechProgress()`。
- TTS 结束、TTS 中断和新用户输入都要释放或取消上一轮时间线。
- 不得为了编舞修改 TTS 文本内容。

### 5.6 配置

线上当前只有 `live-2d/config.json`，没有与本地相同的 provider 注册表。

计划增加不含任何凭据的默认配置：

```json
{
  "motion_director": {
    "enabled": true,
    "stream": true,
    "timeout_ms": 8000,
    "temperature": 0.25,
    "max_tokens": 900,
    "min_keyframes": 7,
    "max_keyframes": 10,
    "wait_before_tts": true,
    "fallback_enabled": true,
    "body": {
      "enabled": true
    },
    "face": {
      "enabled": true
    },
    "vad": {
      "enabled": true
    }
  },
  "expression_solver": {
    "enabled": true,
    "transition_ms": 600,
    "neutral_ms": 600,
    "min_hold_ms": 1500,
    "randomness": 0.5,
    "diversity": 0.6,
    "history_avoidance": 0.7,
    "max_units": 5
  },
  "ui": {
    "avatar_motion_mode": "blend",
    "expression_engine": "au"
  }
}
```

实际编辑时必须合并进现有配置，不得覆盖其它字段。

不得把本地 `config.json` 复制到线上临时克隆。

### 5.7 WebUI

线上 WebUI 已有三档模式和动作风格预设，原则上保留现有界面结构。

只允许进行与本次功能直接相关的调整：

- 确保读取和保存 `avatar_motion_mode`。
- 确保读取和保存 `motion_director.style`。
- 如新增 `motion_director.enabled`，使用复选框或开关。
- 不增加 API URL、API Key 或模型下拉框。
- 不新增独立“表情模型”配置。
- 不增加装饰性页面或新的设置卡片层级。
- 保持当前 WebUI 视觉规范。

若现有 WebUI 已经足够，不为了制造改动而修改前端。

### 5.8 测试

计划新增或移植：

- `live-2d/scripts/test-au-expression-solver.js`
- `live-2d/scripts/test-motion-director-modules.js`
- `live-2d/scripts/test-motion-director-main-api.js`
- 必要时增加 WebUI 配置读写测试

测试必须覆盖：

1. 自动表情：
   - 开心选择笑容相关 AU。
   - 俏皮可选择单眼眨眼。
   - 惊讶、难过、害羞的身体/视线语义。
   - 最近组合的历史回避。
   - 原生表情和原生动作互斥。
   - TTS_END 释放。
   - TTS_INTERRUPTED 释放。
   - min_hold_ms。
   - 缺少 `expression_profile.json` 时使用内存默认值。
   - 启动时不得创建 `expression_profile.json`。
   - 已存在 sidecar 的读取兼容。

2. AI 编舞纯模块：
   - 情绪标签提取。
   - 显式动作指令提取。
   - body fallback。
   - face fallback。
   - AU 映射。
   - 不写 `ParamMouthOpenY`。
   - 不写模型不存在的参数。
   - body/face 通道独立。
   - 首帧截断 fallback。

3. 主对话 API 复用：
   - mock fetch 收到 `{config.llm.api_url}/chat/completions`。
   - model 等于 `config.llm.model`。
   - Authorization 使用 `config.llm.api_key`，但断言失败信息不得包含密钥。
   - `motion_director` 内没有独立 API 字段也能工作。
   - body 和 face 都使用同一主对话配置。
   - API 401、429、500、超时、无效 JSON 均回退本地时间线。
   - API 不支持流式时可使用非流式解析。

4. 模式门控：
   - `blend`：自动表情与 ParamDirector 都启用。
   - `legacy`：自动表情启用，ParamDirector 编舞关闭。
   - `director`：ParamDirector 启用，旧情绪标签路径关闭。

## 6. 明确不做

本次不做以下内容：

1. 不修改 `K:\neruo\my-neuro-main`。
2. 不从本地项目直接 commit 或 push。
3. 不整文件覆盖线上 `llm-handler.js`、`runtime.js`、`tts-playback-engine.js`。
4. 不迁移本地 provider 注册表系统。
5. 不增加 `llm_providers.json`。
6. 不增加编舞专用 API Key。
7. 不增加表情专用 API Key。
8. 不移植 embedding 情绪分类器。
9. 不请求 `/embeddings`。
10. 不修改普通对话的 system prompt、工具调用协议或历史消息结构。
11. 不修改视觉模型 API。
12. 不修改 TTS、ASR、auto-act、companion-director、mood-chat 或其它插件的模型配置。
13. 不复制本地模型文件、角色文件、对话记录、日志或运行时缓存。
14. 不把测试 fallback 误报成真实 AI 编舞成功。
15. 不直接向线上 `main` 强制推送。
16. 不在没有实际运行验证时声称“线上 AI 编舞已经完成”。

## 7. 分阶段执行流程

### 阶段 0：批准前基线冻结

当前状态：

- 已建立独立临时浅克隆。
- 已确认临时克隆基线 SHA。
- 已完成本地与线上只读初步差异核对。
- 尚未创建功能分支。
- 尚未修改实现代码。
- 尚未提交或上传。

批准后执行：

1. 记录临时克隆 `git status`。
2. 记录临时克隆 `HEAD`。
3. 记录本地参考项目 `git status` 摘要和目标文件哈希，仅用于证明未被修改。
4. 创建临时功能分支：
   - `codex/ai-choreography-auto-expression-main-api`
5. 不切换本地参考项目分支。

阶段验收：

- 临时克隆干净。
- 本地参考项目状态与批准前一致。
- 所有后续改动都位于临时功能分支。

### 阶段 1：自动表情差异审计

步骤：

1. 对自动表情四个核心文件做语义 diff。
2. 对 `emotion-engine.js` 和 `runtime.js` 做调用链 diff。
3. 对 `tts-playback-engine.js` 做标签触发和释放 diff。
4. 标记每个差异属于：
   - 自动表情必要修复
   - AI 编舞依赖
   - 本地其它功能
   - 格式或换行差异
5. 只把第一类改动列入补丁。
6. 先移植自动表情测试，再做必要修复。

阶段验收：

- 线上现有自动表情功能没有被重写。
- 本地无关功能没有混入。
- 自动表情测试在改动前能揭示缺口，改动后通过。

### 阶段 2：移植动作指令与纯算法模块

步骤：

1. 移植 `motion-directives.js`。
2. 清除该文件对本地其它未上线模块的依赖。
3. 移植 MotionDirector 中的：
   - 标签解析
   - fallback 生成
   - body/face 校验
   - AU 映射
   - 参数白名单
   - 时间线装载
4. 暂时不接真实 API。
5. 使用 mock catalog 验证纯算法。

阶段验收：

- 不需要 API 即可生成有效 fallback。
- body/face 帧可以写入 ParamDirector 接口。
- 所有纯模块测试通过。

### 阶段 3：接入主对话 API

步骤：

1. 在 MotionDirector 内实现唯一的主对话 API 解析函数。
2. 只读取 `config.llm`。
3. 规范化 API URL。
4. 构造无工具的编舞 messages。
5. body 和 face 使用各自的 system prompt。
6. 允许 body/face 并发，但各自有独立超时和错误隔离。
7. 实现流式 SSE NDJSON 解析。
8. 实现非流式兼容解析。
9. 实现 401、429、5xx、超时和无效内容降级。
10. 记录非敏感诊断：
    - mode
    - model
    - path
    - HTTP 状态
    - 首帧耗时
    - 接受帧数
    - 是否 fallback
11. 禁止记录：
    - API Key
    - Authorization header
    - 完整用户隐私文本
    - 完整模型响应

阶段验收：

- mock 证明所有编舞请求都使用主对话 API。
- 删除或篡改任何单独编舞 API 配置都不影响解析，因为根本不存在该配置。
- API 失败不影响主回复和 TTS。

### 阶段 4：接入最终回复与 TTS

步骤：

1. 在 `llm-handler.js` 最终回复路径加入 MotionDirector。
2. 排除工具调用中间文本。
3. 排除空回复、纯思考、纯文本静默输出。
4. `legacy` 完全跳过编舞。
5. `blend` 启动 fallback 和后台 AI 编舞。
6. `director` 等待首帧或超时。
7. 确认 TTS 流式路径不会绕过 director 首帧 gate。
8. 用户打断时清理时间线。
9. 新一轮请求开始时取消上一轮编舞。

阶段验收：

- 每个最终回复只触发一次编舞。
- 工具中间回复不会触发。
- TTS 与时间线字符进度同步。
- 打断后不播放上一轮动作。

### 阶段 5：配置与 WebUI

步骤：

1. 给 `config.json` 增加不含凭据的默认字段。
2. 保留现有 `llm` 配置不变。
3. 核对 WebUI 读取、保存和热加载。
4. 必要时补充 `motion_director.enabled`。
5. 不增加任何 API 输入项。
6. 保存后重新读取，确认模式和值一致。

阶段验收：

- 三档模式均可从 WebUI 保存。
- 切换到 `legacy` 后不再产生编舞请求。
- 切换到 `blend` 或 `director` 后启用编舞。
- 普通对话 API 设置没有被修改。

### 阶段 6：自动化测试

依次运行：

```text
node --check live-2d/js/ai/motion-director.js
node --check live-2d/js/ai/motion-directives.js
node --check live-2d/js/ai/llm-handler.js
node --check live-2d/js/avatar/live2d/expression/expression-units.js
node live-2d/scripts/test-au-expression-solver.js
node live-2d/scripts/test-motion-director-modules.js
node live-2d/scripts/test-motion-director-main-api.js
```

如涉及 WebUI 后端，再运行对应 Python 测试。

阶段验收：

- 所有新增测试通过。
- 现有相关测试没有新增失败。
- 测试不访问真实付费 API。
- 测试不写入真实模型目录。

### 阶段 7：临时目录运行时验收

运行时验收只能在临时克隆中进行。

配置要求：

- 使用临时且不纳入 Git 的配置。
- API 凭据来自环境变量或用户明确提供的测试配置。
- 不读取或复制本地参考项目的真实配置。

测试场景：

1. `blend`：
   - 回复含 `<开心>`。
   - 自动表情可见。
   - body AI 编舞可见。
   - face AI 帧不会破坏 AU 峰值和口型。

2. `legacy`：
   - 自动表情可见。
   - 传统动作可见。
   - 日志中没有编舞 API 请求。

3. `director`：
   - 旧自动表情路径不触发。
   - 首帧等待不超过上限。
   - AI body/face 时间线可见。

4. API 失败：
   - 临时将 mock 或测试端点设为失败。
   - 对话和 TTS 继续。
   - 使用 fallback 动作。

5. 打断：
   - TTS 播放中发送新消息。
   - 上一轮 AU 和时间线释放。
   - 不出现旧动作继续播放。

阶段验收：

- 至少一轮真实主对话 API 编舞成功。
- 至少一轮自动表情成功。
- 至少一轮 API 失败 fallback 成功。
- 日志可区分 `dialogue`、`choreography-body`、`choreography-face`。
- 日志不包含密钥。

如果没有可用测试凭据：

- 不得声称完成真实 API 验收。
- 可以完成代码、mock 测试和离线运行时验收。
- 在最终报告中把真实 API 验收明确列为待办。

### 阶段 8：差异和安全复核

步骤：

1. 查看临时分支完整 diff。
2. 确认没有修改本地参考项目。
3. 搜索密钥和 Authorization 泄漏。
4. 搜索是否误加入：
   - `provider_id`
   - `model_id`
   - 编舞专用 `api_key`
   - embedding 配置
5. 确认没有模型资产、日志、缓存和私有配置进入 Git。
6. 确认改动只涉及计划列出的模块。
7. 重新运行全部目标测试。

阶段验收：

- diff 范围干净。
- 无秘密信息。
- 无本地无关功能。
- 本地参考项目状态未变化。

### 阶段 9：提交、上传与 Pull Request

所有 Git 操作从临时克隆执行。

计划步骤：

1. 确认线上 `main` 是否前进。
2. 如有新提交，只在临时分支中同步和解决冲突。
3. 创建清晰提交，建议拆分为：
   - `feat(live2d): add main-api motion choreography`
   - `fix(live2d): align automatic AU expression behavior`
   - `test(live2d): cover choreography and expression modes`
4. 添加用户 fork 远程，优先目标：
   - `A-night-owl-Rabbit/my-neuro`
5. 推送功能分支，不推送 `main`。
6. 创建指向 `morettt/my-neuro:main` 的 Pull Request。
7. PR 描述必须包含：
   - 三档模式语义
   - 主对话 API 复用方式
   - 自动表情不产生额外请求
   - fallback 行为
   - 测试结果
   - 未包含任何凭据
8. 如果无推送权限：
   - 保留临时目录中的本地提交。
   - 报告 commit SHA 和阻塞原因。
   - 不改用本地参考项目推送。

阶段验收：

- 分支从临时克隆上传。
- PR 目标正确。
- 没有 force push。
- 没有直接修改线上 `main`。

## 8. 预计涉及的文件

### 8.1 新增文件

- `live-2d/js/ai/motion-director.js`
- `live-2d/js/ai/motion-directives.js`
- `live-2d/scripts/test-au-expression-solver.js`
- `live-2d/scripts/test-llm-motion-tts-order.js`
- `live-2d/scripts/test-motion-director-modules.js`
- `live-2d/scripts/test-motion-director-main-api.js`
- `live-2d/scripts/test-motion-director-runtime.js`

### 8.2 预计修改文件

- `live-2d/js/ai/llm-handler.js`
- `live-2d/js/avatar/motion-mode.js`
- `live-2d/js/avatar/live2d/param-director.js`
- `live-2d/js/avatar/live2d/expression/expression-units.js`
- `live-2d/js/avatar/live2d/runtime.js`
- `live-2d/js/voice/tts-playback-engine.js`
- `live-2d/config.json`
- `live-2d/webui/config_manager.py`
- `live-2d/webui/static/js/app.js`
- `live-2d/webui/templates/index.html`

说明：

- 上述“预计修改”不代表必须制造改动。
- 逐文件审计后若线上现有实现已满足要求，应保持不动。
- `emotion-engine.js` 当前本地与线上核心内容一致，原则上不修改。

## 9. 风险与失败处理

### 风险 1：主对话模型不稳定输出 NDJSON

处理：

- 使用严格 system prompt。
- 流式逐行解析。
- 允许代码围栏、尾逗号和 JSON 数组兼容。
- 丢弃非法帧，不丢弃已接受帧。
- 始终先装载本地 fallback。

### 风险 2：同一 API 每轮增加 body 和 face 两次请求

处理：

- 每条路径限制 token 和超时。
- body/face 独立失败。
- `legacy` 不请求。
- 支持配置关闭其中一条路径。
- 记录 429 和耗时。
- 不在本次擅自增加队列系统；如真实验收持续限流，再更新计划。

### 风险 3：TTS 已经开始，AI 首帧才到

处理：

- fallback 在 API 返回前准备。
- `director` 等首帧但设置硬上限。
- 检查流式 TTS 是否提前绕过 gate。
- 不等待完整双路编舞。

### 风险 4：自动表情与 AI face 帧冲突

处理：

- 保持运行时顺序：ParamDirector 先写，AuDriver 后写，口型最后覆盖。
- ParamDirector 的 face micro 读取 AU active weight。
- 测试眼睛、嘴型、视线和脸颊冲突。
- `director` 模式关闭旧自动表情触发，避免双重表情。

### 风险 5：本地代码包含大量未上线依赖

处理：

- 不复制整文件。
- 每个新增 import 都必须确认线上存在。
- provider、prompt cache、embedding 分类器全部剥离。
- 使用 `rg` 检查残留未定义模块。

### 风险 6：运行时意外写入 expression profile

处理：

- 保持线上无 sidecar 时的纯内存默认值。
- 自动化测试断言模型目录没有新增文件。
- 不从本地移植自动写种子逻辑。
- 不让缺少 sidecar 导致皮套加载失败。

### 风险 7：线上 `main` 在实施期间变化

处理：

- 上传前重新获取最新 `main` SHA。
- 只在临时分支中同步。
- 若新版本已经引入同类编舞实现，停止复制并重新做差异审计。
- 若技术方向变化，先更新本计划并重新取得批准。

### 风险 8：秘密信息泄漏

处理：

- 不读取本地配置中的密钥。
- 不把 API Key 写入日志、测试和计划。
- 测试使用固定假密钥。
- 提交前运行秘密扫描和定向 `rg`。

### 风险 9：临时克隆为 sparse checkout

处理：

- 实施前确认所有目标文件已被 sparse checkout 包含。
- 需要新增目录时先更新 sparse-checkout 范围。
- 提交前用 `git ls-tree` 和 `git status` 核对。

### 风险 10：无法上传或创建 PR

处理：

- 保留临时分支和本地提交。
- 不转而修改本地参考项目。
- 报告准确阻塞点和可继续使用的 commit SHA。

## 10. 最终完成标准

只有同时满足以下条件，才能汇报本任务完成：

1. 本地参考项目没有被修改。
2. 所有代码改动都在临时克隆功能分支中。
3. `blend`、`legacy`、`director` 三档语义与本计划一致。
4. 自动表情在 `blend` 和 `legacy` 可用。
5. AI 编舞在 `blend` 和 `director` 可用。
6. `legacy` 不发送编舞 API 请求。
7. AI 编舞只读取 `config.llm.api_url/api_key/model`。
8. 仓库中不存在编舞专用 API Key 配置。
9. 自动表情不发送独立模型或 embedding 请求。
10. body 和 face 帧均能进入 ParamDirector。
11. API 失败时主对话和 TTS 不失败。
12. TTS 打断后没有残留动作。
13. 自动化测试通过。
14. 至少完成一次真实运行时编舞验收；若缺测试凭据，必须明确标记未完成。
15. diff 中没有私有配置、模型资产、日志或缓存。
16. 功能分支从临时克隆上传。
17. 已创建正确目标的 Pull Request，或明确报告权限阻塞。

## 11. 进度统计口径

进度不按“改了多少文件”统计，而按以下 10 个验收包统计：

| 编号 | 验收包 | 权重 | 当前状态 |
|---|---|---:|---|
| P0 | 基线与本地只读约束确认 | 5% | 已完成 |
| P1 | 计划批准与临时功能分支建立 | 5% | 已完成 |
| P2 | 自动表情差异审计与测试 | 10% | 已完成 |
| P3 | 动作指令与本地 fallback | 10% | 已完成 |
| P4 | AI body/face 编舞生成器 | 20% | 已完成 |
| P5 | 主对话 API 复用与失败隔离 | 15% | 已完成 |
| P6 | 最终回复、TTS 和打断接入 | 10% | 已完成 |
| P7 | 配置与 WebUI 校准 | 5% | 已完成 |
| P8 | 自动化与运行时验收 | 15% | 已完成 mock/集成测试，真实 API 未验收 |
| P9 | 安全复核、上传与 PR | 5% | 进行中 |

当前实施进度：

```text
95%（代码与自动化验收；真实 API 实测属于部署环境验收）
```

这里的进度按验收包统计，不按改动文件数量统计；P9 完成后代表代码已上传并创建 PR，不代表替用户使用真实凭据完成线上运行。

## 12. 批准门槛

本计划已经获得用户明确批准，当前正在按计划执行。批准指令为：

```text
批准这个计划，按计划开始。
```

后续所有提交、推送和 Pull Request 操作仍然只允许从临时克隆执行，不得修改本地参考项目。
