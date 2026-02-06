# preference_memory.py - 偏好记忆
"""
管理用户偏好的专用记忆类型
支持偏好的存储、检索、更新和知识图谱关联
"""

import uuid
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class PreferenceCategory(str, Enum):
    """偏好类别"""
    FOOD = "food"           # 食物
    DRINK = "drink"         # 饮品
    MUSIC = "music"         # 音乐
    MOVIE = "movie"         # 电影
    GAME = "game"           # 游戏
    HOBBY = "hobby"         # 爱好
    STYLE = "style"         # 风格
    PERSONALITY = "personality"  # 性格特点
    COLOR = "color"         # 颜色
    PLACE = "place"         # 地点
    PERSON = "person"       # 人物
    ANIME = "anime"         # 动漫
    BOOK = "book"           # 书籍
    WORK = "work"           # 工作相关
    SCHEDULE = "schedule"   # 日程/时间安排
    GENERAL = "general"     # 通用/一般
    OTHER = "other"         # 其他


class PreferenceType(str, Enum):
    """偏好类型"""
    LIKE = "like"           # 喜欢
    DISLIKE = "dislike"     # 不喜欢
    NEUTRAL = "neutral"     # 中立


class PreferenceItem(BaseModel):
    """偏好项"""
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # 使用完整 UUID 格式
    item: str = Field(..., description="偏好对象")
    category: PreferenceCategory = Field(..., description="类别")
    preference_type: PreferenceType = Field(..., description="偏好类型")
    
    # 强度和置信度
    strength: float = Field(default=0.8, ge=0.0, le=1.0, description="偏好强度")
    confidence: float = Field(default=0.8, ge=0.0, le=1.0, description="置信度")
    
    # 来源
    source_memory_ids: List[str] = Field(
        default_factory=list,
        description="来源记忆 ID"
    )
    
    # 时间
    first_mentioned_at: datetime = Field(
        default_factory=datetime.now,
        description="首次提及时间"
    )
    last_mentioned_at: datetime = Field(
        default_factory=datetime.now,
        description="最后提及时间"
    )
    mention_count: int = Field(default=1, description="提及次数")
    
    # 图谱关联
    entity_id: Optional[str] = Field(default=None, description="关联的实体 ID")
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'item': self.item,
            'category': self.category.value,
            'preference_type': self.preference_type.value,
            'strength': self.strength,
            'confidence': self.confidence,
            'source_memory_ids': self.source_memory_ids,
            'first_mentioned_at': self.first_mentioned_at.isoformat(),
            'last_mentioned_at': self.last_mentioned_at.isoformat(),
            'mention_count': self.mention_count,
            'entity_id': self.entity_id
        }


