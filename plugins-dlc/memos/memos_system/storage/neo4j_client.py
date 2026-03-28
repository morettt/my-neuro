# neo4j_client.py - MemOS Neo4j 知识图谱客户端
"""
Neo4j 图数据库客户端封装
提供实体和关系的存储、查询、图遍历等功能
"""

import os
import uuid
import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

try:
    from neo4j import GraphDatabase
    from neo4j.exceptions import ServiceUnavailable, AuthError
    NEO4J_AVAILABLE = True
except ImportError:
    NEO4J_AVAILABLE = False
    logging.warning("neo4j 未安装，知识图谱功能将不可用")

logger = logging.getLogger(__name__)


class MemosNeo4jClient:
    """MemOS 的 Neo4j 知识图谱客户端"""
    
    def __init__(
        self,
        uri: str = "bolt://localhost:7687",
        user: str = "neo4j",
        password: str = "password",
        database: str = "neo4j"
    ):
        """
        初始化 Neo4j 客户端
        
        Args:
            uri: Neo4j 连接 URI
            user: 用户名
            password: 密码
            database: 数据库名称
        """
        self.uri = uri
        self.user = user
        self.password = password
        self.database = database
        self.driver = None
        self._initialized = False
        
        if not NEO4J_AVAILABLE:
            logger.warning("Neo4j 不可用，请安装 neo4j: pip install neo4j")
            return
        
        self._init_driver()
    
    def _init_driver(self):
        """初始化 Neo4j 驱动"""
        try:
            self.driver = GraphDatabase.driver(
                self.uri,
                auth=(self.user, self.password)
            )
            # 测试连接
            with self.driver.session(database=self.database) as session:
                session.run("RETURN 1")
            
            self._initialized = True
            logger.info(f"Neo4j 连接成功: {self.uri}")
            
            # 创建约束和索引
            self._ensure_schema()
            
        except ServiceUnavailable:
            logger.error(f"无法连接到 Neo4j: {self.uri}")
            logger.info("请确保 Neo4j 服务已启动")
        except AuthError:
            logger.error("Neo4j 认证失败，请检查用户名和密码")
        except Exception as e:
            logger.error(f"Neo4j 初始化失败: {e}")
    
    def _ensure_schema(self):
        """创建必要的约束和索引"""
        try:
            with self.driver.session(database=self.database) as session:
                # 实体 ID 唯一约束
                session.run("""
                    CREATE CONSTRAINT entity_id IF NOT EXISTS
                    FOR (e:Entity) REQUIRE e.id IS UNIQUE
                """)
                
                # 记忆 ID 唯一约束
                session.run("""
                    CREATE CONSTRAINT memory_id IF NOT EXISTS
                    FOR (m:Memory) REQUIRE m.id IS UNIQUE
                """)
                
                # 用户 ID 唯一约束
                session.run("""
                    CREATE CONSTRAINT user_id IF NOT EXISTS
                    FOR (u:User) REQUIRE u.id IS UNIQUE
                """)
                
                # 实体名称索引
                session.run("""
                    CREATE INDEX entity_name IF NOT EXISTS
                    FOR (e:Entity) ON (e.name)
                """)
                
                # 实体类型索引
                session.run("""
                    CREATE INDEX entity_type IF NOT EXISTS
                    FOR (e:Entity) ON (e.type)
                """)
                
                # 用户 ID 索引（用于过滤）
                session.run("""
                    CREATE INDEX entity_user IF NOT EXISTS
                    FOR (e:Entity) ON (e.user_id)
                """)
                
                logger.info("Neo4j Schema 创建成功")
                
        except Exception as e:
            logger.warning(f"创建 Schema 时出错（可能已存在）: {e}")
    
    def is_available(self) -> bool:
        """检查 Neo4j 是否可用"""
        return NEO4J_AVAILABLE and self._initialized and self.driver is not None
    
    def close(self):
        """关闭连接"""
        if self.driver:
            self.driver.close()
            logger.info("Neo4j 连接已关闭")
    
    # ==================== 实体操作 ====================
    
    def create_entity(
        self,
        entity_id: str,
        name: str,
        entity_type: str,
        user_id: str,
        properties: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        创建实体节点
        
        Args:
            entity_id: 实体唯一 ID
            name: 实体名称
            entity_type: 实体类型（person, place, object, event, concept, preference）
            user_id: 所属用户 ID
            properties: 额外属性
        
        Returns:
            是否成功
        """
        if not self.is_available():
            logger.error("Neo4j 不可用")
            return False
        
        try:
            props = properties or {}
            props.update({
                'created_at': datetime.now().isoformat()
            })
            
            with self.driver.session(database=self.database) as session:
                session.run("""
                    MERGE (e:Entity {id: $id})
                    SET e.name = $name,
                        e.type = $type,
                        e.user_id = $user_id,
                        e += $properties
                """, id=entity_id, name=name, type=entity_type, 
                   user_id=user_id, properties=props)
            
            logger.debug(f"创建实体成功: {name} ({entity_type})")
            return True
            
        except Exception as e:
            logger.error(f"创建实体失败: {e}")
            return False
    
    def get_entity(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """
        获取实体
        
        Args:
            entity_id: 实体 ID
        
        Returns:
            实体数据
        """
        if not self.is_available():
            return None
        
        try:
            with self.driver.session(database=self.database) as session:
                result = session.run("""
                    MATCH (e:Entity {id: $id})
                    RETURN e
                """, id=entity_id)
                
                record = result.single()
                if record:
                    node = record['e']
                    return dict(node)
                return None
                
        except Exception as e:
            logger.error(f"获取实体失败: {e}")
            return None
    
    def find_entity_by_name(
        self,
        name: str,
        user_id: str,
        entity_type: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        根据名称查找实体
        
        Args:
            name: 实体名称
            user_id: 用户 ID
            entity_type: 实体类型（可选）
        
        Returns:
            实体数据
        """
        if not self.is_available():
            return None
        
        try:
            with self.driver.session(database=self.database) as session:
                if entity_type:
                    result = session.run("""
                        MATCH (e:Entity {name: $name, user_id: $user_id, type: $type})
                        RETURN e
                        LIMIT 1
                    """, name=name, user_id=user_id, type=entity_type)
                else:
                    result = session.run("""
                        MATCH (e:Entity {name: $name, user_id: $user_id})
                        RETURN e
                        LIMIT 1
                    """, name=name, user_id=user_id)
                
                record = result.single()
                if record:
                    return dict(record['e'])
                return None
                
        except Exception as e:
            logger.error(f"查找实体失败: {e}")
            return None
    
    def list_entities(
        self,
        user_id: str,
        entity_type: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        列出用户的实体
        
        Args:
            user_id: 用户 ID（空字符串时返回所有实体）
            entity_type: 实体类型过滤
            limit: 返回数量
        
        Returns:
            实体列表
        """
        if not self.is_available():
            return []
        
        try:
            with self.driver.session(database=self.database) as session:
                # 当 user_id 为空时，返回所有实体
                if user_id:
                    if entity_type:
                        result = session.run("""
                            MATCH (e:Entity {user_id: $user_id, type: $type})
                            RETURN e
                            ORDER BY e.created_at DESC
                            LIMIT $limit
                        """, user_id=user_id, type=entity_type, limit=limit)
                    else:
                        result = session.run("""
                            MATCH (e:Entity {user_id: $user_id})
                            RETURN e
                            ORDER BY e.created_at DESC
                            LIMIT $limit
                        """, user_id=user_id, limit=limit)
                else:
                    # user_id 为空，返回所有实体
                    if entity_type:
                        result = session.run("""
                            MATCH (e:Entity {type: $type})
                            RETURN e
                            ORDER BY e.created_at DESC
                            LIMIT $limit
                        """, type=entity_type, limit=limit)
                    else:
                        result = session.run("""
                            MATCH (e:Entity)
                            RETURN e
                            ORDER BY e.created_at DESC
                            LIMIT $limit
                        """, limit=limit)
                
                return [dict(record['e']) for record in result]
                
        except Exception as e:
            logger.error(f"列出实体失败: {e}")
            return []
    
    def list_all_relations(
        self,
        user_id: str,
        limit: int = 500
    ) -> List[Dict[str, Any]]:
        """
        列出所有关系（用于图谱可视化）
        
        Args:
            user_id: 用户 ID（空字符串时返回所有关系）
            limit: 返回数量
        
        Returns:
            关系列表，每个包含 source_id, target_id, relation_type
        """
        if not self.is_available():
            return []
        
        try:
            with self.driver.session(database=self.database) as session:
                # 当 user_id 为空时，返回所有关系
                if user_id:
                    result = session.run("""
                        MATCH (s:Entity {user_id: $user_id})-[r]->(t:Entity {user_id: $user_id})
                        RETURN s.id AS source_id, t.id AS target_id, type(r) AS relation_type, r AS rel_props
                        LIMIT $limit
                    """, user_id=user_id, limit=limit)
                else:
                    # user_id 为空，返回所有关系
                    result = session.run("""
                        MATCH (s:Entity)-[r]->(t:Entity)
                        RETURN s.id AS source_id, t.id AS target_id, type(r) AS relation_type, r AS rel_props
                        LIMIT $limit
                    """, limit=limit)
                
                relations = []
                for record in result:
                    rel = {
                        'source_id': record['source_id'],
                        'target_id': record['target_id'],
                        'relation_type': record['relation_type'],
                    }
                    # 添加关系属性（如果有）
                    if record['rel_props']:
                        rel['properties'] = dict(record['rel_props'])
                    relations.append(rel)
                
                return relations
                
        except Exception as e:
            logger.error(f"列出关系失败: {e}")
            return []
    
    def update_entity(
        self,
        entity_id: str,
        updates: Dict[str, Any]
    ) -> bool:
        """
        更新实体属性
        
        Args:
            entity_id: 实体 ID
            updates: 要更新的属性
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        try:
            updates['updated_at'] = datetime.now().isoformat()
            
            with self.driver.session(database=self.database) as session:
                session.run("""
                    MATCH (e:Entity {id: $id})
                    SET e += $updates
                """, id=entity_id, updates=updates)
            
            return True
            
        except Exception as e:
            logger.error(f"更新实体失败: {e}")
            return False
    
    def delete_entity(self, entity_id: str) -> bool:
        """
        删除实体及其关系
        
        Args:
            entity_id: 实体 ID
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        try:
            with self.driver.session(database=self.database) as session:
                session.run("""
                    MATCH (e:Entity {id: $id})
                    DETACH DELETE e
                """, id=entity_id)
            
            logger.debug(f"删除实体成功: {entity_id}")
            return True
            
        except Exception as e:
            logger.error(f"删除实体失败: {e}")
            return False
    
    # ==================== 关系操作 ====================
    
    def create_relation(
        self,
        source_id: str,
        target_id: str,
        relation_type: str,
        properties: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        创建实体间关系
        
        Args:
            source_id: 源实体 ID
            target_id: 目标实体 ID
            relation_type: 关系类型（LIKES, KNOWS, RELATED_TO 等）
            properties: 关系属性
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        try:
            props = properties or {}
            props['created_at'] = datetime.now().isoformat()
            
            # 动态关系类型需要使用 APOC 或字符串拼接
            query = f"""
                MATCH (a:Entity {{id: $source_id}})
                MATCH (b:Entity {{id: $target_id}})
                MERGE (a)-[r:{relation_type}]->(b)
                SET r += $properties
                RETURN r
            """
            
            with self.driver.session(database=self.database) as session:
                session.run(query, source_id=source_id, target_id=target_id, 
                          properties=props)
            
            logger.debug(f"创建关系成功: {source_id} -[{relation_type}]-> {target_id}")
            return True
            
        except Exception as e:
            logger.error(f"创建关系失败: {e}")
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
            direction: 方向（outgoing, incoming, both）
            relation_type: 关系类型过滤
        
        Returns:
            关系列表
        """
        if not self.is_available():
            return []
        
        try:
            with self.driver.session(database=self.database) as session:
                if direction == "outgoing":
                    pattern = "(e)-[r]->(other)"
                elif direction == "incoming":
                    pattern = "(e)<-[r]-(other)"
                else:
                    pattern = "(e)-[r]-(other)"
                
                if relation_type:
                    pattern = pattern.replace("[r]", f"[r:{relation_type}]")
                
                query = f"""
                    MATCH (e:Entity {{id: $id}})
                    MATCH {pattern}
                    RETURN type(r) as relation_type, 
                           properties(r) as properties,
                           other.id as other_id,
                           other.name as other_name,
                           other.type as other_type
                """
                
                result = session.run(query, id=entity_id)
                
                relations = []
                for record in result:
                    relations.append({
                        'relation_type': record['relation_type'],
                        'properties': record['properties'],
                        'other_id': record['other_id'],
                        'other_name': record['other_name'],
                        'other_type': record['other_type']
                    })
                
                return relations
                
        except Exception as e:
            logger.error(f"获取关系失败: {e}")
            return []
    
    def delete_relation(
        self,
        source_id: str,
        target_id: str,
        relation_type: Optional[str] = None
    ) -> bool:
        """
        删除关系
        
        Args:
            source_id: 源实体 ID
            target_id: 目标实体 ID
            relation_type: 关系类型（可选，不指定则删除所有关系）
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        try:
            with self.driver.session(database=self.database) as session:
                if relation_type:
                    query = f"""
                        MATCH (a:Entity {{id: $source_id}})-[r:{relation_type}]->(b:Entity {{id: $target_id}})
                        DELETE r
                    """
                else:
                    query = """
                        MATCH (a:Entity {id: $source_id})-[r]-(b:Entity {id: $target_id})
                        DELETE r
                    """
                
                session.run(query, source_id=source_id, target_id=target_id)
            
            return True
            
        except Exception as e:
            logger.error(f"删除关系失败: {e}")
            return False
    
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
        
        Returns:
            相关实体列表，包含距离
        """
        if not self.is_available():
            return []
        
        try:
            with self.driver.session(database=self.database) as session:
                if relation_types:
                    rel_filter = "|".join(relation_types)
                    query = f"""
                        MATCH path = (start:Entity {{id: $id}})-[:{rel_filter}*1..{max_depth}]-(related:Entity)
                        WHERE related.id <> $id
                        RETURN DISTINCT related,
                               length(path) as distance,
                               [r in relationships(path) | type(r)] as path_relations
                        ORDER BY distance
                    """
                else:
                    query = f"""
                        MATCH path = (start:Entity {{id: $id}})-[*1..{max_depth}]-(related:Entity)
                        WHERE related.id <> $id
                        RETURN DISTINCT related,
                               length(path) as distance,
                               [r in relationships(path) | type(r)] as path_relations
                        ORDER BY distance
                    """
                
                result = session.run(query, id=entity_id)
                
                entities = []
                for record in result:
                    entity = dict(record['related'])
                    entity['distance'] = record['distance']
                    entity['path_relations'] = record['path_relations']
                    entities.append(entity)
                
                return entities
                
        except Exception as e:
            logger.error(f"查找相关实体失败: {e}")
            return []
    
    def find_path(
        self,
        source_id: str,
        target_id: str,
        max_depth: int = 5
    ) -> Optional[Dict[str, Any]]:
        """
        查找两个实体间的最短路径
        
        Args:
            source_id: 源实体 ID
            target_id: 目标实体 ID
            max_depth: 最大深度
        
        Returns:
            路径信息
        """
        if not self.is_available():
            return None
        
        try:
            with self.driver.session(database=self.database) as session:
                result = session.run(f"""
                    MATCH path = shortestPath(
                        (a:Entity {{id: $source_id}})-[*..{max_depth}]-(b:Entity {{id: $target_id}})
                    )
                    RETURN path,
                           length(path) as distance,
                           [n in nodes(path) | n.name] as node_names,
                           [r in relationships(path) | type(r)] as relation_types
                """, source_id=source_id, target_id=target_id)
                
                record = result.single()
                if record:
                    return {
                        'distance': record['distance'],
                        'node_names': record['node_names'],
                        'relation_types': record['relation_types']
                    }
                return None
                
        except Exception as e:
            logger.error(f"查找路径失败: {e}")
            return None
    
    def get_entity_context(
        self,
        entity_id: str
    ) -> Dict[str, Any]:
        """
        获取实体的完整上下文（关联的实体和记忆）
        
        Args:
            entity_id: 实体 ID
        
        Returns:
            上下文信息
        """
        if not self.is_available():
            return {}
        
        try:
            with self.driver.session(database=self.database) as session:
                result = session.run("""
                    MATCH (e:Entity {id: $id})
                    OPTIONAL MATCH (e)-[r]-(related:Entity)
                    OPTIONAL MATCH (e)<-[:CONTAINS]-(m:Memory)
                    RETURN e as entity,
                           collect(DISTINCT {
                               relation: type(r),
                               entity_id: related.id,
                               entity_name: related.name,
                               entity_type: related.type
                           }) as relations,
                           collect(DISTINCT m.id) as memory_ids
                """, id=entity_id)
                
                record = result.single()
                if record:
                    return {
                        'entity': dict(record['entity']) if record['entity'] else None,
                        'relations': [r for r in record['relations'] if r.get('entity_id')],
                        'memory_ids': [m for m in record['memory_ids'] if m]
                    }
                return {}
                
        except Exception as e:
            logger.error(f"获取实体上下文失败: {e}")
            return {}
    
    # ==================== 记忆-实体关联 ====================
    
    def link_memory_to_entity(
        self,
        memory_id: str,
        entity_id: str
    ) -> bool:
        """
        关联记忆和实体
        
        Args:
            memory_id: 记忆 ID
            entity_id: 实体 ID
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        try:
            with self.driver.session(database=self.database) as session:
                session.run("""
                    MERGE (m:Memory {id: $memory_id})
                    WITH m
                    MATCH (e:Entity {id: $entity_id})
                    MERGE (m)-[:CONTAINS]->(e)
                """, memory_id=memory_id, entity_id=entity_id)
            
            return True
            
        except Exception as e:
            logger.error(f"关联记忆和实体失败: {e}")
            return False
    
    def get_memory_entities(self, memory_id: str) -> List[Dict[str, Any]]:
        """
        获取记忆关联的实体
        
        Args:
            memory_id: 记忆 ID
        
        Returns:
            实体列表
        """
        if not self.is_available():
            return []
        
        try:
            with self.driver.session(database=self.database) as session:
                result = session.run("""
                    MATCH (m:Memory {id: $memory_id})-[:CONTAINS]->(e:Entity)
                    RETURN e
                """, memory_id=memory_id)
                
                return [dict(record['e']) for record in result]
                
        except Exception as e:
            logger.error(f"获取记忆实体失败: {e}")
            return []
    
    def get_entity_memories(self, entity_id: str) -> List[str]:
        """
        获取实体关联的记忆 ID
        
        Args:
            entity_id: 实体 ID
        
        Returns:
            记忆 ID 列表
        """
        if not self.is_available():
            return []
        
        try:
            with self.driver.session(database=self.database) as session:
                result = session.run("""
                    MATCH (m:Memory)-[:CONTAINS]->(e:Entity {id: $entity_id})
                    RETURN m.id as memory_id
                """, entity_id=entity_id)
                
                return [record['memory_id'] for record in result]
                
        except Exception as e:
            logger.error(f"获取实体记忆失败: {e}")
            return []
    
    # ==================== 统计 ====================
    
    def get_stats(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        获取图数据库统计
        
        Args:
            user_id: 用户 ID 过滤
        
        Returns:
            统计信息
        """
        if not self.is_available():
            return {}
        
        try:
            with self.driver.session(database=self.database) as session:
                if user_id:
                    result = session.run("""
                        MATCH (e:Entity {user_id: $user_id})
                        WITH count(e) as entity_count
                        MATCH (e:Entity {user_id: $user_id})-[r]-()
                        RETURN entity_count, count(r)/2 as relation_count
                    """, user_id=user_id)
                else:
                    result = session.run("""
                        MATCH (e:Entity)
                        WITH count(e) as entity_count
                        MATCH ()-[r]-()
                        RETURN entity_count, count(r)/2 as relation_count
                    """)
                
                record = result.single()
                if record:
                    return {
                        'entity_count': record['entity_count'],
                        'relation_count': record['relation_count']
                    }
                return {'entity_count': 0, 'relation_count': 0}
                
        except Exception as e:
            logger.error(f"获取统计信息失败: {e}")
            return {}
    
    def execute_cypher(self, query: str, params: Optional[Dict] = None) -> List[Dict]:
        """
        执行自定义 Cypher 查询
        
        Args:
            query: Cypher 查询语句
            params: 参数
        
        Returns:
            查询结果
        """
        if not self.is_available():
            return []
        
        try:
            with self.driver.session(database=self.database) as session:
                result = session.run(query, params or {})
                return [dict(record) for record in result]
                
        except Exception as e:
            logger.error(f"执行 Cypher 查询失败: {e}")
            return []
