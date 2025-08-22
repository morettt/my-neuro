# main_chat.py - 事件驱动重构版本 - 全功能集成版
from ai_singing_feature import SingingSystem
from openai import OpenAI
from PIL import ImageGrab
import io
import base64
from audio_mod.audio_proucess import AudioPlayer
from audio_mod.asr_module import AudioSystem
import keyboard
import inspect
from datetime import datetime

from PyQt5.QtWidgets import QApplication
from UI.live2d_model import Live2DModel, init_live2d, dispose_live2d
import sys
import json

from config_mod.load_config import load_config
import threading
import time

import pyperclip
import pyautogui

from stream_mod.bilibili_stream import BilibiliDanmuListener

# 导入情绪处理器
from emotion_mod.emotion_handler import EmotionHandler
from agent_mod.fc_tools import MyNuroTools

from UI.typing_box import start_gui_with_ai

from bert_mod import Bert_panduan

# 🆕 导入新功能模块
try:
    from memory_mod.long_term_memory import MemoryManager
    HAS_MEMORY = True
except ImportError:
    HAS_MEMORY = False
    print("⚠️ 长期记忆模块导入失败")

try:
    from real_emotion_mod.real_emotion_system import EmotionIntegrator
    HAS_REAL_EMOTION = True
except ImportError:
    HAS_REAL_EMOTION = False
    print("⚠️ 真实情感模块导入失败")

try:
    from teaching_mod.ai_teaching_system import TeachingTools
    HAS_TEACHING = True
except ImportError:
    HAS_TEACHING = False
    print("⚠️ AI讲课模块导入失败")

try:
    from game_mod.game_companion import GameTools
    HAS_GAMES = True
except ImportError:
    HAS_GAMES = False
    print("⚠️ 游戏陪玩模块导入失败")

try:
    from web_interface.web_server import NeuroWebInterface
    HAS_WEB = True
except ImportError:
    HAS_WEB = False
    print("⚠️ Web界面模块导入失败")

# 导入事件总线
try:
    from UI.simple_event_bus import event_bus, Events

    HAS_EVENT_BUS = True
except ImportError:
    HAS_EVENT_BUS = False
    print("未找到事件总线，使用传统模式")


