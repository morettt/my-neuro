# audio_proucess.py - 简洁版重构
from queue import Queue
import pygame
from io import BytesIO
import requests
import time
import threading
import tempfile
import os
import keyboard
import wave
import logging

# 导入事件总线
try:
    from UI.simple_event_bus import event_bus, Events
    HAS_EVENT_BUS = True
except ImportError:
    HAS_EVENT_BUS = False

# 导入文本过滤器
try:
    from utils.text_filter import filter_for_tts
except ImportError:
    # 如果导入失败，提供一个简单的替代函数
    def filter_for_tts(text):
        return text

logger = logging.getLogger("audio_player")


class AudioProcess:
    def tts_inference(self, text):
        """只做TTS推理，返回音频数据"""
        data = {'text': text, 'text_language': 'zh'}
        url = 'http://127.0.0.1:5000'
        response = requests.post(url, json=data)
        return response.content

    def get_audio_duration(self, audio_data):
        """获取音频时长"""
        try:
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_file.write(audio_data)
                temp_path = temp_file.name

            with wave.open(temp_path, 'rb') as wav_file:
                frames = wav_file.getnframes()
                sample_rate = wav_file.getframerate()
                duration = frames / sample_rate

            os.remove(temp_path)
            return duration
        except Exception as e:
            logger.error(f"获取音频时长失败: {e}")
            return 0.0

    def play_audio(self, audio_data):
        """只播放音频数据"""
        if pygame.mixer.get_init():
            pygame.mixer.music.stop()
            pygame.mixer.quit()

        audio_buffer = BytesIO(audio_data)
        pygame.mixer.init()
        pygame.mixer.music.load(audio_buffer)
        pygame.mixer.music.play()

        while pygame.mixer.music.get_busy():
            pygame.time.Clock().tick(10)


