# memory_item.py - 记忆数据模型
"""
记忆项数据模型定义
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class MemoryType(str, Enum):
    """记忆类型枚举
    
    三大核心类型（认知科学分类）：
    - EPISODIC: 情景记忆 - 具体事件、对话、经历（有时间地点）
    - SEMANTIC: 语义记忆 - 抽象知识、概念、事实（无具体时间）
    - PROCEDURAL: 程序记忆 - 技能、习惯、操作方式
    
    应用扩展类型：
    - PREFERENCE: 偏好记忆 - 用户喜好、厌恶
    - FACT: 事实记忆 - 客观事实信息
    - TOOL: 工具记忆 - 工具使用记录
    - EVENT: 事件记忆 - 重要事件
    - GENERAL: 通用记忆 - 未分类
    """
    # 核心类型
    EPISODIC = "episodic"      # 情景记忆（具体经历：何时何地发生了什么）
    SEMANTIC = "semantic"      # 语义记忆（抽象知识：用户是医生、喜欢蓝色）
    PROCEDURAL = "procedural"  # 程序记忆（操作习惯：用户习惯晚睡）
    
    # 应用类型
    PREFERENCE = "preference"  # 偏好记忆（喜欢/不喜欢）
    FACT = "fact"              # 事实记忆（客观信息）
    TOOL = "tool"              # 工具记忆（工具使用）
    EVENT = "event"            # 事件记忆（重要事件）
    GENERAL = "general"        # 通用记忆（未分类）


class MemorySource(str, Enum):
    """记忆来源枚举"""
    CONVERSATION = "conversation"  # 对话
    DOCUMENT = "document"          # 文档
    URL = "url"                    # URL
    MANUAL = "manual"              # 手动添加
    MIGRATED = "migrated"          # 迁移导入


class TextualMemoryItem(BaseModel):
    """文本记忆项模型"""
    
    # 基础字段
    id: str = Field(..., description="记忆唯一 ID")
    content: str = Field(..., description="记忆内容")
    
    # 分类和元数据
    memory_type: MemoryType = Field(
        default=MemoryType.GENERAL,
        description="记忆类型"
    )
    importance: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="重要度 (0.0-1.0)"
    )
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="置信度 (0.0-1.0)"
    )
    
    # 来源追踪
    source: Optional[MemorySource] = Field(
        default=None,
        description="记忆来源"
    )
    source_id: Optional[str] = Field(
        default=None,
        description="来源 ID（如对话 ID、文档 ID）"
    )
    
    # 实体和标签
    entity_ids: List[str] = Field(
        default_factory=list,
        description="关联的实体 ID 列表（知识图谱）"
    )
    tags: List[str] = Field(
        default_factory=list,
        description="自定义标签"
    )
    
    # 可见性
    visibility: str = Field(
        default="private",
        description="可见性: private, shared, public"
    )
    
    # 时间戳
    created_at: datetime = Field(
        default_factory=datetime.now,
        description="创建时间"
    )
    updated_at: Optional[datetime] = Field(
        default=None,
        description="更新时间"
    )
    
    # 合并追踪
    merge_count: int = Field(
        default=0,
        description="合并次数"
    )
    merged_from: List[str] = Field(
        default_factory=list,
        description="合并来源的记忆 ID"
    )
    
    # 用户
    user_id: str = Field(
        default="feiniu_default",
        description="所属用户 ID"
    )
    
    # 向量（可选，用于缓存）
    embedding: Optional[List[float]] = Field(
        default=None,
        description="向量表示（可选）"
    )
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
    
    def to_payload(self) -> Dict[str, Any]:
        """转换为 Qdrant payload 格式"""
        return {
            'content': self.content,
            'memory_type': self.memory_type.value,
            'importance': self.importance,
            'confidence': self.confidence,
            'source': self.source.value if self.source else None,
            'source_id': self.source_id,
            'entity_ids': self.entity_ids,
            'tags': self.tags,
            'visibility': self.visibility,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'merge_count': self.merge_count,
            'merged_from': self.merged_from,
            'user_id': self.user_id
        }
    
    @classmethod
    def from_payload(cls, memory_id: str, payload: Dict[str, Any]) -> "TextualMemoryItem":
        """从 Qdrant payload 创建实例"""
        return cls(
            id=memory_id,
            content=payload.get('content', ''),
            memory_type=MemoryType(payload.get('memory_type', 'general')),
            importance=payload.get('importance', 0.5),
            confidence=payload.get('confidence', 1.0),
            source=MemorySource(payload['source']) if payload.get('source') else None,
            source_id=payload.get('source_id'),
            entity_ids=payload.get('entity_ids', []),
            tags=payload.get('tags', []),
            visibility=payload.get('visibility', 'private'),
            created_at=datetime.fromisoformat(payload['created_at']) if payload.get('created_at') else datetime.now(),
            updated_at=datetime.fromisoformat(payload['updated_at']) if payload.get('updated_at') else None,
            merge_count=payload.get('merge_count', 0),
            merged_from=payload.get('merged_from', []),
            user_id=payload.get('user_id', 'feiniu_default')
        )


class MemorySearchResult(BaseModel):
    """记忆搜索结果"""
    
    memory: TextualMemoryItem
    similarity: float = Field(..., description="相似度分数")
    final_score: float = Field(..., description="综合得分（含重要度加权）")
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
