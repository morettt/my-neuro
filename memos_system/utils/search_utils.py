# search_utils.py - 高级搜索工具
"""
提供 BM25、Reranker、混合搜索等功能
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict

logger = logging.getLogger(__name__)

# 尝试导入 BM25
try:
    from rank_bm25 import BM25Okapi
    BM25_AVAILABLE = True
except ImportError:
    BM25_AVAILABLE = False
    logger.warning("rank-bm25 未安装，BM25 搜索不可用")


class BM25Searcher:
    """BM25 关键词搜索器"""
    
    def __init__(self, tokenizer=None):
        """
        初始化 BM25 搜索器
        
        Args:
            tokenizer: 分词函数，默认使用空格分词
        """
        self.tokenizer = tokenizer or self._default_tokenizer
        self.bm25 = None
        self.documents = []
        self.doc_ids = []
    
    def _default_tokenizer(self, text: str) -> List[str]:
        """默认分词器（简单空格分词 + 中文字符分割）"""
        import re
        
        # 简单处理：按空格和标点分割
        tokens = re.findall(r'[\u4e00-\u9fff]+|[a-zA-Z0-9]+', text.lower())
        
        # 对中文进一步切分为单字（简化处理）
        result = []
        for token in tokens:
            if re.match(r'[\u4e00-\u9fff]+', token):
                # 中文：2-gram
                for i in range(len(token)):
                    result.append(token[i])
                    if i < len(token) - 1:
                        result.append(token[i:i+2])
            else:
                result.append(token)
        
        return result
    
    def build_index(
        self,
        documents: List[Dict[str, Any]],
        content_field: str = 'content',
        id_field: str = 'id'
    ):
        """
        构建 BM25 索引
        
        Args:
            documents: 文档列表
            content_field: 内容字段名
            id_field: ID 字段名
        """
        if not BM25_AVAILABLE:
            logger.warning("BM25 不可用")
            return
        
        self.documents = documents
        self.doc_ids = [doc.get(id_field, str(i)) for i, doc in enumerate(documents)]
        
        # 分词
        tokenized_docs = [
            self.tokenizer(doc.get(content_field, ''))
            for doc in documents
        ]
        
        self.bm25 = BM25Okapi(tokenized_docs)
        logger.info(f"BM25 索引构建完成，共 {len(documents)} 个文档")
    
    def search(
        self,
        query: str,
        top_k: int = 10
    ) -> List[Tuple[str, float]]:
        """
        BM25 搜索
        
        Args:
            query: 查询文本
            top_k: 返回数量
        
        Returns:
            [(doc_id, score), ...]
        """
        if not BM25_AVAILABLE or self.bm25 is None:
            return []
        
        # 分词
        query_tokens = self.tokenizer(query)
        
        # 获取分数
        scores = self.bm25.get_scores(query_tokens)
        
        # 排序并返回 top_k
        scored_docs = list(zip(self.doc_ids, scores))
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        
        return scored_docs[:top_k]
    
    def add_document(
        self,
        doc_id: str,
        content: str,
        rebuild: bool = True
    ):
        """
        增量添加文档到索引
        
        Args:
            doc_id: 文档 ID
            content: 文档内容
            rebuild: 是否重建索引（默认 True）
        """
        if not BM25_AVAILABLE:
            return
        
        # 避免重复添加
        if doc_id in self.doc_ids:
            return
        
        # 添加到文档列表
        self.documents.append({'id': doc_id, 'content': content})
        self.doc_ids.append(doc_id)
        
        # 重建索引（BM25Okapi 不支持增量更新，需要重建）
        if rebuild:
            tokenized_docs = [
                self.tokenizer(doc.get('content', ''))
                for doc in self.documents
            ]
            self.bm25 = BM25Okapi(tokenized_docs)
            logger.debug(f"BM25 索引已更新，共 {len(self.documents)} 个文档")
    
    def add_documents_batch(
        self,
        documents: List[Dict[str, Any]],
        content_field: str = 'content',
        id_field: str = 'id'
    ):
        """
        批量添加文档到索引
        
        Args:
            documents: 文档列表
            content_field: 内容字段名
            id_field: ID 字段名
        """
        if not BM25_AVAILABLE:
            return
        
        added = 0
        for doc in documents:
            doc_id = doc.get(id_field, '')
            if doc_id and doc_id not in self.doc_ids:
                self.documents.append(doc)
                self.doc_ids.append(doc_id)
                added += 1
        
        if added > 0:
            # 重建索引
            tokenized_docs = [
                self.tokenizer(doc.get(content_field, ''))
                for doc in self.documents
            ]
            self.bm25 = BM25Okapi(tokenized_docs)
            logger.info(f"BM25 索引批量更新，新增 {added} 个文档，共 {len(self.documents)} 个")
    
    def is_available(self) -> bool:
        """检查 BM25 是否可用"""
        return BM25_AVAILABLE and self.bm25 is not None


class HybridSearcher:
    """混合搜索器（向量 + BM25 + 图）"""
    
    def __init__(
        self,
        vector_storage=None,
        graph_storage=None,
        embedder=None,
        bm25_weight: float = 0.3,
        vector_weight: float = 0.5,
        graph_weight: float = 0.2
    ):
        """
        初始化混合搜索器
        
        Args:
            vector_storage: 向量存储客户端
            graph_storage: 图存储客户端
            embedder: 嵌入模型
            bm25_weight: BM25 权重
            vector_weight: 向量搜索权重
            graph_weight: 图搜索权重
        """
        self.vector_storage = vector_storage
        self.graph_storage = graph_storage
        self.embedder = embedder
        
        self.bm25_weight = bm25_weight
        self.vector_weight = vector_weight
        self.graph_weight = graph_weight
        
        self.bm25_searcher = BM25Searcher()
        self._bm25_indexed = False
    
    def build_bm25_index(self, documents: List[Dict[str, Any]]):
        """构建 BM25 索引"""
        self.bm25_searcher.build_index(documents)
        self._bm25_indexed = True
    
    def _encode(self, text: str) -> List[float]:
        """文本编码"""
        if self.embedder:
            return self.embedder.encode([text])[0].tolist()
        return []
    
    def search(
        self,
        query: str,
        user_id: str,
        top_k: int = 10,
        similarity_threshold: float = 0.3,
        use_bm25: bool = True,
        use_graph: bool = True,
        memory_type: Optional[str] = None,
        tags: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        混合搜索
        
        Args:
            query: 查询文本
            user_id: 用户 ID
            top_k: 返回数量
            similarity_threshold: 相似度阈值
            use_bm25: 是否使用 BM25
            use_graph: 是否使用图搜索
            memory_type: 类型过滤
            tags: 标签过滤
        
        Returns:
            搜索结果列表
        """
        results_map = defaultdict(lambda: {'scores': {}, 'data': None})
        
        # 1. 向量搜索
        if self.vector_storage and self.vector_storage.is_available():
            query_vector = self._encode(query)
            vector_results = self.vector_storage.search(
                query_vector=query_vector,
                top_k=top_k * 2,
                score_threshold=similarity_threshold,
                user_id=user_id,
                memory_type=memory_type,
                tags=tags
            )
            
            for result in vector_results:
                doc_id = result['id']
                results_map[doc_id]['scores']['vector'] = result.get('similarity', 0)
                results_map[doc_id]['data'] = result
        
        # 2. BM25 搜索
        if use_bm25 and self._bm25_indexed:
            bm25_results = self.bm25_searcher.search(query, top_k * 2)
            
            # 归一化 BM25 分数
            if bm25_results:
                max_score = max(score for _, score in bm25_results) or 1
                for doc_id, score in bm25_results:
                    normalized_score = score / max_score
                    results_map[doc_id]['scores']['bm25'] = normalized_score
        
        # 3. 图搜索
        if use_graph and self.graph_storage and self.graph_storage.is_available():
            graph_memory_ids = self._graph_search(query, user_id)
            
            for memory_id in graph_memory_ids:
                results_map[memory_id]['scores']['graph'] = 1.0
        
        # 4. 合并分数
        final_results = []
        
        for doc_id, result_data in results_map.items():
            scores = result_data['scores']
            data = result_data['data']
            
            # 加权求和
            final_score = 0
            if 'vector' in scores:
                final_score += scores['vector'] * self.vector_weight
            if 'bm25' in scores:
                final_score += scores['bm25'] * self.bm25_weight
            if 'graph' in scores:
                final_score += scores['graph'] * self.graph_weight
            
            if data:
                data['final_score'] = final_score
                data['score_breakdown'] = scores
                final_results.append(data)
            else:
                # 需要从存储中获取数据
                if self.vector_storage:
                    memory = self.vector_storage.get_memory(doc_id)
                    if memory:
                        memory['final_score'] = final_score
                        memory['score_breakdown'] = scores
                        final_results.append(memory)
        
        # 5. 排序
        final_results.sort(key=lambda x: x.get('final_score', 0), reverse=True)
        
        return final_results[:top_k]
    
    def _graph_search(
        self,
        query: str,
        user_id: str,
        max_depth: int = 2
    ) -> List[str]:
        """
        图搜索：从查询中提取实体，找到关联的记忆
        
        Args:
            query: 查询文本
            user_id: 用户 ID
            max_depth: 搜索深度
        
        Returns:
            记忆 ID 列表
        """
        if not self.graph_storage or not self.graph_storage.is_available():
            return []
        
        memory_ids = []
        
        # 简单策略：将查询作为实体名搜索
        # 实际应用中可以用 NER 提取实体
        potential_entities = self._extract_potential_entities(query)
        
        for entity_name in potential_entities:
            # 查找匹配的实体
            entity = self.graph_storage.find_entity_by_name(
                entity_name, user_id
            )
            
            if entity:
                # 获取关联的记忆
                entity_memories = self.graph_storage.get_entity_memories(
                    entity['id']
                )
                memory_ids.extend(entity_memories)
                
                # 获取相关实体的记忆
                related = self.graph_storage.find_related_entities(
                    entity['id'], max_depth
                )
                for related_entity in related:
                    related_memories = self.graph_storage.get_entity_memories(
                        related_entity['id']
                    )
                    memory_ids.extend(related_memories)
        
        return list(set(memory_ids))
    
    def _extract_potential_entities(self, text: str) -> List[str]:
        """
        从文本中提取潜在的实体名称
        简单实现：提取名词短语
        """
        import re
        
        # 简单策略：提取连续的中文字符或英文单词
        entities = []
        
        # 中文词汇（2-4 字）
        chinese_words = re.findall(r'[\u4e00-\u9fff]{2,4}', text)
        entities.extend(chinese_words)
        
        # 英文词汇（首字母大写可能是专有名词）
        english_words = re.findall(r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*', text)
        entities.extend(english_words)
        
        return entities[:10]  # 限制数量


class Reranker:
    """重排序器（可选使用 Cross-Encoder）"""
    
    def __init__(self, model_name_or_path: Optional[str] = None):
        """
        初始化重排序器
        
        Args:
            model_name_or_path: 模型名称或路径
        """
        self.model = None
        self.model_path = model_name_or_path
        
        if model_name_or_path:
            self._load_model()
    
    def _load_model(self):
        """加载重排序模型"""
        try:
            from sentence_transformers import CrossEncoder
            self.model = CrossEncoder(self.model_path)
            logger.info(f"重排序模型加载成功: {self.model_path}")
        except ImportError:
            logger.warning("sentence-transformers 未安装，Reranker 不可用")
        except Exception as e:
            logger.error(f"加载重排序模型失败: {e}")
    
    def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        content_field: str = 'content',
        top_k: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        重排序
        
        Args:
            query: 查询文本
            documents: 文档列表
            content_field: 内容字段名
            top_k: 返回数量
        
        Returns:
            重排序后的文档列表
        """
        if not self.model or not documents:
            return documents
        
        # 构建 query-doc 对
        pairs = [
            [query, doc.get(content_field, '')]
            for doc in documents
        ]
        
        # 获取分数
        scores = self.model.predict(pairs)
        
        # 添加分数并排序
        for doc, score in zip(documents, scores):
            doc['rerank_score'] = float(score)
        
        documents.sort(key=lambda x: x.get('rerank_score', 0), reverse=True)
        
        if top_k:
            return documents[:top_k]
        return documents
    
    def is_available(self) -> bool:
        """检查 Reranker 是否可用"""
        return self.model is not None