class MyNeuro:

    def __init__(self):
        # 初始化配置
        self.config = load_config()
        self.bert = Bert_panduan()

        # API配置
        API_KEY = self.config['api']['api_key']
        API_URL = self.config['api']['api_url']
        self.model = self.config['api']['model']
        self.client = OpenAI(api_key=API_KEY, base_url=API_URL)

        self.messages = [{
            'role': 'system', 'content': self.config['api']['system_prompt']
        }]

        # 各种配置
        self.cut_text_tts = self.config['features']['cut_text_tts']
        self.interval = self.config['inputs']['auto_chat']['interval']
        self.audo_chat = self.config['inputs']['auto_chat']['enabled']
        self.asr_real_time = self.config['inputs']['asr'].get('real_time', True)

        # 状态控制
        self.mic_enabled = True
        self.ai_is_responding = False
        self.stop_flag = False

        # 初始化Live2D
        init_live2d()
        self.app = QApplication(sys.argv)
        live_model = Live2DModel()
        live_model.show()

        # 🆕 初始化新功能组件
        self._setup_enhanced_features(live_model)

        # 🆕 初始化高级功能系统
        self._setup_advanced_features()

        # 初始化各个组件
        self.vad_input = AudioSystem(parent_neuro=self)
        self.asr_vad = self.config['inputs']['asr']['enabled']

        # 情绪处理器
        self.emotion_handler = EmotionHandler(config_path="emotion_mod/emotion_actions.json", live_model=live_model)

        # 音频播放器
        live_2d = self.config['features']['live2d']
        self.audio_player = AudioPlayer(live_model=live_model if live_2d else None,
                                        emotion_handler=self.emotion_handler)

        # 唱歌系统
        self.singing_system = SingingSystem(
            live_model=live_model if live_2d else None,
            audio_dir="KTV/output"
        )

    def _setup_advanced_features(self):
        """设置高级功能系统"""
        print("🚀 初始化高级功能系统...")
        
        # 长期记忆系统
        if HAS_MEMORY:
            try:
                self.memory_manager = MemoryManager()
                print("✅ 长期记忆系统已启动")
            except Exception as e:
                print(f"❌ 长期记忆系统启动失败: {e}")
                self.memory_manager = None
        else:
            self.memory_manager = None
        
        # 真实情感系统
        if HAS_REAL_EMOTION:
            try:
                self.emotion_integrator = EmotionIntegrator(self.memory_manager)
                print("🧠 真实情感系统已启动")
            except Exception as e:
                print(f"❌ 真实情感系统启动失败: {e}")
                self.emotion_integrator = None
        else:
            self.emotion_integrator = None
        
        # AI讲课系统
        if HAS_TEACHING:
            try:
                self.teaching_tools = TeachingTools()
                print("✅ AI讲课系统已启动")
            except Exception as e:
                print(f"❌ AI讲课系统启动失败: {e}")
                self.teaching_tools = None
        else:
            self.teaching_tools = None
        
        # 游戏陪玩系统
        if HAS_GAMES:
            try:
                self.game_tools = GameTools()
                print("✅ 游戏陪玩系统已启动")
            except Exception as e:
                print(f"❌ 游戏陪玩系统启动失败: {e}")
                self.game_tools = None
        else:
            self.game_tools = None
        
        # Web界面系统
        if HAS_WEB:
            try:
                self.web_interface = NeuroWebInterface(port=5000)
                self.web_interface.connect_to_neuro(self)
                self.web_server_thread = self.web_interface.start_server()
                print("✅ Web界面系统已启动")
            except Exception as e:
                print(f"❌ Web界面系统启动失败: {e}")
                self.web_interface = None
        else:
            self.web_interface = None

        # Function calling
        self.function_calling_enabled = self.config['features']['function_calling']
        if self.function_calling_enabled:
            self.fc_tool = MyNuroTools(self)
        else:
            self.fc_tool = None

        # 哔哩哔哩直播
        self.listener = BilibiliDanmuListener()

        # 快捷键
        keyboard.add_hotkey('ctrl+i', self.stop_key)
        
        # 🆕 新功能快捷键
        keyboard.add_hotkey('ctrl+shift+c', self.toggle_mood_color)  # 切换心情颜色
        keyboard.add_hotkey('ctrl+shift+m', self.toggle_free_movement)  # 切换自由移动
        keyboard.add_hotkey('ctrl+shift+r', self.trigger_random_mood)  # 随机心情

        # 🔥 新增：事件驱动集成
        if HAS_EVENT_BUS:
            self._setup_event_handlers()

    def _setup_enhanced_features(self, live_model):
        """设置增强功能组件"""
        try:
            # 🆕 心情颜色叠加系统
            from UI.mood_overlay import MoodColorOverlay
            self.mood_overlay = MoodColorOverlay(config=self.config)
            
            # 🆕 自由移动控制器
            from UI.free_movement import FreeMovementController
            self.movement_controller = FreeMovementController(live_model, config=self.config.get("movement", {}))
            
            print("✨ 增强功能组件初始化完成")
        except ImportError as e:
            print(f"⚠️ 增强功能组件导入失败: {e}")
            self.mood_overlay = None
            self.movement_controller = None

    def _setup_event_handlers(self):
        """设置事件处理器"""
        # 订阅用户输入事件
        event_bus.subscribe(Events.USER_INPUT, self._handle_user_input_event)

        # 订阅音频控制事件
        event_bus.subscribe(Events.AUDIO_INTERRUPT, self._handle_audio_interrupt_event)
        event_bus.subscribe(Events.MIC_TOGGLE, self._handle_mic_toggle_event)

        # 订阅AI响应事件
        event_bus.subscribe("ai_response_start", self._handle_ai_response_start)
        event_bus.subscribe("ai_response_end", self._handle_ai_response_end)

        # 🔥 新增：订阅AI文本块事件
        event_bus.subscribe("ai_text_chunk", self._handle_ai_text_chunk)

    def _handle_user_input_event(self, data):
        """处理用户输入事件"""
        user_text = data.get('text', '')
        source = data.get('source', 'unknown')

        print(f"[事件] 收到用户输入: {user_text} (来源: {source})")
        self.start_chat(user_text)

    def _handle_audio_interrupt_event(self, data=None):
        """处理音频打断事件"""
        print("[事件] 收到音频打断信号")
        self.stop_key()

    def _handle_mic_toggle_event(self, data):
        """处理麦克风开关事件"""
        enabled = data.get('enabled', True)
        self.set_mic_enabled(enabled)

    def _handle_ai_response_start(self, data=None):
        """处理AI开始响应事件"""
        if not self.asr_real_time:
            self.set_mic_enabled(False)
            print("🔇 [事件] 麦克风已关闭，AI回复中...")

    def _handle_ai_response_end(self, data=None):
        """处理AI响应结束事件"""
        if not self.asr_real_time:
            self.wait_for_audio_finish()
            self.set_mic_enabled(True)
            print("🎤 [事件] 麦克风已开启，可以说话了")

    def _handle_ai_text_chunk(self, data):
        """处理AI文本块事件 - 🔥 新增核心方法"""
        ai_response = data.get('text', '')

        # 打印到控制台
        print(ai_response, end='', flush=True)

        # 发送给音频播放器
        if self.cut_text_tts:
            self.audio_player.cut_text(ai_response)

    # 事件发布方法
    def publish_event(self, event_name, data=None):
        """发布事件"""
        if HAS_EVENT_BUS:
            event_bus.publish(event_name, data)

    def start_chat(self, user):
        """开始聊天"""
        self.stop_flag = False

        # 发布开始处理用户输入事件
        self.publish_event("user_input_processing", {"text": user})

        # 原有逻辑
        data = self.bert.vl_bert(user)
        if data == '是':
            image_data = self.get_image_base64()
            self.add_vl_message(user, image_data)
        else:
            self.add_message('user', user)

        # 发布AI开始响应事件
        self.publish_event("ai_response_start")

        response = self.get_requests()
        ai_response = self.accept_chat(response)

        if ai_response:
            self.add_message('assistant', ai_response)

        # 发布AI响应结束事件
        self.publish_event("ai_response_end")

    def accept_chat(self, response):
        """🔥 接收聊天 - 事件驱动改造版本"""
        if self.function_calling_enabled and self.fc_tool:
            result = self.fc_tool.accept_chat(response)
            if self.cut_text_tts and not self.stop_flag:
                self.audio_player.finish_current_text()
            self.ai_is_responding = False
            print("🔥🔥🔥 AI回复结束！🔥🔥🔥")
            return result
        else:
            full_assistant = ''
            print('AI:', end='')

            for chunk in response:
                if self.stop_flag:
                    print("🔥 收到打断信号，停止AI回复")
                    self.publish_event(Events.AUDIO_INTERRUPT)
                    break

                if chunk.choices and chunk.choices[0].delta.content is not None:
                    ai_response = chunk.choices[0].delta.content

                    # 🔥 关键改动：发布事件而不是直接处理
                    self.publish_event("ai_text_chunk", {
                        "text": ai_response,
                        "full_text": full_assistant + ai_response
                    })

                    full_assistant += ai_response
                    time.sleep(0.05)

            # 结束处理
            if self.cut_text_tts and not self.stop_flag:
                self.audio_player.finish_current_text()

            print()
            self.ai_is_responding = False
            self.stop_flag = False
            self.emotion_handler.reset_buffer()
            print("🔥🔥🔥 AI回复结束！🔥🔥🔥")
            return full_assistant

    def stop_key(self):
        """停止按键"""
        self.stop_flag = True
        self.ai_is_responding = False
        print('打断！')

        # 发布系统打断事件
        self.publish_event(Events.AUDIO_INTERRUPT)

        # 重置情绪处理器的缓冲区
        self.emotion_handler.reset_buffer()

    def set_mic_enabled(self, enabled):
        """控制麦克风开关"""
        self.mic_enabled = enabled
        if hasattr(self, 'vad_input'):
            self.vad_input.set_mic_enabled(enabled)

        # 发布麦克风状态事件
        self.publish_event(Events.MIC_TOGGLE, {"enabled": enabled})

    # 外部输入接口（支持事件驱动）
    def handle_keyboard_input(self, text):
        """处理键盘输入"""
        self.publish_event(Events.USER_INPUT, {
            "text": text,
            "source": "keyboard"
        })

    def handle_voice_input(self, text):
        """处理语音输入"""
        self.publish_event(Events.USER_INPUT, {
            "text": text,
            "source": "voice"
        })

    def handle_danmu_input(self, text, nickname):
        """处理弹幕输入"""
        self.publish_event(Events.USER_INPUT, {
            "text": f"弹幕消息：{nickname}: {text}",
            "source": "danmu",
            "nickname": nickname
        })

    # 保持原有方法不变
    def wait_for_audio_finish(self):
        """等待所有音频播放完成"""
        import pygame
        while pygame.mixer.get_init() and pygame.mixer.music.get_busy():
            time.sleep(0.1)
        time.sleep(0.2)

    def add_message(self, role, content):
        self.messages.append({
            'role': role,
            'content': content
        })
        if len(self.messages) > 31:
            self.messages.pop(1)

    def get_requests(self):
        if self.function_calling_enabled and self.fc_tool:
            return self.fc_tool.get_requests()
        else:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                stream=True
            )
            return response

    def get_image_base64(self):
        """截图并把通过base64将图片解析成二进制图片数据"""
        screenshot = ImageGrab.grab()
        buffer = io.BytesIO()
        screenshot.save(buffer, format='JPEG')
        image_data = base64.b64encode(buffer.getvalue()).decode('utf-8')
        print('截图')
        return image_data

    def add_vl_message(self, content, image_data):
        self.messages.append({
            'role': 'user',
            'content': [
                {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{image_data}'}},
                {'type': 'text', 'text': content}
            ]
        })
        if len(self.messages) > 31:
            self.messages.pop(1)

    def asr_vad_chat(self):
        """ASR语音输入"""
        if self.asr_vad:
            while True:
                print('启动ASR')
                user = self.vad_input.vad_asr()
                if user.strip():  # 只有非空输入才处理
                    # 使用事件驱动方式
                    self.handle_voice_input(user)

    def main(self):
        """GUI输入处理"""

        def process_keyboard_input(text):
            self.handle_keyboard_input(text)

        sys.exit(start_gui_with_ai(process_keyboard_input))

    def start_main(self):
        """弹幕监听"""
        print('开始对话')
        self.listener.start_listening()

        while True:
            chat = self.listener.get_chat()
            if chat:
                # 使用事件驱动方式
                user_message = chat['text']
                nickname = chat['nickname']
                print(f"收到弹幕: {nickname}: {user_message}")

                self.handle_danmu_input(user_message, nickname)

            time.sleep(1)

    def auto_chat(self):
        """自动聊天"""
        if self.audo_chat:
            while True:
                jiange = self.interval
                time.sleep(jiange)

                user = self.config['api']['auto_content_chat']
                # 使用事件驱动方式
                self.publish_event(Events.USER_INPUT, {
                    "text": user,
                    "source": "auto_chat"
                })

    def toggle_mood_color(self):
        """切换心情颜色功能"""
        if hasattr(self, 'mood_overlay') and self.mood_overlay:
            self.mood_overlay.toggle_overlay()
            print("🎨 切换心情颜色叠加")
        else:
            print("⚠️ 心情颜色功能不可用")

    def toggle_free_movement(self):
        """切换自由移动功能"""
        if hasattr(self, 'movement_controller') and self.movement_controller:
            self.movement_controller.toggle_movement()
            status = self.movement_controller.get_status()
            state = "开启" if status["enabled"] else "关闭"
            print(f"🚶 {state}自由移动功能")
        else:
            print("⚠️ 自由移动功能不可用")

    def trigger_random_mood(self):
        """触发随机心情"""
        if hasattr(self, 'mood_overlay') and self.mood_overlay:
            self.mood_overlay.random_mood_change()
            print("🎲 触发随机心情变化")
        else:
            print("⚠️ 心情颜色功能不可用")

    # 🆕 新增功能方法
    def process_web_message(self, message: str) -> str:
        """处理来自Web界面的消息"""
        try:
            # 模拟聊天处理
            self.start_chat(message)
            
            # 返回最后的AI回复
            if self.messages and self.messages[-1]['role'] == 'assistant':
                return self.messages[-1]['content']
            else:
                return "我收到了你的消息！"
        except Exception as e:
            return f"处理消息时出错: {str(e)}"
    
    def get_memory_summary(self) -> str:
        """获取记忆摘要"""
        if self.memory_manager:
            return self.memory_manager.get_memory_summary()
        return "❌ 记忆系统未启用"
    
    def get_emotion_status(self) -> str:
        """获取情绪状态"""
        if self.emotion_integrator:
            return self.emotion_integrator.get_emotion_status()
        return "❌ 情感系统未启用"
    
    def start_game(self, game_type: str) -> str:
        """启动游戏"""
        if self.game_tools:
            return self.game_tools.start_game(game_type)
        return "❌ 游戏系统未启用"
    
    def start_lesson(self, subject: str, topic: str = None) -> str:
        """启动课程"""
        if self.teaching_tools:
            if not topic:
                # 根据科目选择默认主题
                topic_map = {
                    "编程": "Python基础",
                    "programming": "Python基础",
                    "语言": "英语语法",
                    "language": "英语语法",
                    "数学": "微积分",
                    "math": "微积分"
                }
                topic = topic_map.get(subject, "Python基础")
            
            return self.teaching_tools.start_lesson(subject, topic)
        return "❌ 教学系统未启用"
    
    def list_courses(self) -> str:
        """列出可用课程"""
        if self.teaching_tools:
            return self.teaching_tools.list_available_courses()
        return "❌ 教学系统未启用"
    
    def trigger_emotion(self, emotion: str, intensity: float = 0.5):
        """触发特定情绪"""
        if self.emotion_integrator:
            success = self.emotion_integrator.real_emotion_system.trigger_specific_emotion(
                emotion, intensity, trigger="manual"
            )
            if success:
                print(f"✅ 已触发情绪: {emotion}")
            else:
                print(f"❌ 未知情绪类型: {emotion}")
        else:
            print("⚠️ 情感系统未启用")
    
    def trigger_motion(self, motion: str):
        """触发动作"""
        # 这里可以调用Live2D的动作方法
        print(f"🎭 执行动作: {motion}")
    
    def reset_emotions(self):
        """重置情绪"""
        if self.emotion_integrator:
            self.emotion_integrator.real_emotion_system.reset_emotions()
            print("🔄 情绪已重置")
        else:
            print("⚠️ 情感系统未启用")
    
    def save_config(self):
        """保存配置"""
        try:
            # 保存主配置
            import json
            with open('config_mod/config.json', 'w', encoding='utf-8') as f:
                json.dump(self.config, f, ensure_ascii=False, indent=2)
            
            # 保存其他系统配置
            if self.emotion_integrator:
                self.emotion_integrator.real_emotion_system.save_config()
            
            print("💾 配置已保存")
        except Exception as e:
            print(f"❌ 保存配置失败: {e}")
    
    def restart(self):
        """重启系统"""
        print("🔄 系统重启中...")
        # 这里可以添加重启逻辑
    
    def get_system_status(self) -> dict:
        """获取系统状态"""
        status = {
            'ai_status': '在线' if not self.ai_is_responding else '思考中',
            'memory_status': '正常' if self.memory_manager else '未启用',
            'emotion_status': '正常' if self.emotion_integrator else '未启用',
            'teaching_status': '正常' if self.teaching_tools else '未启用',
            'game_status': '正常' if self.game_tools else '未启用',
            'web_status': '正常' if self.web_interface else '未启用'
        }
        return status

    def main_chat(self):
        """主聊天循环"""
        threading.Thread(target=self.auto_chat, daemon=True).start()
        threading.Thread(target=self.start_main, daemon=True).start()
        threading.Thread(target=self.asr_vad_chat, daemon=True).start()

        # 主线程
        if self.config['inputs']['keyboard']['enabled']:
            self.main()
        else:
            while True:
                user = input('你：')
                self.handle_keyboard_input(user)


if __name__ == '__main__':
    print("🚀 启动My-Neuro全功能版本")
    print("=" * 50)
    print("📋 功能清单:")
    print("✅ 基础对话功能")
    print("✅ Live2D显示")
    print("✅ 语音合成 & 识别")
    print("✅ 情绪表达 & 动作")
    print("✅ 变色功能 & 自由移动")
    
    if HAS_MEMORY:
        print("✅ 长期记忆系统")
    else:
        print("❌ 长期记忆系统 (模块未安装)")
    
    if HAS_REAL_EMOTION:
        print("✅ 真实情感系统")
    else:
        print("❌ 真实情感系统 (模块未安装)")
    
    if HAS_TEACHING:
        print("✅ AI讲课功能")
    else:
        print("❌ AI讲课功能 (模块未安装)")
    
    if HAS_GAMES:
        print("✅ 游戏陪玩功能")
    else:
        print("❌ 游戏陪玩功能 (模块未安装)")
    
    if HAS_WEB:
        print("✅ Web界面支持")
        print("🌐 Web界面地址: http://localhost:5000")
    else:
        print("❌ Web界面支持 (Flask未安装)")
    
    print("=" * 50)
    print("🎮 快捷键:")
    print("  Ctrl+I - 停止AI回复")
    print("  Ctrl+Shift+C - 切换心情颜色")
    print("  Ctrl+Shift+M - 切换自由移动")
    print("  Ctrl+Shift+R - 随机心情")
    print("=" * 50)
    print("💬 特殊命令:")
    print("  '开始游戏' - 启动游戏功能")
    print("  '教我编程' - 启动编程课程")
    print("  '记忆摘要' - 查看记忆状态")
    print("  '情绪状态' - 查看当前情绪")
    print("=" * 50)
    
    my_neuro = MyNeuro()
    my_neuro.main_chat()
