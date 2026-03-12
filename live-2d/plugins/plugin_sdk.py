# plugin_sdk.py - Python 插件 SDK
# 使用方法：
#   from plugin_sdk import Plugin, run
#
# 示例：
#   class MyPlugin(Plugin):
#       async def on_user_input(self, event):
#           event.add_context("注入的信息")
#
#   if __name__ == '__main__':
#       run(MyPlugin)

import sys
import json
import asyncio
import concurrent.futures
import copy

# ===== 上下文对象 =====

class _Storage:
    def __init__(self):
        self._data = {}

    def get(self, key, default=None):
        return copy.deepcopy(self._data.get(key, default))

    def set(self, key, value):
        self._data[key] = value

    def delete(self, key):
        self._data.pop(key, None)

    def get_all(self):
        return copy.deepcopy(self._data)


class PluginContext:
    def __init__(self, send_fn, config=None):
        self._send = send_fn
        self._config = config or {}
        self._plugin_file_config = {}
        self.storage = _Storage()
        self._req_id = 0
        self._pending_requests = {}  # reqId -> asyncio.Future

    # ===== 内部：请求/响应机制 =====

    def _handle_response(self, msg):
        """主循环收到 JS 响应时调用，resolve 对应 Future"""
        req_id = msg.get('reqId')
        if req_id and req_id in self._pending_requests:
            future = self._pending_requests.pop(req_id)
            if not future.done():
                if 'error' in msg:
                    future.set_exception(Exception(msg['error']))
                else:
                    future.set_result(msg.get('result'))

    async def _request(self, method, data=None):
        """向 JS 主进程发请求并等待响应（10s 超时）"""
        self._req_id += 1
        req_id = f'py-{self._req_id}'
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending_requests[req_id] = future
        self._send({'type': 'request', 'reqId': req_id, 'method': method, 'data': data or {}})
        try:
            return await asyncio.wait_for(future, timeout=10.0)
        except asyncio.TimeoutError:
            self._pending_requests.pop(req_id, None)
            raise TimeoutError(f'JS 请求超时: {method}')

    # ===== 日志 / 消息 =====

    def log(self, level, message):
        self._send({'type': 'log', 'level': level, 'message': message})

    def send_message(self, text):
        """让 AI 主动说一句话（走完整 LLM + TTS 流程）"""
        self._send({'type': 'sendMessage', 'text': text})

    # ===== 配置 =====

    def get_config(self):
        return self._config

    def get_plugin_config(self):
        """获取插件自身的 plugin_config.json 内容"""
        return self._plugin_file_config

    # ===== 对话 =====

    async def get_messages(self):
        """获取当前对话历史"""
        return await self._request('getMessages')

    def add_system_prompt_patch(self, patch_id, text):
        """往系统提示词里注入内容（直到 remove）"""
        self._send({'type': 'addSystemPromptPatch', 'id': patch_id, 'text': text})

    def remove_system_prompt_patch(self, patch_id):
        """移除已注入的系统提示词片段"""
        self._send({'type': 'removeSystemPromptPatch', 'id': patch_id})

    # ===== LLM =====

    async def call_llm(self, prompt, options=None):
        """插件自己偷偷问 AI（不进入对话历史）"""
        return await self._request('callLLM', {'prompt': prompt, 'options': options or {}})

    # ===== UI =====

    def show_subtitle(self, text, duration=3000):
        """在屏幕上显示字幕"""
        self._send({'type': 'showSubtitle', 'text': text, 'duration': duration})

    def trigger_emotion(self, emotion):
        """触发 Live2D 表情"""
        self._send({'type': 'triggerEmotion', 'emotion': emotion})

    # ===== 工具 =====

    def register_tool(self, tool_def):
        """运行时动态注册工具（OpenAI function calling 格式）"""
        self._send({'type': 'registerTool', 'toolDef': tool_def})


# ===== 事件对象 =====

class UserInputEvent:
    def __init__(self, text, source):
        self.text = text
        self.source = source
        self._actions = []

    def add_context(self, text):
        self._actions.append({'type': 'addContext', 'text': text})

    def set_text(self, text):
        self.text = text
        self._actions.append({'type': 'setText', 'text': text})

    def prevent_default(self):
        self._actions.append({'type': 'preventDefault'})

    def stop_propagation(self):
        self._actions.append({'type': 'stopPropagation'})


