# graph_manager.py - 知识图谱管理器
"""
知识图谱管理功能
"""

import uuid
import logging
from typing import List, Dict, Any, Optional, Set

try:
    from ..models.entity import Entity, EntityType, ExtractedEntity
    from ..models.relation import Relation, RelationType, ExtractedRelation
except ImportError:
    from models.entity import Entity, EntityType, ExtractedEntity
    from models.relation import Relation, RelationType, ExtractedRelation

logger = logging.getLogger(__name__)


class GraphManager:
    """知识图谱管理器"""
    
    def __init__(self, neo4j_client):
        """
        初始化图谱管理器
        
        Args:
            neo4j_client: Neo4j 客户端实例
        """
        self.client = neo4j_client
    
    def is_available(self) -> bool:
        """检查图谱是否可用"""
        return self.client and self.client.is_available()
    
    # ==================== 实体操作 ====================
    
    async def add_entity(self, entity: Entity) -> bool:
        """
        添加实体
        
        Args:
            entity: 实体对象
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        return self.client.create_entity(
            entity_id=entity.id,
            name=entity.name,
            entity_type=entity.entity_type.value,
            user_id=entity.user_id,
            properties=entity.to_neo4j_properties()
        )
    
    async def add_entities(
        self,
        extracted_entities: List[ExtractedEntity],
        user_id: str,
        source_memory_id: Optional[str] = None
    ) -> List[str]:
        """
        批量添加提取的实体
        
        Args:
            extracted_entities: 提取的实体列表
            user_id: 用户 ID
            source_memory_id: 来源记忆 ID
        
        Returns:
            创建的实体 ID 列表
        """
        if not self.is_available():
            return []
        
        entity_ids = []
        
        for ext_entity in extracted_entities:
            # 检查是否已存在相似实体
            existing = await self.find_similar_entity(
                ext_entity.name, 
                user_id, 
                ext_entity.entity_type
            )
            
            if existing:
                # 使用现有实体
                entity_ids.append(existing['id'])
                
                # 关联到记忆
                if source_memory_id:
                    self.client.link_memory_to_entity(
                        source_memory_id, existing['id']
                    )
            else:
                # 创建新实体
                entity_id = f"entity_{uuid.uuid4().hex[:8]}"
                entity = ext_entity.to_entity(entity_id, user_id)
                
                if source_memory_id:
                    entity.source_memory_ids.append(source_memory_id)
                
                if await self.add_entity(entity):
                    entity_ids.append(entity_id)
                    
                    # 关联到记忆
                    if source_memory_id:
                        self.client.link_memory_to_entity(
                            source_memory_id, entity_id
                        )
        
        return entity_ids
    
    async def find_similar_entity(
        self,
        name: str,
        user_id: str,
        entity_type: Optional[EntityType] = None
    ) -> Optional[Dict[str, Any]]:
        """
        查找相似实体
        
        Args:
            name: 实体名称
            user_id: 用户 ID
            entity_type: 实体类型（可选）
        
        Returns:
            找到的实体或 None
        """
        if not self.is_available():
            return None
        
        # 精确匹配
        type_str = entity_type.value if entity_type else None
        entity = self.client.find_entity_by_name(name, user_id, type_str)
        
        if entity:
            return entity
        
        # TODO: 可以添加模糊匹配逻辑
        return None
    
    async def get_entity(self, entity_id: str) -> Optional[Entity]:
        """
        获取实体
        
        Args:
            entity_id: 实体 ID
        
        Returns:
            实体对象
        """
        if not self.is_available():
            return None
        
        data = self.client.get_entity(entity_id)
        if data:
            return Entity.from_neo4j_node(data)
        return None
    
    async def list_entities(
        self,
        user_id: str,
        entity_type: Optional[EntityType] = None,
        limit: int = 100
    ) -> List[Entity]:
        """
        列出实体
        
        Args:
            user_id: 用户 ID
            entity_type: 实体类型过滤
            limit: 返回数量
        
        Returns:
            实体列表
        """
        if not self.is_available():
            return []
        
        type_str = entity_type.value if entity_type else None
        data_list = self.client.list_entities(user_id, type_str, limit)
        
        return [Entity.from_neo4j_node(data) for data in data_list]
    
    async def update_entity(
        self,
        entity_id: str,
        updates: Dict[str, Any]
    ) -> bool:
        """
        更新实体
        
        Args:
            entity_id: 实体 ID
            updates: 更新内容
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        return self.client.update_entity(entity_id, updates)
    
    async def delete_entity(self, entity_id: str) -> bool:
        """
        删除实体
        
        Args:
            entity_id: 实体 ID
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        return self.client.delete_entity(entity_id)
    
    # ==================== 关系操作 ====================
    
    async def add_relation(self, relation: Relation) -> bool:
        """
        添加关系
        
        Args:
            relation: 关系对象
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        return self.client.create_relation(
            source_id=relation.source_entity_id,
            target_id=relation.target_entity_id,
            relation_type=relation.relation_type.value,
            properties=relation.to_neo4j_properties()
        )
    
    async def add_relations(
        self,
        extracted_relations: List[ExtractedRelation],
        user_id: str,
        source_memory_id: Optional[str] = None
    ) -> int:
        """
        批量添加提取的关系
        
        Args:
            extracted_relations: 提取的关系列表
            user_id: 用户 ID
            source_memory_id: 来源记忆 ID
        
        Returns:
            成功添加的数量
        """
        if not self.is_available():
            return 0
        
        added_count = 0
        
        for ext_relation in extracted_relations:
            # 查找源实体和目标实体
            source = await self.find_similar_entity(
                ext_relation.source_name, user_id
            )
            target = await self.find_similar_entity(
                ext_relation.target_name, user_id
            )
            
            if source and target:
                relation = ext_relation.to_relation(
                    source['id'],
                    target['id'],
                    source_memory_id
                )
                
                if await self.add_relation(relation):
                    added_count += 1
        
        return added_count
    
    async def get_entity_relations(
        self,
        entity_id: str,
        direction: str = "both",
        relation_type: Optional[RelationType] = None
    ) -> List[Dict[str, Any]]:
        """
        获取实体的关系
        
        Args:
            entity_id: 实体 ID
            direction: 方向
            relation_type: 关系类型过滤
        
        Returns:
            关系列表
        """
        if not self.is_available():
            return []
        
        type_str = relation_type.value if relation_type else None
        return self.client.get_relations(entity_id, direction, type_str)
    
    async def delete_relation(
        self,
        source_id: str,
        target_id: str,
        relation_type: Optional[RelationType] = None
    ) -> bool:
        """
        删除关系
        
        Args:
            source_id: 源实体 ID
            target_id: 目标实体 ID
            relation_type: 关系类型
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        type_str = relation_type.value if relation_type else None
        return self.client.delete_relation(source_id, target_id, type_str)
    
    # ==================== 图查询 ====================
    
    async def find_related_entities(
        self,
        entity_id: str,
        max_depth: int = 2,
        relation_types: Optional[List[RelationType]] = None
    ) -> List[Entity]:
        """
        查找相关实体
        
        Args:
            entity_id: 起始实体 ID
            max_depth: 最大深度
            relation_types: 关系类型过滤
        
        Returns:
            相关实体列表
        """
        if not self.is_available():
            return []
        
        type_strs = [t.value for t in relation_types] if relation_types else None
        data_list = self.client.find_related_entities(
            entity_id, max_depth, type_strs
        )
        
        return [Entity.from_neo4j_node(data) for data in data_list]
    
    async def find_path(
        self,
        source_id: str,
        target_id: str,
        max_depth: int = 5
    ) -> Optional[Dict[str, Any]]:
        """
        查找路径
        
        Args:
            source_id: 源实体 ID
            target_id: 目标实体 ID
            max_depth: 最大深度
        
        Returns:
            路径信息
        """
        if not self.is_available():
            return None
        
        return self.client.find_path(source_id, target_id, max_depth)
    
    async def get_entity_context(
        self,
        entity_id: str
    ) -> Dict[str, Any]:
        """
        获取实体上下文
        
        Args:
            entity_id: 实体 ID
        
        Returns:
            上下文信息
        """
        if not self.is_available():
            return {}
        
        return self.client.get_entity_context(entity_id)
    
    async def search_by_entities(
        self,
        entity_names: List[str],
        user_id: str,
        max_depth: int = 2
    ) -> Set[str]:
        """
        根据实体名称搜索关联的记忆 ID
        
        Args:
            entity_names: 实体名称列表
            user_id: 用户 ID
            max_depth: 搜索深度
        
        Returns:
            记忆 ID 集合
        """
        if not self.is_available():
            return set()
        
        memory_ids = set()
        
        for name in entity_names:
            # 查找实体
            entity = await self.find_similar_entity(name, user_id)
            if not entity:
                continue
            
            # 获取直接关联的记忆
            direct_memories = self.client.get_entity_memories(entity['id'])
            memory_ids.update(direct_memories)
            
            # 获取相关实体的记忆
            related = self.client.find_related_entities(
                entity['id'], max_depth
            )
            for related_entity in related:
                related_memories = self.client.get_entity_memories(
                    related_entity['id']
                )
                memory_ids.update(related_memories)
        
        return memory_ids
    
    # ==================== 统计 ====================
    
    async def get_stats(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        获取图谱统计
        
        Args:
            user_id: 用户 ID
        
        Returns:
            统计信息
        """
        if not self.is_available():
            return {}
        
        return self.client.get_stats(user_id)