class PreferenceMemory:
    """偏好记忆管理器"""
    
    def __init__(
        self,
        user_id: str,
        vector_storage=None,
        graph_storage=None,
        embedder=None
    ):
        """
        初始化偏好记忆
        
        Args:
            user_id: 用户 ID
            vector_storage: 向量存储
            graph_storage: 图存储
            embedder: 嵌入模型
        """
        self.user_id = user_id
        self.vector_storage = vector_storage
        self.graph_storage = graph_storage
        self.embedder = embedder
        
        # 内存缓存
        self.preferences: Dict[str, PreferenceItem] = {}
        self._loaded = False
    
    def _infer_category_from_tags(self, tags: List[str]) -> PreferenceCategory:
        """根据 tags 推断类别"""
        if not tags:
            return PreferenceCategory.OTHER
        
        # 将所有 tags 合并为一个字符串用于匹配
        tags_str = ' '.join(tags).lower()
        
        # 定义关键词到类别的映射
        category_keywords = {
            PreferenceCategory.FOOD: ['食物', '美食', '口味', '吃', '饮食', '餐', '菜', '零食', '甜品', '饮料', '咖啡', '茶'],
            PreferenceCategory.DRINK: ['饮品', '饮料', '酒', '咖啡', '茶', '奶茶', '果汁'],
            PreferenceCategory.MUSIC: ['音乐', '歌曲', '歌', '唱歌', '乐队', '专辑', 'j-pop', 'jpop', '摇滚', '流行'],
            PreferenceCategory.MOVIE: ['电影', '影片', '观影', '院线'],
            PreferenceCategory.GAME: ['游戏', '玩', 'galgame', 'rpg', 'jrpg', '攻略', '通关', '二次元游戏'],
            PreferenceCategory.HOBBY: ['爱好', '兴趣', '娱乐', '休闲'],
            PreferenceCategory.STYLE: ['风格', '傲娇', '毒舌', '互动', '性格', '态度'],
            PreferenceCategory.ANIME: ['动漫', '动画', '番剧', '漫画', '二次元', 'vtuber', '声优', 'neuro', 'fake neuro'],
            PreferenceCategory.BOOK: ['书', '阅读', '小说', '文学', '读书'],
            PreferenceCategory.WORK: ['工作', '编程', 'python', 'ai', '代码', '开发'],
            PreferenceCategory.SCHEDULE: ['日程', '时间', '计划', '安排'],
            PreferenceCategory.PERSON: ['人物', '角色', '主播', 'up主'],
            PreferenceCategory.PLACE: ['地点', '地方', '旅游', '城市'],
            PreferenceCategory.COLOR: ['颜色', '色彩'],
        }
        
        # 遍历检查每个类别的关键词
        for category, keywords in category_keywords.items():
            for keyword in keywords:
                if keyword in tags_str:
                    return category
        
        return PreferenceCategory.OTHER
    
    async def load(self):
        """从存储加载偏好"""
        if self._loaded:
            return
        
        if self.vector_storage and self.vector_storage.is_available():
            results = self.vector_storage.get_all_memories(
                user_id=self.user_id,
                limit=1000  # 增加限制以加载更多偏好
            )
            
            for result in results:
                payload = result.get('payload', {})
                if payload.get('memory_type') == 'preference':
                    try:
                        # 优先使用 item 字段，如果不存在则使用 content 字段
                        # （LLM 提取的偏好只有 content 字段，没有 item 字段）
                        item_value = payload.get('item') or payload.get('content', '')
                        if not item_value:
                            logger.warning(f"偏好缺少 item/content 字段: {result['id']}")
                            continue
                        
                        # 确定类别：优先使用 payload 中的 category，否则根据 tags 推断
                        category_value = payload.get('category')
                        if category_value and category_value != 'other':
                            try:
                                category = PreferenceCategory(category_value)
                            except ValueError:
                                category = PreferenceCategory.OTHER
                        else:
                            # 根据 tags 推断类别
                            tags = payload.get('tags', [])
                            category = self._infer_category_from_tags(tags)
                        
                        pref = PreferenceItem(
                            id=result['id'],
                            item=item_value,
                            category=category,
                            preference_type=PreferenceType(payload.get('preference_type', 'like')),
                            strength=payload.get('strength', payload.get('importance', 0.8)),
                            confidence=payload.get('confidence', 0.8),
                            source_memory_ids=payload.get('source_memory_ids', []),
                            mention_count=payload.get('mention_count', 1),
                            entity_id=payload.get('entity_id')
                        )
                        # 使用 ID 作为 key，避免 item 重复导致覆盖
                        self.preferences[pref.id] = pref
                    except Exception as e:
                        logger.warning(f"加载偏好失败: {e}")
        
        self._loaded = True
        logger.info(f"加载 {len(self.preferences)} 个偏好")
    
    async def add_preference(
        self,
        item: str,
        category: PreferenceCategory,
        preference_type: PreferenceType,
        strength: float = 0.8,
        confidence: float = 0.8,
        source_memory_id: Optional[str] = None
    ) -> PreferenceItem:
        """
        添加或更新偏好
        
        Args:
            item: 偏好对象
            category: 类别
            preference_type: 喜欢/不喜欢
            strength: 强度
            confidence: 置信度
            source_memory_id: 来源记忆 ID
        
        Returns:
            偏好项
        """
        await self.load()
        
        # 查找是否已存在相同 item 的偏好（不区分大小写）
        item_lower = item.lower()
        existing_pref = None
        for pref_id, p in self.preferences.items():
            if p.item.lower() == item_lower:
                existing_pref = p
                break
        
        if existing_pref:
            # 更新现有偏好
            pref = existing_pref
            pref.mention_count += 1
            pref.last_mentioned_at = datetime.now()
            
            # 更新强度（加权平均）
            pref.strength = (pref.strength * (pref.mention_count - 1) + strength) / pref.mention_count
            pref.confidence = max(pref.confidence, confidence)
            
            if source_memory_id and source_memory_id not in pref.source_memory_ids:
                pref.source_memory_ids.append(source_memory_id)
            
            # 如果偏好类型变了（从喜欢变成不喜欢），更新
            if preference_type != pref.preference_type and confidence > pref.confidence:
                pref.preference_type = preference_type
            
        else:
            # 创建新偏好
            pref = PreferenceItem(
                item=item,
                category=category,
                preference_type=preference_type,
                strength=strength,
                confidence=confidence,
                source_memory_ids=[source_memory_id] if source_memory_id else []
            )
            self.preferences[pref.id] = pref
        
        # 存储到向量库
        await self._save_preference(pref)
        
        # 创建知识图谱实体和关系
        if self.graph_storage and self.graph_storage.is_available():
            await self._link_to_graph(pref)
        
        return pref
    
    async def _save_preference(self, pref: PreferenceItem):
        """保存偏好到向量库"""
        if not self.vector_storage or not self.vector_storage.is_available():
            return
        
        # 构建内容用于向量化
        content = f"用户{'喜欢' if pref.preference_type == PreferenceType.LIKE else '不喜欢'}{pref.item}（{pref.category.value}）"
        
        vector = self._encode(content)
        
        payload = {
            'content': content,
            'user_id': self.user_id,
            'memory_type': 'preference',
            'item': pref.item,
            'category': pref.category.value,
            'preference_type': pref.preference_type.value,
            'strength': pref.strength,
            'confidence': pref.confidence,
            'source_memory_ids': pref.source_memory_ids,
            'mention_count': pref.mention_count,
            'entity_id': pref.entity_id,
            'created_at': pref.first_mentioned_at.isoformat(),
            'updated_at': pref.last_mentioned_at.isoformat()
        }
        
        self.vector_storage.add_memory(pref.id, vector, payload)
    
    async def _link_to_graph(self, pref: PreferenceItem):
        """关联到知识图谱"""
        if not self.graph_storage:
            return
        
        try:
            # 创建偏好实体
            entity_id = f"pref_entity_{pref.id}"
            
            # 使用 add_entity（兼容 NetworkX 和 Neo4j）
            add_method = getattr(self.graph_storage, 'add_entity', None) or getattr(self.graph_storage, 'create_entity', None)
            if add_method:
                add_method(
                    entity_id=entity_id,
                    name=pref.item,
                    entity_type="preference",
                    properties={
                        'category': pref.category.value,
                        'preference_type': pref.preference_type.value,
                        'strength': pref.strength,
                        'user_id': self.user_id
                    }
                )
            
            pref.entity_id = entity_id
            
            # 创建用户到偏好的关系
            user_entity_id = f"user_{self.user_id}"
            
            # 确保用户实体存在
            if add_method:
                add_method(
                    entity_id=user_entity_id,
                    name=self.user_id,
                    entity_type="person",
                    properties={'user_id': self.user_id}
                )
            
            # 创建关系
            relation_type = "likes" if pref.preference_type == PreferenceType.LIKE else "dislikes"
            add_rel_method = getattr(self.graph_storage, 'add_relation', None) or getattr(self.graph_storage, 'create_relation', None)
            if add_rel_method:
                add_rel_method(
                    source_id=user_entity_id,
                    target_id=entity_id,
                    relation_type=relation_type,
                    properties={'strength': pref.strength}
                )
        except Exception as e:
            logger.warning(f"关联图谱失败: {e}")
    
    async def get_preferences(
        self,
        category: Optional[PreferenceCategory] = None,
        preference_type: Optional[PreferenceType] = None
    ) -> List[PreferenceItem]:
        """
        获取偏好列表
        
        Args:
            category: 类别过滤
            preference_type: 类型过滤
        
        Returns:
            偏好列表
        """
        await self.load()
        
        prefs = list(self.preferences.values())
        
        if category:
            prefs = [p for p in prefs if p.category == category]
        
        if preference_type:
            prefs = [p for p in prefs if p.preference_type == preference_type]
        
        # 按强度排序
        prefs.sort(key=lambda x: x.strength, reverse=True)
        
        return prefs
    
    async def delete_preference(self, pref_id: str) -> bool:
        """删除偏好"""
        await self.load()
        
        # 现在 key 就是 pref_id，直接查找
        if pref_id in self.preferences:
            # 从内存删除
            del self.preferences[pref_id]
            
            # 从向量库删除
            if self.vector_storage:
                self.vector_storage.delete_memory(pref_id)
            
            # 从图谱删除
            if self.graph_storage:
                try:
                    entity_id = f"pref_entity_{pref_id}"
                    delete_method = getattr(self.graph_storage, 'delete_entity', None)
                    if delete_method:
                        delete_method(entity_id)
                except:
                    pass
                    
            return True
            
        return False

    async def search_preferences(
        self,
        query: str,
        top_k: int = 5
    ) -> List[PreferenceItem]:
        """
        搜索相关偏好
        
        Args:
            query: 查询文本
            top_k: 返回数量
        
        Returns:
            偏好列表
        """
        if not self.vector_storage or not self.vector_storage.is_available():
            return []
        
        query_vector = self._encode(query)
        
        results = self.vector_storage.search(
            query_vector=query_vector,
            top_k=top_k,
            user_id=self.user_id,
            memory_type='preference'
        )
        
        prefs = []
        for result in results:
            # 使用 ID 查找，因为 preferences 现在用 ID 作为 key
            pref_id = result.get('id')
            if pref_id and pref_id in self.preferences:
                prefs.append(self.preferences[pref_id])
        
        return prefs
    
    async def get_summary(self) -> Dict[str, Any]:
        """获取偏好摘要"""
        await self.load()
        
        likes = [p for p in self.preferences.values() if p.preference_type == PreferenceType.LIKE]
        dislikes = [p for p in self.preferences.values() if p.preference_type == PreferenceType.DISLIKE]
        
        # 按类别统计
        by_category = {}
        categories = {}  # 添加 categories 字段，统计每个类别的数量（供 JS 工具使用）
        for pref in self.preferences.values():
            cat = pref.category.value
            if cat not in by_category:
                by_category[cat] = {'likes': [], 'dislikes': []}
                categories[cat] = 0
            
            categories[cat] += 1
            
            if pref.preference_type == PreferenceType.LIKE:
                by_category[cat]['likes'].append(pref.item)
            else:
                by_category[cat]['dislikes'].append(pref.item)
        
        return {
            'total_count': len(self.preferences),
            'likes_count': len(likes),
            'dislikes_count': len(dislikes),
            'category_count': len(categories),  # 添加类别数量字段（供 JS 工具使用）
            'categories': categories,  # 添加类别分布字段（供 JS 工具使用）
            'top_likes': [p.item for p in sorted(likes, key=lambda x: x.strength, reverse=True)[:10]],
            'top_dislikes': [p.item for p in sorted(dislikes, key=lambda x: x.strength, reverse=True)[:5]],
            'by_category': by_category
        }
    
    def _encode(self, text: str) -> List[float]:
        """文本编码"""
        if self.embedder:
            return self.embedder.encode([text])[0].tolist()
        return []