class LLMRequestEvent:
    def __init__(self, messages):
        self.messages = messages


class LLMResponseEvent:
    def __init__(self, text):
        self.text = text


# ===== 插件基类 =====

class Plugin:
    def __init__(self):
        self.context = None
        self.metadata = None

    async def on_init(self):   pass
    async def on_start(self):  pass
    async def on_stop(self):   pass
    async def on_destroy(self): pass

    async def on_user_input(self, event):    pass
    async def on_llm_request(self, request): pass
    async def on_llm_response(self, response): pass
    async def on_tts_text(self, text) -> str: return text
    async def on_tts_start(self, text): pass
    async def on_tts_end(self): pass

    def get_tools(self): return []
    async def execute_tool(self, name, params): return 'Not implemented'



# ===== 事件分发 =====

async def _dispatch(plugin, msg):
    event = msg['event']
    data = msg.get('data', {})
    id_ = msg['id']

    try:
        if event == 'onInit':
            if 'config' in data:
                plugin.context._config = data['config']
            if 'pluginFileConfig' in data:
                plugin.context._plugin_file_config = data['pluginFileConfig']
            await plugin.on_init()
            return {'id': id_, 'status': 'ok'}

        elif event == 'onStart':
            await plugin.on_start()
            return {'id': id_, 'status': 'ok'}

        elif event == 'onStop':
            await plugin.on_stop()
            return {'id': id_, 'status': 'ok'}

        elif event == 'onDestroy':
            await plugin.on_destroy()
            return {'id': id_, 'status': 'ok'}

        elif event == 'onUserInput':
            ev = UserInputEvent(data['text'], data['source'])
            await plugin.on_user_input(ev)
            return {'id': id_, 'status': 'ok', 'actions': ev._actions}

        elif event == 'onLLMRequest':
            req = LLMRequestEvent(data['messages'])
            await plugin.on_llm_request(req)
            return {'id': id_, 'status': 'ok', 'messages': req.messages}

        elif event == 'onLLMResponse':
            resp = LLMResponseEvent(data['text'])
            await plugin.on_llm_response(resp)
            return {'id': id_, 'status': 'ok', 'text': resp.text}

        elif event == 'onTTSText':
            result = await plugin.on_tts_text(data['text'])
            return {'id': id_, 'result': result if result is not None else data['text']}

        elif event == 'onTTSStart':
            await plugin.on_tts_start(data.get('text', ''))
            return {'id': id_, 'status': 'ok'}

        elif event == 'onTTSEnd':
            await plugin.on_tts_end()
            return {'id': id_, 'status': 'ok'}

        elif event == 'getTools':
            return {'id': id_, 'tools': plugin.get_tools()}

        elif event == 'executeTool':
            result = await plugin.execute_tool(data['name'], data['params'])
            return {'id': id_, 'result': result}

        else:
            return {'id': id_, 'status': 'ok'}

    except Exception as e:
        return {'id': id_, 'error': str(e)}


# ===== 主入口 =====

def run(plugin_class):
    def _send(msg):
        sys.stdout.write(json.dumps(msg, ensure_ascii=False) + '\n')
        sys.stdout.flush()

    plugin = plugin_class()
    plugin.context = PluginContext(_send)

    async def _handle_message(msg):
        try:
            response = await _dispatch(plugin, msg)
            if response:
                _send(response)
        except Exception as e:
            sys.stderr.write(f'Dispatch error: {e}\n')
            sys.stderr.flush()

    async def main():
        loop = asyncio.get_running_loop()
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

        while True:
            try:
                line = await loop.run_in_executor(executor, sys.stdin.readline)
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                msg = json.loads(line)

                # JS 响应 Python 的请求（get_messages / call_llm 等）
                if msg.get('type') == 'response':
                    plugin.context._handle_response(msg)
                    continue

                # 钩子调用作为独立 Task，主循环继续读 stdin
                # 这样 get_messages/call_llm 向 JS 请求时不会死锁
                asyncio.create_task(_handle_message(msg))

            except Exception as e:
                sys.stderr.write(f'SDK Error: {e}\n')
                sys.stderr.flush()

    asyncio.run(main())
