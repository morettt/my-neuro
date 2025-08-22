import json
import random
import time
import threading
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from enum import Enum

class GameType(Enum):
    """游戏类型枚举"""
    GUESS_DRAW = "你画我猜"
    WORD_GAME = "文字游戏"
    RIDDLE = "猜谜游戏"
    STORY_GAME = "故事接龙"
    TRIVIA = "知识问答"
    TWENTY_QUESTIONS = "二十个问题"
    ROCK_PAPER_SCISSORS = "石头剪刀布"
    NUMBER_GUESS = "猜数字"

class GameState(Enum):
    """游戏状态枚举"""
    NOT_STARTED = "未开始"
    IN_PROGRESS = "进行中"
    PAUSED = "暂停"
    COMPLETED = "已完成"
    ABORTED = "已中止"

@dataclass
class GameSession:
    """游戏会话数据类"""
    session_id: str
    game_type: GameType
    state: GameState
    start_time: float
    end_time: Optional[float]
    players: List[str]
    current_turn: int
    game_data: Dict[str, Any]
    score: Dict[str, int]
    moves_history: List[Dict[str, Any]]
    
    def to_dict(self):
        return asdict(self)

class GameCompanionSystem:
    """游戏陪玩系统 - 支持多种互动游戏"""
    
    def __init__(self, games_data_path="game_mod/games_data.json"):
        self.games_data_path = games_data_path
        self.active_sessions = {}  # 活跃的游戏会话
        self.game_rules = {}       # 游戏规则
        self.game_data = {}        # 游戏数据（题库、词库等）
        
        # 加载游戏数据和规则
        self.load_game_data()
        self.initialize_game_rules()
        
        print("🎮 游戏陪玩系统已初始化")
    
    def load_game_data(self):
        """加载游戏数据"""
        try:
            with open(self.games_data_path, 'r', encoding='utf-8') as f:
                self.game_data = json.load(f)
        except FileNotFoundError:
            # 创建默认游戏数据
            self.game_data = self._create_default_game_data()
            self.save_game_data()
    
    def save_game_data(self):
        """保存游戏数据"""
        import os
        os.makedirs(os.path.dirname(self.games_data_path), exist_ok=True)
        
        with open(self.games_data_path, 'w', encoding='utf-8') as f:
            json.dump(self.game_data, f, ensure_ascii=False, indent=2)
    
    def _create_default_game_data(self):
        """创建默认游戏数据"""
        return {
            "你画我猜": {
                "words": [
                    "苹果", "汽车", "房子", "猫咪", "太阳", "书籍", "手机", "花朵",
                    "飞机", "蝴蝶", "雨伞", "眼镜", "音乐", "游泳", "跳舞", "画画",
                    "电脑", "咖啡", "蛋糕", "足球", "吉他", "电视", "钟表", "鞋子"
                ],
                "categories": {
                    "动物": ["猫", "狗", "鸟", "鱼", "兔子", "老虎", "大象", "熊猫"],
                    "水果": ["苹果", "香蕉", "橙子", "葡萄", "草莓", "西瓜", "桃子"],
                    "交通工具": ["汽车", "飞机", "火车", "自行车", "船", "摩托车"]
                }
            },
            "知识问答": {
                "categories": {
                    "科学": [
                        {"question": "地球上最大的哺乳动物是什么？", "answer": "蓝鲸", "options": ["蓝鲸", "大象", "鲸鱼", "河马"]},
                        {"question": "一年有多少天？", "answer": "365天", "options": ["364天", "365天", "366天", "367天"]},
                        {"question": "太阳系有几颗行星？", "answer": "8颗", "options": ["7颗", "8颗", "9颗", "10颗"]}
                    ],
                    "历史": [
                        {"question": "中国的首都是哪里？", "answer": "北京", "options": ["上海", "北京", "广州", "深圳"]},
                        {"question": "万里长城建于哪个朝代？", "answer": "秦朝", "options": ["汉朝", "唐朝", "秦朝", "明朝"]}
                    ],
                    "文学": [
                        {"question": "《红楼梦》的作者是谁？", "answer": "曹雪芹", "options": ["曹雪芹", "施耐庵", "吴承恩", "罗贯中"]},
                        {"question": "李白被称为什么？", "answer": "诗仙", "options": ["诗圣", "诗仙", "诗鬼", "诗佛"]}
                    ]
                }
            },
            "猜谜游戏": {
                "riddles": [
                    {"riddle": "有时圆，有时弯，有时亮，有时暗。远看像个白玉盘，近看什么都不见。", "answer": "月亮"},
                    {"riddle": "千条线，万条线，掉在水里看不见。", "answer": "雨"},
                    {"riddle": "红红脸，圆又圆，亲一口，脆又甜。", "answer": "苹果"},
                    {"riddle": "身穿绿衣裳，肚里水汪汪，生的子儿多，个个黑脸膛。", "answer": "西瓜"}
                ]
            },
            "文字游戏": {
                "word_chains": {
                    "动物": ["猫", "狗", "鸟", "鱼", "熊", "虎", "兔", "马"],
                    "颜色": ["红", "橙", "黄", "绿", "蓝", "紫", "黑", "白"],
                    "食物": ["米", "面", "肉", "菜", "果", "茶", "酒", "水"]
                },
                "成语": [
                    "一心一意", "三心二意", "四面八方", "五光十色", "六神无主",
                    "七上八下", "九牛一毛", "十全十美", "百发百中", "千里迢迢"
                ]
            }
        }
    
    def initialize_game_rules(self):
        """初始化游戏规则"""
        self.game_rules = {
            GameType.GUESS_DRAW: {
                "max_players": 2,
                "turn_time_limit": 180,  # 3分钟
                "max_rounds": 5,
                "description": "一个人画画，另一个人猜词语"
            },
            GameType.TRIVIA: {
                "max_players": 2,
                "turn_time_limit": 30,   # 30秒
                "max_rounds": 10,
                "description": "回答各种知识问题"
            },
            GameType.RIDDLE: {
                "max_players": 2,
                "turn_time_limit": 60,   # 1分钟
                "max_rounds": 5,
                "description": "猜谜语游戏"
            },
            GameType.WORD_GAME: {
                "max_players": 2,
                "turn_time_limit": 45,   # 45秒
                "max_rounds": 10,
                "description": "文字接龙或成语游戏"
            },
            GameType.STORY_GAME: {
                "max_players": 2,
                "turn_time_limit": 120,  # 2分钟
                "max_rounds": 6,
                "description": "轮流接故事"
            },
            GameType.ROCK_PAPER_SCISSORS: {
                "max_players": 2,
                "turn_time_limit": 10,   # 10秒
                "max_rounds": 5,
                "description": "经典石头剪刀布游戏"
            },
            GameType.NUMBER_GUESS: {
                "max_players": 2,
                "turn_time_limit": 60,   # 1分钟
                "max_rounds": 10,
                "description": "猜数字游戏"
            }
        }
    
    def start_game(self, game_type: GameType, player_name: str = "用户") -> str:
        """开始游戏"""
        session_id = f"game_{int(time.time())}"
        
        # 创建游戏会话
        session = GameSession(
            session_id=session_id,
            game_type=game_type,
            state=GameState.IN_PROGRESS,
            start_time=time.time(),
            end_time=None,
            players=[player_name, "肥牛"],
            current_turn=0,
            game_data={
                "round": 1,
                "max_rounds": self.game_rules[game_type]["max_rounds"],
                "current_question": None,
                "correct_answer": None,
                "hints_used": 0
            },
            score={player_name: 0, "肥牛": 0},
            moves_history=[]
        )
        
        self.active_sessions[session_id] = session
        
        # 生成游戏开始消息
        start_message = self._generate_game_start_message(session)
        
        print(f"🎮 开始游戏: {game_type.value}")
        return start_message
    
    def _generate_game_start_message(self, session: GameSession) -> str:
        """生成游戏开始消息"""
        game_type = session.game_type
        rules = self.game_rules[game_type]
        
        message = f"🎮 {game_type.value} 开始！\n\n"
        message += f"📋 游戏规则: {rules['description']}\n"
        message += f"🔄 总共 {session.game_data['max_rounds']} 轮\n"
        message += f"⏱️ 每轮时间限制: {rules['turn_time_limit']} 秒\n\n"
        
        # 开始第一轮
        first_round = self._start_new_round(session)
        message += first_round
        
        return message
    
    def _start_new_round(self, session: GameSession) -> str:
        """开始新一轮游戏"""
        game_type = session.game_type
        round_num = session.game_data["round"]
        
        if game_type == GameType.TRIVIA:
            return self._start_trivia_round(session)
        elif game_type == GameType.RIDDLE:
            return self._start_riddle_round(session)
        elif game_type == GameType.GUESS_DRAW:
            return self._start_guess_draw_round(session)
        elif game_type == GameType.WORD_GAME:
            return self._start_word_game_round(session)
        elif game_type == GameType.STORY_GAME:
            return self._start_story_round(session)
        elif game_type == GameType.ROCK_PAPER_SCISSORS:
            return self._start_rps_round(session)
        elif game_type == GameType.NUMBER_GUESS:
            return self._start_number_guess_round(session)
        else:
            return f"第 {round_num} 轮开始！"
    
    def _start_trivia_round(self, session: GameSession) -> str:
        """开始知识问答轮"""
        trivia_data = self.game_data.get("知识问答", {})
        categories = trivia_data.get("categories", {})
        
        if not categories:
            return "❌ 没有可用的问答题目。"
        
        # 随机选择分类和问题
        category = random.choice(list(categories.keys()))
        questions = categories[category]
        question_data = random.choice(questions)
        
        session.game_data["current_question"] = question_data
        session.game_data["category"] = category
        
        message = f"🧠 第 {session.game_data['round']} 轮 - {category} 问题:\n\n"
        message += f"❓ {question_data['question']}\n\n"
        
        if "options" in question_data:
            for i, option in enumerate(question_data["options"], 1):
                message += f"{i}. {option}\n"
            message += "\n请选择答案编号或直接说出答案！"
        else:
            message += "请说出你的答案！"
        
        return message
    
    def _start_riddle_round(self, session: GameSession) -> str:
        """开始猜谜轮"""
        riddle_data = self.game_data.get("猜谜游戏", {})
        riddles = riddle_data.get("riddles", [])
        
        if not riddles:
            return "❌ 没有可用的谜语。"
        
        riddle = random.choice(riddles)
        session.game_data["current_question"] = riddle
        
        message = f"🤔 第 {session.game_data['round']} 轮 - 猜谜语:\n\n"
        message += f"🔍 {riddle['riddle']}\n\n"
        message += "请说出你的答案！"
        
        return message
    
    def _start_guess_draw_round(self, session: GameSession) -> str:
        """开始你画我猜轮"""
        draw_data = self.game_data.get("你画我猜", {})
        words = draw_data.get("words", [])
        
        if not words:
            return "❌ 没有可用的词语。"
        
        word = random.choice(words)
        session.game_data["current_word"] = word
        
        # 确定谁画谁猜
        current_player = session.players[session.current_turn % 2]
        
        if current_player == "肥牛":
            # AI画，用户猜
            message = f"🎨 第 {session.game_data['round']} 轮:\n\n"
            message += "我来画，你来猜！\n"
            message += "🖼️ *我正在画一个东西...*\n\n"
            message += f"提示：这是一个{len(word)}字的词语\n"
            message += "你觉得我画的是什么？"
        else:
            # 用户画，AI猜
            message = f"🎨 第 {session.game_data['round']} 轮:\n\n"
            message += f"请你画: **{word}**\n\n"
            message += "画好后告诉我，我来猜！"
        
        return message
    
    def _start_word_game_round(self, session: GameSession) -> str:
        """开始文字游戏轮"""
        word_data = self.game_data.get("文字游戏", {})
        
        # 随机选择游戏类型
        game_modes = ["word_chain", "idiom"]
        mode = random.choice(game_modes)
        
        if mode == "word_chain":
            # 词语接龙
            categories = word_data.get("word_chains", {})
            category = random.choice(list(categories.keys()))
            words = categories[category]
            start_word = random.choice(words)
            
            session.game_data["mode"] = "word_chain"
            session.game_data["category"] = category
            session.game_data["last_word"] = start_word
            
            message = f"🔤 第 {session.game_data['round']} 轮 - 词语接龙 ({category}):\n\n"
            message += f"起始词: **{start_word}**\n\n"
            message += "请说一个相关的词语！"
        else:
            # 成语接龙
            idioms = word_data.get("成语", [])
            start_idiom = random.choice(idioms)
            
            session.game_data["mode"] = "idiom"
            session.game_data["last_word"] = start_idiom
            
            message = f"🀄 第 {session.game_data['round']} 轮 - 成语接龙:\n\n"
            message += f"起始成语: **{start_idiom}**\n\n"
            message += "请说一个成语！"
        
        return message
    
    def _start_story_round(self, session: GameSession) -> str:
        """开始故事接龙轮"""
        # 故事开头
        story_starts = [
            "从前有一个勇敢的小女孩，她住在森林边的小屋里...",
            "在遥远的星球上，有一个神奇的城市...",
            "一个下雨天，小明在路上捡到了一本奇怪的书...",
            "海边的灯塔里住着一位老船长...",
            "魔法学院的新学期开始了，艾米发现自己有特殊能力..."
        ]
        
        if session.game_data["round"] == 1:
            # 第一轮，AI开始故事
            start = random.choice(story_starts)
            session.game_data["story"] = start
            
            message = f"📖 故事接龙 第 {session.game_data['round']} 轮:\n\n"
            message += f"{start}\n\n"
            message += "请继续这个故事！"
        else:
            # 继续之前的故事
            message = f"📖 故事接龙 第 {session.game_data['round']} 轮:\n\n"
            message += f"故事到目前为止:\n{session.game_data.get('story', '')}\n\n"
            message += "请继续故事！"
        
        return message
    
    def _start_rps_round(self, session: GameSession) -> str:
        """开始石头剪刀布轮"""
        message = f"✂️ 第 {session.game_data['round']} 轮 - 石头剪刀布:\n\n"
        message += "请出招：石头 🗿 / 剪刀 ✂️ / 布 📄"
        
        return message
    
    def _start_number_guess_round(self, session: GameSession) -> str:
        """开始猜数字轮"""
        # 生成随机数字
        target_number = random.randint(1, 100)
        session.game_data["target_number"] = target_number
        session.game_data["guesses"] = 0
        session.game_data["max_guesses"] = 7
        
        message = f"🔢 第 {session.game_data['round']} 轮 - 猜数字:\n\n"
        message += "我想了一个1到100之间的数字，你来猜！\n"
        message += f"你有 {session.game_data['max_guesses']} 次机会。\n\n"
        message += "请说出你的第一个猜测！"
        
        return message
    
    def process_player_move(self, session_id: str, player_input: str) -> str:
        """处理玩家输入"""
        if session_id not in self.active_sessions:
            return "❌ 找不到对应的游戏会话。"
        
        session = self.active_sessions[session_id]
        if session.state != GameState.IN_PROGRESS:
            return "❌ 游戏未在进行中。"
        
        # 记录玩家移动
        move = {
            "player": session.players[session.current_turn % 2],
            "input": player_input,
            "timestamp": time.time(),
            "round": session.game_data["round"]
        }
        session.moves_history.append(move)
        
        # 根据游戏类型处理输入
        game_type = session.game_type
        
        if game_type == GameType.TRIVIA:
            result = self._process_trivia_answer(session, player_input)
        elif game_type == GameType.RIDDLE:
            result = self._process_riddle_answer(session, player_input)
        elif game_type == GameType.GUESS_DRAW:
            result = self._process_guess_draw_move(session, player_input)
        elif game_type == GameType.WORD_GAME:
            result = self._process_word_game_move(session, player_input)
        elif game_type == GameType.STORY_GAME:
            result = self._process_story_move(session, player_input)
        elif game_type == GameType.ROCK_PAPER_SCISSORS:
            result = self._process_rps_move(session, player_input)
        elif game_type == GameType.NUMBER_GUESS:
            result = self._process_number_guess_move(session, player_input)
        else:
            result = "未知游戏类型。"
        
        # 检查游戏是否结束
        if session.game_data["round"] > session.game_data["max_rounds"]:
            end_result = self._end_game(session)
            result += f"\n\n{end_result}"
        
        return result
    
    def _process_trivia_answer(self, session: GameSession, answer: str) -> str:
        """处理知识问答答案"""
        question_data = session.game_data["current_question"]
        correct_answer = question_data["answer"]
        
        # 检查答案
        is_correct = False
        answer_lower = answer.lower().strip()
        correct_lower = correct_answer.lower()
        
        # 支持选项编号回答
        if answer.isdigit() and "options" in question_data:
            option_index = int(answer) - 1
            if 0 <= option_index < len(question_data["options"]):
                is_correct = question_data["options"][option_index] == correct_answer
        else:
            # 直接文本匹配
            is_correct = answer_lower in correct_lower or correct_lower in answer_lower
        
        result = ""
        if is_correct:
            session.score[session.players[0]] += 1
            result = f"🎉 正确！答案是：{correct_answer}\n"
            result += f"得分：{session.score[session.players[0]]} 分"
        else:
            result = f"❌ 不正确。正确答案是：{correct_answer}"
        
        # 进入下一轮
        session.game_data["round"] += 1
        session.current_turn += 1
        
        if session.game_data["round"] <= session.game_data["max_rounds"]:
            result += f"\n\n{self._start_new_round(session)}"
        
        return result
    
    def _process_riddle_answer(self, session: GameSession, answer: str) -> str:
        """处理猜谜答案"""
        riddle_data = session.game_data["current_question"]
        correct_answer = riddle_data["answer"]
        
        # 检查答案
        is_correct = answer.strip() == correct_answer or correct_answer in answer
        
        result = ""
        if is_correct:
            session.score[session.players[0]] += 1
            result = f"🎉 正确！答案是：{correct_answer}\n"
            result += f"得分：{session.score[session.players[0]]} 分"
        else:
            # 给提示
            if session.game_data["hints_used"] < 2:
                session.game_data["hints_used"] += 1
                hints = self._generate_riddle_hint(correct_answer, session.game_data["hints_used"])
                result = f"❌ 不对哦。提示 {session.game_data['hints_used']}: {hints}\n\n再猜一次！"
                return result
            else:
                result = f"❌ 不正确。正确答案是：{correct_answer}"
        
        # 进入下一轮
        session.game_data["round"] += 1
        session.current_turn += 1
        session.game_data["hints_used"] = 0
        
        if session.game_data["round"] <= session.game_data["max_rounds"]:
            result += f"\n\n{self._start_new_round(session)}"
        
        return result
    
    def _generate_riddle_hint(self, answer: str, hint_level: int) -> str:
        """生成谜语提示"""
        if hint_level == 1:
            return f"答案有 {len(answer)} 个字"
        elif hint_level == 2:
            if len(answer) > 1:
                return f"答案的第一个字是：{answer[0]}"
            else:
                return f"答案是：{answer[0]}"
        return ""
    
    def _process_guess_draw_move(self, session: GameSession, move: str) -> str:
        """处理你画我猜移动"""
        current_word = session.game_data["current_word"]
        current_player = session.players[session.current_turn % 2]
        
        if current_player == session.players[0]:  # 用户回合
            # 用户猜词
            if move.strip() == current_word or current_word in move:
                session.score[session.players[0]] += 1
                result = f"🎉 猜对了！是 {current_word}！\n"
                result += f"得分：{session.score[session.players[0]]} 分"
            else:
                result = f"❌ 不对哦，再想想！"
                if session.game_data.get("hints_used", 0) < 1:
                    session.game_data["hints_used"] = 1
                    result += f"\n💡 提示：这个词语和{current_word[0]}有关"
                    return result
                else:
                    result += f"\n正确答案是：{current_word}"
        else:  # AI回合
            # AI猜用户的画
            result = f"🤔 让我猜猜...这是 {move} 吗？"
            # 简单模拟AI猜测
            if random.random() > 0.3:  # 70%正确率
                session.score["肥牛"] += 1
                result += f"\n🎉 我猜对了！得分：{session.score['肥牛']} 分"
            else:
                result += f"\n❌ 我猜错了！正确答案是什么？"
        
        # 进入下一轮
        session.game_data["round"] += 1
        session.current_turn += 1
        session.game_data["hints_used"] = 0
        
        if session.game_data["round"] <= session.game_data["max_rounds"]:
            result += f"\n\n{self._start_new_round(session)}"
        
        return result
    
    def _process_rps_move(self, session: GameSession, move: str) -> str:
        """处理石头剪刀布移动"""
        move_map = {
            "石头": "rock", "🗿": "rock",
            "剪刀": "scissors", "✂️": "scissors", 
            "布": "paper", "📄": "paper"
        }
        
        player_move = None
        for key, value in move_map.items():
            if key in move:
                player_move = value
                break
        
        if not player_move:
            return "❌ 无效的输入。请说：石头、剪刀或布"
        
        # AI随机出招
        ai_moves = ["rock", "scissors", "paper"]
        ai_move = random.choice(ai_moves)
        
        # 判断胜负
        result = ""
        if player_move == ai_move:
            result = "🤝 平局！"
        elif (player_move == "rock" and ai_move == "scissors") or \
             (player_move == "scissors" and ai_move == "paper") or \
             (player_move == "paper" and ai_move == "rock"):
            session.score[session.players[0]] += 1
            result = f"🎉 你赢了！"
        else:
            session.score["肥牛"] += 1
            result = f"😄 我赢了！"
        
        # 显示双方出招
        move_display = {
            "rock": "石头🗿", "scissors": "剪刀✂️", "paper": "布📄"
        }
        result += f"\n你：{move_display[player_move]} vs 我：{move_display[ai_move]}"
        result += f"\n当前比分 - 你：{session.score[session.players[0]]} | 我：{session.score['肥牛']}"
        
        # 进入下一轮
        session.game_data["round"] += 1
        session.current_turn += 1
        
        if session.game_data["round"] <= session.game_data["max_rounds"]:
            result += f"\n\n{self._start_new_round(session)}"
        
        return result
    
    def _process_number_guess_move(self, session: GameSession, guess: str) -> str:
        """处理猜数字移动"""
        try:
            guess_num = int(guess.strip())
        except ValueError:
            return "❌ 请输入一个数字！"
        
        target = session.game_data["target_number"]
        session.game_data["guesses"] += 1
        guesses_left = session.game_data["max_guesses"] - session.game_data["guesses"]
        
        if guess_num == target:
            session.score[session.players[0]] += 1
            result = f"🎉 恭喜！你猜对了！数字就是 {target}！\n"
            result += f"用了 {session.game_data['guesses']} 次猜测。"
            
            # 进入下一轮
            session.game_data["round"] += 1
            session.current_turn += 1
            
            if session.game_data["round"] <= session.game_data["max_rounds"]:
                result += f"\n\n{self._start_new_round(session)}"
            
            return result
        
        elif guesses_left <= 0:
            result = f"😅 机会用完了！正确数字是 {target}。"
            
            # 进入下一轮
            session.game_data["round"] += 1
            session.current_turn += 1
            
            if session.game_data["round"] <= session.game_data["max_rounds"]:
                result += f"\n\n{self._start_new_round(session)}"
            
            return result
        
        else:
            if guess_num < target:
                hint = "太小了！"
            else:
                hint = "太大了！"
            
            result = f"{hint} 还有 {guesses_left} 次机会。"
            return result
    
    def _process_word_game_move(self, session: GameSession, word: str) -> str:
        """处理文字游戏移动"""
        mode = session.game_data.get("mode", "word_chain")
        
        if mode == "word_chain":
            return self._process_word_chain(session, word)
        else:
            return self._process_idiom_chain(session, word)
    
    def _process_word_chain(self, session: GameSession, word: str) -> str:
        """处理词语接龙"""
        # 简单验证（实际可以更复杂）
        category = session.game_data["category"]
        word_data = self.game_data.get("文字游戏", {})
        valid_words = word_data.get("word_chains", {}).get(category, [])
        
        is_valid = word.strip() in valid_words or len(word.strip()) > 0
        
        if is_valid:
            session.score[session.players[0]] += 1
            
            # AI接词
            ai_word = random.choice(valid_words)
            session.game_data["last_word"] = ai_word
            
            result = f"✅ 很好！你说了：{word}\n"
            result += f"我来接：{ai_word}\n"
            result += f"得分：{session.score[session.players[0]]} 分"
        else:
            result = f"❌ 这个词不太合适，换一个试试！"
            return result
        
        # 进入下一轮
        session.game_data["round"] += 1
        session.current_turn += 1
        
        if session.game_data["round"] <= session.game_data["max_rounds"]:
            result += f"\n\n请接：{ai_word}"
        
        return result
    
    def _process_story_move(self, session: GameSession, story_part: str) -> str:
        """处理故事接龙移动"""
        # 添加玩家的故事部分
        current_story = session.game_data.get("story", "")
        updated_story = current_story + " " + story_part.strip()
        session.game_data["story"] = updated_story
        
        # AI继续故事
        ai_continuations = [
            "突然，一阵神秘的风吹过...",
            "这时候，远处传来了奇怪的声音...",
            "就在这个时候，意想不到的事情发生了...",
            "然而，事情并没有这么简单...",
            "接下来发生的事情让所有人都感到惊讶..."
        ]
        
        ai_part = random.choice(ai_continuations)
        updated_story += " " + ai_part
        session.game_data["story"] = updated_story
        
        result = f"📝 你的续写很精彩！\n\n"
        result += f"我来继续：{ai_part}\n\n"
        
        # 进入下一轮
        session.game_data["round"] += 1
        session.current_turn += 1
        
        if session.game_data["round"] <= session.game_data["max_rounds"]:
            result += "请继续这个故事！"
        
        return result
    
    def _end_game(self, session: GameSession) -> str:
        """结束游戏"""
        session.state = GameState.COMPLETED
        session.end_time = time.time()
        
        # 生成游戏结果
        duration = session.end_time - session.start_time
        user_score = session.score[session.players[0]]
        ai_score = session.score.get("肥牛", 0)
        
        result = f"🏁 游戏结束！\n\n"
        result += f"📊 最终得分:\n"
        result += f"   你: {user_score} 分\n"
        result += f"   我: {ai_score} 分\n\n"
        
        if user_score > ai_score:
            result += "🎉 恭喜你获胜！"
        elif user_score < ai_score:
            result += "😄 这次我赢了！"
        else:
            result += "🤝 平局！打得不错！"
        
        result += f"\n\n⏱️ 游戏时长: {duration/60:.1f} 分钟"
        result += f"\n🎮 游戏类型: {session.game_type.value}"
        
        # 移除会话
        if session.session_id in self.active_sessions:
            del self.active_sessions[session.session_id]
        
        return result
    
    def get_available_games(self) -> str:
        """获取可用游戏列表"""
        games_list = "🎮 可用游戏:\n\n"
        
        for game_type in GameType:
            rule = self.game_rules.get(game_type, {})
            games_list += f"**{game_type.value}**\n"
            games_list += f"   {rule.get('description', '暂无描述')}\n"
            games_list += f"   最多 {rule.get('max_rounds', 'N/A')} 轮\n\n"
        
        games_list += "💡 说 '开始[游戏名]' 来开始游戏！"
        return games_list
    
    def get_game_status(self) -> str:
        """获取游戏状态"""
        active_count = len(self.active_sessions)
        
        if active_count == 0:
            return "🎮 当前没有进行中的游戏。"
        
        status = f"🎮 游戏状态:\n"
        for session_id, session in self.active_sessions.items():
            duration = time.time() - session.start_time
            status += f"- {session.game_type.value}: 第{session.game_data['round']}轮 ({duration/60:.1f}分钟)\n"
        
        return status

