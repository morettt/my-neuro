# entity.py - 实体数据模型
"""
知识图谱实体数据模型定义
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class EntityType(str, Enum):
    """实体类型枚举"""
    PERSON = "person"            # 人物
    PLACE = "place"              # 地点
    OBJECT = "object"            # 物品
    EVENT = "event"              # 事件
    CONCEPT = "concept"          # 概念
    PREFERENCE = "preference"    # 偏好
    ORGANIZATION = "organization"  # 组织
    TIME = "time"                # 时间
    CUSTOM = "custom"            # 自定义


class Entity(BaseModel):
    """实体模型"""
    
    # 基础字段
    id: str = Field(..., description="实体唯一 ID")
    name: str = Field(..., description="实体名称")
    entity_type: EntityType = Field(..., description="实体类型")
    
    # 描述和别名
    description: Optional[str] = Field(
        default=None,
        description="实体描述"
    )
    aliases: List[str] = Field(
        default_factory=list,
        description="实体别名列表"
    )
    
    # 自定义属性
    properties: Dict[str, Any] = Field(
        default_factory=dict,
        description="自定义属性"
    )
    
    # 关联的记忆
    source_memory_ids: List[str] = Field(
        default_factory=list,
        description="来源记忆 ID 列表"
    )
    
    # 置信度
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="实体置信度"
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
    
    # 用户
    user_id: str = Field(
        default="feiniu_default",
        description="所属用户 ID"
    )
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
    
    def to_neo4j_properties(self) -> Dict[str, Any]:
        """转换为 Neo4j 节点属性"""
        props = {
            'id': self.id,
            'name': self.name,
            'type': self.entity_type.value,
            'user_id': self.user_id,
            'confidence': self.confidence,
            'created_at': self.created_at.isoformat()
        }
        
        if self.description:
            props['description'] = self.description
        if self.aliases:
            props['aliases'] = self.aliases
        if self.updated_at:
            props['updated_at'] = self.updated_at.isoformat()
        
        # 合并自定义属性（排除复杂类型）
        for key, value in self.properties.items():
            if isinstance(value, (str, int, float, bool)):
                props[key] = value
        
        return props
    
    @classmethod
    def from_neo4j_node(cls, node_data: Dict[str, Any]) -> "Entity":
        """从 Neo4j 节点数据创建实例"""
        return cls(
            id=node_data.get('id', ''),
            name=node_data.get('name', ''),
            entity_type=EntityType(node_data.get('type', 'custom')),
            description=node_data.get('description'),
            aliases=node_data.get('aliases', []),
            properties={k: v for k, v in node_data.items() 
                       if k not in ['id', 'name', 'type', 'description', 'aliases', 
                                   'user_id', 'confidence', 'created_at', 'updated_at']},
            confidence=node_data.get('confidence', 1.0),
            created_at=datetime.fromisoformat(node_data['created_at']) if node_data.get('created_at') else datetime.now(),
            updated_at=datetime.fromisoformat(node_data['updated_at']) if node_data.get('updated_at') else None,
            user_id=node_data.get('user_id', 'feiniu_default')
        )


class ExtractedEntity(BaseModel):
    """从文本中提取的实体（未持久化）"""
    
    name: str = Field(..., description="实体名称")
    entity_type: EntityType = Field(..., description="实体类型")
    description: Optional[str] = Field(default=None, description="实体描述")
    confidence: float = Field(default=0.8, description="提取置信度")
    
    def to_entity(self, entity_id: str, user_id: str) -> Entity:
        """转换为完整实体"""
        return Entity(
            id=entity_id,
            name=self.name,
            entity_type=self.entity_type,
            description=self.description,
            confidence=self.confidence,
            user_id=user_id
        )
