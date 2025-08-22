import json
import time
import threading
import random
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from enum import Enum

class EmotionType(Enum):
    """情绪类型枚举"""
    HAPPY = "开心"
    SAD = "难过"  
    ANGRY = "生气"
    SURPRISED = "惊讶"
    SHY = "害羞"
    PLAYFUL = "俏皮"
    NEUTRAL = "平静"
    EXCITED = "兴奋"
    TIRED = "疲倦"
    CURIOUS = "好奇"

@dataclass
class EmotionState:
    """情绪状态数据类"""
    emotion_type: EmotionType
    intensity: float  # 0.0 - 1.0
    duration: float   # 持续时间(秒)
    decay_rate: float # 衰减速率
    triggers: List[str]  # 触发因素
    timestamp: float
    
    def to_dict(self):
        return {
            'emotion_type': self.emotion_type.value,
            'intensity': self.intensity,
            'duration': self.duration,
            'decay_rate': self.decay_rate,
            'triggers': self.triggers,
            'timestamp': self.timestamp
        }

class RealEmotionSystem:
    """真实情感系统 - 模拟真人的持续情绪状态"""
    
    def __init__(self, config_path="real_emotion_mod/emotion_config.json"):
        self.config_path = config_path
        self.current_emotions = {}  # 当前活跃的情绪状态
        self.base_mood = EmotionType.NEUTRAL  # 基础心情
        self.personality_traits = {}  # 性格特征
        self.emotion_history = []  # 情绪历史
        self.lock = threading.Lock()
        
        # 情绪影响因子
        self.emotion_influences = {
            "time_of_day": 0.1,    # 时间因素
            "interaction_count": 0.2,  # 互动次数
            "recent_events": 0.3,  # 最近事件
            "personality": 0.4     # 性格特征
        }
        
        # 加载配置
        self.load_config()
        
        # 初始化基础情绪
        self.initialize_base_emotions()
        
        # 启动情绪更新线程
        self.emotion_update_thread = threading.Thread(target=self._emotion_update_loop, daemon=True)
        self.emotion_update_thread.start()
        
        print("🧠 真实情感系统已启动")
    
    def load_config(self):
        """加载情感系统配置"""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                self.personality_traits = config.get("personality_traits", {})
                self.emotion_influences.update(config.get("emotion_influences", {}))
        except FileNotFoundError:
            # 使用默认配置
            self.personality_traits = {
                "extraversion": 0.7,    # 外向性
                "agreeableness": 0.6,   # 宜人性
                "conscientiousness": 0.5, # 尽责性
                "neuroticism": 0.4,     # 神经质
                "openness": 0.8         # 开放性
            }
            self.save_config()
    
    def save_config(self):
        """保存配置"""
        config = {
            "personality_traits": self.personality_traits,
            "emotion_influences": self.emotion_influences
        }
        
        import os
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        
        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    
    def initialize_base_emotions(self):
        """初始化基础情绪状态"""
        current_time = time.time()
        
        # 根据性格特征设置初始情绪
        if self.personality_traits.get("extraversion", 0.5) > 0.6:
            self.add_emotion(EmotionType.HAPPY, 0.3, duration=3600, triggers=["personality"])
        
        if self.personality_traits.get("neuroticism", 0.5) > 0.6:
            self.add_emotion(EmotionType.TIRED, 0.2, duration=1800, triggers=["personality"])
        
        # 添加基础平静状态
        self.add_emotion(EmotionType.NEUTRAL, 0.5, duration=float('inf'), triggers=["base"])
    
    def add_emotion(self, emotion_type: EmotionType, intensity: float, 
                   duration: float = 300, triggers: List[str] = None, 
                   decay_rate: float = 0.001):
        """添加新的情绪状态"""
        with self.lock:
            current_time = time.time()
            
            # 如果已存在同类型情绪，则增强或替换
            if emotion_type in self.current_emotions:
                existing = self.current_emotions[emotion_type]
                # 叠加强度（有上限）
                new_intensity = min(1.0, existing.intensity + intensity * 0.5)
                existing.intensity = new_intensity
                existing.duration = max(existing.duration, duration)
                existing.triggers.extend(triggers or [])
                existing.timestamp = current_time
            else:
                # 创建新情绪状态
                emotion_state = EmotionState(
                    emotion_type=emotion_type,
                    intensity=min(1.0, intensity),
                    duration=duration,
                    decay_rate=decay_rate,
                    triggers=triggers or [],
                    timestamp=current_time
                )
                self.current_emotions[emotion_type] = emotion_state
            
            # 记录到历史
            self.emotion_history.append({
                'emotion': emotion_type.value,
                'intensity': intensity,
                'timestamp': current_time,
                'triggers': triggers or []
            })
            
            print(f"😊 新增情绪: {emotion_type.value} (强度: {intensity:.2f})")
    
    def process_user_interaction(self, user_text: str, ai_response: str = ""):
        """处理用户交互，分析情绪影响"""
        # 分析用户文本的情绪倾向
        emotion_analysis = self._analyze_text_emotion(user_text)
        
        # 根据分析结果调整情绪
        for emotion_type, score in emotion_analysis.items():
            if score > 0.3:
                # 强正面情绪
                if emotion_type in [EmotionType.HAPPY, EmotionType.EXCITED]:
                    self.add_emotion(emotion_type, score * 0.7, duration=600, 
                                   triggers=[f"user_positive_{user_text[:20]}"])
                # 负面情绪
                elif emotion_type in [EmotionType.SAD, EmotionType.ANGRY]:
                    self.add_emotion(emotion_type, score * 0.5, duration=900, 
                                   triggers=[f"user_negative_{user_text[:20]}"])
        
        # 互动本身会带来轻微的愉悦
        self.add_emotion(EmotionType.HAPPY, 0.1, duration=300, triggers=["interaction"])
    
    def _analyze_text_emotion(self, text: str) -> Dict[EmotionType, float]:
        """分析文本情绪倾向"""
        emotion_keywords = {
            EmotionType.HAPPY: ["开心", "高兴", "快乐", "哈哈", "不错", "棒", "好", "喜欢", "爱"],
            EmotionType.SAD: ["难过", "伤心", "失望", "沮丧", "痛苦", "哭", "悲伤"],
            EmotionType.ANGRY: ["生气", "愤怒", "烦躁", "讨厌", "气", "恼火", "怒"],
            EmotionType.SURPRISED: ["惊讶", "震惊", "意外", "没想到", "天哪", "哇"],
            EmotionType.EXCITED: ["兴奋", "激动", "期待", "太好了", "太棒了"],
            EmotionType.TIRED: ["累", "疲惫", "困", "无聊", "懒"]
        }
        
        scores = {}
        text_lower = text.lower()
        
        for emotion_type, keywords in emotion_keywords.items():
            score = 0
            for keyword in keywords:
                if keyword in text_lower:
                    score += 0.2
            scores[emotion_type] = min(1.0, score)
        
        return scores
    
    def get_dominant_emotion(self) -> Optional[EmotionType]:
        """获取当前主导情绪"""
        with self.lock:
            if not self.current_emotions:
                return EmotionType.NEUTRAL
            
            # 找到强度最高的情绪
            dominant = max(self.current_emotions.values(), key=lambda x: x.intensity)
            return dominant.emotion_type if dominant.intensity > 0.1 else EmotionType.NEUTRAL
    
    def get_emotion_mix(self) -> Dict[str, float]:
        """获取当前情绪混合状态"""
        with self.lock:
            emotion_mix = {}
            total_intensity = sum(emotion.intensity for emotion in self.current_emotions.values())
            
            if total_intensity > 0:
                for emotion_type, emotion_state in self.current_emotions.items():
                    if emotion_state.intensity > 0.05:  # 忽略微弱情绪
                        emotion_mix[emotion_type.value] = emotion_state.intensity / total_intensity
            else:
                emotion_mix[EmotionType.NEUTRAL.value] = 1.0
            
            return emotion_mix
    
    def get_emotional_context_for_ai(self) -> str:
        """为AI生成情绪上下文提示"""
        dominant = self.get_dominant_emotion()
        emotion_mix = self.get_emotion_mix()
        
        if not dominant or dominant == EmotionType.NEUTRAL:
            return "当前心情平静。"
        
        context = f"当前主要心情是{dominant.value}"
        
        # 添加情绪强度描述
        with self.lock:
            if dominant in self.current_emotions:
                intensity = self.current_emotions[dominant].intensity
                if intensity > 0.7:
                    context += "，情绪很强烈"
                elif intensity > 0.4:
                    context += "，情绪中等"
                else:
                    context += "，情绪较轻"
        
        # 添加混合情绪
        if len(emotion_mix) > 1:
            other_emotions = [emotion for emotion in emotion_mix.keys() if emotion != dominant.value]
            if other_emotions:
                context += f"，同时还有一些{other_emotions[0]}"
        
        return context + "。在回复时要体现出这种情绪状态。"
    
    def apply_time_based_changes(self):
        """应用基于时间的情绪变化"""
        current_hour = datetime.now().hour
        
        # 早晨 (6-10点) - 更有活力
        if 6 <= current_hour <= 10:
            self.add_emotion(EmotionType.EXCITED, 0.2, duration=1800, triggers=["morning"])
        
        # 下午 (14-18点) - 相对平稳
        elif 14 <= current_hour <= 18:
            self.add_emotion(EmotionType.NEUTRAL, 0.3, duration=3600, triggers=["afternoon"])
        
        # 晚上 (20-23点) - 更放松
        elif 20 <= current_hour <= 23:
            self.add_emotion(EmotionType.HAPPY, 0.15, duration=2700, triggers=["evening"])
        
        # 深夜 (0-5点) - 疲倦
        elif current_hour <= 5 or current_hour >= 0:
            self.add_emotion(EmotionType.TIRED, 0.4, duration=3600, triggers=["late_night"])
    
    def _emotion_update_loop(self):
        """情绪更新循环"""
        last_time_update = 0
        
        while True:
            try:
                current_time = time.time()
                
                with self.lock:
                    # 更新所有情绪状态
                    emotions_to_remove = []
                    
                    for emotion_type, emotion_state in self.current_emotions.items():
                        # 计算衰减
                        time_elapsed = current_time - emotion_state.timestamp
                        
                        if time_elapsed >= emotion_state.duration:
                            # 情绪持续时间结束，开始衰减
                            emotion_state.intensity -= emotion_state.decay_rate * (time_elapsed - emotion_state.duration)
                        
                        # 移除强度过低的情绪
                        if emotion_state.intensity <= 0.01 and emotion_type != EmotionType.NEUTRAL:
                            emotions_to_remove.append(emotion_type)
                    
                    # 清理过期情绪
                    for emotion_type in emotions_to_remove:
                        del self.current_emotions[emotion_type]
                        print(f"😴 情绪消散: {emotion_type.value}")
                
                # 每小时应用时间相关变化
                if current_time - last_time_update > 3600:
                    self.apply_time_based_changes()
                    last_time_update = current_time
                
                # 随机情绪波动（模拟自然的心情变化）
                if random.random() < 0.001:  # 0.1% 概率
                    self._apply_random_mood_shift()
                
                time.sleep(30)  # 每30秒更新一次
                
            except Exception as e:
                print(f"❌ 情绪更新循环错误: {e}")
                time.sleep(60)
    
    def _apply_random_mood_shift(self):
        """应用随机的心情波动"""
        mood_shifts = [
            (EmotionType.CURIOUS, 0.2, 600),
            (EmotionType.PLAYFUL, 0.15, 900),
            (EmotionType.TIRED, 0.1, 1200),
        ]
        
        emotion_type, intensity, duration = random.choice(mood_shifts)
        self.add_emotion(emotion_type, intensity, duration, triggers=["random_shift"])
    
    def get_emotion_summary(self) -> Dict[str, Any]:
        """获取情绪系统摘要"""
        with self.lock:
            dominant = self.get_dominant_emotion()
            emotion_mix = self.get_emotion_mix()
            
            # 最近情绪历史
            recent_history = self.emotion_history[-10:] if self.emotion_history else []
            
            return {
                'dominant_emotion': dominant.value if dominant else "平静",
                'emotion_mix': emotion_mix,
                'active_emotions_count': len(self.current_emotions),
                'recent_history': recent_history,
                'personality_traits': self.personality_traits,
                'last_updated': datetime.now().isoformat()
            }
    
    def trigger_specific_emotion(self, emotion_name: str, intensity: float = 0.5, 
                               duration: float = 600, trigger: str = "manual"):
        """手动触发特定情绪（用于测试或特殊情况）"""
        try:
            emotion_type = EmotionType(emotion_name)
            self.add_emotion(emotion_type, intensity, duration, triggers=[trigger])
            return True
        except ValueError:
            print(f"❌ 未知情绪类型: {emotion_name}")
            return False
    
    def reset_emotions(self):
        """重置所有情绪到基础状态"""
        with self.lock:
            self.current_emotions.clear()
            self.initialize_base_emotions()
            print("🔄 情绪系统已重置")

