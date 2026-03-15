# LLM Provider Demo

这个示例插件演示两件事：

- 在 `plugin_config.json` 里用 `llm_provider` 和 `llm_model` 显示下拉选择器
- 在插件代码里通过 `this.context.callLLM()` 调用统一的 LLM 提供商管理

## 配置项

插件配置页会显示：

- `提供商`
- `模型`
- `温度`
- `提示词前缀`

其中：

- `提供商` 来自主程序里启用中的 LLM 提供商
- `模型` 来自所选提供商下启用中的模型
- 留空时会回退到当前全局对话模型

## 工具

这个插件注册了一个工具：

- `demo_llm_summary`

参数：

- `text`: 要总结的文本

返回：

- LLM 生成的总结结果

## 调用链

核心代码：

```js
const cfg = this.context.getPluginConfig();
const llm = cfg.llm || {};

const result = await this.context.callLLM(prompt, {
  provider_id: llm.provider_id || undefined,
  model: llm.model_id || undefined,
  temperature: Number.isFinite(llm.temperature) ? llm.temperature : 0.7,
  stream: false
});
```

这也是其他插件推荐复用的写法。
