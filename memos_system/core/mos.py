# mos.py - Memory Operating System 核心类
"""
MOS (Memory Operating System) 核心类
统一管理记忆操作、用户管理、知识图谱等功能
"""

import os
import uuid
import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class MOSConfig:
    """MOS 配置类"""
    
    def __init__(self, config_path: Optional[str] = None):
        self.config = {}
        if config_path and os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                self.config = json.load(f)
    
    @property
    def qdrant_path(self) -> str:
        return self.config.get('storage', {}).get('vector', {}).get('path', './data/qdrant')
    
    @property
    def qdrant_collection(self) -> str:
        return self.config.get('storage', {}).get('vector', {}).get('collection_name', 'memories')
    
    @property
    def vector_size(self) -> int:
        return self.config.get('embedding', {}).get('vector_size', 768)
    
    @property
    def embedding_model_path(self) -> str:
        return self.config.get('embedding', {}).get('model_path', '../full-hub/rag-hub')
    
    @property
    def neo4j_enabled(self) -> bool:
        return self.config.get('storage', {}).get('graph', {}).get('enabled', False)
    
    @property
    def neo4j_uri(self) -> str:
        return self.config.get('storage', {}).get('graph', {}).get('uri', 'bolt://localhost:7687')
    
    @property
    def neo4j_user(self) -> str:
        return self.config.get('storage', {}).get('graph', {}).get('user', 'neo4j')
    
    @property
    def neo4j_password(self) -> str:
        return self.config.get('storage', {}).get('graph', {}).get('password', 'password')
    
    @property
    def default_top_k(self) -> int:
        return self.config.get('search', {}).get('default_top_k', 5)
    
    @property
    def similarity_threshold(self) -> float:
        return self.config.get('search', {}).get('similarity_threshold', 0.5)
    
    @property
    def importance_weight(self) -> float:
        return self.config.get('search', {}).get('importance_weight', 0.3)
    
    @property
    def enable_graph_query(self) -> bool:
        return self.config.get('search', {}).get('enable_graph_query', False)
    
    @property
    def graph_max_depth(self) -> int:
        return self.config.get('search', {}).get('graph_max_depth', 2)
    
    @property
    def entity_extraction_enabled(self) -> bool:
        return self.config.get('entity_extraction', {}).get('enabled', False)
    
    @property
    def llm_config(self) -> Dict[str, Any]:
        return self.config.get('llm', {}).get('config', {})
    
    @property
    def default_user(self) -> str:
        return self.config.get('users', {}).get('default_user', 'feiniu_default')


