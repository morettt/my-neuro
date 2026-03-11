# 插件使用统一 LLM 提供商参考

这份文档是对插件教程的补充，专门说明：

- 插件如何读取自己的 LLM 配置
- 插件如何调用统一的 `LLM 提供商管理`
- 什么情况下该用全局模型，什么情况下该用插件自定义模型

这份参考只覆盖插件里的 LLM 调用，不改动原有插件教程的其他内容。

---

## 目标

现在项目里的 LLM 已经统一到“提供商 + 模型”管理：

- 提供商在主程序的 `LLM 提供商管理` 页面维护
- 模型挂在某个提供商下面
- 对话模型、视觉模型、插件调用，都应该尽量复用这套配置

插件里不要优先自己保存：

- `api_key`
- `api_url`

插件里优先保存：

- `provider_id`
- `model_id`

然后通过 `this.context.callLLM()` 调用。

---

## 最小用法

如果插件只是偶尔调用一次 LLM，最简单的写法就是：

```js
const result = await this.context.callLLM('帮我总结一下', {
  provider_id: '主模型',
  model: 'deepseek-ai/DeepSeek-V3.2',
  temperature: 0.7
});
```

说明：

- `provider_id` 是你在 `LLM 提供商管理` 里创建的提供商名称
- `model` 是该提供商下的 `model_id`
- 这会优先走统一 provider/model 注册表

---

## 推荐配置方式

推荐给插件单独提供一个 `plugin_config.json`，让用户在 UI 里配置：

```json
{
  "llm": {
    "title": "LLM 设置",
    "description": "留空则回退到当前全局对话模型",
    "type": "object",
    "fields": {
      "provider_id": {
        "title": "提供商 ID",
        "description": "对应 LLM 提供商管理里的名称",
        "type": "llm_provider",
        "default": ""
      },
      "model_id": {
        "title": "模型 ID",
        "description": "对应该提供商下的模型 ID",
        "type": "llm_model",
        "provider_field": "llm.provider_id",
        "default": ""
      },
      "temperature": {
        "title": "温度",
        "description": "留空时使用默认值 0.7",
        "type": "float",
        "default": 0.7
      }
    }
  }
}
```

插件代码里读取：

```js
const cfg = this.context.getPluginConfig();
const llm = cfg.llm || {};

const result = await this.context.callLLM('帮我总结一下', {
  provider_id: llm.provider_id,
  model: llm.model_id,
  temperature: llm.temperature ?? 0.7
});
```

这是推荐做法，因为：

- 插件不需要自己管理密钥
- 用户可以直接复用主程序里已经配置好的提供商
- 多个插件可以共享同一个 provider
- 后续切换模型只改配置，不用改插件代码

字段说明：

- `llm_provider` 会在插件配置页渲染成“提供商下拉框”
- `llm_model` 会在插件配置页渲染成“模型下拉框”
- `provider_field` 用来指定这个模型下拉框要跟随哪个提供商字段联动

---

## 留空时的行为

如果插件没有填写 `provider_id`，`callLLM()` 会回退到当前全局对话模型。

例如：

```js
const result = await this.context.callLLM('帮我总结一下');
```

或者：

```js
const result = await this.context.callLLM('帮我总结一下', {
  temperature: 0.3
});
```

这种写法适合：

- 插件只是附属功能
- 希望插件跟着当前对话模型走
- 不想给插件单独暴露 LLM 选择项

---

## 完整示例

目录结构：

```text
plugins/community/my-llm-plugin/
├── index.js
├── metadata.json
└── plugin_config.json
```

`metadata.json`

```json
{
  "name": "my-llm-plugin",
  "displayName": "LLM 调用示例",
  "version": "1.0.0",
  "author": "you",
  "description": "演示插件如何使用统一 LLM 提供商",
  "main": "index.js"
}
```

`plugin_config.json`

```json
{
  "llm": {
    "title": "LLM 设置",
    "description": "留空则使用当前全局对话模型",
    "type": "object",
    "fields": {
      "provider_id": {
        "title": "提供商 ID",
        "type": "llm_provider",
        "default": ""
      },
      "model_id": {
        "title": "模型 ID",
        "type": "llm_model",
        "provider_field": "llm.provider_id",
        "default": ""
      },
      "temperature": {
        "title": "温度",
        "type": "float",
        "default": 0.7
      }
    }
  }
}
```

`index.js`

```js
const { Plugin } = require('../../../js/core/plugin-base.js');

class MyLLMPlugin extends Plugin {
  async onStart() {
    this.context.log('info', 'my-llm-plugin started');
  }

  async summarize(text) {
    const cfg = this.context.getPluginConfig();
    const llm = cfg.llm || {};

    const prompt = `请用三行总结以下内容：\n${text}`;
    return await this.context.callLLM(prompt, {
      provider_id: llm.provider_id || undefined,
      model: llm.model_id || undefined,
      temperature: llm.temperature ?? 0.7,
      stream: false
    });
  }
}

module.exports = MyLLMPlugin;
```

---

## Python 插件参考

当前统一 provider/model 的直接封装主要在 JS `PluginContext` 里。

如果你写的是 Python 插件，建议优先：

1. 在插件配置里仍然保存 `provider_id` 和 `model_id`
2. 通过现有 Python SDK 暴露的方法读取配置
3. 如果需要直接发 LLM 请求，优先先看当前 Python bridge 是否已经封装了对应调用

如果 Python 插件后续也要和 JS 插件完全一致，建议补一个 Python 侧的 `call_llm(provider_id, model_id, ...)` 包装层，而不是让每个 Python 插件自己拼接 `api_key` 和 `api_url`。

---

## 不推荐的做法

不推荐插件继续使用这种旧配置思路：

```json
{
  "llm": {
    "api_key": "...",
    "api_url": "...",
    "model": "..."
  }
}
```

问题是：

- 会绕开统一的提供商管理
- 密钥重复维护
- 用户在主程序里切换模型后，插件不会自动跟上
- 多个插件会重复保存同一套密钥

只有当插件必须访问完全独立的第三方接口，且不希望复用主程序已有 provider 时，才考虑这么做。

---

## 适用建议

建议优先选下面两种模式之一。

模式一：跟随全局模型

- 插件不配置 `provider_id`
- 直接 `this.context.callLLM(prompt)`
- 适合简单插件

模式二：插件指定模型

- 插件配置 `provider_id + model_id`
- 调用时显式传给 `callLLM()`
- 适合摘要、压缩、识图辅助、专用工作流插件

如果插件是面向普通用户发布，推荐默认走“跟随全局模型”，只在确实需要时再暴露单独的 LLM 配置项。

---

## 相关位置

- 插件上下文：`live-2d/js/core/plugin-context.js`
- 统一 provider 管理：`live-2d/js/core/llm-provider.js`
- 插件教程：`live-2d/plugins/README.md`
