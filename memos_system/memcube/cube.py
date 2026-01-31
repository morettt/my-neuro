# cube.py - MemCube 记忆容器
"""
MemCube - 记忆容器
将不同类型的记忆（文本记忆、图记忆等）组织在一个容器中
"""

import uuid
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class CubeVisibility(str, Enum):
    """Cube 可见性"""
    PRIVATE = "private"      # 私有
    SHARED = "shared"        # 共享给特定用户
    PUBLIC = "public"        # 公开


class CubeMetadata(BaseModel):
    """Cube 元数据"""
    
    id: str = Field(..., description="Cube 唯一 ID")
    name: str = Field(..., description="Cube 名称")
    description: Optional[str] = Field(default=None, description="描述")
    
    # 所有者
    owner_id: str = Field(..., description="所有者用户 ID")
    
    # 可见性和共享
    visibility: CubeVisibility = Field(
        default=CubeVisibility.PRIVATE,
        description="可见性"
    )
    shared_with: List[str] = Field(
        default_factory=list,
        description="共享给的用户 ID 列表"
    )
    
    # 统计
    memory_count: int = Field(default=0, description="记忆数量")
    entity_count: int = Field(default=0, description="实体数量")
    
    # 时间戳
    created_at: datetime = Field(
        default_factory=datetime.now,
        description="创建时间"
    )
    updated_at: Optional[datetime] = Field(
        default=None,
        description="更新时间"
    )
    
    # 配置
    settings: Dict[str, Any] = Field(
        default_factory=dict,
        description="Cube 设置"
    )
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'owner_id': self.owner_id,
            'visibility': self.visibility.value,
            'shared_with': self.shared_with,
            'memory_count': self.memory_count,
            'entity_count': self.entity_count,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'settings': self.settings
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CubeMetadata":
        return cls(
            id=data['id'],
            name=data['name'],
            description=data.get('description'),
            owner_id=data['owner_id'],
            visibility=CubeVisibility(data.get('visibility', 'private')),
            shared_with=data.get('shared_with', []),
            memory_count=data.get('memory_count', 0),
            entity_count=data.get('entity_count', 0),
            created_at=datetime.fromisoformat(data['created_at']) if data.get('created_at') else datetime.now(),
            updated_at=datetime.fromisoformat(data['updated_at']) if data.get('updated_at') else None,
            settings=data.get('settings', {})
        )


