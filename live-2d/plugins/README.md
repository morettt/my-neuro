# 插件开发指南

插件放在 `plugins/community/` 里，应用启动时自动加载。

插件能做三件事：
- **后台运行**：定时器、轮询外部数据、监听事件
- **拦截消息**：在用户消息发给 AI 之前插手，或者在 AI 回复之后做点什么
- **注册工具**：给 AI 提供可以调用的函数（Function Calling）

一个插件可以同时做这三件事。

---

## 五分钟上手（JS）

新建一个目录：

```
plugins/community/my-plugin/
├── index.js
└── metadata.json
```

**metadata.json**

```json
{
  "name": "my-plugin",
  "displayName": "我的插件",
  "version": "1.0.0",
  "author": "你的名字",
  "description": "做什么的",
  "main": "index.js"
}
```

在 `config.json` 里控制开关（不写默认启用）：

```json
{ "plugins": { "my_plugin": { "enabled": true } } }
```

config 的 key 自动由 `name` 转换：连字符换成下划线（`my-plugin` → `my_plugin`）。

**index.js**

```js
const { Plugin } = require('../../../js/core/plugin-base.js');

class MyPlugin extends Plugin {
    async onStart() {
        this.context.log('info', '我启动了');
    }
}

module.exports = MyPlugin;
```

重启应用，终端出现 `✅ 插件已加载: my-plugin` 就成了。

---

## 三种玩法

### 1. 后台定时器

```js
class MyPlugin extends Plugin {
    async onStart() {
        this.timer = setInterval(() => {
            // 每分钟做一次
        }, 60000);
    }

    async onStop() {
        clearInterval(this.timer);
    }
}
```

也可以让 AI 主动说一句话：

```js
async onStart() {
    this.timer = setInterval(async () => {
        await this.context.sendMessage('提示词，让 AI 说点什么');
    }, 60000);
}
```

### 2. 拦截消息

消息在发给 AI 之前经过 `onUserInput`，AI 回复之后经过 `onLLMResponse`：

```js
class MyPlugin extends Plugin {
    async onUserInput(event) {
        // 给这次请求偷偷加点背景信息（用户看不到）
        event.addContext('（现在是下午3点，用户在工作）');

        // 修改用户说的话
        // event.setText('改写后的消息');

        // 阻止消息发给 AI，插件自己处理
        // event.preventDefault();
    }

    async onLLMResponse(response) {
        // AI 刚说完话，response.text 是回复内容
        // 可以在这里记录日志、触发其他操作
    }

    async onTTSEnd() {
        // AI 说完话了（语音播放结束）
    }
}
```

`event.source` 可以区分来源：`'voice'`（语音）、`'text'`（文字）、`'barrage'`（弹幕）

### 3. 给 AI 注册工具

AI 可以在对话中主动调用这些工具：

```js
class MyPlugin extends Plugin {
    getTools() {
        return [{
            type: 'function',
            function: {
                name: 'get_weather',
                description: '查询城市天气',
                parameters: {
                    type: 'object',
                    properties: {
                        city: { type: 'string', description: '城市名' }
                    },
                    required: ['city']
                }
            }
        }];
    }

    async executeTool(name, params) {
        if (name === 'get_weather') {
            return `${params.city}：晴，25°C`;
        }
    }
}
```

---

## context 能做什么

`this.context` 是插件和应用之间的桥梁：

```js
// 打日志（显示在终端）
this.context.log('info', '消息');
this.context.log('warn', '警告');

// 读配置
this.context.getConfig()           // 整个 config.json
this.context.getPluginConfig()     // 只读本插件那块（config.plugins.my_plugin）

// 临时存数据（重启清空）
this.context.storage.set('key', value);
this.context.storage.get('key');

// 让 AI 主动说一句话（走完整 LLM + TTS 流程）
await this.context.sendMessage('提示词');

// 往系统提示词里注入内容（每次 AI 请求都会带着，直到 remove）
this.context.addSystemPromptPatch('patch-id', '你记住这件事');
this.context.removeSystemPromptPatch('patch-id');

// 获取当前对话历史
this.context.getMessages();

// 插件自己偷偷问 AI（不进入对话历史）
const result = await this.context.callLLM('帮我总结一下');

// UI 操作
this.context.showSubtitle('在屏幕上显示字幕', 3000);  // 持续3秒
this.context.triggerEmotion('happy');                  // 触发 Live2D 表情

// 获取另一个插件的实例（插件间通信）
const other = this.context.getPlugin('other-plugin-name');
```

---

## 完整钩子列表

| 钩子 | 什么时候触发 | 常见用途 |
|------|-------------|---------|
| `onInit()` | 插件加载时 | 读配置、初始化变量 |
| `onStart()` | 应用就绪后 | 启动定时器、连接服务 |
| `onStop()` | 应用关闭前 | 清理定时器、保存数据 |
| `onUserInput(event)` | 用户消息发给 AI 之前 | 注入上下文、过滤词、修改消息 |
| `onLLMRequest(request)` | 即将调用 LLM 时 | 修改 messages 数组 |
| `onLLMResponse(response)` | AI 回复之后、TTS 之前 | 记录回复、触发副作用 |
| `onTTSText(text) → string` | TTS 处理文本时 | 翻译、替换词（只影响语音，字幕不变）|
| `onTTSStart(text)` | 语音开始播放 | 同步动画、状态标记 |
| `onTTSEnd()` | 语音播放结束 | 重置定时器、下一步操作 |

所有方法都是可选的，不需要的不用写。

---

## Python 插件

不想写 JS 可以用 Python，需要系统已安装 Python 3。

目录结构和 JS 一样，区别是 metadata.json 里多一行 `"lang": "python"`：

```json
{
  "name": "my-py-plugin",
  "displayName": "我的 Python 插件",
  "version": "1.0.0",
  "author": "你",
  "lang": "python",
  "main": "index.py"
}
```

**index.py**

```python
from plugin_sdk import Plugin, run

class MyPlugin(Plugin):

    async def on_start(self):
        self.context.log('info', '启动了')

    async def on_user_input(self, event):
        event.add_context('（注入的信息）')

    async def on_tts_end(self):
        pass

if __name__ == '__main__':
    run(MyPlugin)
```

钩子名称和 JS 一样，只是改成了 Python 的下划线风格（`onStart` → `on_start`）。

**Python context 可用方法：**

```python
self.context.log('info', '消息')
self.context.send_message('让 AI 主动说这句话')  # 走完整 LLM + TTS
self.context.get_config()           # 整个 config.json
self.context.get_plugin_config()    # 本插件的 config 块
self.context.storage.get('key')
self.context.storage.set('key', value)
```

**Python 的 on_user_input：**

```python
event.text               # 用户输入
event.source             # 'voice' | 'text' | 'barrage'
event.add_context(text)  # 注入背景信息（用户看不到）
event.set_text(text)     # 修改消息内容
event.prevent_default()  # 阻止发给 AI
event.stop_propagation() # 阻止后续插件处理
```

Python 插件用 asyncio，定时器这样写：

```python
import asyncio

class MyPlugin(Plugin):
    async def on_start(self):
        self._task = asyncio.create_task(self._loop())

    async def on_stop(self):
        self._task.cancel()

    async def _loop(self):
        try:
            while True:
                await asyncio.sleep(60)
                self.context.send_message('让 AI 说点什么')
        except asyncio.CancelledError:
            pass
```

---

## 参考示例

- `plugins/built-in/` 里的内置插件，每个都是完整的例子
- `plugins/community/check-in/` — Python 定时器示例
- `plugins/community/notes/` — Python 工具注册示例
