import json
import re
import random
import threading
import time

# 导入事件总线
try:
    from UI.simple_event_bus import event_bus, Events
    HAS_EVENT_BUS = True
except ImportError:
    HAS_EVENT_BUS = False

class EmotionHandler:
    """情绪标签处理器 - 支持时间轴同步"""

    def __init__(self, config_path="emotion_actions.json", live_model=None):
        self.live_model = live_model
        self.emotion_config = {}
        self.motion_file_to_index = {}
        self.text_buffer = ""
        
        # 时间轴同步相关
        self.emotion_timeline = []
        self.current_text_segment = ""
        self.sync_timer = None
        self.audio_start_time = None

        # 加载配置
        self.load_config(config_path)
        # 构建动作文件名到索引的映射
        self.build_motion_mapping()

    def load_config(self, config_path):
        """加载情绪配置文件"""
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                self.emotion_config = config.get("emotion_actions", {})
        except Exception as e:
            self.emotion_config = {}

    def build_motion_mapping(self):
        """构建动作文件名到索引的映射"""
        motion_files = [
            "Hiyori_m02.motion3.json",  # index 0
            "Hiyori_m03.motion3.json",  # index 1
            "Hiyori_m04.motion3.json",  # index 2
            "Hiyori_m05.motion3.json",  # index 3
            "Hiyori_m06.motion3.json",  # index 4
            "Hiyori_m07.motion3.json",  # index 5
            "Hiyori_m08.motion3.json",  # index 6
            "Hiyori_m09.motion3.json",  # index 7
            "micoff.motion3.json",      # index 8
            "micon.motion3.json"        # index 9
        ]

        for index, filename in enumerate(motion_files):
            self.motion_file_to_index[filename] = index

    def prepare_text_for_audio(self, text):
        """为音频播放准备文本，提取情绪标签和位置信息"""
        # 使用正则表达式匹配所有情绪标签和位置
        pattern = r'<([^>]+)>'
        emotion_tags = []
        
        # 找到所有匹配项
        for match in re.finditer(pattern, text):
            emotion = match.group(1)
            if emotion in self.emotion_config:
                emotion_tags.append({
                    'emotion': emotion,
                    'start_index': match.start(),
                    'end_index': match.end(),
                    'full_tag': match.group(0)
                })
        
        # 如果没有情绪标签，直接返回
        if not emotion_tags:
            return {
                'clean_text': text,
                'emotion_markers': []
            }
        
        # 创建纯文本版本（移除所有情绪标签）
        clean_text = text
        # 从后向前处理，避免位置偏移问题
        for tag in reversed(emotion_tags):
            clean_text = clean_text[:tag['start_index']] + clean_text[tag['end_index']:]
        
        # 创建情绪标记数组，转换为基于字符位置的标记
        emotion_markers = []
        offset = 0
        
        for tag in emotion_tags:
            # 计算在纯文本中的位置（考虑前面移除的标签）
            adjusted_position = tag['start_index'] - offset
            offset += tag['end_index'] - tag['start_index']
            
            # 获取对应的动作
            motion_files = self.emotion_config[tag['emotion']]
            if motion_files:
                # 随机选择一个动作文件
                selected_motion_file = random.choice(motion_files)
                motion_index = self.motion_file_to_index.get(selected_motion_file)
                
                if motion_index is not None:
                    emotion_markers.append({
                        'position': adjusted_position,
                        'emotion': tag['emotion'],
                        'motion_index': motion_index,
                        'motion_file': selected_motion_file
                    })
        
        return {
            'clean_text': clean_text,
            'emotion_markers': emotion_markers
        }

    def start_audio_sync(self, clean_text, emotion_markers, audio_duration):
        """开始音频同步，根据音频时长和文本长度计算触发时机"""
        if not emotion_markers:
            return
        
        self.current_text_segment = clean_text
        self.emotion_timeline = []
        self.audio_start_time = time.time()
        
        # 计算每个字符对应的时间
        text_length = len(clean_text)
        if text_length == 0:
            return
        
        char_duration = audio_duration / text_length
        
        # 为每个情绪标记计算触发时间
        for marker in emotion_markers:
            trigger_time = marker['position'] * char_duration
            
            self.emotion_timeline.append({
                'trigger_time': trigger_time,
                'emotion': marker['emotion'],
                'motion_index': marker['motion_index'],
                'motion_file': marker['motion_file'],
                'triggered': False
            })
        
        # 启动同步计时器
        self.start_sync_timer()

    def start_sync_timer(self):
        """启动同步计时器"""
        if self.sync_timer:
            self.sync_timer.cancel()
        
        def check_triggers():
            if not self.audio_start_time or not self.emotion_timeline:
                return
            
            current_time = time.time()
            elapsed_time = current_time - self.audio_start_time
            
            # 检查是否有需要触发的情绪动作
            for timeline_item in self.emotion_timeline:
                if (not timeline_item['triggered'] and 
                    elapsed_time >= timeline_item['trigger_time']):
                    
                    # 触发动作
                    self.trigger_emotion_motion(
                        timeline_item['emotion'],
                        timeline_item['motion_index'],
                        timeline_item['motion_file']
                    )
                    timeline_item['triggered'] = True
            
            # 继续检查（每50ms检查一次）
            if any(not item['triggered'] for item in self.emotion_timeline):
                self.sync_timer = threading.Timer(0.05, check_triggers)
                self.sync_timer.start()
        
        # 开始检查
        check_triggers()

    def trigger_emotion_motion(self, emotion, motion_index, motion_file):
        """触发情绪动作"""
        if self.live_model:
            try:
                self.live_model.play_tapbody_motion(motion_index)
            except Exception as e:
                pass
        
        # 🆕 发布情绪触发事件，用于心情颜色变化
        if HAS_EVENT_BUS:
            event_bus.publish("emotion_triggered", {
                "emotion": emotion,
                "motion_index": motion_index,
                "motion_file": motion_file,
                "timestamp": time.time()
            })
            
        print(f"🎭 触发情绪: {emotion}")

    def stop_audio_sync(self):
        """停止音频同步"""
        if self.sync_timer:
            self.sync_timer.cancel()
            self.sync_timer = None
        
        self.emotion_timeline = []
        self.audio_start_time = None

    def process_text_chunk(self, text_chunk):
        """处理流式文本块（保留兼容性，但不会立即触发）"""
        if not text_chunk:
            return
        self.text_buffer += text_chunk

    def reset_buffer(self):
        """重置所有缓冲区和状态"""
        self.text_buffer = ""
        self.stop_audio_sync()

    def get_available_emotions(self):
        """获取可用的情绪列表"""
        return list(self.emotion_config.keys())
