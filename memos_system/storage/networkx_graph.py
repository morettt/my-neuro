# networkx_graph.py - 轻量级图存储（替代 Neo4j）
"""
基于 NetworkX 的轻量级图存储
无需安装额外软件，数据持久化到 JSON 文件
"""

import os
import json
import logging
from typing import List, Dict, Any, Optional, Set
from datetime import datetime

try:
    import networkx as nx
    NETWORKX_AVAILABLE = True
except ImportError:
    NETWORKX_AVAILABLE = False

logger = logging.getLogger(__name__)


class NetworkXGraphClient:
    """轻量级图数据库客户端（基于 NetworkX）"""
    
    def __init__(self, data_path: str = "./data/graph_store.json"):
        """
        初始化图客户端
        
        Args:
            data_path: 图数据持久化路径
        """
        self.data_path = data_path
        self.graph = nx.DiGraph()  # 有向图
        self._initialized = False
        
        if not NETWORKX_AVAILABLE:
            logger.warning("NetworkX 不可用")
            return
        
        self._load_graph()
        self._initialized = True
        logger.info(f"图数据库已初始化: {self.get_stats()}")
    
    def _load_graph(self):
        """从文件加载图数据"""
        if os.path.exists(self.data_path):
            try:
                with open(self.data_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # 加载节点
                for node in data.get('nodes', []):
                    node_id = node.pop('id')
                    self.graph.add_node(node_id, **node)
                
                # 加载边
                for edge in data.get('edges', []):
                    self.graph.add_edge(
                        edge['source'],
                        edge['target'],
                        relation_type=edge.get('relation_type', 'related'),
                        properties=edge.get('properties', {}),
                        created_at=edge.get('created_at')
                    )
                
                logger.info(f"从文件加载图数据: {len(self.graph.nodes)} 节点, {len(self.graph.edges)} 边")
            except Exception as e:
                logger.error(f"加载图数据失败: {e}")
                self.graph = nx.DiGraph()
        else:
            # 确保目录存在
            os.makedirs(os.path.dirname(self.data_path), exist_ok=True)
    
    def _save_graph(self):
        """保存图数据到文件"""
        try:
            data = {
                'nodes': [],
                'edges': [],
                'metadata': {
                    'saved_at': datetime.now().isoformat(),
                    'node_count': len(self.graph.nodes),
                    'edge_count': len(self.graph.edges)
                }
            }
            
            # 保存节点
            for node_id, attrs in self.graph.nodes(data=True):
                node_data = {'id': node_id, **attrs}
                data['nodes'].append(node_data)
            
            # 保存边
            for source, target, attrs in self.graph.edges(data=True):
                edge_data = {
                    'source': source,
                    'target': target,
                    **attrs
                }
                data['edges'].append(edge_data)
            
            # 写入文件
            os.makedirs(os.path.dirname(self.data_path), exist_ok=True)
            with open(self.data_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            
            logger.debug("图数据已保存")
        except Exception as e:
            logger.error(f"保存图数据失败: {e}")
    
    def is_available(self) -> bool:
        """检查是否可用"""
        return NETWORKX_AVAILABLE and self._initialized
    
    # ==================== 实体（节点）操作 ====================
    
    def add_entity(
        self,
        entity_id: str,
        entity_type: str,
        name: str,
        properties: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None
    ) -> bool:
        """
        添加实体
        
        Args:
            entity_id: 实体唯一 ID
            entity_type: 实体类型（person, place, concept 等）
            name: 实体名称
            properties: 附加属性
            user_id: 所属用户
        """
        if not self.is_available():
            return False
        
        try:
            self.graph.add_node(
                entity_id,
                entity_type=entity_type,
                name=name,
                properties=properties or {},
                user_id=user_id,
                created_at=datetime.now().isoformat(),
                updated_at=datetime.now().isoformat()
            )
            self._save_graph()
            logger.debug(f"添加实体: {name} ({entity_type})")
            return True
        except Exception as e:
            logger.error(f"添加实体失败: {e}")
            return False
    
    def get_entity(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """获取实体"""
        if not self.is_available():
            return None
        
        if entity_id in self.graph.nodes:
            data = dict(self.graph.nodes[entity_id])
            data['id'] = entity_id
            return data
        return None
    
    def find_entity_by_name(
        self,
        name: str,
        user_id: Optional[str] = None,
        entity_type: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """按名称查找实体（与 Neo4j 接口一致）
        
        Args:
            name: 实体名称
            user_id: 用户 ID 过滤
            entity_type: 实体类型过滤
            
        Returns:
            找到的第一个匹配实体，或 None
        """
        if not self.is_available():
            return None
        
        name_lower = name.lower()
        
        for node_id, attrs in self.graph.nodes(data=True):
            node_name = attrs.get('name', '').lower()
            
            # 名称匹配（模糊）
            if name_lower in node_name or node_name in name_lower:
                # 用户过滤
                if user_id and attrs.get('user_id') != user_id:
                    continue
                # 类型过滤
                if entity_type and attrs.get('entity_type') != entity_type:
                    continue
                
                return {'id': node_id, **attrs}
        
        return None
    
    def find_entities_by_name(
        self,
        name: str,
        user_id: Optional[str] = None,
        entity_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """按名称查找所有匹配的实体
        
        Args:
            name: 实体名称
            user_id: 用户 ID 过滤
            entity_type: 实体类型过滤
            
        Returns:
            所有匹配的实体列表
        """
        if not self.is_available():
            return []
        
        results = []
        name_lower = name.lower()
        
        for node_id, attrs in self.graph.nodes(data=True):
            node_name = attrs.get('name', '').lower()
            
            # 名称匹配（模糊）
            if name_lower in node_name or node_name in name_lower:
                # 用户过滤
                if user_id and attrs.get('user_id') != user_id:
                    continue
                # 类型过滤
                if entity_type and attrs.get('entity_type') != entity_type:
                    continue
                
                results.append({'id': node_id, **attrs})
        
        return results
    
    def update_entity(
        self,
        entity_id: str,
        properties: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None
    ) -> bool:
        """更新实体"""
        if not self.is_available() or entity_id not in self.graph.nodes:
            return False
        
        try:
            if name:
                self.graph.nodes[entity_id]['name'] = name
            if properties:
                existing = self.graph.nodes[entity_id].get('properties', {})
                existing.update(properties)
                self.graph.nodes[entity_id]['properties'] = existing
            
            self.graph.nodes[entity_id]['updated_at'] = datetime.now().isoformat()
            self._save_graph()
            return True
        except Exception as e:
            logger.error(f"更新实体失败: {e}")
            return False
    
    def delete_entity(self, entity_id: str) -> bool:
        """删除实体（同时删除相关的边）"""
        if not self.is_available() or entity_id not in self.graph.nodes:
            return False
        
        try:
            self.graph.remove_node(entity_id)
            self._save_graph()
            logger.debug(f"删除实体: {entity_id}")
            return True
        except Exception as e:
            logger.error(f"删除实体失败: {e}")
            return False
    
    def list_entities(
        self,
        user_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """列出实体
        
        Args:
            user_id: 用户 ID 过滤（与 Neo4j 接口一致）
            entity_type: 实体类型过滤
            limit: 返回数量限制
        """
        if not self.is_available():
            return []
        
        results = []
        for node_id, attrs in self.graph.nodes(data=True):
            if user_id and attrs.get('user_id') != user_id:
                continue
            if entity_type and attrs.get('entity_type') != entity_type:
                continue
            
            results.append({'id': node_id, **attrs})
            if len(results) >= limit:
                break
        
        return results
    
    def list_all_relations(
        self,
        user_id: str = "",
        limit: int = 500
    ) -> List[Dict[str, Any]]:
        """列出所有关系（用于图谱可视化）
        
        Args:
            user_id: 用户 ID（空字符串时返回所有关系）
            limit: 返回数量限制
        
        Returns:
            关系列表，每个包含 source_id, target_id, relation_type
        """
        if not self.is_available():
            return []
        
        relations = []
        for source, target, attrs in self.graph.edges(data=True):
            # 如果指定了 user_id，检查源和目标节点的 user_id
            if user_id:
                source_attrs = self.graph.nodes.get(source, {})
                target_attrs = self.graph.nodes.get(target, {})
                if source_attrs.get('user_id') != user_id or target_attrs.get('user_id') != user_id:
                    continue
            
            relations.append({
                'source_id': source,
                'target_id': target,
                'relation_type': attrs.get('relation_type', 'related_to'),
                'properties': attrs.get('properties', {})
            })
            
            if len(relations) >= limit:
                break
        
        return relations
    
    # ==================== 关系（边）操作 ====================
    
    def add_relation(
        self,
        source_id: str,
        target_id: str,
        relation_type: str,
        properties: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        添加关系
        
        Args:
            source_id: 源实体 ID
            target_id: 目标实体 ID
            relation_type: 关系类型（likes, works_at, knows 等）
            properties: 关系属性
        """
        if not self.is_available():
            return False
        
        # 确保两个节点都存在
        if source_id not in self.graph.nodes or target_id not in self.graph.nodes:
            logger.warning(f"添加关系失败: 节点不存在")
            return False
        
        try:
            self.graph.add_edge(
                source_id,
                target_id,
                relation_type=relation_type,
                properties=properties or {},
                created_at=datetime.now().isoformat()
            )
            self._save_graph()
            logger.debug(f"添加关系: {source_id} -[{relation_type}]-> {target_id}")
            return True
        except Exception as e:
            logger.error(f"添加关系失败: {e}")
            return False
    
    def get_relations(
        self,
        entity_id: str,
        direction: str = "both",
        relation_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        获取实体的关系
        
        Args:
            entity_id: 实体 ID
            direction: 方向 (out, in, both)
            relation_type: 关系类型过滤
        """
        if not self.is_available() or entity_id not in self.graph.nodes:
            return []
        
        relations = []
        
        # 出边
        if direction in ("out", "both"):
            for _, target, attrs in self.graph.out_edges(entity_id, data=True):
                if relation_type and attrs.get('relation_type') != relation_type:
                    continue
                relations.append({
                    'source': entity_id,
                    'target': target,
                    'direction': 'out',
                    **attrs
                })
        
        # 入边
        if direction in ("in", "both"):
            for source, _, attrs in self.graph.in_edges(entity_id, data=True):
                if relation_type and attrs.get('relation_type') != relation_type:
                    continue
                relations.append({
                    'source': source,
                    'target': entity_id,
                    'direction': 'in',
                    **attrs
                })
        
        return relations
    
    def delete_relation(
        self,
        source_id: str,
        target_id: str,
        relation_type: Optional[str] = None
    ) -> bool:
        """删除关系
        
        Args:
            source_id: 源实体 ID
            target_id: 目标实体 ID
            relation_type: 关系类型（可选，不指定则删除所有关系）
        """
        if not self.is_available():
            return False
        
        try:
            if self.graph.has_edge(source_id, target_id):
                # 如果指定了关系类型，检查是否匹配
                if relation_type:
                    edge_data = self.graph.edges[source_id, target_id]
                    if edge_data.get('relation_type') != relation_type:
                        return False
                
                self.graph.remove_edge(source_id, target_id)
                self._save_graph()
                return True
            return False
        except Exception as e:
            logger.error(f"删除关系失败: {e}")
            return False
    
    def get_memory_entities(self, memory_id: str) -> List[Dict[str, Any]]:
        """获取记忆关联的实体列表
        
        Args:
            memory_id: 记忆 ID
        
        Returns:
            关联的实体列表
        """
        if not self.is_available():
            return []
        
        entities = []
        
        for node_id, attrs in self.graph.nodes(data=True):
            source_memory_ids = attrs.get('source_memory_ids', [])
            if memory_id in source_memory_ids:
                entities.append({'id': node_id, **attrs})
        
        return entities
    
    # ==================== 图查询 ====================
    
    def find_related_entities(
        self,
        entity_id: str,
        max_depth: int = 2,
        relation_types: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        查找相关实体（多跳查询）
        
        Args:
            entity_id: 起始实体 ID
            max_depth: 最大深度
            relation_types: 关系类型过滤
        """
        if not self.is_available() or entity_id not in self.graph.nodes:
            return []
        
        visited: Set[str] = {entity_id}
        results = []
        current_level = [entity_id]
        
        for depth in range(1, max_depth + 1):
            next_level = []
            
            for node in current_level:
                # 出边邻居
                for neighbor in self.graph.successors(node):
                    if neighbor in visited:
                        continue
                    
                    edge_data = self.graph.edges[node, neighbor]
                    if relation_types and edge_data.get('relation_type') not in relation_types:
                        continue
                    
                    visited.add(neighbor)
                    next_level.append(neighbor)
                    
                    node_data = dict(self.graph.nodes[neighbor])
                    node_data['id'] = neighbor
                    node_data['depth'] = depth
                    node_data['path_relation'] = edge_data.get('relation_type')
                    results.append(node_data)
                
                # 入边邻居
                for neighbor in self.graph.predecessors(node):
                    if neighbor in visited:
                        continue
                    
                    edge_data = self.graph.edges[neighbor, node]
                    if relation_types and edge_data.get('relation_type') not in relation_types:
                        continue
                    
                    visited.add(neighbor)
                    next_level.append(neighbor)
                    
                    node_data = dict(self.graph.nodes[neighbor])
                    node_data['id'] = neighbor
                    node_data['depth'] = depth
                    node_data['path_relation'] = edge_data.get('relation_type')
                    results.append(node_data)
            
            current_level = next_level
            if not current_level:
                break
        
        return results
    
    def find_path(
        self,
        source_id: str,
        target_id: str,
        max_length: int = 5
    ) -> Optional[List[Dict[str, Any]]]:
        """
        查找两个实体之间的路径
        
        Args:
            source_id: 起始实体
            target_id: 目标实体
            max_length: 最大路径长度
        """
        if not self.is_available():
            return None
        
        if source_id not in self.graph.nodes or target_id not in self.graph.nodes:
            return None
        
        try:
            # 使用无向图版本查找路径
            undirected = self.graph.to_undirected()
            path = nx.shortest_path(undirected, source_id, target_id)
            
            if len(path) > max_length + 1:
                return None
            
            # 构建路径详情
            result = []
            for i, node_id in enumerate(path):
                node_data = dict(self.graph.nodes[node_id])
                node_data['id'] = node_id
                node_data['step'] = i
                
                # 添加到下一节点的关系
                if i < len(path) - 1:
                    next_id = path[i + 1]
                    if self.graph.has_edge(node_id, next_id):
                        node_data['next_relation'] = self.graph.edges[node_id, next_id].get('relation_type')
                    elif self.graph.has_edge(next_id, node_id):
                        node_data['next_relation'] = self.graph.edges[next_id, node_id].get('relation_type') + ' (反向)'
                
                result.append(node_data)
            
            return result
        except nx.NetworkXNoPath:
            return None
        except Exception as e:
            logger.error(f"查找路径失败: {e}")
            return None
    
    def search_by_entities(
        self,
        entity_names: List[str],
        user_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        根据实体名称搜索相关内容
        
        Args:
            entity_names: 实体名称列表
            user_id: 用户 ID
        """
        if not self.is_available():
            return []
        
        # 找到匹配的实体（使用 find_entities_by_name 获取所有匹配）
        matched_entities = []
        for name in entity_names:
            entities = self.find_entities_by_name(name, user_id=user_id)
            matched_entities.extend(entities)
        
        # 获取所有相关实体
        all_related = []
        seen_ids = set()
        
        for entity in matched_entities:
            if entity['id'] in seen_ids:
                continue
            seen_ids.add(entity['id'])
            all_related.append(entity)
            
            # 获取一跳相关
            related = self.find_related_entities(entity['id'], max_depth=1)
            for r in related:
                if r['id'] not in seen_ids:
                    seen_ids.add(r['id'])
                    all_related.append(r)
        
        return all_related
    
    def get_entity_memories(self, entity_id: str) -> List[str]:
        """获取实体关联的记忆 ID
        
        Args:
            entity_id: 实体 ID
        
        Returns:
            记忆 ID 列表
        """
        if not self.is_available() or entity_id not in self.graph.nodes:
            return []
        
        # 从实体节点的 source_memory_ids 属性获取
        entity_data = self.graph.nodes[entity_id]
        memory_ids = entity_data.get('source_memory_ids', [])
        
        # 也检查关系中的 source_memory_id
        for _, _, attrs in self.graph.edges(entity_id, data=True):
            mem_id = attrs.get('source_memory_id')
            if mem_id and mem_id not in memory_ids:
                memory_ids.append(mem_id)
        
        for _, _, attrs in self.graph.in_edges(entity_id, data=True):
            mem_id = attrs.get('source_memory_id')
            if mem_id and mem_id not in memory_ids:
                memory_ids.append(mem_id)
        
        return memory_ids
    
    def link_entity_to_memory(
        self,
        entity_id: str,
        memory_id: str
    ) -> bool:
        """将实体关联到记忆
        
        Args:
            entity_id: 实体 ID
            memory_id: 记忆 ID
        
        Returns:
            是否成功
        """
        if not self.is_available() or entity_id not in self.graph.nodes:
            return False
        
        try:
            # 获取当前的 source_memory_ids
            current_ids = self.graph.nodes[entity_id].get('source_memory_ids', [])
            
            if memory_id not in current_ids:
                current_ids.append(memory_id)
                self.graph.nodes[entity_id]['source_memory_ids'] = current_ids
                self._save_graph()
            
            return True
        except Exception as e:
            logger.error(f"关联实体到记忆失败: {e}")
            return False
    
    def get_memories_by_entities(
        self,
        entity_ids: List[str]
    ) -> List[str]:
        """获取多个实体关联的所有记忆 ID
        
        Args:
            entity_ids: 实体 ID 列表
        
        Returns:
            去重的记忆 ID 列表
        """
        memory_ids = set()
        
        for entity_id in entity_ids:
            entity_memories = self.get_entity_memories(entity_id)
            memory_ids.update(entity_memories)
        
        return list(memory_ids)
    
    # ==================== 统计 ====================
    
    def get_stats(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """获取图统计信息
        
        Args:
            user_id: 用户 ID 过滤（与 Neo4j 接口一致）
        """
        if not self.is_available():
            return {'available': False}
        
        # 统计实体类型
        entity_types = {}
        entity_count = 0
        for _, attrs in self.graph.nodes(data=True):
            # 用户过滤
            if user_id and attrs.get('user_id') != user_id:
                continue
            
            entity_count += 1
            etype = attrs.get('entity_type', 'unknown')
            entity_types[etype] = entity_types.get(etype, 0) + 1
        
        # 统计关系类型
        relation_types = {}
        relation_count = 0
        for source, target, attrs in self.graph.edges(data=True):
            # 用户过滤（检查源节点或目标节点是否属于该用户）
            if user_id:
                source_user = self.graph.nodes.get(source, {}).get('user_id')
                target_user = self.graph.nodes.get(target, {}).get('user_id')
                if source_user != user_id and target_user != user_id:
                    continue
            
            relation_count += 1
            rtype = attrs.get('relation_type', 'unknown')
            relation_types[rtype] = relation_types.get(rtype, 0) + 1
        
        return {
            'available': True,
            'entity_count': entity_count if user_id else len(self.graph.nodes),
            'relation_count': relation_count if user_id else len(self.graph.edges),
            'entity_types': entity_types,
            'relation_types': relation_types
        }
    
    # ==================== Neo4j 兼容方法 ====================
    # 以下方法是为了与 Neo4j 客户端接口保持一致
    
    def create_entity(
        self,
        entity_id: str,
        name: str,
        entity_type: str,
        user_id: str,
        properties: Optional[Dict[str, Any]] = None
    ) -> bool:
        """创建实体（Neo4j 兼容接口）"""
        return self.add_entity(
            entity_id=entity_id,
            entity_type=entity_type,
            name=name,
            properties=properties,
            user_id=user_id
        )
    
    def create_relation(
        self,
        source_id: str,
        target_id: str,
        relation_type: str,
        properties: Optional[Dict[str, Any]] = None
    ) -> bool:
        """创建关系（Neo4j 兼容接口）"""
        return self.add_relation(
            source_id=source_id,
            target_id=target_id,
            relation_type=relation_type,
            properties=properties
        )
    
    def link_memory_to_entity(
        self,
        memory_id: str,
        entity_id: str
    ) -> bool:
        """将记忆关联到实体（Neo4j 兼容接口）"""
        return self.link_entity_to_memory(entity_id, memory_id)
    
    def get_entity_context(self, entity_id: str) -> Dict[str, Any]:
        """获取实体上下文
        
        Args:
            entity_id: 实体 ID
        
        Returns:
            包含实体信息、关系和相关记忆的上下文
        """
        if not self.is_available() or entity_id not in self.graph.nodes:
            return {}
        
        entity = self.get_entity(entity_id)
        if not entity:
            return {}
        
        # 获取关系
        relations = self.get_relations(entity_id, direction="both")
        
        # 获取关联的记忆
        memory_ids = self.get_entity_memories(entity_id)
        
        # 获取相关实体（1 跳）
        related = self.find_related_entities(entity_id, max_depth=1)
        
        return {
            'entity': entity,
            'relations': relations,
            'memory_ids': memory_ids,
            'related_entities': related
        }
    
    def close(self):
        """关闭（保存数据）"""
        self._save_graph()
        logger.info("图数据库已关闭")


# 兼容 Neo4j 接口的别名
MemosNeo4jClient = NetworkXGraphClient
