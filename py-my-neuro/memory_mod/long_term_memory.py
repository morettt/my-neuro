import json
import os
import hashlib
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import sqlite3
import threading

class LongTermMemorySystem:
    """长期记忆系统 - 持久化存储用户信息、对话历史和重要事件"""
    
    def __init__(self, db_path="memory_mod/long_term_memory.db"):
        self.db_path = db_path
        self.lock = threading.Lock()
        self._init_database()
        
    def _init_database(self):
        """初始化数据库"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # 用户信息表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS user_info (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,
                    value TEXT NOT NULL,
                    category TEXT DEFAULT 'general',
                    importance INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 对话历史表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS conversation_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_message TEXT,
                    ai_response TEXT,
                    emotion_state TEXT,
                    importance INTEGER DEFAULT 1,
                    session_id TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 重要事件表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS important_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    description TEXT NOT NULL,
                    context TEXT,
                    importance INTEGER DEFAULT 1,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 情绪历史表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS emotion_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    emotion TEXT NOT NULL,
                    intensity REAL DEFAULT 0.5,
                    trigger_event TEXT,
                    duration INTEGER DEFAULT 0,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            conn.commit()
    
    def store_user_info(self, key: str, value: str, category: str = "general", importance: int = 1):
        """存储用户信息"""
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT OR REPLACE INTO user_info (key, value, category, importance, updated_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', (key, value, category, importance))
                conn.commit()
    
    def get_user_info(self, key: str = None, category: str = None) -> List[Dict]:
        """获取用户信息"""
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                if key:
                    cursor.execute('SELECT * FROM user_info WHERE key = ?', (key,))
                elif category:
                    cursor.execute('SELECT * FROM user_info WHERE category = ? ORDER BY importance DESC', (category,))
                else:
                    cursor.execute('SELECT * FROM user_info ORDER BY importance DESC, updated_at DESC')
                
                columns = [col[0] for col in cursor.description]
                return [dict(zip(columns, row)) for row in cursor.fetchall()]
    
    def store_conversation(self, user_message: str, ai_response: str, emotion_state: str = "", 
                          importance: int = 1, session_id: str = None):
        """存储对话历史"""
        if not session_id:
            session_id = datetime.now().strftime("%Y%m%d_%H")
            
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO conversation_history (user_message, ai_response, emotion_state, importance, session_id)
                    VALUES (?, ?, ?, ?, ?)
                ''', (user_message, ai_response, emotion_state, importance, session_id))
                conn.commit()
    
    def get_recent_conversations(self, limit: int = 10, session_id: str = None) -> List[Dict]:
        """获取最近的对话历史"""
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                if session_id:
                    cursor.execute('''
                        SELECT * FROM conversation_history 
                        WHERE session_id = ? 
                        ORDER BY timestamp DESC LIMIT ?
                    ''', (session_id, limit))
                else:
                    cursor.execute('''
                        SELECT * FROM conversation_history 
                        ORDER BY timestamp DESC LIMIT ?
                    ''', (limit,))
                
                columns = [col[0] for col in cursor.description]
                return [dict(zip(columns, row)) for row in cursor.fetchall()]
    
    def store_important_event(self, event_type: str, description: str, context: str = "", importance: int = 1):
        """存储重要事件"""
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO important_events (event_type, description, context, importance)
                    VALUES (?, ?, ?, ?)
                ''', (event_type, description, context, importance))
                conn.commit()
    
    def get_important_events(self, event_type: str = None, limit: int = 20) -> List[Dict]:
        """获取重要事件"""
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                if event_type:
                    cursor.execute('''
                        SELECT * FROM important_events 
                        WHERE event_type = ? 
                        ORDER BY importance DESC, timestamp DESC LIMIT ?
                    ''', (event_type, limit))
                else:
                    cursor.execute('''
                        SELECT * FROM important_events 
                        ORDER BY importance DESC, timestamp DESC LIMIT ?
                    ''', (limit,))
                
                columns = [col[0] for col in cursor.description]
                return [dict(zip(columns, row)) for row in cursor.fetchall()]
    
    def store_emotion_event(self, emotion: str, intensity: float = 0.5, trigger_event: str = "", duration: int = 0):
        """存储情绪事件"""
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO emotion_history (emotion, intensity, trigger_event, duration)
                    VALUES (?, ?, ?, ?)
                ''', (emotion, intensity, trigger_event, duration))
                conn.commit()
    
    def get_emotion_history(self, emotion: str = None, days: int = 30) -> List[Dict]:
        """获取情绪历史"""
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                past_date = datetime.now() - timedelta(days=days)
                
                if emotion:
                    cursor.execute('''
                        SELECT * FROM emotion_history 
                        WHERE emotion = ? AND timestamp >= ? 
                        ORDER BY timestamp DESC
                    ''', (emotion, past_date))
                else:
                    cursor.execute('''
                        SELECT * FROM emotion_history 
                        WHERE timestamp >= ? 
                        ORDER BY timestamp DESC
                    ''', (past_date,))
                
                columns = [col[0] for col in cursor.description]
                return [dict(zip(columns, row)) for row in cursor.fetchall()]
    
    def search_memories(self, keywords: List[str], limit: int = 10) -> Dict[str, List[Dict]]:
        """基于关键词搜索记忆"""
        results = {
            'user_info': [],
            'conversations': [],
            'events': []
        }
        
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # 搜索用户信息
                for keyword in keywords:
                    cursor.execute('''
                        SELECT * FROM user_info 
                        WHERE key LIKE ? OR value LIKE ? 
                        ORDER BY importance DESC
                    ''', (f'%{keyword}%', f'%{keyword}%'))
                    columns = [col[0] for col in cursor.description]
                    results['user_info'].extend([dict(zip(columns, row)) for row in cursor.fetchall()])
                
                # 搜索对话历史
                for keyword in keywords:
                    cursor.execute('''
                        SELECT * FROM conversation_history 
                        WHERE user_message LIKE ? OR ai_response LIKE ? 
                        ORDER BY importance DESC, timestamp DESC LIMIT ?
                    ''', (f'%{keyword}%', f'%{keyword}%', limit))
                    columns = [col[0] for col in cursor.description]
                    results['conversations'].extend([dict(zip(columns, row)) for row in cursor.fetchall()])
                
                # 搜索重要事件
                for keyword in keywords:
                    cursor.execute('''
                        SELECT * FROM important_events 
                        WHERE description LIKE ? OR context LIKE ? 
                        ORDER BY importance DESC, timestamp DESC LIMIT ?
                    ''', (f'%{keyword}%', f'%{keyword}%', limit))
                    columns = [col[0] for col in cursor.description]
                    results['events'].extend([dict(zip(columns, row)) for row in cursor.fetchall()])
        
        # 去重
        for key in results:
            seen = set()
            unique_results = []
            for item in results[key]:
                item_id = item.get('id')
                if item_id not in seen:
                    seen.add(item_id)
                    unique_results.append(item)
            results[key] = unique_results[:limit]
        
        return results
    
    def get_memory_summary(self) -> Dict[str, Any]:
        """获取记忆系统摘要"""
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # 统计信息
                cursor.execute('SELECT COUNT(*) FROM user_info')
                user_info_count = cursor.fetchone()[0]
                
                cursor.execute('SELECT COUNT(*) FROM conversation_history')
                conversation_count = cursor.fetchone()[0]
                
                cursor.execute('SELECT COUNT(*) FROM important_events')
                events_count = cursor.fetchone()[0]
                
                cursor.execute('SELECT COUNT(*) FROM emotion_history')
                emotion_count = cursor.fetchone()[0]
                
                # 最近活跃情绪
                cursor.execute('''
                    SELECT emotion, COUNT(*) as count 
                    FROM emotion_history 
                    WHERE timestamp >= datetime('now', '-7 days')
                    GROUP BY emotion 
                    ORDER BY count DESC LIMIT 5
                ''')
                recent_emotions = cursor.fetchall()
                
                return {
                    'total_user_info': user_info_count,
                    'total_conversations': conversation_count,
                    'total_events': events_count,
                    'total_emotions': emotion_count,
                    'recent_emotions': recent_emotions,
                    'last_updated': datetime.now().isoformat()
                }
    
    def cleanup_old_data(self, days: int = 90):
        """清理旧数据（保留重要度高的）"""
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                past_date = datetime.now() - timedelta(days=days)
                
                # 清理低重要度的旧对话
                cursor.execute('''
                    DELETE FROM conversation_history 
                    WHERE timestamp < ? AND importance <= 1
                ''', (past_date,))
                
                # 清理旧的情绪记录
                cursor.execute('''
                    DELETE FROM emotion_history 
                    WHERE timestamp < ?
                ''', (past_date,))
                
                conn.commit()
                print(f"🧹 清理了 {days} 天前的低重要度数据")

class MemoryManager:
    """记忆管理器 - 整合长期记忆系统到主程序"""
    
    def __init__(self):
        self.memory_system = LongTermMemorySystem()
        self.current_session_id = datetime.now().strftime("%Y%m%d_%H")
        
    def process_user_input(self, user_text: str):
        """处理用户输入，提取和存储有用信息"""
        # 分析用户输入中的个人信息
        self._extract_user_info(user_text)
        
    def process_ai_response(self, user_text: str, ai_response: str, emotion_state: str = ""):
        """处理AI响应，存储对话历史"""
        # 判断对话重要性
        importance = self._calculate_importance(user_text, ai_response)
        
        # 存储对话
        self.memory_system.store_conversation(
            user_text, ai_response, emotion_state, importance, self.current_session_id
        )
        
        # 提取重要事件
        self._extract_important_events(user_text, ai_response)
    
    def _extract_user_info(self, text: str):
        """从文本中提取用户信息"""
        # 简单的信息提取逻辑（可以后续优化使用NLP）
        
        # 姓名检测
        if any(phrase in text for phrase in ["我叫", "我的名字是", "我是"]):
            # 这里可以添加更复杂的姓名提取逻辑
            pass
            
        # 年龄检测
        if any(phrase in text for phrase in ["我今年", "岁", "年龄"]):
            # 年龄提取逻辑
            pass
            
        # 兴趣爱好检测
        if any(phrase in text for phrase in ["我喜欢", "我爱好", "我的兴趣"]):
            self.memory_system.store_user_info("interests", text, "personal", 2)
    
    def _extract_important_events(self, user_text: str, ai_response: str):
        """提取重要事件"""
        # 检测特殊事件关键词
        event_keywords = {
            "celebration": ["生日", "节日", "庆祝", "纪念"],
            "achievement": ["成功", "完成", "获得", "达成"],
            "emotion": ["开心", "难过", "生气", "兴奋", "紧张"],
            "plan": ["计划", "打算", "准备", "想要"]
        }
        
        for event_type, keywords in event_keywords.items():
            if any(keyword in user_text for keyword in keywords):
                self.memory_system.store_important_event(
                    event_type, user_text, ai_response, 2
                )
    
    def _calculate_importance(self, user_text: str, ai_response: str) -> int:
        """计算对话重要性"""
        importance = 1
        
        # 包含个人信息的对话更重要
        personal_keywords = ["我的", "我是", "我叫", "我家", "我工作"]
        if any(keyword in user_text for keyword in personal_keywords):
            importance += 1
            
        # 情绪相关的对话更重要
        emotion_keywords = ["开心", "难过", "生气", "害怕", "兴奋", "紧张"]
        if any(keyword in user_text or keyword in ai_response for keyword in emotion_keywords):
            importance += 1
            
        # 长对话更重要
        if len(user_text) > 50 or len(ai_response) > 100:
            importance += 1
            
        return min(importance, 5)  # 最大重要性为5
    
    def get_context_for_ai(self, user_text: str) -> str:
        """为AI提供相关的记忆上下文"""
        # 搜索相关记忆
        keywords = user_text.split()[:3]  # 取前3个关键词
        memories = self.memory_system.search_memories(keywords, limit=5)
        
        context_parts = []
        
        # 用户信息上下文
        if memories['user_info']:
            user_info = [f"{item['key']}: {item['value']}" for item in memories['user_info'][:3]]
            context_parts.append("用户信息: " + "; ".join(user_info))
        
        # 相关对话上下文
        if memories['conversations']:
            recent_conv = memories['conversations'][0]
            context_parts.append(f"相关历史: {recent_conv['user_message']} -> {recent_conv['ai_response']}")
        
        # 重要事件上下文
        if memories['events']:
            recent_event = memories['events'][0]
            context_parts.append(f"重要事件: {recent_event['description']}")
        
        if context_parts:
            return "记忆上下文: " + " | ".join(context_parts)
        
        return ""
    
    def store_emotion_event(self, emotion: str, intensity: float = 0.5, trigger: str = ""):
        """存储情绪事件"""
        self.memory_system.store_emotion_event(emotion, intensity, trigger)
    
    def get_memory_summary(self) -> str:
        """获取记忆摘要文本"""
        summary = self.memory_system.get_memory_summary()
        
        text = f"📚 记忆系统状态:\n"
        text += f"- 用户信息: {summary['total_user_info']} 条\n"
        text += f"- 对话记录: {summary['total_conversations']} 条\n"
        text += f"- 重要事件: {summary['total_events']} 条\n"
        text += f"- 情绪记录: {summary['total_emotions']} 条\n"
        
        if summary['recent_emotions']:
            emotions = ", ".join([f"{emotion}({count}次)" for emotion, count in summary['recent_emotions']])
            text += f"- 近期情绪: {emotions}"
        
        return text