class MOS:
    """Memory Operating System 核心类"""
    
    def __init__(self, config: Optional[MOSConfig] = None, config_path: Optional[str] = None):
        """
        初始化 MOS
        
        Args:
            config: MOS 配置对象
            config_path: 配置文件路径
        """
        if config:
            self.config = config
        elif config_path:
            self.config = MOSConfig(config_path)
        else:
            # 默认配置路径
            default_path = os.path.join(
                os.path.dirname(__file__), 
                '..', 'config', 'memos_config.json'
            )
            self.config = MOSConfig(default_path)
        
        # 初始化组件
        self.vector_storage = None
        self.graph_storage = None
        self.embedder = None
        self.user_manager = None
        self.graph_manager = None
        
        self._initialized = False
    
    def initialize(self):
        """初始化所有组件"""
        if self._initialized:
            return
        
        logger.info("初始化 MOS...")
        
        # 初始化向量存储
        self._init_vector_storage()
        
        # 初始化图存储（如果启用）
        if self.config.neo4j_enabled:
            self._init_graph_storage()
        
        # 初始化嵌入模型
        self._init_embedder()
        
        # 初始化管理器
        self._init_managers()
        
        self._initialized = True
        logger.info("MOS 初始化完成")
    
    def _init_vector_storage(self):
        """初始化向量存储"""
        try:
            try:
                from ..storage import MemosQdrantClient
            except ImportError:
                from storage import MemosQdrantClient
            
            self.vector_storage = MemosQdrantClient(
                path=self.config.qdrant_path,
                collection_name=self.config.qdrant_collection,
                vector_size=self.config.vector_size
            )
            
            if self.vector_storage.is_available():
                logger.info("Qdrant 向量存储已就绪")
            else:
                logger.warning("Qdrant 不可用，将使用备用存储")
                
        except Exception as e:
            logger.error(f"初始化向量存储失败: {e}")
    
    def _init_graph_storage(self):
        """初始化图存储"""
        try:
            try:
                from ..storage import MemosNeo4jClient
            except ImportError:
                from storage import MemosNeo4jClient
            
            self.graph_storage = MemosNeo4jClient(
                uri=self.config.neo4j_uri,
                user=self.config.neo4j_user,
                password=self.config.neo4j_password
            )
            
            if self.graph_storage.is_available():
                logger.info("Neo4j 图存储已就绪")
            else:
                logger.warning("Neo4j 不可用，知识图谱功能将禁用")
                
        except Exception as e:
            logger.error(f"初始化图存储失败: {e}")
    
    def _init_embedder(self):
        """初始化嵌入模型"""
        try:
            from sentence_transformers import SentenceTransformer
            import torch
            
            model_path = self.config.embedding_model_path
            if not os.path.isabs(model_path):
                model_path = os.path.join(
                    os.path.dirname(__file__), '..', model_path
                )
            
            self.embedder = SentenceTransformer(model_path)
            
            if torch.cuda.is_available():
                self.embedder = self.embedder.to('cuda')
                logger.info("Embedding 模型已加载 (GPU)")
            else:
                logger.info("Embedding 模型已加载 (CPU)")
                
        except Exception as e:
            logger.error(f"初始化 Embedding 模型失败: {e}")
    
    def _init_managers(self):
        """初始化管理器"""
        from .user_manager import UserManager
        from .graph_manager import GraphManager
        
        self.user_manager = UserManager()
        
        if self.graph_storage and self.graph_storage.is_available():
            self.graph_manager = GraphManager(self.graph_storage)
    
    # ==================== 记忆操作 ====================
    
    async def add(
        self,
        content: str,
        user_id: Optional[str] = None,
        memory_type: str = "general",
        importance: float = 0.5,
        tags: Optional[List[str]] = None,
        extract_entities: bool = False
    ) -> Dict[str, Any]:
        """
        添加记忆
        
        Args:
            content: 记忆内容
            user_id: 用户 ID
            memory_type: 记忆类型
            importance: 重要度
            tags: 标签
            extract_entities: 是否提取实体到知识图谱
        
        Returns:
            添加结果
        """
        if not self._initialized:
            self.initialize()
        
        user_id = user_id or self.config.default_user
        tags = tags or []
        
        # 生成向量
        vector = self._encode(content)
        
        # 生成 ID
        memory_id = f"mem_{uuid.uuid4().hex[:12]}"
        
        # 构建 payload
        payload = {
            'content': content,
            'user_id': user_id,
            'memory_type': memory_type,
            'importance': importance,
            'tags': tags,
            'created_at': datetime.now().isoformat(),
            'entity_ids': []
        }
        
        # 提取实体（如果启用）
        entity_ids = []
        if extract_entities and self.graph_manager:
            entity_ids = await self._extract_and_store_entities(
                content, memory_id, user_id
            )
            payload['entity_ids'] = entity_ids
        
        # 存储到向量库
        success = False
        if self.vector_storage and self.vector_storage.is_available():
            success = self.vector_storage.add_memory(memory_id, vector, payload)
        
        return {
            'success': success,
            'memory_id': memory_id,
            'entity_ids': entity_ids
        }
    
    async def search(
        self,
        query: str,
        user_id: Optional[str] = None,
        top_k: Optional[int] = None,
        similarity_threshold: Optional[float] = None,
        memory_type: Optional[str] = None,
        tags: Optional[List[str]] = None,
        use_graph: bool = False
    ) -> List[Dict[str, Any]]:
        """
        搜索记忆
        
        Args:
            query: 查询文本
            user_id: 用户 ID
            top_k: 返回数量
            similarity_threshold: 相似度阈值
            memory_type: 记忆类型过滤
            tags: 标签过滤
            use_graph: 是否使用图查询增强
        
        Returns:
            记忆列表
        """
        if not self._initialized:
            self.initialize()
        
        user_id = user_id or self.config.default_user
        top_k = top_k or self.config.default_top_k
        similarity_threshold = similarity_threshold or self.config.similarity_threshold
        
        # 生成查询向量
        query_vector = self._encode(query)
        
        # 向量检索
        results = []
        if self.vector_storage and self.vector_storage.is_available():
            results = self.vector_storage.search(
                query_vector=query_vector,
                top_k=top_k,
                score_threshold=similarity_threshold,
                user_id=user_id,
                memory_type=memory_type,
                tags=tags
            )
        
        # 图查询增强（如果启用）
        if use_graph and self.graph_manager and self.config.enable_graph_query:
            graph_results = await self._graph_enhanced_search(
                query, user_id, top_k
            )
            results = self._merge_results(results, graph_results, top_k)
        
        # 应用重要度加权
        results = self._apply_importance_weight(results)
        
        return results[:top_k]
    
    async def get(self, memory_id: str) -> Optional[Dict[str, Any]]:
        """获取单条记忆"""
        if not self._initialized:
            self.initialize()
        
        if self.vector_storage and self.vector_storage.is_available():
            return self.vector_storage.get_memory(memory_id)
        return None
    
    async def get_all(
        self,
        user_id: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """获取所有记忆"""
        if not self._initialized:
            self.initialize()
        
        user_id = user_id or self.config.default_user
        
        if self.vector_storage and self.vector_storage.is_available():
            return self.vector_storage.get_all_memories(user_id=user_id, limit=limit)
        return []
    
    async def update(
        self,
        memory_id: str,
        content: Optional[str] = None,
        importance: Optional[float] = None,
        tags: Optional[List[str]] = None,
        **kwargs
    ) -> bool:
        """更新记忆"""
        if not self._initialized:
            self.initialize()
        
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
        
        if self.vector_storage and self.vector_storage.is_available():
            return self.vector_storage.update_memory(
                memory_id, updates, new_vector
            )
        return False
    
    async def delete(self, memory_id: str) -> bool:
        """删除记忆"""
        if not self._initialized:
            self.initialize()
        
        if self.vector_storage and self.vector_storage.is_available():
            return self.vector_storage.delete_memory(memory_id)
        return False
    
    # ==================== 辅助方法 ====================
    
    def _encode(self, text: str) -> List[float]:
        """文本编码为向量"""
        if self.embedder:
            return self.embedder.encode([text])[0].tolist()
        return []
    
    def _apply_importance_weight(
        self,
        results: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """应用重要度加权"""
        weight = self.config.importance_weight
        
        for result in results:
            similarity = result.get('similarity', 0)
            importance = result.get('importance', 0.5)
            result['final_score'] = similarity * (1 + importance * weight)
        
        # 按综合得分排序
        results.sort(key=lambda x: x.get('final_score', 0), reverse=True)
        return results
    
    async def _extract_and_store_entities(
        self,
        content: str,
        memory_id: str,
        user_id: str
    ) -> List[str]:
        """
        从内容中提取实体和关系，并存储到知识图谱
        
        Args:
            content: 记忆内容
            memory_id: 记忆 ID
            user_id: 用户 ID
        
        Returns:
            提取的实体 ID 列表
        """
        if not self.graph_storage or not self.graph_storage.is_available():
            return []
        
        entity_ids = []
        
        try:
            # 初始化实体提取器
            try:
                from ..utils.entity_extractor import EntityExtractor
            except ImportError:
                from utils.entity_extractor import EntityExtractor
            
            extractor = EntityExtractor(
                llm_config=self.config.llm_config
            )
            
            # 提取实体和关系
            entities, relations = await extractor.extract(content)
            
            if not entities:
                logger.debug(f"未从内容中提取到实体")
                return []
            
            logger.info(f"提取到 {len(entities)} 个实体, {len(relations)} 个关系")
            
            # 存储实体
            entity_name_to_id = {}
            
            for extracted in entities:
                # 生成实体 ID
                import uuid
                entity_id = f"ent_{uuid.uuid4().hex[:12]}"
                
                # 检查是否已存在同名实体
                existing = self.graph_storage.find_entity_by_name(
                    extracted.name, user_id
                )
                
                if existing:
                    # 使用现有实体
                    entity_id = existing['id']
                    # 更新关联的记忆
                    if hasattr(self.graph_storage, 'link_entity_to_memory'):
                        self.graph_storage.link_entity_to_memory(entity_id, memory_id)
                else:
                    # 创建新实体
                    self.graph_storage.add_entity(
                        entity_id=entity_id,
                        entity_type=extracted.entity_type.value,
                        name=extracted.name,
                        properties={
                            'description': extracted.description,
                            'confidence': extracted.confidence,
                            'source_memory_ids': [memory_id]
                        },
                        user_id=user_id
                    )
                
                entity_name_to_id[extracted.name] = entity_id
                entity_ids.append(entity_id)
            
            # 存储关系
            for relation in relations:
                source_id = entity_name_to_id.get(relation.source_name)
                target_id = entity_name_to_id.get(relation.target_name)
                
                if source_id and target_id:
                    self.graph_storage.add_relation(
                        source_id=source_id,
                        target_id=target_id,
                        relation_type=relation.relation_type.value,
                        properties={
                            'description': relation.description,
                            'confidence': relation.confidence,
                            'source_memory_id': memory_id
                        }
                    )
            
            logger.info(f"已存储 {len(entity_ids)} 个实体到图谱")
            
        except ImportError:
            logger.warning("实体提取器不可用")
        except Exception as e:
            logger.error(f"实体提取失败: {e}")
        
        return entity_ids
    
    async def _graph_enhanced_search(
        self,
        query: str,
        user_id: str,
        top_k: int
    ) -> List[Dict[str, Any]]:
        """
        图查询增强搜索
        
        从查询中识别实体，通过知识图谱找到相关记忆
        
        Args:
            query: 查询文本
            user_id: 用户 ID
            top_k: 返回数量
        
        Returns:
            记忆列表
        """
        if not self.graph_storage or not self.graph_storage.is_available():
            return []
        
        if not self.vector_storage or not self.vector_storage.is_available():
            return []
        
        results = []
        
        try:
            # 1. 从查询中提取潜在实体名
            potential_entities = self._extract_query_entities(query)
            
            if not potential_entities:
                return []
            
            # 2. 在图中查找匹配的实体
            matched_entity_ids = []
            
            for entity_name in potential_entities:
                entity = self.graph_storage.find_entity_by_name(
                    entity_name, user_id
                )
                if entity:
                    matched_entity_ids.append(entity['id'])
                    
                    # 获取相关实体（1-2 跳）
                    related = self.graph_storage.find_related_entities(
                        entity['id'],
                        max_depth=self.config.graph_max_depth
                    )
                    for rel in related:
                        if rel['id'] not in matched_entity_ids:
                            matched_entity_ids.append(rel['id'])
            
            if not matched_entity_ids:
                return []
            
            # 3. 获取实体关联的记忆 ID
            memory_ids = []
            if hasattr(self.graph_storage, 'get_memories_by_entities'):
                memory_ids = self.graph_storage.get_memories_by_entities(
                    matched_entity_ids
                )
            else:
                for eid in matched_entity_ids:
                    mids = self.graph_storage.get_entity_memories(eid)
                    memory_ids.extend(mids)
                memory_ids = list(set(memory_ids))
            
            # 4. 从向量库获取这些记忆的详细信息
            for memory_id in memory_ids[:top_k * 2]:
                memory = self.vector_storage.get_memory(memory_id)
                if memory:
                    # 添加图增强标记
                    memory['graph_enhanced'] = True
                    memory['matched_entities'] = matched_entity_ids
                    results.append(memory)
            
            logger.debug(f"图增强搜索找到 {len(results)} 条记忆")
            
        except Exception as e:
            logger.error(f"图增强搜索失败: {e}")
        
        return results[:top_k]
    
    def _extract_query_entities(self, query: str) -> List[str]:
        """
        从查询中提取潜在的实体名称
        简单实现：提取中文词汇和英文专有名词
        
        Args:
            query: 查询文本
        
        Returns:
            潜在实体名称列表
        """
        import re
        
        entities = []
        
        # 提取中文词汇（2-4 字，可能是人名、地名、物品名）
        chinese_words = re.findall(r'[\u4e00-\u9fff]{2,4}', query)
        entities.extend(chinese_words)
        
        # 提取英文专有名词（首字母大写）
        english_names = re.findall(r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*', query)
        entities.extend(english_names)
        
        # 去重并限制数量
        seen = set()
        unique_entities = []
        for e in entities:
            if e not in seen:
                seen.add(e)
                unique_entities.append(e)
        
        return unique_entities[:10]
    
    def _merge_results(
        self,
        vector_results: List[Dict],
        graph_results: List[Dict],
        top_k: int
    ) -> List[Dict]:
        """合并向量和图查询结果"""
        # 去重并合并
        seen_ids = set()
        merged = []
        
        for result in vector_results + graph_results:
            if result['id'] not in seen_ids:
                seen_ids.add(result['id'])
                merged.append(result)
        
        return merged
    
    # ==================== 统计 ====================
    
    async def get_stats(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """获取统计信息"""
        if not self._initialized:
            self.initialize()
        
        user_id = user_id or self.config.default_user
        
        stats = {
            'total_memories': 0,
            'total_entities': 0,
            'total_relations': 0
        }
        
        if self.vector_storage and self.vector_storage.is_available():
            stats['total_memories'] = self.vector_storage.count_memories(user_id)
        
        if self.graph_storage and self.graph_storage.is_available():
            graph_stats = self.graph_storage.get_stats(user_id)
            stats['total_entities'] = graph_stats.get('entity_count', 0)
            stats['total_relations'] = graph_stats.get('relation_count', 0)
        
        return stats
    
    def close(self):
        """关闭连接"""
        if self.vector_storage:
            self.vector_storage.close()
        if self.graph_storage:
            self.graph_storage.close()
