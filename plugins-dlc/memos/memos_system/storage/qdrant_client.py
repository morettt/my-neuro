# qdrant_client.py - MemOS Qdrant 向量数据库客户端
"""
Qdrant 向量数据库客户端封装
提供记忆的向量存储、检索、更新、删除等功能
"""

import os
import uuid
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        VectorParams, Distance, PointStruct,
        Filter, FieldCondition, MatchValue, Range,
        UpdateStatus, PayloadSchemaType
    )
    QDRANT_AVAILABLE = True
except ImportError:
    QDRANT_AVAILABLE = False
    logging.warning("qdrant-client 未安装，将使用内存存储模式")

logger = logging.getLogger(__name__)


class MemosQdrantClient:
    """MemOS 的 Qdrant 向量数据库客户端"""
    
    def __init__(
        self,
        path: str = "./memos_data/qdrant",
        collection_name: str = "memories",
        vector_size: int = 768,
        use_memory: bool = False
    ):
        """
        初始化 Qdrant 客户端
        
        Args:
            path: Qdrant 本地存储路径
            collection_name: 集合名称
            vector_size: 向量维度
            use_memory: 是否使用内存模式（不持久化）
        """
        self.path = path
        self.collection_name = collection_name
        self.vector_size = vector_size
        self.use_memory = use_memory
        self.client = None
        self._initialized = False
        
        if not QDRANT_AVAILABLE:
            logger.warning("Qdrant 不可用，请安装 qdrant-client")
            return
        
        self._init_client()
    
    def _init_client(self):
        """初始化 Qdrant 客户端"""
        try:
            if self.use_memory:
                # 内存模式
                self.client = QdrantClient(":memory:")
                logger.info("Qdrant 内存模式已启动")
            else:
                # 本地持久化模式
                os.makedirs(self.path, exist_ok=True)
                self.client = QdrantClient(path=self.path)
                logger.info(f"Qdrant 本地模式已启动: {self.path}")
            
            # 检查并创建集合
            self._ensure_collection()
            self._initialized = True
            
        except Exception as e:
            logger.error(f"Qdrant 初始化失败: {e}")
            raise
    
    def _ensure_collection(self):
        """确保集合存在，不存在则创建"""
        try:
            collections = self.client.get_collections().collections
            collection_names = [c.name for c in collections]
            
            if self.collection_name not in collection_names:
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=self.vector_size,
                        distance=Distance.COSINE
                    )
                )
                logger.info(f"创建集合: {self.collection_name}")
                
                # 创建索引
                self._create_payload_indexes()
            else:
                logger.info(f"集合已存在: {self.collection_name}")
                
        except Exception as e:
            logger.error(f"创建集合失败: {e}")
            raise
    
    def _create_payload_indexes(self):
        """创建 Payload 索引以加速过滤查询"""
        try:
            # 用户 ID 索引
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="user_id",
                field_schema=PayloadSchemaType.KEYWORD
            )
            
            # 记忆类型索引
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="memory_type",
                field_schema=PayloadSchemaType.KEYWORD
            )
            
            # 标签索引
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="tags",
                field_schema=PayloadSchemaType.KEYWORD
            )
            
            logger.info("Payload 索引创建成功")
            
        except Exception as e:
            logger.warning(f"创建索引时出错（可能已存在）: {e}")
    
    def is_available(self) -> bool:
        """检查 Qdrant 是否可用"""
        return QDRANT_AVAILABLE and self._initialized and self.client is not None
    
    # ==================== 记忆操作 ====================
    
    def add_memory(
        self,
        memory_id: str,
        vector: List[float],
        payload: Dict[str, Any]
    ) -> bool:
        """
        添加单条记忆
        
        Args:
            memory_id: 记忆唯一 ID
            vector: 向量表示
            payload: 元数据（content, user_id, importance 等）
        
        Returns:
            是否成功
        """
        if not self.is_available():
            logger.error("Qdrant 不可用")
            return False
        
        try:
            # 确保 payload 包含必要字段
            payload.setdefault('created_at', datetime.now().isoformat())
            payload.setdefault('importance', 0.5)
            
            self.client.upsert(
                collection_name=self.collection_name,
                points=[
                    PointStruct(
                        id=memory_id,
                        vector=vector,
                        payload=payload
                    )
                ]
            )
            logger.debug(f"添加记忆成功: {memory_id}")
            return True
            
        except Exception as e:
            logger.error(f"添加记忆失败: {e}")
            return False
    
    def add_memories_batch(
        self,
        memories: List[Dict[str, Any]]
    ) -> int:
        """
        批量添加记忆
        
        Args:
            memories: 记忆列表，每个元素包含 id, vector, payload
        
        Returns:
            成功添加的数量
        """
        if not self.is_available():
            logger.error("Qdrant 不可用")
            return 0
        
        try:
            points = []
            for mem in memories:
                payload = mem.get('payload', {})
                payload.setdefault('created_at', datetime.now().isoformat())
                payload.setdefault('importance', 0.5)
                
                points.append(
                    PointStruct(
                        id=mem['id'],
                        vector=mem['vector'],
                        payload=payload
                    )
                )
            
            self.client.upsert(
                collection_name=self.collection_name,
                points=points
            )
            logger.info(f"批量添加 {len(points)} 条记忆成功")
            return len(points)
            
        except Exception as e:
            logger.error(f"批量添加记忆失败: {e}")
            return 0
    
    def search(
        self,
        query_vector: List[float],
        top_k: int = 5,
        score_threshold: float = 0.5,
        user_id: Optional[str] = None,
        memory_type: Optional[str] = None,
        tags: Optional[List[str]] = None,
        importance_min: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """
        搜索相似记忆
        
        Args:
            query_vector: 查询向量
            top_k: 返回数量
            score_threshold: 相似度阈值
            user_id: 用户 ID 过滤
            memory_type: 记忆类型过滤
            tags: 标签过滤
            importance_min: 最低重要度
        
        Returns:
            记忆列表，包含 id, content, similarity, payload
        """
        if not self.is_available():
            logger.error("Qdrant 不可用")
            return []
        
        try:
            # 构建过滤条件
            filter_conditions = []
            
            if user_id:
                filter_conditions.append(
                    FieldCondition(
                        key="user_id",
                        match=MatchValue(value=user_id)
                    )
                )
            
            if memory_type:
                filter_conditions.append(
                    FieldCondition(
                        key="memory_type",
                        match=MatchValue(value=memory_type)
                    )
                )
            
            if tags:
                for tag in tags:
                    filter_conditions.append(
                        FieldCondition(
                            key="tags",
                            match=MatchValue(value=tag)
                        )
                    )
            
            if importance_min is not None:
                filter_conditions.append(
                    FieldCondition(
                        key="importance",
                        range=Range(gte=importance_min)
                    )
                )
            
            # 构建过滤器
            query_filter = None
            if filter_conditions:
                query_filter = Filter(must=filter_conditions)
            
            # 执行搜索 (qdrant-client >= 1.7 使用 query_points)
            results = self.client.query_points(
                collection_name=self.collection_name,
                query=query_vector,
                limit=top_k,
                score_threshold=score_threshold,
                query_filter=query_filter
            )
            
            # 格式化返回结果
            memories = []
            for hit in results.points:
                memories.append({
                    'id': hit.id,
                    'content': hit.payload.get('content', ''),
                    'similarity': round(hit.score, 4),
                    'importance': hit.payload.get('importance', 0.5),
                    'created_at': hit.payload.get('created_at'),
                    'updated_at': hit.payload.get('updated_at'),
                    'memory_type': hit.payload.get('memory_type', 'general'),
                    'tags': hit.payload.get('tags', []),
                    'entity_ids': hit.payload.get('entity_ids', []),
                    'payload': hit.payload
                })
            
            logger.debug(f"搜索返回 {len(memories)} 条结果")
            return memories
            
        except Exception as e:
            logger.error(f"搜索记忆失败: {e}")
            return []
    
    def get_memory(self, memory_id: str) -> Optional[Dict[str, Any]]:
        """
        获取单条记忆
        
        Args:
            memory_id: 记忆 ID
        
        Returns:
            记忆数据，包含 id, content, payload
        """
        if not self.is_available():
            return None
        
        try:
            results = self.client.retrieve(
                collection_name=self.collection_name,
                ids=[memory_id],
                with_payload=True,
                with_vectors=True
            )
            
            if results:
                point = results[0]
                return {
                    'id': point.id,
                    'content': point.payload.get('content', ''),
                    'vector': point.vector,
                    'payload': point.payload
                }
            return None
            
        except Exception as e:
            logger.error(f"获取记忆失败: {e}")
            return None
    
    def get_all_memories(
        self,
        user_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """
        获取所有记忆（分页）
        
        Args:
            user_id: 用户 ID 过滤
            limit: 返回数量
            offset: 偏移量
        
        Returns:
            记忆列表
        """
        if not self.is_available():
            return []
        
        try:
            # 构建过滤器
            query_filter = None
            if user_id:
                query_filter = Filter(
                    must=[
                        FieldCondition(
                            key="user_id",
                            match=MatchValue(value=user_id)
                        )
                    ]
                )
            
            # 使用 scroll 获取所有记录
            results, _ = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=query_filter,
                limit=limit,
                offset=offset,
                with_payload=True,
                with_vectors=False
            )
            
            memories = []
            for point in results:
                memories.append({
                    'id': point.id,
                    'content': point.payload.get('content', ''),
                    'importance': point.payload.get('importance', 0.5),
                    'created_at': point.payload.get('created_at'),
                    'updated_at': point.payload.get('updated_at'),
                    'memory_type': point.payload.get('memory_type', 'general'),
                    'tags': point.payload.get('tags', []),
                    'merge_count': point.payload.get('merge_count', 0),
                    'payload': point.payload
                })
            
            return memories
            
        except Exception as e:
            logger.error(f"获取记忆列表失败: {e}")
            return []
    
    def update_memory(
        self,
        memory_id: str,
        payload_updates: Dict[str, Any],
        new_vector: Optional[List[float]] = None
    ) -> bool:
        """
        更新记忆
        
        Args:
            memory_id: 记忆 ID
            payload_updates: 要更新的字段
            new_vector: 新的向量（可选）
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        try:
            # 添加更新时间
            payload_updates['updated_at'] = datetime.now().isoformat()
            
            # 更新 payload
            self.client.set_payload(
                collection_name=self.collection_name,
                points=[memory_id],
                payload=payload_updates
            )
            
            # 如果有新向量，更新向量
            if new_vector:
                # 获取现有 payload
                existing = self.get_memory(memory_id)
                if existing:
                    merged_payload = {**existing['payload'], **payload_updates}
                    self.client.upsert(
                        collection_name=self.collection_name,
                        points=[
                            PointStruct(
                                id=memory_id,
                                vector=new_vector,
                                payload=merged_payload
                            )
                        ]
                    )
            
            logger.debug(f"更新记忆成功: {memory_id}")
            return True
            
        except Exception as e:
            logger.error(f"更新记忆失败: {e}")
            return False
    
    def delete_memory(self, memory_id: str) -> bool:
        """
        删除记忆
        
        Args:
            memory_id: 记忆 ID
        
        Returns:
            是否成功
        """
        if not self.is_available():
            return False
        
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=[memory_id]
            )
            logger.debug(f"删除记忆成功: {memory_id}")
            return True
            
        except Exception as e:
            logger.error(f"删除记忆失败: {e}")
            return False
    
    def delete_memories_batch(self, memory_ids: List[str]) -> int:
        """
        批量删除记忆
        
        Args:
            memory_ids: 记忆 ID 列表
        
        Returns:
            成功删除的数量
        """
        if not self.is_available():
            return 0
        
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=memory_ids
            )
            logger.info(f"批量删除 {len(memory_ids)} 条记忆成功")
            return len(memory_ids)
            
        except Exception as e:
            logger.error(f"批量删除记忆失败: {e}")
            return 0
    
    # ==================== 统计和维护 ====================
    
    def get_collection_info(self) -> Dict[str, Any]:
        """获取集合信息"""
        if not self.is_available():
            return {}
        
        try:
            info = self.client.get_collection(self.collection_name)
            # 兼容新版本 qdrant-client
            points_count = getattr(info, 'points_count', 0) or 0
            vectors_count = getattr(info, 'vectors_count', points_count) or points_count
            status = info.status.value if hasattr(info.status, 'value') else str(info.status)
            return {
                'name': self.collection_name,
                'vectors_count': vectors_count,
                'points_count': points_count,
                'status': status,
                'vector_size': self.vector_size
            }
        except Exception as e:
            logger.error(f"获取集合信息失败: {e}")
            return {}
    
    def count_memories(self, user_id: Optional[str] = None) -> int:
        """
        统计记忆数量
        
        Args:
            user_id: 用户 ID 过滤
        
        Returns:
            记忆数量
        """
        if not self.is_available():
            return 0
        
        try:
            if user_id:
                result = self.client.count(
                    collection_name=self.collection_name,
                    count_filter=Filter(
                        must=[
                            FieldCondition(
                                key="user_id",
                                match=MatchValue(value=user_id)
                            )
                        ]
                    )
                )
                return result.count
            else:
                info = self.client.get_collection(self.collection_name)
                return info.points_count
                
        except Exception as e:
            logger.error(f"统计记忆数量失败: {e}")
            return 0
    
    def find_similar(
        self,
        vector: List[float],
        threshold: float = 0.95,
        exclude_id: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        查找相似记忆（用于去重）
        
        Args:
            vector: 向量
            threshold: 相似度阈值
            exclude_id: 排除的 ID
            user_id: 用户 ID
        
        Returns:
            最相似的记忆，或 None
        """
        results = self.search(
            query_vector=vector,
            top_k=5,
            score_threshold=threshold,
            user_id=user_id
        )
        
        for result in results:
            if exclude_id and result['id'] == exclude_id:
                continue
            return result
        
        return None
    
    def close(self):
        """关闭连接"""
        if self.client:
            try:
                self.client.close()
                logger.info("Qdrant 连接已关闭")
            except:
                pass


# ==================== 迁移工具 ====================

def migrate_from_json(
    json_file: str,
    qdrant_client: MemosQdrantClient,
    embedding_model
) -> int:
    """
    从 JSON 文件迁移记忆到 Qdrant
    
    Args:
        json_file: JSON 文件路径
        qdrant_client: Qdrant 客户端
        embedding_model: 嵌入模型（用于重新生成向量）
    
    Returns:
        迁移成功的数量
    """
    import json
    
    if not os.path.exists(json_file):
        logger.error(f"文件不存在: {json_file}")
        return 0
    
    try:
        with open(json_file, 'r', encoding='utf-8') as f:
            memories = json.load(f)
        
        logger.info(f"读取到 {len(memories)} 条记忆")
        
        migrated = 0
        batch = []
        batch_size = 50
        
        for mem in memories:
            # 获取或生成向量
            if 'embedding' in mem and mem['embedding']:
                vector = mem['embedding']
            else:
                # 重新生成向量
                content = mem.get('content', '')
                if content:
                    vector = embedding_model.encode([content])[0].tolist()
                else:
                    continue
            
            # 构建 payload
            payload = {
                'content': mem.get('content', ''),
                'user_id': mem.get('user_id', 'feiniu_default'),
                'importance': mem.get('importance', 0.5),
                'memory_type': mem.get('memory_type', 'general'),
                'tags': mem.get('tags', []),
                'created_at': mem.get('created_at') or mem.get('timestamp'),
                'updated_at': mem.get('updated_at'),
                'merge_count': mem.get('merge_count', 0),
                'source': 'migrated_from_json'
            }
            
            # 生成 ID
            memory_id = mem.get('id') or f"migrated_{migrated}_{uuid.uuid4().hex[:8]}"
            
            batch.append({
                'id': memory_id,
                'vector': vector,
                'payload': payload
            })
            
            # 批量插入
            if len(batch) >= batch_size:
                count = qdrant_client.add_memories_batch(batch)
                migrated += count
                batch = []
                logger.info(f"已迁移 {migrated} 条记忆")
        
        # 处理剩余
        if batch:
            count = qdrant_client.add_memories_batch(batch)
            migrated += count
        
        logger.info(f"迁移完成，共 {migrated} 条记忆")
        return migrated
        
    except Exception as e:
        logger.error(f"迁移失败: {e}")
        return 0
