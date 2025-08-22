import json
import os
import time
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from enum import Enum

class TeachingMode(Enum):
    """教学模式枚举"""
    LECTURE = "讲座模式"      # 连续讲解
    INTERACTIVE = "互动模式"   # 问答式
    PRACTICE = "练习模式"     # 实践操作
    REVIEW = "复习模式"       # 知识回顾

class TeachingSubject(Enum):
    """教学科目枚举"""
    PROGRAMMING = "编程"
    LANGUAGE = "语言学习"
    MATH = "数学"
    SCIENCE = "科学"
    HISTORY = "历史"
    LITERATURE = "文学"
    PHILOSOPHY = "哲学"
    TECHNOLOGY = "技术"
    LIFE_SKILLS = "生活技能"
    CUSTOM = "自定义"

@dataclass
class TeachingSession:
    """教学会话数据类"""
    session_id: str
    subject: str
    topic: str
    mode: TeachingMode
    start_time: float
    end_time: Optional[float]
    progress: Dict[str, Any]
    questions_asked: List[str]
    student_responses: List[Dict[str, Any]]
    teaching_materials: List[str]
    current_step: int
    total_steps: int
    
    def to_dict(self):
        return asdict(self)

class AITeachingSystem:
    """AI讲课系统 - 结构化教学与互动问答"""
    
    def __init__(self, knowledge_base_path="teaching_mod/knowledge_base"):
        self.knowledge_base_path = knowledge_base_path
        self.teaching_sessions = {}  # 活跃的教学会话
        self.knowledge_base = {}     # 知识库
        self.teaching_templates = {} # 教学模板
        self.student_progress = {}   # 学生进度
        
        # 创建必要目录
        os.makedirs(knowledge_base_path, exist_ok=True)
        
        # 加载知识库和模板
        self.load_knowledge_base()
        self.load_teaching_templates()
        
        print("📚 AI讲课系统已初始化")
    
    def load_knowledge_base(self):
        """加载知识库"""
        kb_file = os.path.join(self.knowledge_base_path, "knowledge_base.json")
        try:
            with open(kb_file, 'r', encoding='utf-8') as f:
                self.knowledge_base = json.load(f)
        except FileNotFoundError:
            # 创建默认知识库
            self.knowledge_base = self._create_default_knowledge_base()
            self.save_knowledge_base()
    
    def load_teaching_templates(self):
        """加载教学模板"""
        template_file = os.path.join(self.knowledge_base_path, "teaching_templates.json")
        try:
            with open(template_file, 'r', encoding='utf-8') as f:
                self.teaching_templates = json.load(f)
        except FileNotFoundError:
            # 创建默认教学模板
            self.teaching_templates = self._create_default_templates()
            self.save_teaching_templates()
    
    def _create_default_knowledge_base(self):
        """创建默认知识库"""
        return {
            "编程": {
                "Python基础": {
                    "概述": "Python是一种简单易学的编程语言",
                    "知识点": [
                        "变量和数据类型",
                        "条件语句",
                        "循环结构",
                        "函数定义",
                        "类和对象"
                    ],
                    "练习题": [
                        "编写一个计算两个数之和的函数",
                        "使用循环打印1到10的数字",
                        "创建一个简单的学生类"
                    ],
                    "难度级别": "初级"
                },
                "Web开发": {
                    "概述": "使用Python进行Web应用开发",
                    "知识点": [
                        "HTTP协议基础",
                        "Flask框架",
                        "模板引擎",
                        "数据库操作",
                        "API设计"
                    ],
                    "练习题": [
                        "创建一个简单的博客系统",
                        "实现用户登录功能",
                        "设计REST API"
                    ],
                    "难度级别": "中级"
                }
            },
            "数学": {
                "微积分": {
                    "概述": "微积分是数学的重要分支，研究变化率和积累",
                    "知识点": [
                        "极限的概念",
                        "导数的定义",
                        "积分的应用",
                        "微分方程"
                    ],
                    "练习题": [
                        "计算函数f(x)=x²的导数",
                        "求解简单的微分方程",
                        "应用积分计算面积"
                    ],
                    "难度级别": "高级"
                }
            },
            "语言学习": {
                "英语语法": {
                    "概述": "英语语法是英语学习的基础",
                    "知识点": [
                        "时态系统",
                        "从句结构",
                        "语态变化",
                        "词汇搭配"
                    ],
                    "练习题": [
                        "将句子改为被动语态",
                        "使用正确的时态填空",
                        "翻译复杂句子"
                    ],
                    "难度级别": "中级"
                }
            }
        }
    
    def _create_default_templates(self):
        """创建默认教学模板"""
        return {
            "lecture_template": {
                "introduction": "今天我们来学习{topic}。{overview}",
                "main_content": "首先，让我们了解{concept}。{explanation}",
                "examples": "举个例子：{example}",
                "practice": "现在我们来做个练习：{exercise}",
                "summary": "总结一下，我们今天学习了{key_points}",
                "homework": "课后请练习：{homework_tasks}"
            },
            "interactive_template": {
                "question_types": [
                    "什么是{concept}？",
                    "你能举个{topic}的例子吗？",
                    "你认为{scenario}应该如何处理？",
                    "请解释{term}的含义"
                ],
                "encouragement": [
                    "很好！你理解得很正确。",
                    "不错的思路！我们继续深入。",
                    "这个回答很有见地！",
                    "让我们从另一个角度来看这个问题。"
                ],
                "correction": [
                    "这个理解有些偏差，让我重新解释一下。",
                    "你的想法很好，但是还需要考虑{point}。",
                    "几乎正确！只是{detail}需要调整。"
                ]
            }
        }
    
    def save_knowledge_base(self):
        """保存知识库"""
        kb_file = os.path.join(self.knowledge_base_path, "knowledge_base.json")
        with open(kb_file, 'w', encoding='utf-8') as f:
            json.dump(self.knowledge_base, f, ensure_ascii=False, indent=2)
    
    def save_teaching_templates(self):
        """保存教学模板"""
        template_file = os.path.join(self.knowledge_base_path, "teaching_templates.json")
        with open(template_file, 'w', encoding='utf-8') as f:
            json.dump(self.teaching_templates, f, ensure_ascii=False, indent=2)
    
    def start_teaching_session(self, subject: str, topic: str, mode: TeachingMode = TeachingMode.INTERACTIVE) -> str:
        """开始教学会话"""
        session_id = f"teach_{int(time.time())}"
        
        # 检查知识库中是否有相关内容
        knowledge = self._get_topic_knowledge(subject, topic)
        if not knowledge:
            return None
        
        # 创建教学会话
        session = TeachingSession(
            session_id=session_id,
            subject=subject,
            topic=topic,
            mode=mode,
            start_time=time.time(),
            end_time=None,
            progress={
                "current_section": 0,
                "completed_exercises": [],
                "understanding_level": 0.5
            },
            questions_asked=[],
            student_responses=[],
            teaching_materials=knowledge.get("知识点", []),
            current_step=0,
            total_steps=len(knowledge.get("知识点", []))
        )
        
        self.teaching_sessions[session_id] = session
        
        print(f"📖 开始教学会话: {subject} - {topic} ({mode.value})")
        return session_id
    
    def get_teaching_content(self, session_id: str) -> Optional[str]:
        """获取教学内容"""
        if session_id not in self.teaching_sessions:
            return None
        
        session = self.teaching_sessions[session_id]
        knowledge = self._get_topic_knowledge(session.subject, session.topic)
        
        if not knowledge:
            return "抱歉，找不到相关的教学内容。"
        
        if session.mode == TeachingMode.LECTURE:
            return self._generate_lecture_content(session, knowledge)
        elif session.mode == TeachingMode.INTERACTIVE:
            return self._generate_interactive_content(session, knowledge)
        elif session.mode == TeachingMode.PRACTICE:
            return self._generate_practice_content(session, knowledge)
        else:
            return self._generate_review_content(session, knowledge)
    
    def _generate_lecture_content(self, session: TeachingSession, knowledge: Dict) -> str:
        """生成讲座模式内容"""
        template = self.teaching_templates.get("lecture_template", {})
        
        if session.current_step == 0:
            # 介绍阶段
            content = template.get("introduction", "").format(
                topic=session.topic,
                overview=knowledge.get("概述", "")
            )
            session.current_step += 1
        elif session.current_step <= len(session.teaching_materials):
            # 主要内容阶段
            current_point = session.teaching_materials[session.current_step - 1]
            content = template.get("main_content", "").format(
                concept=current_point,
                explanation=f"关于{current_point}的详细说明..."
            )
            session.current_step += 1
        else:
            # 总结阶段
            content = template.get("summary", "").format(
                key_points=", ".join(session.teaching_materials)
            )
            session.end_time = time.time()
        
        return content
    
    def _generate_interactive_content(self, session: TeachingSession, knowledge: Dict) -> str:
        """生成互动模式内容"""
        template = self.teaching_templates.get("interactive_template", {})
        
        if session.current_step == 0:
            # 开场介绍
            content = f"我们来互动学习{session.topic}！{knowledge.get('概述', '')}\n\n"
            content += "我会问你一些问题来检查理解程度。准备好了吗？"
            session.current_step += 1
        elif session.current_step <= len(session.teaching_materials):
            # 提问阶段
            current_point = session.teaching_materials[session.current_step - 1]
            questions = template.get("question_types", [])
            if questions:
                import random
                question_template = random.choice(questions)
                content = question_template.format(
                    concept=current_point,
                    topic=session.topic,
                    term=current_point
                )
                session.questions_asked.append(content)
            else:
                content = f"请解释一下{current_point}是什么？"
        else:
            # 结束阶段
            content = f"很好！我们已经学完了{session.topic}的主要内容。"
            if knowledge.get("练习题"):
                content += f"\n\n建议你练习以下题目：\n"
                for i, exercise in enumerate(knowledge["练习题"], 1):
                    content += f"{i}. {exercise}\n"
            session.end_time = time.time()
        
        return content
    
    def _generate_practice_content(self, session: TeachingSession, knowledge: Dict) -> str:
        """生成练习模式内容"""
        exercises = knowledge.get("练习题", [])
        if not exercises:
            return "抱歉，这个主题暂时没有练习题。"
        
        if session.current_step < len(exercises):
            exercise = exercises[session.current_step]
            content = f"练习题 {session.current_step + 1}: {exercise}\n\n"
            content += "请尝试解答，我会给你反馈。"
            session.current_step += 1
        else:
            content = "所有练习题都完成了！你做得很好。"
            session.end_time = time.time()
        
        return content
    
    def _generate_review_content(self, session: TeachingSession, knowledge: Dict) -> str:
        """生成复习模式内容"""
        if session.current_step == 0:
            content = f"让我们复习一下{session.topic}的要点：\n\n"
            for i, point in enumerate(session.teaching_materials, 1):
                content += f"{i}. {point}\n"
            content += "\n你对哪个部分还有疑问吗？"
            session.current_step += 1
        else:
            content = "复习完成！如果有任何疑问，随时可以问我。"
            session.end_time = time.time()
        
        return content
    
    def process_student_response(self, session_id: str, response: str) -> str:
        """处理学生回答"""
        if session_id not in self.teaching_sessions:
            return "找不到对应的教学会话。"
        
        session = self.teaching_sessions[session_id]
        
        # 记录学生回答
        session.student_responses.append({
            "response": response,
            "timestamp": time.time(),
            "question_index": len(session.questions_asked) - 1 if session.questions_asked else -1
        })
        
        # 分析回答质量
        understanding_score = self._analyze_response_quality(response, session)
        session.progress["understanding_level"] = (
            session.progress["understanding_level"] + understanding_score
        ) / 2
        
        # 生成反馈
        feedback = self._generate_feedback(response, understanding_score, session)
        
        # 继续下一步教学
        if session.current_step < session.total_steps:
            next_content = self.get_teaching_content(session_id)
            feedback += f"\n\n{next_content}"
        
        return feedback
    
    def _analyze_response_quality(self, response: str, session: TeachingSession) -> float:
        """分析回答质量"""
        # 简单的启发式分析（可以后续使用AI模型改进）
        score = 0.5  # 基础分数
        
        # 长度分析
        if len(response) > 10:
            score += 0.1
        if len(response) > 50:
            score += 0.1
        
        # 关键词匹配
        knowledge = self._get_topic_knowledge(session.subject, session.topic)
        if knowledge:
            key_terms = session.teaching_materials
            for term in key_terms:
                if term.lower() in response.lower():
                    score += 0.15
        
        # 积极态度检测
        positive_words = ["明白", "理解", "懂了", "学会", "掌握", "清楚"]
        if any(word in response for word in positive_words):
            score += 0.1
        
        return min(1.0, score)
    
    def _generate_feedback(self, response: str, score: float, session: TeachingSession) -> str:
        """生成反馈"""
        template = self.teaching_templates.get("interactive_template", {})
        
        if score >= 0.8:
            feedbacks = template.get("encouragement", ["很好！"])
            import random
            return random.choice(feedbacks)
        elif score >= 0.5:
            return "不错的回答，让我们继续深入学习。"
        else:
            feedbacks = template.get("correction", ["让我们重新看看这个问题。"])
            import random
            base_feedback = random.choice(feedbacks)
            
            # 提供额外解释
            knowledge = self._get_topic_knowledge(session.subject, session.topic)
            if knowledge and session.current_step > 0:
                current_point = session.teaching_materials[session.current_step - 1]
                base_feedback += f"\n\n关于{current_point}，重要的是要理解..."
            
            return base_feedback
    
    def _get_topic_knowledge(self, subject: str, topic: str) -> Optional[Dict]:
        """获取主题知识"""
        return self.knowledge_base.get(subject, {}).get(topic)
    
    def add_custom_knowledge(self, subject: str, topic: str, knowledge_data: Dict):
        """添加自定义知识"""
        if subject not in self.knowledge_base:
            self.knowledge_base[subject] = {}
        
        self.knowledge_base[subject][topic] = knowledge_data
        self.save_knowledge_base()
        
        print(f"📝 已添加自定义知识: {subject} - {topic}")
    
    def get_available_subjects(self) -> List[str]:
        """获取可用的科目列表"""
        return list(self.knowledge_base.keys())
    
    def get_available_topics(self, subject: str) -> List[str]:
        """获取指定科目的主题列表"""
        return list(self.knowledge_base.get(subject, {}).keys())
    
    def get_session_progress(self, session_id: str) -> Optional[Dict]:
        """获取会话进度"""
        if session_id not in self.teaching_sessions:
            return None
        
        session = self.teaching_sessions[session_id]
        return {
            "progress_percentage": (session.current_step / session.total_steps * 100) if session.total_steps > 0 else 0,
            "understanding_level": session.progress["understanding_level"],
            "questions_asked": len(session.questions_asked),
            "responses_given": len(session.student_responses),
            "duration_minutes": (time.time() - session.start_time) / 60,
            "status": "completed" if session.end_time else "active"
        }
    
    def end_teaching_session(self, session_id: str) -> str:
        """结束教学会话"""
        if session_id not in self.teaching_sessions:
            return "找不到对应的教学会话。"
        
        session = self.teaching_sessions[session_id]
        session.end_time = time.time()
        
        # 生成学习报告
        duration = session.end_time - session.start_time
        report = f"📊 学习报告 - {session.subject}: {session.topic}\n\n"
        report += f"- 学习时长: {duration/60:.1f} 分钟\n"
        report += f"- 完成进度: {session.current_step}/{session.total_steps}\n"
        report += f"- 理解程度: {session.progress['understanding_level']*100:.1f}%\n"
        report += f"- 问答次数: {len(session.student_responses)}\n"
        
        if session.progress['understanding_level'] >= 0.8:
            report += "\n🎉 恭喜！你对这个主题掌握得很好！"
        elif session.progress['understanding_level'] >= 0.6:
            report += "\n👍 不错！建议继续练习巩固知识。"
        else:
            report += "\n💪 建议复习相关内容，多做练习。"
        
        # 移除会话（可选择保留到历史记录）
        del self.teaching_sessions[session_id]
        
        return report
    
    def get_teaching_summary(self) -> str:
        """获取教学系统摘要"""
        active_sessions = len(self.teaching_sessions)
        total_subjects = len(self.knowledge_base)
        total_topics = sum(len(topics) for topics in self.knowledge_base.values())
        
        text = f"📚 AI讲课系统状态:\n"
        text += f"- 活跃教学会话: {active_sessions}\n"
        text += f"- 可用科目: {total_subjects}\n"
        text += f"- 总主题数: {total_topics}\n"
        
        if self.knowledge_base:
            text += f"- 科目列表: {', '.join(self.knowledge_base.keys())}"
        
        return text