class GameTools:
    """游戏工具类 - 提供给Agent使用的游戏功能"""
    
    def __init__(self):
        self.game_system = GameCompanionSystem()
        self.current_session = None
    
    def start_game(self, game_name: str) -> str:
        """开始游戏"""
        game_map = {
            "你画我猜": GameType.GUESS_DRAW,
            "猜画": GameType.GUESS_DRAW,
            "知识问答": GameType.TRIVIA,
            "问答": GameType.TRIVIA,
            "猜谜": GameType.RIDDLE,
            "谜语": GameType.RIDDLE,
            "文字游戏": GameType.WORD_GAME,
            "接龙": GameType.WORD_GAME,
            "故事接龙": GameType.STORY_GAME,
            "石头剪刀布": GameType.ROCK_PAPER_SCISSORS,
            "剪刀石头布": GameType.ROCK_PAPER_SCISSORS,
            "猜数字": GameType.NUMBER_GUESS
        }
        
        game_type = None
        for name, gtype in game_map.items():
            if name in game_name:
                game_type = gtype
                break
        
        if not game_type:
            return f"❌ 不认识的游戏: {game_name}\n\n{self.game_system.get_available_games()}"
        
        result = self.game_system.start_game(game_type)
        
        # 记录当前会话
        for session_id, session in self.game_system.active_sessions.items():
            if session.game_type == game_type:
                self.current_session = session_id
                break
        
        return result
    
    def play_move(self, move: str) -> str:
        """进行游戏操作"""
        if not self.current_session:
            return "❌ 没有进行中的游戏。请先开始一个游戏。"
        
        result = self.game_system.process_player_move(self.current_session, move)
        
        # 检查游戏是否结束
        if self.current_session not in self.game_system.active_sessions:
            self.current_session = None
        
        return result
    
    def list_games(self) -> str:
        """列出可用游戏"""
        return self.game_system.get_available_games()
    
    def game_status(self) -> str:
        """获取游戏状态"""
        return self.game_system.get_game_status()