class EmotionIntegrator:
    """情绪系统集成器 - 将真实情感系统整合到主程序"""
    
    def __init__(self, memory_manager=None):
        self.real_emotion_system = RealEmotionSystem()
        self.memory_manager = memory_manager
        
        # 导入事件总线
        try:
            from UI.simple_event_bus import event_bus, Events
            self.has_event_bus = True
            # 订阅情绪相关事件
            event_bus.subscribe("emotion_triggered", self._handle_emotion_triggered)
            event_bus.subscribe("user_input", self._handle_user_input)
        except ImportError:
            self.has_event_bus = False
    
    def _handle_emotion_triggered(self, data):
        """处理情绪触发事件"""
        emotion = data.get("emotion", "")
        if emotion:
            # 将显示的情绪也添加到真实情感系统
            try:
                emotion_type = EmotionType(emotion)
                self.real_emotion_system.add_emotion(
                    emotion_type, 0.3, duration=300, triggers=["display_emotion"]
                )
            except ValueError:
                pass
    
    def _handle_user_input(self, data):
        """处理用户输入事件"""
        user_text = data.get('text', '')
        if user_text:
            self.real_emotion_system.process_user_interaction(user_text)
    
    def get_enhanced_system_prompt(self, original_prompt: str) -> str:
        """获取增强的系统提示（包含情绪上下文）"""
        emotion_context = self.real_emotion_system.get_emotional_context_for_ai()
        
        enhanced_prompt = original_prompt + f"\n\n[情绪状态] {emotion_context}"
        
        return enhanced_prompt
    
    def process_conversation(self, user_text: str, ai_response: str):
        """处理对话，更新情绪和记忆"""
        # 更新情绪系统
        self.real_emotion_system.process_user_interaction(user_text, ai_response)
        
        # 记录情绪到长期记忆
        if self.memory_manager:
            dominant_emotion = self.real_emotion_system.get_dominant_emotion()
            emotion_mix = self.real_emotion_system.get_emotion_mix()
            
            # 存储情绪事件到记忆
            if dominant_emotion and dominant_emotion != EmotionType.NEUTRAL:
                self.memory_manager.store_emotion_event(
                    dominant_emotion.value, 
                    emotion_mix.get(dominant_emotion.value, 0.5),
                    user_text[:50]
                )
    
    def get_current_emotion_for_display(self) -> str:
        """获取当前情绪用于显示"""
        dominant = self.real_emotion_system.get_dominant_emotion()
        return dominant.value if dominant else "平静"
    
    def get_emotion_status(self) -> str:
        """获取情绪状态文本"""
        summary = self.real_emotion_system.get_emotion_summary()
        
        text = f"🧠 情绪状态:\n"
        text += f"- 主导情绪: {summary['dominant_emotion']}\n"
        text += f"- 活跃情绪数: {summary['active_emotions_count']}\n"
        
        if summary['emotion_mix']:
            mix_text = ", ".join([f"{emotion}({ratio:.1%})" for emotion, ratio in summary['emotion_mix'].items()])
            text += f"- 情绪组合: {mix_text}\n"
        
        return text