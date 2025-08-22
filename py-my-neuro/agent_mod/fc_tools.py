import pyperclip
import pyautogui
from datetime import datetime
import inspect
import json
import requests
import json

from .agent import Pc_Agent
from tavily import TavilyClient


class MyNuroTools:

    def __init__(self, my_neuro_instance):
        # 保存主类的引用，这样就能访问所有属性了
        self.main = my_neuro_instance
        agent = Pc_Agent()
        self.url = "http://127.0.0.1:8002/ask"

        # 工具调用配置
        self.FUNCTIONS = {
            'get_current_time': self.get_current_time,
            'type_text': self.type_text,
            'click_element': agent.click_element,
            'get_search': self.get_search,
            'ask_q': self.ask_q,
            # 🆕 新增功能工具
            'start_game': self.start_game,
            'start_lesson': self.start_lesson,
            'get_memory_summary': self.get_memory_summary,
            'get_emotion_status': self.get_emotion_status,
            'trigger_emotion': self.trigger_emotion,
            'save_memory': self.save_memory,
            'search_memories': self.search_memories
        }

        # 将工具列表生成移到这里
        self.tools = []
        for name, func in self.FUNCTIONS.items():
            sig = inspect.signature(func)

            properties = {}
            required = []

            for param_name, param in sig.parameters.items():
                properties[param_name] = {
                    "type": "string",
                    "description": f"参数 {param_name}"
                }
                if param.default == inspect.Parameter.empty:
                    required.append(param_name)

            tool = {
                "type": "function",
                "function": {
                    "name": name,
                    "description": func.__doc__ or "什么都没有",
                    "parameters": {
                        "type": "object",
                        "properties": properties,
                        "required": required
                    }
                }
            }
            self.tools.append(tool)

    # 工具函数·······························································

    def get_search(self, content: str, quantity: int):
        """
        输入问题得到回复，利用游览器搜索引擎获取网络信息
        content参数为搜索具体内容，quantity为返回的结果数量。一般填入1~5以内
        """

        client = TavilyClient("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")

        response = client.search(
            query=content,
            search_depth="advanced",
            include_raw_content=True,
            include_answer=True,
            max_results=quantity
        )

        # 这一段是AI总结的内容
        # if response.get('answer'):
        #     print("AI生成答案:")
        #     print(response['answer'][:1000])  # 前1000字符
        #     print("=" * 50)

        # 再看看原始内容
        for i, result in enumerate(response['results'], 1):
            search_results = result['title']
            print(f"结果：{search_results}")
            content = result.get('raw_content') or result['content']
            full_content = content[:1500]  # 只要前1500字符文本
            print(full_content)

            print("-" * 50)

        return full_content

    def get_current_time(self):
        """获取当前时间"""
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def type_text(self, text: str):
        """
        把文本复制到剪贴板,输入想要填入的文本
        """
        pyperclip.copy(text)
        # 自动按Ctrl+V粘贴
        pyautogui.hotkey('ctrl', 'v')
        return '已粘贴完成！'

    def ask_q(self, ask, qty=1):
        """
        检索记忆内容。输入想要检索的记忆来查询以往记下的记忆
        """
        response = requests.post(self.url, json={"question": ask, "top_k": qty})
        js_content = response.json()

        rag_content = ""
        for passage in js_content['relevant_passages']:
            print(passage['content'])
            rag_content += passage['content'] + "\n"  # 收集内容返回

        return rag_content

    # 工具函数·······························································

    def get_requests(self):
        response = self.main.client.chat.completions.create(
            model=self.main.model,
            messages=self.main.messages,
            stream=True,
            tools=self.tools
        )
        return response

    def accept_chat(self, response):

        tool_calls = {}
        full_assistant = ''

        print("AI: ", end="", flush=True)
        for chunk in response:
            if self.main.stop_flag:
                break
            # 处理普通文本内容
            if chunk.choices and chunk.choices[0].delta.content is not None:
                delta = chunk.choices[0].delta
                text_content = delta.content
                print(text_content, end="", flush=True)
                # *** 新增：处理情绪标签 ***
                self.main.emotion_handler.process_text_chunk(text_content)

                # 根据config配置文件布尔值判断是否开启tts语音播放
                if self.main.cut_text_tts:
                    self.main.audio_player.cut_text(text_content)

                full_assistant += text_content

            # 处理工具调用
            if chunk.choices and chunk.choices[0].delta.tool_calls:
                delta = chunk.choices[0].delta
                for tool_call in delta.tool_calls:
                    tool_call_id = tool_call.id
                    if tool_call_id not in tool_calls:
                        tool_calls[tool_call_id] = {
                            'id': tool_call_id,
                            'function': {'name': '', 'arguments': ''},
                            'type': 'function'
                        }

                    if tool_call.function.name:
                        tool_calls[tool_call_id]['function']['name'] = tool_call.function.name
                        print(f"\n[调用工具: {tool_call.function.name}]", flush=True)

                    if tool_call.function.arguments:
                        tool_calls[tool_call_id]['function']['arguments'] += tool_call.function.arguments

        print()
        self.main.stop_flag = False

        # 对话结束后重置情绪处理器缓冲区
        self.main.emotion_handler.reset_buffer()

        if tool_calls:
            tool_calls_list = list(tool_calls.values())

            print(f'调用工具：{tool_calls_list[0]["function"]["name"]}')

            self.main.messages.append({
                'role': 'assistant',
                'content': full_assistant if full_assistant else None,
                'tool_calls': tool_calls_list
            })

            for tool_call in tool_calls_list:
                function_name = tool_call['function']['name']

                if function_name in self.FUNCTIONS:
                    if tool_call['function']['arguments']:
                        arg = json.loads(tool_call['function']['arguments'])
                        print(f'参数：{arg}')
                        result = self.FUNCTIONS[function_name](**arg)
                    else:
                        result = self.FUNCTIONS[function_name]()

                print(f'工具结果：{result}')

                self.main.messages.append({
                    'role': 'tool',
                    'content': str(result),
                    'tool_call_id': tool_call['id'],
                    'name': function_name
                })

            ai_response = self.get_requests()
            content = self.accept_chat(ai_response)
            return content

        return full_assistant

    # 🆕 新增功能工具方法
    def start_game(self, game_type: str):
        """启动游戏功能，支持的游戏类型：你画我猜、知识问答、猜谜、石头剪刀布、猜数字等"""
        if hasattr(self.main, 'game_tools') and self.main.game_tools:
            return self.main.game_tools.start_game(game_type)
        return "❌ 游戏系统未启用"
    
    def start_lesson(self, subject: str, topic: str = "基础"):
        """启动AI讲课功能，科目包括：编程、语言学习、数学、科学等"""
        if hasattr(self.main, 'teaching_tools') and self.main.teaching_tools:
            return self.main.teaching_tools.start_lesson(subject, topic)
        return "❌ 教学系统未启用"
    
    def get_memory_summary(self):
        """获取长期记忆系统的摘要信息"""
        if hasattr(self.main, 'memory_manager') and self.main.memory_manager:
            return self.main.memory_manager.get_memory_summary()
        return "❌ 记忆系统未启用"
    
    def get_emotion_status(self):
        """获取当前的真实情绪状态"""
        if hasattr(self.main, 'emotion_integrator') and self.main.emotion_integrator:
            return self.main.emotion_integrator.get_emotion_status()
        return "❌ 情感系统未启用"
    
    def trigger_emotion(self, emotion: str, intensity: float = 0.5):
        """触发特定情绪，可用情绪：开心、难过、生气、惊讶、害羞、俏皮、兴奋、疲倦、好奇"""
        if hasattr(self.main, 'emotion_integrator') and self.main.emotion_integrator:
            success = self.main.emotion_integrator.real_emotion_system.trigger_specific_emotion(
                emotion, intensity, trigger="tool_call"
            )
            return f"✅ 已触发情绪: {emotion}" if success else f"❌ 未知情绪类型: {emotion}"
        return "❌ 情感系统未启用"
    
    def save_memory(self, key: str, value: str, category: str = "general", importance: int = 1):
        """保存重要信息到长期记忆"""
        if hasattr(self.main, 'memory_manager') and self.main.memory_manager:
            self.main.memory_manager.memory_system.store_user_info(key, value, category, importance)
            return f"✅ 已保存记忆: {key} = {value}"
        return "❌ 记忆系统未启用"
    
    def search_memories(self, keywords: str):
        """搜索长期记忆中的相关信息"""
        if hasattr(self.main, 'memory_manager') and self.main.memory_manager:
            keyword_list = keywords.split()
            results = self.main.memory_manager.memory_system.search_memories(keyword_list)
            
            summary = "🔍 记忆搜索结果:\n"
            if results['user_info']:
                summary += f"用户信息 ({len(results['user_info'])} 条):\n"
                for info in results['user_info'][:3]:
                    summary += f"  - {info['key']}: {info['value']}\n"
            
            if results['conversations']:
                summary += f"相关对话 ({len(results['conversations'])} 条):\n"
                for conv in results['conversations'][:2]:
                    summary += f"  - {conv['user_message'][:50]}...\n"
            
            if results['events']:
                summary += f"重要事件 ({len(results['events'])} 条):\n"
                for event in results['events'][:2]:
                    summary += f"  - {event['description'][:50]}...\n"
            
            return summary if any(results.values()) else "🔍 没有找到相关记忆"
        return "❌ 记忆系统未启用"
