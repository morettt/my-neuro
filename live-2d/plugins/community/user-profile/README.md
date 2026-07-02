# 用户画像插件

从长期记忆和近期对话中保守沉淀用户画像，并在每次 LLM 请求前注入正式画像。

## 核心思路

- `AI记录室/用户画像.json`：正式画像，只保存已晋升的长期信息，会注入提示词。
- `AI记录室/用户画像_候选.json`：候选池，不注入提示词，用来累积跨天证据。
- 单次对话不会直接写入习惯或做派。插件会先把观察放进候选池，同一天多次提到只算一次证据。
- 习惯/做派默认需要 `promote_count=3` 个不同日期，且跨度达到 `promote_span_days=3` 天才晋升。
- 主人明确说“我习惯……/我一直……”时会被视为强信号，可直接晋升。
- MemOS 可用时，插件会用 `merge_count`、搜索命中数和时间跨度作为复现佐证。

## 首次诊断

首次启动时，如果 `用户画像.json` 还没有 `bootstrapped=true`，插件会尝试从 MemOS 拉取：

- `/list?limit=0` 的长期记忆
- `/preferences` 的结构化偏好
- `/graph/entities` 和 `/graph/relations` 的关系摘要（可用时）

然后使用 `profile_llm` 专用模型生成初始画像。MemOS 不可用时会跳过，下次启动重试。

## 专用画像模型

在 `plugin_config.json` 的 `profile_llm` 中配置独立模型：

- `model`
- `api_key`
- `base_url`
- `max_tokens`
- `timeout_seconds`

如果 `profile_llm` 为空，插件会回退到 `context.callLLM` 使用主对话模型。

## 工具

- `profile_view`：查看正式画像。
- `profile_update`：手动修正画像。
- `profile_rebuild`：重新从 MemOS 诊断初始画像。