class MemCube:
    """
    MemCube - 记忆容器
    
    包含:
    - 文本记忆 (TextualMemory)
    - 图记忆 (GraphMemory) - 知识图谱
    """
    
    def __init__(
        self,
        metadata: CubeMetadata,
        vector_storage=None,
        graph_storage=None,
        embedder=None
    ):
        """
        初始化 MemCube
        
        Args:
            metadata: Cube 元数据
            vector_storage: 向量存储客户端
            graph_storage: 图存储客户端
            embedder: 嵌入模型
        """
        self.metadata = metadata
        self.vector_storage = vector_storage
        self.graph_storage = graph_storage
        self.embedder = embedder
        
        # Cube 前缀，用于隔离不同 Cube 的数据
        self.prefix = f"cube_{self.metadata.id}_"
    
    @property
    def id(self) -> str:
        return self.metadata.id
    
    @property
    def name(self) -> str:
        return self.metadata.name
    
    @property
    def owner_id(self) -> str:
        return self.metadata.owner_id
    
    def can_access(self, user_id: str) -> bool:
        """检查用户是否有权限访问"""
        if self.metadata.visibility == CubeVisibility.PUBLIC:
            return True
        if user_id == self.owner_id:
            return True
        if user_id in self.metadata.shared_with:
            return True
        return False
    
    def can_write(self, user_id: str) -> bool:
        """检查用户是否有写权限"""
        # 目前只有所有者可写
        return user_id == self.owner_id
    
    # ==================== 记忆操作 ====================
    
    def _make_memory_id(self, base_id: str) -> str:
        """生成带 Cube 前缀的记忆 ID"""
        if base_id.startswith(self.prefix):
            return base_id
        return f"{self.prefix}{base_id}"
    
    async def add_memory(
        self,
        content: str,
        memory_type: str = "general",
        importance: float = 0.5,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        添加记忆
        
        Args:
            content: 记忆内容
            memory_type: 记忆类型
            importance: 重要度
            tags: 标签
            metadata: 额外元数据
        
        Returns:
            添加结果
        """
        tags = tags or []
        metadata = metadata or {}
        
        # 生成向量
        vector = self._encode(content)
        
        # 生成 ID
        base_id = f"mem_{uuid.uuid4().hex[:12]}"
        memory_id = self._make_memory_id(base_id)
        
        # 构建 payload
        payload = {
            'content': content,
            'user_id': self.owner_id,
            'cube_id': self.id,
            'memory_type': memory_type,
            'importance': importance,
            'tags': tags,
            'created_at': datetime.now().isoformat(),
            **metadata
        }
        
        # 存储
        success = False
        if self.vector_storage and self.vector_storage.is_available():
            success = self.vector_storage.add_memory(memory_id, vector, payload)
            
            if success:
                self.metadata.memory_count += 1
        
        return {
            'success': success,
            'memory_id': memory_id
        }
    
    async def search_memories(
        self,
        query: str,
        top_k: int = 5,
        similarity_threshold: float = 0.5,
        memory_type: Optional[str] = None,
        tags: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        搜索记忆
        
        Args:
            query: 查询文本
            top_k: 返回数量
            similarity_threshold: 相似度阈值
            memory_type: 类型过滤
            tags: 标签过滤
        
        Returns:
            记忆列表
        """
        if not self.vector_storage or not self.vector_storage.is_available():
            return []
        
        # 生成查询向量
        query_vector = self._encode(query)
        
        # 搜索（通过前缀过滤本 Cube 的记忆）
        # 注意：Qdrant 不直接支持 ID 前缀过滤，需要通过 payload 过滤
        results = self.vector_storage.search(
            query_vector=query_vector,
            top_k=top_k * 2,  # 多取一些，后面过滤
            score_threshold=similarity_threshold,
            memory_type=memory_type,
            tags=tags
        )
        
        # 过滤属于本 Cube 的记忆
        cube_results = [
            r for r in results 
            if r.get('payload', {}).get('cube_id') == self.id
        ]
        
        return cube_results[:top_k]
    
    async def get_memory(self, memory_id: str) -> Optional[Dict[str, Any]]:
        """获取记忆"""
        if not self.vector_storage:
            return None
        
        full_id = self._make_memory_id(memory_id)
        return self.vector_storage.get_memory(full_id)
    
    async def update_memory(
        self,
        memory_id: str,
        content: Optional[str] = None,
        importance: Optional[float] = None,
        tags: Optional[List[str]] = None,
        **kwargs
    ) -> bool:
        """更新记忆"""
        if not self.vector_storage:
            return False
        
        full_id = self._make_memory_id(memory_id)
        updates = {}
        new_vector = None
        
        if content:
            updates['content'] = content
            new_vector = self._encode(content)
        if importance is not None:
            updates['importance'] = importance
        if tags is not None:
            updates['tags'] = tags
        
        updates.update(kwargs)
        
        return self.vector_storage.update_memory(full_id, updates, new_vector)
    
    async def delete_memory(self, memory_id: str) -> bool:
        """删除记忆"""
        if not self.vector_storage:
            return False
        
        full_id = self._make_memory_id(memory_id)
        success = self.vector_storage.delete_memory(full_id)
        
        if success:
            self.metadata.memory_count = max(0, self.metadata.memory_count - 1)
        
        return success
    
    async def list_memories(self, limit: int = 100) -> List[Dict[str, Any]]:
        """列出所有记忆"""
        if not self.vector_storage:
            return []
        
        all_memories = self.vector_storage.get_all_memories(
            user_id=self.owner_id,
            limit=limit * 2
        )
        
        # 过滤本 Cube 的记忆
        return [
            m for m in all_memories
            if m.get('payload', {}).get('cube_id') == self.id
        ][:limit]
    
    # ==================== 图操作 ====================
    
    async def add_entity(
        self,
        name: str,
        entity_type: str,
        properties: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """添加实体"""
        if not self.graph_storage or not self.graph_storage.is_available():
            return None
        
        entity_id = f"{self.prefix}entity_{uuid.uuid4().hex[:8]}"
        props = properties or {}
        props['cube_id'] = self.id
        
        success = self.graph_storage.create_entity(
            entity_id=entity_id,
            name=name,
            entity_type=entity_type,
            user_id=self.owner_id,
            properties=props
        )
        
        if success:
            self.metadata.entity_count += 1
            return entity_id
        return None
    
    async def add_relation(
        self,
        source_id: str,
        target_id: str,
        relation_type: str,
        properties: Optional[Dict[str, Any]] = None
    ) -> bool:
        """添加关系"""
        if not self.graph_storage or not self.graph_storage.is_available():
            return False
        
        props = properties or {}
        props['cube_id'] = self.id
        
        return self.graph_storage.create_relation(
            source_id=source_id,
            target_id=target_id,
            relation_type=relation_type,
            properties=props
        )
    
    async def get_related_entities(
        self,
        entity_id: str,
        max_depth: int = 2
    ) -> List[Dict[str, Any]]:
        """获取相关实体"""
        if not self.graph_storage or not self.graph_storage.is_available():
            return []
        
        return self.graph_storage.find_related_entities(entity_id, max_depth)
    
    async def get_entity_context(self, entity_id: str) -> Dict[str, Any]:
        """获取实体上下文"""
        if not self.graph_storage or not self.graph_storage.is_available():
            return {}
        
        return self.graph_storage.get_entity_context(entity_id)
    
    # ==================== 辅助方法 ====================
    
    def _encode(self, text: str) -> List[float]:
        """文本编码"""
        if self.embedder:
            return self.embedder.encode([text])[0].tolist()
        return []
    
    # ==================== 统计 ====================
    
    async def get_stats(self) -> Dict[str, Any]:
        """获取统计"""
        return {
            'cube_id': self.id,
            'name': self.name,
            'owner_id': self.owner_id,
            'memory_count': self.metadata.memory_count,
            'entity_count': self.metadata.entity_count,
            'visibility': self.metadata.visibility.value,
            'shared_with_count': len(self.metadata.shared_with)
        }