class TeachingTools:
    """教学工具类 - 提供给Agent使用的教学功能"""
    
    def __init__(self):
        self.teaching_system = AITeachingSystem()
        self.current_session = None
    
    def start_lesson(self, subject: str, topic: str, mode: str = "互动模式") -> str:
        """开始课程"""
        mode_map = {
            "讲座模式": TeachingMode.LECTURE,
            "互动模式": TeachingMode.INTERACTIVE,
            "练习模式": TeachingMode.PRACTICE,
            "复习模式": TeachingMode.REVIEW
        }
        
        teaching_mode = mode_map.get(mode, TeachingMode.INTERACTIVE)
        session_id = self.teaching_system.start_teaching_session(subject, topic, teaching_mode)
        
        if session_id:
            self.current_session = session_id
            content = self.teaching_system.get_teaching_content(session_id)
            return f"🎓 开始{mode}学习！\n\n{content}"
        else:
            available_subjects = self.teaching_system.get_available_subjects()
            return f"❌ 找不到相关教学内容。\n\n可用科目: {', '.join(available_subjects)}"
    
    def continue_lesson(self, student_response: str = "") -> str:
        """继续课程"""
        if not self.current_session:
            return "❌ 没有活跃的教学会话。请先开始一个课程。"
        
        if student_response:
            # 处理学生回答
            feedback = self.teaching_system.process_student_response(self.current_session, student_response)
            return feedback
        else:
            # 继续下一部分
            content = self.teaching_system.get_teaching_content(self.current_session)
            return content or "课程已完成！"
    
    def end_lesson(self) -> str:
        """结束课程"""
        if not self.current_session:
            return "❌ 没有活跃的教学会话。"
        
        report = self.teaching_system.end_teaching_session(self.current_session)
        self.current_session = None
        return report
    
    def get_lesson_progress(self) -> str:
        """获取课程进度"""
        if not self.current_session:
            return "❌ 没有活跃的教学会话。"
        
        progress = self.teaching_system.get_session_progress(self.current_session)
        if progress:
            return f"📈 课程进度: {progress['progress_percentage']:.1f}% | 理解度: {progress['understanding_level']*100:.1f}%"
        
        return "无法获取进度信息。"
    
    def list_available_courses(self) -> str:
        """列出可用课程"""
        subjects = self.teaching_system.get_available_subjects()
        
        course_list = "📚 可用课程:\n\n"
        for subject in subjects:
            topics = self.teaching_system.get_available_topics(subject)
            course_list += f"**{subject}**:\n"
            for topic in topics:
                course_list += f"  - {topic}\n"
            course_list += "\n"
        
        return course_list
    
    def add_custom_course(self, subject: str, topic: str, overview: str, 
                         knowledge_points: List[str], exercises: List[str] = None) -> str:
        """添加自定义课程"""
        knowledge_data = {
            "概述": overview,
            "知识点": knowledge_points,
            "练习题": exercises or [],
            "难度级别": "自定义"
        }
        
        self.teaching_system.add_custom_knowledge(subject, topic, knowledge_data)
        return f"✅ 已成功添加自定义课程: {subject} - {topic}"