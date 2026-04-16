# relation.py - 关系数据模型
"""
知识图谱关系数据模型定义
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime
from enum import Enum


class RelationType(str, Enum):
    """关系类型枚举"""
    # 偏好关系
    LIKES = "LIKES"                  # 喜欢
    DISLIKES = "DISLIKES"            # 不喜欢
    PREFERS = "PREFERS"              # 偏好
    
    # 社交关系
    KNOWS = "KNOWS"                  # 认识
    FRIEND_OF = "FRIEND_OF"          # 朋友
    FAMILY_OF = "FAMILY_OF"          # 家人
    COLLEAGUE_OF = "COLLEAGUE_OF"    # 同事
    
    # 逻辑关系
    RELATED_TO = "RELATED_TO"        # 相关
    CAUSED_BY = "CAUSED_BY"          # 由...引起
    LEADS_TO = "LEADS_TO"            # 导致
    OPPOSITE_OF = "OPPOSITE_OF"      # 对立
    
    # 组成关系
    PART_OF = "PART_OF"              # 属于/部分
    CONTAINS = "CONTAINS"            # 包含
    BELONGS_TO = "BELONGS_TO"        # 归属于
    
    # 时空关系
    LOCATED_AT = "LOCATED_AT"        # 位于
    HAPPENED_AT = "HAPPENED_AT"      # 发生于
    HAPPENED_DURING = "HAPPENED_DURING"  # 发生在...期间
    BEFORE = "BEFORE"                # 之前
    AFTER = "AFTER"                  # 之后
    
    # 动作关系
    CREATED = "CREATED"              # 创建
    USES = "USES"                    # 使用
    OWNS = "OWNS"                    # 拥有
    WORKS_ON = "WORKS_ON"            # 从事
    
    # 自定义
    CUSTOM = "CUSTOM"                # 自定义


class Relation(BaseModel):
    """关系模型"""
    
    # 基础字段
    id: Optional[str] = Field(default=None, description="关系唯一 ID（可选）")
    source_entity_id: str = Field(..., description="源实体 ID")
    target_entity_id: str = Field(..., description="目标实体 ID")
    relation_type: RelationType = Field(..., description="关系类型")
    
    # 关系属性
    weight: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="关系强度/权重 (0.0-1.0)"
    )
    description: Optional[str] = Field(
        default=None,
        description="关系描述"
    )
    properties: Dict[str, Any] = Field(
        default_factory=dict,
        description="自定义属性"
    )
    
    # 来源
    source_memory_id: Optional[str] = Field(
        default=None,
        description="来源记忆 ID"
    )
    
    # 置信度
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="关系置信度"
    )
    
    # 时间戳
    created_at: datetime = Field(
        default_factory=datetime.now,
        description="创建时间"
    )
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
    
    def to_neo4j_properties(self) -> Dict[str, Any]:
        """转换为 Neo4j 关系属性"""
        props = {
            'weight': self.weight,
            'confidence': self.confidence,
            'created_at': self.created_at.isoformat()
        }
        
        if self.id:
            props['id'] = self.id
        if self.description:
            props['description'] = self.description
        if self.source_memory_id:
            props['source_memory_id'] = self.source_memory_id
        
        # 合并自定义属性
        for key, value in self.properties.items():
            if isinstance(value, (str, int, float, bool)):
                props[key] = value
        
        return props


class ExtractedRelation(BaseModel):
    """从文本中提取的关系（未持久化）"""
    
    source_name: str = Field(..., description="源实体名称")
    target_name: str = Field(..., description="目标实体名称")
    relation_type: RelationType = Field(..., description="关系类型")
    description: Optional[str] = Field(default=None, description="关系描述")
    confidence: float = Field(default=0.8, description="提取置信度")
    
    def to_relation(
        self,
        source_entity_id: str,
        target_entity_id: str,
        source_memory_id: Optional[str] = None
    ) -> Relation:
        """转换为完整关系"""
        return Relation(
            source_entity_id=source_entity_id,
            target_entity_id=target_entity_id,
            relation_type=self.relation_type,
            description=self.description,
            confidence=self.confidence,
            source_memory_id=source_memory_id
        )