class AudioPlayer:
    def __init__(self, live_model=None, emotion_handler=None):
        self.audio_process = AudioProcess()
        self.text_queue = Queue()
        self.audio_queue = Queue()
        self.text_buffer = ''
        self.punc = {',', '，', '。', '！', '!', '?'}
        self.live_model = live_model
        self.emotion_handler = emotion_handler
        self.is_interrupted = False

        self.sync_data_queue = Queue()

        self.start_tts_thread()
        keyboard.add_hotkey('ctrl+i', self.interrupt_audio)

        # 🔥 新增：订阅事件
        if HAS_EVENT_BUS:
            event_bus.subscribe("audio_interrupt", self._handle_interrupt_event)
            event_bus.subscribe("tts_request", self._handle_tts_request)

    def _handle_interrupt_event(self, data=None):
        """处理打断事件"""
        self.interrupt_audio()

    def _handle_tts_request(self, data):
        """处理TTS请求事件"""
        text = data.get('text', '')
        if text.strip():
            self.add_text_to_queue(text)

    def clear_queue(self):
        """清空所有队列"""
        while not self.text_queue.empty():
            self.text_queue.get()
        while not self.audio_queue.empty():
            self.audio_queue.get()
        while not self.sync_data_queue.empty():
            self.sync_data_queue.get()

    def interrupt_audio(self):
        """打断操作"""
        print("🔇 音频被打断")
        pygame.mixer.music.stop()
        self.clear_queue()
        self.is_interrupted = True

        # 🔥 发布打断事件
        if HAS_EVENT_BUS:
            event_bus.publish("audio_interrupted", {"timestamp": time.time()})

        if self.emotion_handler:
            self.emotion_handler.stop_audio_sync()

    def cut_text(self, ai_content):
        """处理流式文本输入"""
        self.is_interrupted = False
        for char in ai_content:
            if self.is_interrupted:
                break
            self.text_buffer += char
            if char in self.punc:
                self.process_text_segment(self.text_buffer)
                self.text_buffer = ''

    def finish_current_text(self):
        """在AI回复完全结束时调用，处理剩余文本"""
        if self.text_buffer.strip() and not self.is_interrupted:
            self.process_text_segment(self.text_buffer.strip())
            self.text_buffer = ''

    def process_text_segment(self, text_segment):
        """处理文本段落"""
        if not text_segment.strip():
            return

        # 🆕 应用文本过滤器
        filtered_text = filter_for_tts(text_segment)
        
        # 🔥 发布文本处理事件
        if HAS_EVENT_BUS:
            event_bus.publish("text_processing", {"text": filtered_text})

        # 如果有情绪处理器，预处理文本
        if self.emotion_handler:
            processed_data = self.emotion_handler.prepare_text_for_audio(filtered_text)
            clean_text = processed_data['clean_text']
            emotion_markers = processed_data['emotion_markers']

            sync_data = {
                'original_text': text_segment,
                'filtered_text': filtered_text,
                'clean_text': clean_text,
                'emotion_markers': emotion_markers
            }
            self.sync_data_queue.put(sync_data)
        else:
            sync_data = {
                'original_text': text_segment,
                'filtered_text': filtered_text,
                'clean_text': filtered_text,
                'emotion_markers': []
            }
            self.sync_data_queue.put(sync_data)

    def run_tts(self):
        """TTS转换线程"""
        while True:
            sync_data = self.sync_data_queue.get()

            if self.is_interrupted:
                continue

            clean_text = sync_data['clean_text']
            emotion_markers = sync_data['emotion_markers']

            # 🔥 发布TTS开始事件
            if HAS_EVENT_BUS:
                event_bus.publish("tts_start", {"text": clean_text})

            audio_data = self.audio_process.tts_inference(clean_text)
            audio_duration = self.audio_process.get_audio_duration(audio_data)

            audio_item = {
                'audio_data': audio_data,
                'clean_text': clean_text,
                'emotion_markers': emotion_markers,
                'audio_duration': audio_duration
            }

            self.audio_queue.put(audio_item)

    def play_audio_data(self):
        """音频播放线程"""
        while True:
            audio_item = self.audio_queue.get()

            if self.is_interrupted:
                continue

            audio_data = audio_item['audio_data']
            clean_text = audio_item['clean_text']
            emotion_markers = audio_item['emotion_markers']
            audio_duration = audio_item['audio_duration']

            try:
                # 🔥 发布音频播放开始事件
                if HAS_EVENT_BUS:
                    event_bus.publish("audio_play_start", {
                        "duration": audio_duration,
                        "text": clean_text
                    })

                # 启动情绪同步
                if self.emotion_handler and emotion_markers:
                    self.emotion_handler.start_audio_sync(
                        clean_text,
                        emotion_markers,
                        audio_duration
                    )

                # 如果有Live2D模型，启动嘴型同步
                if self.live_model:
                    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                        temp_file.write(audio_data)
                        temp_path = temp_file.name

                    try:
                        # 🔥 发布嘴型同步事件
                        if HAS_EVENT_BUS:
                            event_bus.publish("lip_sync_start", {"audio_path": temp_path})

                        self.live_model.start_lip_sync(temp_path)
                        self.audio_process.play_audio(audio_data)
                    finally:
                        if os.path.exists(temp_path):
                            os.remove(temp_path)
                else:
                    self.audio_process.play_audio(audio_data)

                # 🔥 发布音频播放完成事件
                if HAS_EVENT_BUS:
                    event_bus.publish("audio_play_complete", {"text": clean_text})

                # 停止情绪同步
                if self.emotion_handler:
                    self.emotion_handler.stop_audio_sync()

            except pygame.error as e:
                continue
            except Exception as e:
                if self.emotion_handler:
                    self.emotion_handler.stop_audio_sync()

    def add_text_to_queue(self, text):
        """添加文本到队列（保留兼容性）"""
        self.is_interrupted = False
        self.process_text_segment(text)

    def start_tts_thread(self):
        """启动TTS双线程"""
        run_tts_thread = threading.Thread(target=self.run_tts, daemon=True)
        play_audio_data_thread = threading.Thread(target=self.play_audio_data, daemon=True)
        run_tts_thread.start()
        play_audio_data_thread.start()

    def set_live_model(self, live_model):
        """设置Live2D模型"""
        self.live_model = live_model

    def set_emotion_handler(self, emotion_handler):
        """设置情绪处理器"""
        self.emotion_handler = emotion_handler
