# memos_api_server_v2.py - MemOS FastAPI 服务（完整集成版）
"""
集成 Qdrant 向量数据库、Neo4j 知识图谱的完整版 MemOS API

新功能：
- Qdrant 向量数据库（替代 JSON 存储）
- Neo4j 知识图谱（可选）
- 混合检索（向量 + BM25）
- 实体关系提取
- 多用户支持
- MemCube 容器
"""

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from contextlib import asynccontextmanager
import uvicorn
import json
import os
import re
import asyncio
import uuid
import logging
from datetime import datetime

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 全局变量
embedding_model = None
qdrant_client = None
neo4j_client = None
config = None
llm_config = None
full_config = None
bm25_searcher = None
preference_memory = None  # 偏好记忆管理器
tool_memory = None        # 工具记忆管理器
document_loader = None    # 文档加载器
scheduler = None          # 异步任务调度器
image_memory = None       # 图像记忆管理器
entity_extractor = None   # 实体提取器

# 记忆类型权重配置（搜索时加权）
MEMORY_TYPE_WEIGHTS = {
    'preference': 1.5,    # 偏好记忆权重最高
    'fact': 1.3,          # 事实记忆
    'semantic': 1.2,      # 语义记忆
    'episodic': 1.0,      # 情景记忆（基准）
    'procedural': 1.1,    # 程序记忆
    'event': 1.0,         # 事件记忆
    'tool': 0.9,          # 工具记忆
    'general': 1.0,       # 通用记忆
}

# 兼容旧版：内存备份存储
memory_store_backup = []
USER_ID = "feiniu_default"


# ==================== 生命周期管理 ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时初始化
    await startup_event()
    yield
    # 关闭时清理
    await shutdown_event()


app = FastAPI(
    title="MemOS API for 肥牛AI",
    version="2.0.0",
    description="集成 Qdrant + Neo4j 的完整版记忆系统",
    lifespan=lifespan
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== 请求模型（兼容旧版） ====================

class AddMemoryRequest(BaseModel):
    messages: List[Dict[str, str]]
    user_id: Optional[str] = USER_ID


class RawMemoryMessage(BaseModel):
    content: str
    role: Optional[str] = "user"
    importance: Optional[float] = 0.8
    memory_type: Optional[str] = "general"  # 支持指定记忆类型
    tags: Optional[List[str]] = None  # 标签


class AddRawMemoryRequest(BaseModel):
    messages: List[RawMemoryMessage]
    user_id: Optional[str] = USER_ID
    extract_entities: Optional[bool] = False  # 是否提取实体到图谱


class SearchMemoryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 5
    user_id: Optional[str] = USER_ID
    similarity_threshold: Optional[float] = 0.5
    use_graph: Optional[bool] = None   # 是否使用图增强（None表示使用配置文件设置）
    use_bm25: Optional[bool] = None    # 是否使用BM25混合搜索（None表示使用配置文件设置）
    tags: Optional[List[str]] = None   # 标签过滤
    memory_types: Optional[List[str]] = None  # 记忆类型过滤


class MigrateRequest(BaseModel):
    file_path: str


# ==================== 初始化 ====================

async def startup_event():
    """启动时初始化所有组件"""
    global embedding_model, qdrant_client, neo4j_client, config
    global llm_config, full_config, bm25_searcher, memory_store_backup
    
    print("=" * 60)
    print("  [启动] MemOS 服务（完整集成版 v2.0）")
    print("=" * 60)
    
    try:
        # 1. 加载配置
        config_path = os.path.join(os.path.dirname(__file__), "..", "config", "memos_config.json")
        print(f"[配置] 配置文件: {config_path}")
        
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                full_config = config
                llm_config = config.get('llm', {}).get('config', {})
                
                if llm_config and all(llm_config.get(k) for k in ['model', 'api_key', 'base_url']):
                    print(f"[OK] LLM 配置: {llm_config.get('model')}")
                else:
                    print("[警告] LLM 配置不完整")
        else:
            print(f"[警告] 配置文件不存在，使用默认配置")
            config = {}
        
        # 2. 加载 Embedding 模型
        print("[加载] Embedding 模型...")
        from sentence_transformers import SentenceTransformer
        import torch
        
        model_path = config.get('embedding', {}).get('model_path', '../full-hub/rag-hub')
        if not os.path.isabs(model_path):
            model_path = os.path.join(os.path.dirname(__file__), "..", model_path)
        model_path = os.path.normpath(model_path)
        
        embedding_model = SentenceTransformer(model_path)
        if torch.cuda.is_available():
            embedding_model = embedding_model.to('cuda')
            print("[OK] Embedding 模型已加载 (GPU)")
        else:
            print("[OK] Embedding 模型已加载 (CPU)")
        
        # 3. 初始化 Qdrant
        print("[初始化] Qdrant 向量数据库...")
        try:
            import sys
            sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
            from storage.qdrant_client import MemosQdrantClient
            
            qdrant_path = config.get('storage', {}).get('vector', {}).get('path', './data/qdrant')
            if not os.path.isabs(qdrant_path):
                qdrant_path = os.path.join(os.path.dirname(__file__), "..", qdrant_path)
            qdrant_path = os.path.normpath(qdrant_path)
            
            vector_size = config.get('embedding', {}).get('vector_size', 768)
            collection_name = config.get('storage', {}).get('vector', {}).get('collection_name', 'memories')
            
            qdrant_client = MemosQdrantClient(
                path=qdrant_path,
                collection_name=collection_name,
                vector_size=vector_size
            )
            
            if qdrant_client.is_available():
                info = qdrant_client.get_collection_info()
                print(f"[OK] Qdrant 已就绪: {info.get('points_count', 0)} 条记忆")
            else:
                print("[警告] Qdrant 初始化失败，使用内存存储")
                qdrant_client = None
        except ImportError as e:
            print(f"[警告] Qdrant 模块导入失败: {e}")
            print("   请运行: pip install qdrant-client")
            qdrant_client = None
        except Exception as e:
            print(f"[警告] Qdrant 初始化失败: {e}")
            qdrant_client = None
        
        # 4. 初始化图数据库（如果启用）
        graph_enabled = config.get('storage', {}).get('graph', {}).get('enabled', False)
        if graph_enabled:
            graph_type = config.get('storage', {}).get('graph', {}).get('type', 'networkx')
            print(f"[初始化] 图数据库 ({graph_type})...")
            try:
                graph_config = config.get('storage', {}).get('graph', {})
                
                if graph_type == 'networkx':
                    # 使用轻量级 NetworkX 图存储
                    from storage.networkx_graph import NetworkXGraphClient
                    graph_path = graph_config.get('path', './data/graph_store.json')
                    if not os.path.isabs(graph_path):
                        graph_path = os.path.join(os.path.dirname(__file__), "..", graph_path)
                    neo4j_client = NetworkXGraphClient(data_path=graph_path)
                else:
                    # 使用 Neo4j
                    from storage.neo4j_client import MemosNeo4jClient
                    neo4j_client = MemosNeo4jClient(
                        uri=graph_config.get('uri', 'bolt://localhost:7687'),
                        user=graph_config.get('user', 'neo4j'),
                        password=graph_config.get('password', 'password')
                    )
                
                if neo4j_client.is_available():
                    stats = neo4j_client.get_stats()
                    print(f"[OK] 图数据库已就绪: {stats.get('entity_count', 0)} 实体, {stats.get('relation_count', 0)} 关系")
                else:
                    print("[警告] 图数据库初始化失败")
                    neo4j_client = None
            except Exception as e:
                print(f"[警告] 图数据库初始化失败: {e}")
                neo4j_client = None
        else:
            print("[信息] 图数据库未启用")
        
        # 5. 加载备份数据（兼容旧版）
        legacy_json = config.get('storage', {}).get('legacy_json', {})
        if legacy_json.get('enabled', True):
            json_path = legacy_json.get('path', './data/memory_store.json')
            if not os.path.isabs(json_path):
                json_path = os.path.join(os.path.dirname(__file__), "..", json_path)
            
            if os.path.exists(json_path):
                try:
                    with open(json_path, 'r', encoding='utf-8') as f:
                        memory_store_backup = json.load(f)
                    print(f"[OK] 加载 JSON 备份: {len(memory_store_backup)} 条记忆")
                    
                    # 如果 Qdrant 为空，尝试迁移
                    if qdrant_client and qdrant_client.is_available():
                        qdrant_count = qdrant_client.count_memories()
                        if qdrant_count == 0 and len(memory_store_backup) > 0:
                            print("[迁移] 检测到需要迁移数据到 Qdrant...")
                            await migrate_json_to_qdrant()
                except Exception as e:
                    print(f"[警告] 加载 JSON 备份失败: {e}")
        
        # 6. 初始化 BM25 索引（如果启用）
        if config.get('search', {}).get('enable_bm25', False):
            print("[初始化] BM25 索引...")
            try:
                from utils.search_utils import BM25Searcher
                bm25_searcher = BM25Searcher()
                await rebuild_bm25_index()
                print("[OK] BM25 索引已就绪")
            except Exception as e:
                print(f"[警告] BM25 初始化失败: {e}")
        
        # 7. 初始化偏好记忆管理器
        global preference_memory
        print("[初始化] 偏好记忆管理器...")
        try:
            from memories.preference_memory import PreferenceMemory
            preference_memory = PreferenceMemory(
                user_id=USER_ID,
                vector_storage=qdrant_client,
                graph_storage=neo4j_client,
                embedder=embedding_model
            )
            await preference_memory.load()
            pref_summary = await preference_memory.get_summary()
            print(f"[OK] 偏好记忆已就绪: {pref_summary.get('total_count', 0)} 个偏好")
        except Exception as e:
            print(f"[警告] 偏好记忆初始化失败: {e}")
            import traceback
            traceback.print_exc()
            preference_memory = None
        
        # 8. 初始化工具记忆管理器
        global tool_memory
        print("[初始化] 工具记忆管理器...")
        try:
            from memories.tool_memory import ToolMemory
            tool_memory = ToolMemory(
                user_id=USER_ID,
                vector_storage=qdrant_client
            )
            await tool_memory.load()
            tool_stats = await tool_memory.get_stats()
            print(f"[OK] 工具记忆已就绪: {tool_stats.get('total_usage', 0)} 条使用记录")
        except Exception as e:
            print(f"[警告] 工具记忆初始化失败: {e}")
            tool_memory = None
        
        # 9. 初始化文档加载器
        global document_loader
        print("[初始化] 文档加载器...")
        try:
            from utils.document_loader import DocumentLoader
            document_loader = DocumentLoader(
                chunk_size=config.get('kb', {}).get('chunk_size', 500),
                chunk_overlap=config.get('kb', {}).get('chunk_overlap', 50)
            )
            print("[OK] 文档加载器已就绪")
        except Exception as e:
            print(f"[警告] 文档加载器初始化失败: {e}")
            document_loader = None
        
        # 10. 初始化异步任务调度器
        global scheduler
        scheduler_config = config.get('scheduler', {}) if config else {}
        if scheduler_config.get('enabled', False):
            print("[初始化] 异步任务调度器...")
            try:
                from core.scheduler import MemScheduler
                scheduler = MemScheduler(
                    use_redis=scheduler_config.get('use_redis', False),
                    redis_url=scheduler_config.get('redis_url', 'redis://localhost:6379'),
                    max_workers=scheduler_config.get('max_workers', 4),
                    quota_per_user=scheduler_config.get('quota_per_user', 100)
                )
                await scheduler.start()
                
                # 注册任务处理器
                scheduler.register_handler('add_memory', _handle_add_memory_task)
                scheduler.register_handler('process_image', _handle_process_image_task)
                scheduler.register_handler('extract_entities', _handle_extract_entities_task)
                
                print(f"[OK] 调度器已就绪: {scheduler_config.get('max_workers', 4)} 个工作协程")
            except Exception as e:
                print(f"[警告] 调度器初始化失败: {e}")
                scheduler = None
        else:
            print("[信息] 异步调度器未启用（可在配置中启用）")
        
        # 11. 初始化图像记忆管理器
        global image_memory
        image_config = config.get('image', {}) if config else {}
        if image_config.get('enabled', True):
            print("[初始化] 图像记忆管理器...")
            try:
                from memories.image_memory import ImageMemory
                image_storage_path = image_config.get('storage_path', './data/images')
                if not os.path.isabs(image_storage_path):
                    image_storage_path = os.path.join(os.path.dirname(__file__), "..", image_storage_path)
                
                image_memory = ImageMemory(
                    storage_path=image_storage_path,
                    vector_storage=qdrant_client,
                    embedder=embedding_model,
                    llm_config=llm_config,
                    use_clip=image_config.get('use_clip', False),
                    max_image_size=image_config.get('max_size_mb', 5) * 1024 * 1024
                )
                await image_memory.load_metadata()
                img_stats = image_memory.get_stats()
                print(f"[OK] 图像记忆已就绪: {img_stats.get('total_images', 0)} 张图像")
            except Exception as e:
                print(f"[警告] 图像记忆初始化失败: {e}")
                image_memory = None
        
        # 12. 初始化实体提取器
        global entity_extractor
        entity_config = config.get('entity_extraction', {}) if config else {}
        if entity_config.get('enabled', False) and llm_config:
            print("[初始化] 实体提取器...")
            try:
                from utils.entity_extractor import EntityExtractor
                entity_extractor = EntityExtractor(
                    llm_config=llm_config,
                    fallback_config=full_config.get('llm_fallback', {}).get('config') if full_config else None
                )
                print("[OK] 实体提取器已就绪")
            except Exception as e:
                print(f"[警告] 实体提取器初始化失败: {e}")
                entity_extractor = None
        else:
            print("[信息] 实体提取器未启用（可在配置中启用）")
        
        print("=" * 60)
        print("  [OK] MemOS 服务启动成功!")
        print("=" * 60)
        print(f"  Qdrant: {'已启用' if qdrant_client else '未启用'}")
        print(f"  Graph: {'已启用' if neo4j_client else '未启用'}")
        print(f"  Scheduler: {'已启用' if scheduler else '未启用'}")
        print(f"  Image: {'已启用' if image_memory else '未启用'}")
        print(f"  Entity: {'已启用' if entity_extractor else '未启用'}")
        print(f"  LLM: {llm_config.get('model', '未配置') if llm_config else '未配置'}")
        print("=" * 60)
        
    except Exception as e:
        print(f"[错误] 初始化失败: {e}")
        import traceback
        traceback.print_exc()


# ==================== 调度器任务处理器 ====================

async def _handle_add_memory_task(task):
    """处理添加记忆任务"""
    from core.scheduler import Task
    payload = task.payload
    
    content = payload.get('content', '')
    user_id = payload.get('user_id', USER_ID)
    importance = payload.get('importance', 0.5)
    memory_type = payload.get('memory_type', 'general')
    
    if not content:
        return {'status': 'error', 'message': '内容为空'}
    
    vector = encode_text(content)
    memory_id = str(uuid.uuid4())
    
    qdrant_payload = {
        'content': content,
        'user_id': user_id,
        'importance': importance,
        'memory_type': memory_type,
        'created_at': datetime.now().isoformat(),
        'async_processed': True
    }
    
    if qdrant_client and qdrant_client.is_available():
        qdrant_client.add_memory(memory_id, vector, qdrant_payload)
        return {'status': 'success', 'memory_id': memory_id}
    
    return {'status': 'error', 'message': '存储不可用'}


async def _handle_process_image_task(task):
    """处理图像任务"""
    payload = task.payload
    
    if not image_memory:
        return {'status': 'error', 'message': '图像记忆未启用'}
    
    image_data = payload.get('image_data')
    if not image_data:
        return {'status': 'error', 'message': '图像数据为空'}
    
    result = await image_memory.save_image_from_base64(
        image_data,
        original_name=payload.get('filename', 'image.jpg'),
        image_type=payload.get('image_type', 'other'),
        description=payload.get('description'),
        tags=payload.get('tags', []),
        user_id=payload.get('user_id', USER_ID)
    )
    
    if result:
        return {'status': 'success', 'image_id': result.id}
    return {'status': 'error', 'message': '处理失败'}


async def _handle_extract_entities_task(task):
    """处理实体提取任务"""
    payload = task.payload
    content = payload.get('content', '')
    
    if not content:
        return {'status': 'error', 'message': '内容为空'}
    
    # TODO: 实现实体提取逻辑
    return {'status': 'success', 'entities': []}


async def shutdown_event():
    """关闭时清理资源"""
    global qdrant_client, neo4j_client, scheduler
    
    print("[关闭] 正在关闭 MemOS 服务...")
    
    # 关闭调度器
    if scheduler:
        try:
            await scheduler.stop()
            print("[OK] 调度器已停止")
        except:
            pass
    
    if qdrant_client:
        try:
            qdrant_client.close()
        except:
            pass
    
    if neo4j_client:
        try:
            neo4j_client.close()
        except:
            pass
    
    print("[OK] MemOS 服务已关闭")


async def migrate_json_to_qdrant():
    """将 JSON 数据迁移到 Qdrant"""
    global memory_store_backup, qdrant_client
    
    if not qdrant_client or not memory_store_backup:
        return
    
    print(f"[迁移] 开始迁移 {len(memory_store_backup)} 条记忆到 Qdrant...")
    
    batch = []
    migrated = 0
    
    for i, mem in enumerate(memory_store_backup):
        content = mem.get('content', '')
        if not content or len(content) < 5:
            continue
        
        # 获取或生成向量
        if 'embedding' in mem and mem['embedding']:
            vector = mem['embedding']
        else:
            vector = embedding_model.encode([content])[0].tolist()
        
        # 构建 payload
        payload = {
            'content': content,
            'user_id': mem.get('user_id', USER_ID),
            'importance': mem.get('importance', 0.5),
            'memory_type': mem.get('memory_type', 'general'),
            'tags': mem.get('tags', []),
            'created_at': mem.get('created_at') or mem.get('timestamp', datetime.now().isoformat()),
            'updated_at': mem.get('updated_at'),
            'merge_count': mem.get('merge_count', 0),
            'source': 'migrated_from_json'
        }
        
        memory_id = mem.get('id') or f"migrated_{i}_{uuid.uuid4().hex[:8]}"
        
        batch.append({
            'id': memory_id,
            'vector': vector,
            'payload': payload
        })
        
        if len(batch) >= 50:
            count = qdrant_client.add_memories_batch(batch)
            migrated += count
            batch = []
            print(f"  进度: {migrated}/{len(memory_store_backup)}")
    
    if batch:
        count = qdrant_client.add_memories_batch(batch)
        migrated += count
    
    print(f"[OK] 迁移完成: {migrated} 条记忆")


async def rebuild_bm25_index():
    """重建 BM25 索引"""
    global bm25_searcher, qdrant_client
    
    if not bm25_searcher:
        return
    
    # 从 Qdrant 获取所有文档
    if qdrant_client and qdrant_client.is_available():
        documents = qdrant_client.get_all_memories(limit=10000)
        bm25_searcher.build_index(documents)


def update_bm25_index(memory_id: str, content: str):
    """增量更新 BM25 索引（添加单条记忆）"""
    global bm25_searcher
    
    if bm25_searcher and hasattr(bm25_searcher, 'add_document'):
        try:
            bm25_searcher.add_document(memory_id, content)
        except Exception as e:
            print(f"[警告] BM25 索引更新失败: {e}")


# ==================== 工具函数 ====================

def encode_text(text: str) -> List[float]:
    """文本编码为向量"""
    if embedding_model:
        return embedding_model.encode([text])[0].tolist()
    return []


def get_storage():
    """获取存储客户端"""
    return qdrant_client


async def process_conversation_batch(conversation: str) -> Dict[str, Any]:
    """使用 LLM 从对话中提取记忆"""
    global llm_config, full_config
    
    if not llm_config:
        return {"memories": []}
    
    # 构建模型列表
    models_to_try = []
    
    api_key = llm_config.get('api_key', '')
    model = llm_config.get('model', '')
    base_url = llm_config.get('base_url', '')
    
    if api_key and model and base_url:
        models_to_try.append({
            'name': '主模型',
            'api_key': api_key,
            'model': model,
            'base_url': base_url
        })
    
    # 备用模型
    fallback_config = full_config.get('llm_fallback', {}) if full_config else {}
    if fallback_config.get('enabled', False):
        fb_cfg = fallback_config.get('config', {})
        if all(fb_cfg.get(k) for k in ['api_key', 'model', 'base_url']):
            models_to_try.append({
                'name': '备用模型',
                **fb_cfg
            })
    
    if not models_to_try:
        return {"memories": []}
    
    import aiohttp
    
    prompt = f"""你是记忆提取专家。从以下多轮对话中提取关键事实，并按类型严格分类。

身份说明：
- "主人"是使用AI的真人用户
- "肥牛"是AI助手

提取规则：
1. 用自然的中文描述要点，每条记忆15-80字
2. 忽略无意义的闲聊
3. 判断重要度（0.1-1.0）
4. **严格按以下类型分类记忆（memory_type）**：
   - preference: 用户表达的喜好/偏好/厌恶（关键词："喜欢"、"不喜欢"、"讨厌"、"最爱"、"偏好"、"想要"）
   - fact: 用户的客观个人信息（姓名、生日、年龄、职业、地址、身体数据、联系方式等）
   - episodic: 具体的事件或经历（关键词："今天"、"昨天"、"刚才"、"上次"、有明确时间/地点的事件）
   - semantic: 用户了解/学习的知识概念（关键词："知道"、"了解"、"学到"、技术知识、概念理解）
   - procedural: 用户的技能/习惯/日常规律（关键词："会做"、"习惯"、"每天都"、"总是"、"经常"）
   - general: 无法归入以上任何类别的记忆（仅当完全不符合以上任何类型时使用）
5. 提取相关标签（tags），1-3个关键词

**分类优先级（如果可归入多个类型，选择优先级最高的）**：
preference > fact > episodic > procedural > semantic > general

**分类示例**：
- "主人喜欢吃辣的食物" → preference（表达喜好）
- "主人的生日是5月20日" → fact（个人信息）
- "主人今天去了健身房锻炼" → episodic（具体事件）
- "主人每天早上都会喝咖啡" → procedural（日常习惯）
- "主人了解Python编程" → semantic（知识技能）

对话内容：
{conversation}

请返回 JSON：
{{"memories": [
  {{"content": "主人喜欢吃辣的食物", "importance": 0.9, "memory_type": "preference", "tags": ["食物", "口味"]}},
  {{"content": "主人今天去了健身房锻炼", "importance": 0.6, "memory_type": "episodic", "tags": ["健身", "运动"]}},
  {{"content": "主人的生日是5月20日", "importance": 0.95, "memory_type": "fact", "tags": ["生日", "个人信息"]}}
]}}
"""
    
    timeouts = [60, 120]
    
    for model_info in models_to_try:
        for attempt, timeout_seconds in enumerate(timeouts, 1):
            try:
                async with aiohttp.ClientSession() as session:
                    headers = {
                        "Authorization": f"Bearer {model_info['api_key']}",
                        "Content-Type": "application/json"
                    }
                    
                    payload = {
                        "model": model_info['model'],
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 2000,
                        "temperature": 0.3
                    }
                    
                    async with session.post(
                        f"{model_info['base_url']}/chat/completions",
                        headers=headers,
                        json=payload,
                        timeout=aiohttp.ClientTimeout(total=timeout_seconds)
                    ) as response:
                        if response.status == 200:
                            result = await response.json()
                            response_text = result['choices'][0]['message']['content'].strip()
                            
                            try:
                                parsed = json.loads(response_text)
                            except:
                                json_match = re.search(r'\{[\s\S]*"memories"[\s\S]*\}', response_text)
                                if json_match:
                                    parsed = json.loads(json_match.group())
                                else:
                                    continue
                            
                            memories = parsed.get('memories', [])
                            valid_memories = []
                            
                            # 有效的记忆类型列表
                            valid_types = ['preference', 'fact', 'episodic', 'semantic', 'procedural', 'general']
                            
                            for mem in memories:
                                if isinstance(mem, dict) and mem.get('content'):
                                    content = str(mem['content']).strip()
                                    try:
                                        importance = float(mem.get('importance', 0.5))
                                    except:
                                        importance = 0.5
                                    importance = max(0.1, min(1.0, importance))
                                    
                                    # 🔥 提取 memory_type 并验证
                                    memory_type = mem.get('memory_type', 'general')
                                    if memory_type not in valid_types:
                                        memory_type = 'general'
                                    
                                    # 🔥 提取 tags 并验证
                                    tags = mem.get('tags', [])
                                    if not isinstance(tags, list):
                                        tags = []
                                    
                                    if len(content) >= 5:
                                        valid_memories.append({
                                            "content": content,
                                            "importance": importance,
                                            "memory_type": memory_type,  # 🔥 保留记忆类型
                                            "tags": tags                  # 🔥 保留标签
                                        })
                            
                            return {"memories": valid_memories}
                            
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.warning(f"LLM 调用失败: {e}")
                continue
    
    return {"memories": []}


# ==================== API 端点 ====================

@app.get("/")
async def root():
    """服务状态"""
    return {
        "service": "MemOS API for 肥牛AI",
        "version": "2.0.0",
        "status": "running",
        "storage": "qdrant" if qdrant_client else "memory",
        "graph": "neo4j" if neo4j_client else "disabled"
    }


@app.get("/health")
async def health_check():
    """健康检查"""
    memory_count = 0
    if qdrant_client and qdrant_client.is_available():
        memory_count = qdrant_client.count_memories()
    
    return {
        "status": "healthy",
        "model_loaded": embedding_model is not None,
        "qdrant_available": qdrant_client is not None and qdrant_client.is_available(),
        "neo4j_available": neo4j_client is not None and neo4j_client.is_available(),
        "memory_count": memory_count
    }


@app.post("/add")
async def add_memory(request: AddMemoryRequest):
    """添加记忆（LLM 加工版）
    
    自动执行：
    1. LLM 提取记忆 → 存入 Qdrant
    2. LLM 提取偏好 → 存入 preference_memory
    3. LLM 提取实体 → 存入知识图谱
    """
    global qdrant_client, preference_memory, entity_extractor, neo4j_client
    
    if not embedding_model:
        raise HTTPException(status_code=500, detail="Embedding 模型未加载")
    
    try:
        user_id = request.user_id or USER_ID
        added_count = 0
        merged_count = 0
        skipped_count = 0
        preference_count = 0
        entity_count = 0
        
        # 合并对话
        conversation_text = []
        for msg in request.messages:
            content = msg.get('content', '')
            role = msg.get('role', 'user')
            if content and len(content.strip()) > 0:
                role_label = "主人" if role == 'user' else "肥牛"
                conversation_text.append(f"【{role_label}】{content}")
        
        if not conversation_text:
            return {"status": "success", "message": "无有效对话", "added": 0}
        
        full_conversation = "\n".join(conversation_text)
        
        # 🧠 对话总结日志开始
        print(f"\n{'='*60}")
        print(f"🧠 [记忆总结] 正在处理 {len(request.messages)} 条对话消息...")
        print(f"{'='*60}")
        
        # ========== 1. LLM 提取记忆 ==========
        processed_result = await process_conversation_batch(full_conversation)
        
        if processed_result.get("memories"):
            # 处理每条记忆
            for mem_item in processed_result["memories"]:
                content = mem_item.get("content", "").strip()
                importance = mem_item.get("importance", 0.5)
                # 🔥 新增：从 LLM 提取记忆类型和标签
                memory_type = mem_item.get("memory_type", "general")
                tags = mem_item.get("tags", [])
                
                # 验证记忆类型
                valid_types = ['preference', 'fact', 'episodic', 'semantic', 'procedural', 'general']
                if memory_type not in valid_types:
                    memory_type = 'general'
                
                # 确保 tags 是列表
                if not isinstance(tags, list):
                    tags = []
                
                if not content or len(content) < 5:
                    continue
                
                if importance < 0.3:
                    skipped_count += 1
                    continue
                
                # 生成向量
                vector = encode_text(content)
                
                # 去重检查
                if qdrant_client and qdrant_client.is_available():
                    similar = qdrant_client.find_similar(
                        vector, threshold=0.95, user_id=user_id
                    )
                    
                    if similar:
                        # 更新现有记忆
                        qdrant_client.update_memory(
                            similar['id'],
                            {
                                'merge_count': similar.get('payload', {}).get('merge_count', 0) + 1,
                                'importance': max(importance, similar.get('importance', 0.5))
                            }
                        )
                        merged_count += 1
                        continue
                
                # 添加新记忆（使用完整 UUID）
                memory_id = str(uuid.uuid4())
                payload = {
                    'content': content,
                    'user_id': user_id,
                    'importance': importance,
                    'memory_type': memory_type,  # 🔥 使用 LLM 提取的类型
                    'tags': tags,                 # 🔥 使用 LLM 提取的标签
                    'created_at': datetime.now().isoformat(),
                    'merge_count': 0,
                    'processed': True
                }
                
                if qdrant_client and qdrant_client.is_available():
                    qdrant_client.add_memory(memory_id, vector, payload)
                    # 更新 BM25 索引
                    update_bm25_index(memory_id, content)
                
                added_count += 1
                # 详细记忆日志（包含类型和标签）
                type_label = {'preference': '偏好', 'fact': '事实', 'episodic': '情景', 
                             'semantic': '语义', 'procedural': '程序性', 'general': '通用'}.get(memory_type, memory_type)
                tags_str = f" 标签:{tags}" if tags else ""
                print(f"   📝 新增记忆: {content[:60]}{'...' if len(content) > 60 else ''}")
                print(f"      └─ 类型:{type_label} | 重要度:{importance:.0%}{tags_str}")
                logger.info(f"[OK] 新增记忆: {content[:50]}... (类型:{memory_type}, 重要度:{importance})")
        
        # ========== 2. 自动提取实体 ==========
        if entity_extractor and neo4j_client:
            try:
                print(f"\n🕸️ [实体提取] 正在分析知识图谱实体...")
                entities, relations = await entity_extractor.extract(full_conversation)
                
                if entities:
                    print(f"   发现 {len(entities)} 个实体, {len(relations) if relations else 0} 个关系:")
                    for entity in entities:
                        try:
                            # ExtractedEntity 是 Pydantic 模型，直接访问属性
                            entity_name = entity.name if hasattr(entity, 'name') else str(entity)
                            entity_type = entity.entity_type.value if hasattr(entity, 'entity_type') else 'unknown'
                            
                            # 检查实体是否已存在
                            existing = neo4j_client.find_entity_by_name(entity_name, user_id)
                            if not existing:
                                # 生成实体 ID（uuid 已在文件顶部导入）
                                new_entity_id = str(uuid.uuid4())
                                
                                success = neo4j_client.create_entity(
                                    entity_id=new_entity_id,
                                    name=entity_name,
                                    entity_type=entity_type,
                                    user_id=user_id,
                                    properties={'description': entity.description} if hasattr(entity, 'description') and entity.description else {}
                                )
                                if success:
                                    entity_count += 1
                                    # 实体详细日志
                                    print(f"   🔹 实体: {entity_name} [{entity_type}]")
                        except Exception as ee:
                            logger.warning(f"保存实体失败: {ee}")
                    
                    if entity_count > 0:
                        print(f"   ✅ 成功保存 {entity_count} 个实体")
                        logger.info(f"[OK] 自动提取实体: {entity_count} 个")
                else:
                    print(f"   ℹ️ 未发现新实体")
                
                # 保存关系
                if relations:
                    for rel in relations:
                        try:
                            # ExtractedRelation 是 Pydantic 模型，直接访问属性
                            source_name = rel.source_name if hasattr(rel, 'source_name') else ''
                            target_name = rel.target_name if hasattr(rel, 'target_name') else ''
                            relation_type = rel.relation_type.value if hasattr(rel, 'relation_type') else 'related_to'
                            
                            source_entity = neo4j_client.find_entity_by_name(source_name, user_id)
                            target_entity = neo4j_client.find_entity_by_name(target_name, user_id)
                            
                            if source_entity and target_entity:
                                neo4j_client.create_relation(
                                    source_id=source_entity['id'],
                                    target_id=target_entity['id'],
                                    relation_type=relation_type,
                                    properties={'description': rel.description} if hasattr(rel, 'description') and rel.description else {}
                                )
                        except Exception as re:
                            logger.warning(f"保存关系失败: {re}")
            except Exception as e:
                logger.warning(f"实体提取失败: {e}")
        
        # 构建返回结果
        result_parts = []
        if added_count > 0:
            result_parts.append(f"新增记忆 {added_count} 条")
        if merged_count > 0:
            result_parts.append(f"合并 {merged_count} 条")
        if skipped_count > 0:
            result_parts.append(f"跳过 {skipped_count} 条")
        if preference_count > 0:
            result_parts.append(f"提取偏好 {preference_count} 条")
        if entity_count > 0:
            result_parts.append(f"提取实体 {entity_count} 个")
        
        message = "、".join(result_parts) if result_parts else "无有效记忆"
        
        # 🧠 总结日志
        print(f"\n{'='*60}")
        print(f"📊 [记忆总结完成]")
        print(f"   📝 新增记忆: {added_count} 条")
        print(f"   🔄 合并记忆: {merged_count} 条")
        print(f"   ⏭️ 跳过低重要度: {skipped_count} 条")
        print(f"   💝 提取偏好: {preference_count} 条")
        print(f"   🕸️ 提取实体: {entity_count} 个")
        print(f"{'='*60}\n")
        
        return {
            "status": "success",
            "message": message,
            "added": added_count,
            "merged": merged_count,
            "skipped": skipped_count,
            "preferences_extracted": preference_count,
            "entities_extracted": entity_count
        }
        
    except Exception as e:
        logger.error(f"添加记忆失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/add_raw")
async def add_memory_raw(request: AddRawMemoryRequest):
    """直接添加记忆（不经过 LLM 加工）
    
    支持指定记忆类型:
    - episodic: 情景记忆
    - semantic: 语义记忆
    - procedural: 程序记忆
    - preference: 偏好记忆
    - fact: 事实记忆
    - event: 事件记忆
    - general: 通用记忆
    
    支持 extract_entities=true 自动提取实体到知识图谱
    """
    if not embedding_model:
        raise HTTPException(status_code=500, detail="Embedding 模型未加载")
    
    try:
        user_id = request.user_id or USER_ID
        added_count = 0
        type_counts = {}
        extracted_entities = []
        
        for msg in request.messages:
            content = msg.content
            importance = msg.importance if msg.importance is not None else 0.8
            memory_type = msg.memory_type or "general"
            tags = msg.tags or []
            
            # 验证记忆类型
            if memory_type not in MEMORY_TYPE_WEIGHTS:
                memory_type = "general"
            
            if content and len(content) > 5:
                vector = encode_text(content)
                
                # 去重
                if qdrant_client and qdrant_client.is_available():
                    similar = qdrant_client.find_similar(vector, threshold=0.95, user_id=user_id)
                    if similar:
                        continue
                
                memory_id = str(uuid.uuid4())
                entity_ids = []
                
                # 实体提取（如果启用）
                if request.extract_entities and entity_extractor and neo4j_client:
                    try:
                        entities, relations = await entity_extractor.extract(content)
                        
                        entity_name_to_id = {}
                        for entity in entities:
                            ent_id = f"ent_{uuid.uuid4().hex[:12]}"
                            
                            # 检查是否已存在
                            existing = neo4j_client.find_entity_by_name(entity.name, user_id)
                            if existing:
                                ent_id = existing['id']
                                if hasattr(neo4j_client, 'link_entity_to_memory'):
                                    neo4j_client.link_entity_to_memory(ent_id, memory_id)
                            else:
                                neo4j_client.add_entity(
                                    entity_id=ent_id,
                                    entity_type=entity.entity_type.value,
                                    name=entity.name,
                                    properties={
                                        'description': entity.description,
                                        'confidence': entity.confidence,
                                        'source_memory_ids': [memory_id]
                                    },
                                    user_id=user_id
                                )
                            
                            entity_name_to_id[entity.name] = ent_id
                            entity_ids.append(ent_id)
                        
                        # 添加关系
                        for relation in relations:
                            src_id = entity_name_to_id.get(relation.source_name)
                            tgt_id = entity_name_to_id.get(relation.target_name)
                            if src_id and tgt_id:
                                neo4j_client.add_relation(
                                    source_id=src_id,
                                    target_id=tgt_id,
                                    relation_type=relation.relation_type.value,
                                    properties={
                                        'description': relation.description,
                                        'confidence': relation.confidence,
                                        'source_memory_id': memory_id
                                    }
                                )
                        
                        extracted_entities.extend([{'id': eid, 'name': name} for name, eid in entity_name_to_id.items()])
                        
                    except Exception as e:
                        print(f"[警告] 实体提取失败: {e}")
                
                payload = {
                    'content': content,
                    'user_id': user_id,
                    'importance': importance,
                    'memory_type': memory_type,
                    'tags': tags,
                    'entity_ids': entity_ids,
                    'created_at': datetime.now().isoformat(),
                    'processed': False
                }
                
                if qdrant_client and qdrant_client.is_available():
                    qdrant_client.add_memory(memory_id, vector, payload)
                    # 更新 BM25 索引
                    update_bm25_index(memory_id, content)
                
                added_count += 1
                type_counts[memory_type] = type_counts.get(memory_type, 0) + 1
        
        result = {
            "status": "success",
            "message": f"直接添加 {added_count} 条记忆",
            "added": added_count,
            "type_breakdown": type_counts
        }
        
        if extracted_entities:
            result["extracted_entities"] = extracted_entities
            result["entity_count"] = len(extracted_entities)
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search")
async def search_memory(request: SearchMemoryRequest):
    """搜索记忆
    
    支持功能：
    - 向量语义搜索
    - BM25关键词搜索（可选，混合检索）
    - 重要度加权
    - 记忆类型加权（偏好记忆权重更高）
    - 图增强搜索（可选）
    - 标签过滤
    - 记忆类型过滤
    """
    if not embedding_model:
        raise HTTPException(status_code=500, detail="Embedding 模型未加载")
    
    try:
        user_id = request.user_id or USER_ID
        
        # 确定是否启用 BM25（请求参数优先，否则使用配置）
        enable_bm25 = request.use_bm25
        if enable_bm25 is None:
            enable_bm25 = config.get('search', {}).get('enable_bm25', False) if config else False
        
        # 确定是否启用图增强（请求参数优先，否则使用配置）
        enable_graph = request.use_graph
        if enable_graph is None:
            enable_graph = config.get('search', {}).get('enable_graph_query', False) if config else False
        
        # 🔍 被动检索日志
        print(f"\n{'='*50}")
        print(f"🔍 [被动检索] 查询: {request.query[:80]}{'...' if len(request.query) > 80 else ''}")
        print(f"   参数: top_k={request.top_k}, 阈值={request.similarity_threshold}, 图谱={'启用' if enable_graph else '禁用'}, BM25={'启用' if enable_bm25 else '禁用'}")
        
        query_vector = encode_text(request.query)
        
        # 使用字典来合并不同检索方式的结果
        results_map = {}  # id -> {data, scores: {vector, bm25}}
        
        # 1. Qdrant 向量搜索
        if qdrant_client and qdrant_client.is_available():
            vector_results = qdrant_client.search(
                query_vector=query_vector,
                top_k=request.top_k * 3,  # 多取一些用于过滤和重排
                score_threshold=request.similarity_threshold,
                user_id=user_id
            )
            for r in vector_results:
                r_id = r.get('id')
                if r_id:
                    results_map[r_id] = {
                        'data': r,
                        'scores': {'vector': r.get('similarity', 0)}
                    }
        
        # 2. BM25 关键词搜索
        if enable_bm25 and bm25_searcher:
            try:
                bm25_results = bm25_searcher.search(request.query, top_k=request.top_k * 3)
                
                if bm25_results:
                    # 归一化 BM25 分数
                    max_bm25_score = max(score for _, score in bm25_results) or 1
                    
                    for doc_id, score in bm25_results:
                        normalized_score = score / max_bm25_score
                        
                        if doc_id in results_map:
                            # 已存在于向量搜索结果中，添加 BM25 分数
                            results_map[doc_id]['scores']['bm25'] = normalized_score
                        else:
                            # 仅 BM25 找到的结果，需要从存储获取完整数据
                            memory = qdrant_client.get_memory(doc_id) if qdrant_client else None
                            if memory and memory.get('payload', {}).get('user_id') == user_id:
                                # 转换为标准格式
                                memory_data = {
                                    'id': doc_id,
                                    'content': memory.get('payload', {}).get('content', memory.get('content', '')),
                                    'similarity': 0,  # 无向量相似度
                                    'importance': memory.get('payload', {}).get('importance', memory.get('importance', 0.5)),
                                    'memory_type': memory.get('payload', {}).get('memory_type', memory.get('memory_type', 'general')),
                                    'tags': memory.get('payload', {}).get('tags', memory.get('tags', [])),
                                    'created_at': memory.get('payload', {}).get('created_at', memory.get('created_at')),
                                    'updated_at': memory.get('payload', {}).get('updated_at', memory.get('updated_at')),
                                    'entity_ids': memory.get('payload', {}).get('entity_ids', memory.get('entity_ids', [])),
                                    'bm25_only': True  # 标记仅BM25找到
                                }
                                results_map[doc_id] = {
                                    'data': memory_data,
                                    'scores': {'bm25': normalized_score}
                                }
                
                print(f"   📊 BM25 找到 {len(bm25_results)} 条候选记忆")
            except Exception as e:
                print(f"[警告] BM25 搜索失败: {e}")
        
        # 3. 合并结果并计算混合得分
        bm25_weight = config.get('search', {}).get('bm25_weight', 0.3) if config else 0.3
        vector_weight = 1.0 - bm25_weight if enable_bm25 else 1.0
        
        results = []
        for r_id, r_data in results_map.items():
            result = r_data['data'].copy()
            scores = r_data['scores']
            
            # 计算混合相似度得分
            if enable_bm25:
                vector_score = scores.get('vector', 0)
                bm25_score = scores.get('bm25', 0)
                # 混合得分 = 向量权重 * 向量得分 + BM25权重 * BM25得分
                mixed_similarity = vector_weight * vector_score + bm25_weight * bm25_score
                result['similarity'] = mixed_similarity
                result['vector_score'] = vector_score
                result['bm25_score'] = bm25_score
            
            results.append(result)
        
        # 标签过滤
        if request.tags:
            results = [
                r for r in results 
                if any(tag in r.get('tags', []) for tag in request.tags)
            ]
        
        # 记忆类型过滤
        if request.memory_types:
            results = [
                r for r in results 
                if r.get('memory_type', 'general') in request.memory_types
            ]
        
        # 图增强搜索
        if enable_graph:
            if not neo4j_client:
                print(f"   ⚠️ 图谱客户端未初始化")
            elif not neo4j_client.is_available():
                print(f"   ⚠️ 图谱客户端不可用")
            else:
                # 从查询中提取实体进行图谱关联搜索
                try:
                    import re
                    # 提取查询中的潜在实体名
                    potential_entities = []
                    # 中文词汇
                    potential_entities.extend(re.findall(r'[\u4e00-\u9fff]{2,4}', request.query))
                    # 英文专有名词
                    potential_entities.extend(re.findall(r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*', request.query))
                    
                    print(f"   🕸️ 图谱搜索: 提取到 {len(potential_entities)} 个候选实体")
                    
                    # 匹配图中的实体
                    matched_entity_ids = []
                    for name in potential_entities[:10]:
                        entity = neo4j_client.find_entity_by_name(name, user_id)
                        if entity:
                            matched_entity_ids.append(entity['id'])
                            # 获取相关实体
                            related = neo4j_client.find_related_entities(entity['id'], max_depth=2)
                            for rel in related:
                                if rel['id'] not in matched_entity_ids:
                                    matched_entity_ids.append(rel['id'])
                    
                    if matched_entity_ids:
                        print(f"   🕸️ 图谱搜索: 匹配到 {len(matched_entity_ids)} 个实体")
                        # 获取实体关联的记忆
                        if hasattr(neo4j_client, 'get_memories_by_entities'):
                            graph_memory_ids = neo4j_client.get_memories_by_entities(matched_entity_ids)
                        else:
                            graph_memory_ids = []
                            for eid in matched_entity_ids:
                                mids = neo4j_client.get_entity_memories(eid)
                                graph_memory_ids.extend(mids)
                            graph_memory_ids = list(set(graph_memory_ids))
                        
                        # 为图谱关联的记忆添加加分
                        result_ids = {r.get('id') for r in results}
                        graph_boost_count = 0
                        for r in results:
                            r_id = r.get('id')
                            r_entities = r.get('entity_ids', [])
                            
                            # 检查是否通过图谱关联
                            if r_id in graph_memory_ids:
                                r['graph_boost'] = 0.15  # 直接关联加分
                                graph_boost_count += 1
                            elif any(eid in r_entities for eid in matched_entity_ids):
                                r['graph_boost'] = 0.1  # 实体匹配加分
                                graph_boost_count += 1
                        
                        # 添加向量搜索未找到但图谱关联的记忆
                        graph_only_count = 0
                        for mem_id in graph_memory_ids[:5]:
                            if mem_id not in result_ids:
                                memory = qdrant_client.get_memory(mem_id)
                                if memory and memory.get('payload', {}).get('user_id') == user_id:
                                    memory['graph_boost'] = 0.2
                                    memory['similarity'] = 0.5  # 基础相似度
                                    memory['graph_only'] = True
                                    results.append(memory)
                                    graph_only_count += 1
                        
                        if graph_boost_count > 0 or graph_only_count > 0:
                            print(f"   🕸️ 图谱增强: {graph_boost_count} 条加分, {graph_only_count} 条仅图谱")
                    else:
                        print(f"   🕸️ 图谱搜索: 未匹配到任何实体")
                                
                except Exception as e:
                    print(f"[警告] 图增强搜索失败: {e}")
        
        # 应用多维加权
        IMPORTANCE_WEIGHT = config.get('search', {}).get('importance_weight', 0.3) if config else 0.3
        TYPE_WEIGHT_FACTOR = config.get('search', {}).get('type_weight_factor', 0.2) if config else 0.2
        
        for result in results:
            similarity = result.get('similarity', 0)
            importance = result.get('importance', 0.5)
            memory_type = result.get('memory_type', 'general')
            graph_boost = result.get('graph_boost', 0)
            
            # 获取类型权重
            type_weight = MEMORY_TYPE_WEIGHTS.get(memory_type, 1.0)
            
            # 综合得分 = 相似度 × (1 + 重要度加权 + 类型加权) + 图谱加分
            result['final_score'] = similarity * (1 + importance * IMPORTANCE_WEIGHT + (type_weight - 1) * TYPE_WEIGHT_FACTOR) + graph_boost
            result['type_weight'] = type_weight
            result['graph_boost'] = graph_boost
        
        # 排序
        results.sort(key=lambda x: x.get('final_score', 0), reverse=True)
        results = results[:request.top_k]
        
        # 格式化返回
        formatted_results = []
        for r in results:
            item = {
                "content": r.get('content', ''),
                "similarity": round(r.get('similarity', 0), 4),
                "importance": r.get('importance', 0.5),
                "memory_type": r.get('memory_type', 'general'),
                "tags": r.get('tags', []),
                "type_weight": r.get('type_weight', 1.0),
                "graph_boost": round(r.get('graph_boost', 0), 4),
                "final_score": round(r.get('final_score', 0), 4),
                "timestamp": r.get('created_at'),
                "created_at": r.get('created_at'),
                "updated_at": r.get('updated_at')
            }
            # 添加 BM25 相关字段（如果启用）
            if enable_bm25:
                item["vector_score"] = round(r.get('vector_score', 0), 4)
                item["bm25_score"] = round(r.get('bm25_score', 0), 4)
                if r.get('bm25_only'):
                    item["bm25_only"] = True
            formatted_results.append(item)
        
        # 🔍 检索结果日志（综合检索详情）
        if formatted_results:
            print(f"✅ [检索结果] 找到 {len(formatted_results)} 条相关记忆:")
            for i, mem in enumerate(formatted_results[:5]):  # 最多显示5条
                content_preview = mem['content'][:50].replace('\n', ' ')
                type_label = {'preference': '偏好', 'fact': '事实', 'episodic': '情景', 
                             'semantic': '语义', 'procedural': '程序性', 'general': '通用'}.get(mem['memory_type'], mem['memory_type'])
                # 综合得分详情
                graph_info = f"|图谱:{mem.get('graph_boost', 0):.2f}" if mem.get('graph_boost', 0) > 0 else ""
                bm25_info = ""
                if enable_bm25:
                    bm25_info = f"|向量:{mem.get('vector_score', 0):.2f}|BM25:{mem.get('bm25_score', 0):.2f}"
                    if mem.get('bm25_only'):
                        bm25_info += "(仅BM25)"
                print(f"   {i+1}. [{type_label}] {content_preview}...")
                print(f"      └─ 相似度:{mem['similarity']:.2f}{bm25_info} | 类型权重:{mem['type_weight']:.1f}x | 最终得分:{mem['final_score']:.2f}{graph_info}")
            if len(formatted_results) > 5:
                print(f"   ... 还有 {len(formatted_results) - 5} 条")
        else:
            print(f"ℹ️ [检索结果] 未找到相关记忆")
        print(f"{'='*50}\n")
        
        return {
            "query": request.query,
            "memories": formatted_results,
            "count": len(formatted_results)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/list")
async def list_memories(user_id: Optional[str] = USER_ID, limit: int = 100):
    """列出记忆"""
    try:
        memories = []
        
        if qdrant_client and qdrant_client.is_available():
            memories = qdrant_client.get_all_memories(user_id=user_id, limit=limit)
        
        results = [
            {
                "id": mem.get('id', ''),
                "content": mem.get('content', ''),
                "timestamp": mem.get('created_at'),
                "created_at": mem.get('created_at'),
                "updated_at": mem.get('updated_at'),
                "importance": mem.get('importance', 0.5),
                "merge_count": mem.get('merge_count', 0),
                "memory_type": mem.get('memory_type', 'general'),
                "tags": mem.get('tags', [])  # 添加标签字段
            }
            for mem in memories
        ]
        
        return {
            "user_id": user_id,
            "count": len(results),
            "memories": results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/delete/{memory_id}")
async def delete_memory(memory_id: str):
    """删除记忆"""
    try:
        if qdrant_client and qdrant_client.is_available():
            success = qdrant_client.delete_memory(memory_id)
            if success:
                return {"status": "success", "message": f"记忆 {memory_id} 已删除"}
        
        raise HTTPException(status_code=404, detail=f"记忆 {memory_id} 不存在")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats")
async def get_statistics():
    """获取统计信息"""
    try:
        stats = {
            "total_count": 0,
            "today_count": 0,
            "week_count": 0,
            "avg_importance": 0,
            "storage_type": "qdrant" if qdrant_client else "memory",
            "graph_enabled": neo4j_client is not None
        }
        
        if qdrant_client and qdrant_client.is_available():
            info = qdrant_client.get_collection_info()
            stats["total_count"] = info.get('points_count', 0)
        
        if neo4j_client and neo4j_client.is_available():
            graph_stats = neo4j_client.get_stats()
            stats["entity_count"] = graph_stats.get('entity_count', 0)
            stats["relation_count"] = graph_stats.get('relation_count', 0)
        
        return stats
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def merge_memories_v2(keeper_id: str, content_a: str, content_b: str) -> bool:
    """使用 LLM 智能合并两条相似记忆（适配 Qdrant 存储）
    
    将两条记忆的内容交给 LLM 融合，保留双方的独特信息，去除重复部分。
    合并后更新保留方的 content 和 vector。
    
    Args:
        keeper_id: 要保留的记忆 ID（合并后的内容写入这条）
        content_a: 第一条记忆的内容
        content_b: 第二条记忆的内容
    
    Returns:
        True 表示合并成功，False 表示失败（两条均应保留）
    """
    global llm_config
    
    if not llm_config:
        print("⚠️ LLM 未配置，无法合并记忆")
        return False
    
    import aiohttp
    
    api_key = llm_config.get('api_key', '')
    model = llm_config.get('model', '')
    base_url = llm_config.get('base_url', '')
    
    if not all([api_key, model, base_url]):
        print("⚠️ LLM 配置不完整，无法合并记忆")
        return False
    
    prompt = f"""合并以下两条相似的记忆，保留所有有价值的信息，去除重复内容：

已有记忆：{content_a}
新增信息：{content_b}

合并后的记忆（保留所有细节，用分号分隔要点）："""
    
    # 重试机制：最多 3 次，超时逐次增加
    max_retries = 3
    timeouts = [60, 90, 120]
    
    for attempt in range(max_retries):
        try:
            timeout_seconds = timeouts[attempt]
            
            async with aiohttp.ClientSession() as session:
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 2000,
                    "temperature": 0.2
                }
                
                async with session.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=timeout_seconds)
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        merged_content = result['choices'][0]['message']['content'].strip()
                        
                        # 生成新的 embedding
                        new_vector = encode_text(merged_content)
                        
                        # 获取保留方的当前 payload
                        full_mem = qdrant_client.get_memory(keeper_id)
                        if not full_mem:
                            print(f"⚠️ 找不到记忆 {keeper_id}，合并失败")
                            return False
                        
                        keeper_payload = full_mem.get('payload', {})
                        
                        # 更新 payload
                        keeper_payload['content'] = merged_content
                        keeper_payload['updated_at'] = datetime.now().isoformat()
                        keeper_payload['merge_count'] = keeper_payload.get('merge_count', 0) + 1
                        
                        # 写入 Qdrant
                        qdrant_client.update_memory(keeper_id, keeper_payload, new_vector)
                        
                        # 更新 BM25 索引
                        update_bm25_index(keeper_id, merged_content)
                        
                        print(f"   🤖 LLM合并成功 (第 {keeper_payload['merge_count']} 次): {merged_content[:50]}...")
                        return True
                    else:
                        error_text = await response.text()
                        print(f"⚠️ LLM API 返回错误 {response.status}: {error_text[:200]}")
                        return False  # API 错误不重试
                        
        except asyncio.TimeoutError:
            print(f"⚠️ LLM 合并超时 (第 {attempt + 1}/{max_retries} 次, {timeouts[attempt]}秒)")
            if attempt < max_retries - 1:
                print(f"   🔄 等待 5 秒后重试...")
                await asyncio.sleep(5)
        except Exception as e:
            print(f"⚠️ LLM 合并异常: {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(3)
    
    print(f"❌ LLM 合并失败（已重试 {max_retries} 次），两条记忆均保留")
    return False


@app.post("/deduplicate")
async def deduplicate_memories(
    threshold: float = 0.90,
    by_type: bool = True  # 🔥 新增：是否按记忆类型分组去重
):
    """去重（支持按记忆类型分组）
    
    Args:
        threshold: 相似度阈值，默认 0.90
        by_type: 是否按 memory_type 分组去重，默认 True
                 - True: 只在同类型记忆之间去重（推荐，避免不同类型记忆被错误合并）
                 - False: 全局去重（所有记忆之间比较）
    """
    try:
        if not qdrant_client or not qdrant_client.is_available():
            return {"status": "error", "message": "存储不可用"}
        
        # 获取所有记忆
        memories = qdrant_client.get_all_memories(limit=10000)
        
        if len(memories) < 2:
            return {"status": "success", "merged_count": 0, "by_type": by_type}
        
        deleted_ids = set()
        merged_count = 0
        type_stats = {}  # 记录每个类型的去重统计
        
        if by_type:
            # 🔥 按 memory_type 分组
            type_groups = {}
            for mem in memories:
                mem_type = mem.get('memory_type', 'general')
                type_groups.setdefault(mem_type, []).append(mem)
            
            print(f"🔍 按类型分组去重（阈值: {threshold}）")
            for mem_type, group in type_groups.items():
                print(f"   📁 {mem_type}: {len(group)} 条记忆")
            
            # 在每个类型组内去重
            for mem_type, group in type_groups.items():
                if len(group) < 2:
                    continue
                
                group_deleted = 0
                
                for i, mem_i in enumerate(group):
                    if mem_i['id'] in deleted_ids:
                        continue
                    
                    full_mem_i = qdrant_client.get_memory(mem_i['id'])
                    if not full_mem_i or 'vector' not in full_mem_i:
                        continue
                    
                    emb_i = np.array(full_mem_i['vector'])
                    
                    for j in range(i + 1, len(group)):
                        mem_j = group[j]
                        if mem_j['id'] in deleted_ids:
                            continue
                        
                        full_mem_j = qdrant_client.get_memory(mem_j['id'])
                        if not full_mem_j or 'vector' not in full_mem_j:
                            continue
                        
                        emb_j = np.array(full_mem_j['vector'])
                        
                        similarity = float(cosine_similarity([emb_i], [emb_j])[0][0])
                        
                        if similarity >= threshold:
                            print(f"   🔗 [{mem_type}] 发现相似记忆 (相似度: {similarity:.2%})")
                            print(f"      记忆1: {mem_i.get('content', '')[:50]}...")
                            print(f"      记忆2: {mem_j.get('content', '')[:50]}...")
                            
                            # 使用 LLM 智能合并（保留双方独特信息）
                            merge_success = await merge_memories_v2(
                                keeper_id=mem_i['id'],
                                content_a=mem_i.get('content', ''),
                                content_b=mem_j.get('content', '')
                            )
                            
                            if merge_success:
                                deleted_ids.add(mem_j['id'])
                                merged_count += 1
                                group_deleted += 1
                            else:
                                print(f"   ⏭️ [{mem_type}] LLM合并失败，两条均保留")
                
                if group_deleted > 0:
                    type_stats[mem_type] = group_deleted
        else:
            # 🔥 原有全局去重逻辑
            print(f"🔍 全局去重（阈值: {threshold}）")
            
            for i, mem_i in enumerate(memories):
                if mem_i['id'] in deleted_ids:
                    continue
                
                full_mem_i = qdrant_client.get_memory(mem_i['id'])
                if not full_mem_i or 'vector' not in full_mem_i:
                    continue
                
                emb_i = np.array(full_mem_i['vector'])
                
                for j in range(i + 1, len(memories)):
                    mem_j = memories[j]
                    if mem_j['id'] in deleted_ids:
                        continue
                    
                    full_mem_j = qdrant_client.get_memory(mem_j['id'])
                    if not full_mem_j or 'vector' not in full_mem_j:
                        continue
                    
                    emb_j = np.array(full_mem_j['vector'])
                    
                    similarity = float(cosine_similarity([emb_i], [emb_j])[0][0])
                    
                    if similarity >= threshold:
                        print(f"   🔗 发现相似记忆 (相似度: {similarity:.2%})")
                        print(f"      记忆1: {mem_i.get('content', '')[:50]}...")
                        print(f"      记忆2: {mem_j.get('content', '')[:50]}...")
                        
                        # 使用 LLM 智能合并（保留双方独特信息）
                        merge_success = await merge_memories_v2(
                            keeper_id=mem_i['id'],
                            content_a=mem_i.get('content', ''),
                            content_b=mem_j.get('content', '')
                        )
                        
                        if merge_success:
                            deleted_ids.add(mem_j['id'])
                            merged_count += 1
                        else:
                            print(f"   ⏭️ LLM合并失败，两条均保留")
        
        # 删除重复记忆
        if deleted_ids:
            qdrant_client.delete_memories_batch(list(deleted_ids))
        
        print(f"✅ 去重完成！合并 {merged_count} 条记忆")
        
        return {
            "status": "success",
            "merged_count": merged_count,
            "remaining_count": len(memories) - len(deleted_ids),
            "by_type": by_type,
            "type_stats": type_stats if by_type else None
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/reclassify")
async def reclassify_all_memories(
    dry_run: bool = False,
    limit: int = 10000
):
    """批量重新分类所有历史记忆
    
    将每条现有记忆重新用 LLM 拆分+分类，生成新的分类记忆，保留原始时间戳。
    
    Args:
        dry_run: 是否只预览不执行（True 时只返回预览结果，不修改数据）
        limit: 处理的最大记忆数量
    
    流程：
    1. 获取所有历史记忆
    2. 逐条用 LLM 重新提取和分类（复用 process_conversation_batch）
    3. 新记忆继承原始 created_at 时间戳
    4. 去重后添加新记忆，删除原记忆
    """
    global qdrant_client, embedding_model
    
    if not qdrant_client or not qdrant_client.is_available():
        raise HTTPException(status_code=500, detail="存储不可用")
    
    if not embedding_model:
        raise HTTPException(status_code=500, detail="Embedding 模型未加载")
    
    try:
        # 1. 获取所有记忆
        all_memories = qdrant_client.get_all_memories(limit=limit)
        total_original = len(all_memories)
        
        if total_original == 0:
            return {"status": "success", "message": "没有记忆需要处理"}
        
        print(f"\n{'='*60}")
        print(f"🔄 [重新分类] 开始处理 {total_original} 条历史记忆...")
        print(f"{'='*60}")
        
        new_memories_to_add = []  # 待添加的新记忆
        original_ids_to_delete = []  # 待删除的原记忆 ID
        failed_count = 0
        skipped_count = 0
        type_distribution = {}
        
        # 2. 逐条处理
        for idx, mem in enumerate(all_memories):
            original_id = mem['id']
            original_content = mem.get('content', '')
            original_time = mem.get('created_at') or mem.get('timestamp', datetime.now().isoformat())
            original_importance = mem.get('importance', 0.5)
            user_id = mem.get('user_id', USER_ID)
            
            if not original_content or len(original_content) < 5:
                skipped_count += 1
                continue
            
            print(f"\n📝 [{idx+1}/{total_original}] 处理: {original_content[:50]}...")
            
            try:
                # 调用现有的 LLM 提取函数
                result = await process_conversation_batch(original_content)
                extracted_memories = result.get('memories', [])
                
                if not extracted_memories:
                    # 提取失败，保留原记忆
                    print(f"   ⚠️ 提取失败，保留原记忆")
                    failed_count += 1
                    continue
                
                # 处理提取出的每条新记忆
                for new_mem in extracted_memories:
                    new_content = new_mem.get('content', '').strip()
                    if not new_content or len(new_content) < 5:
                        continue
                    
                    memory_type = new_mem.get('memory_type', 'general')
                    tags = new_mem.get('tags', [])
                    importance = new_mem.get('importance', original_importance)
                    
                    # 统计类型分布
                    type_distribution[memory_type] = type_distribution.get(memory_type, 0) + 1
                    
                    new_memories_to_add.append({
                        'content': new_content,
                        'memory_type': memory_type,
                        'tags': tags,
                        'importance': importance,
                        'created_at': original_time,  # 🔥 继承原始时间戳
                        'user_id': user_id,
                        'original_id': original_id,  # 记录来源
                        'reclassified': True
                    })
                    
                    type_label = {'preference': '偏好', 'fact': '事实', 'episodic': '情景', 
                                 'semantic': '语义', 'procedural': '程序性', 'general': '通用'}.get(memory_type, memory_type)
                    print(f"   ✅ [{type_label}] {new_content[:40]}...")
                
                # 标记原记忆待删除
                original_ids_to_delete.append(original_id)
                
            except Exception as e:
                print(f"   ❌ 处理失败: {e}")
                failed_count += 1
                continue
        
        # 3. 预览模式 - 只返回结果不执行
        if dry_run:
            print(f"\n{'='*60}")
            print(f"🔍 [预览模式] 不执行实际修改")
            print(f"{'='*60}")
            
            return {
                "status": "preview",
                "dry_run": True,
                "original_count": total_original,
                "will_delete": len(original_ids_to_delete),
                "will_add": len(new_memories_to_add),
                "failed": failed_count,
                "skipped": skipped_count,
                "type_distribution": type_distribution,
                "sample_new_memories": [
                    {
                        "content": m['content'][:100],
                        "memory_type": m['memory_type'],
                        "tags": m['tags'],
                        "created_at": m['created_at']
                    } for m in new_memories_to_add[:10]  # 预览前 10 条
                ]
            }
        
        # 4. 执行模式 - 添加新记忆并删除原记忆
        print(f"\n{'='*60}")
        print(f"💾 [执行] 开始写入新记忆...")
        print(f"{'='*60}")
        
        added_count = 0
        duplicate_skipped = 0
        
        for new_mem in new_memories_to_add:
            content = new_mem['content']
            vector = encode_text(content)
            
            # 去重检查
            similar = qdrant_client.find_similar(vector, threshold=0.95, user_id=new_mem['user_id'])
            if similar:
                duplicate_skipped += 1
                continue
            
            # 添加新记忆
            memory_id = str(uuid.uuid4())
            payload = {
                'content': content,
                'user_id': new_mem['user_id'],
                'importance': new_mem['importance'],
                'memory_type': new_mem['memory_type'],
                'tags': new_mem['tags'],
                'created_at': new_mem['created_at'],  # 使用原始时间
                'merge_count': 0,
                'processed': True,
                'reclassified': True,
                'original_id': new_mem.get('original_id')
            }
            
            qdrant_client.add_memory(memory_id, vector, payload)
            added_count += 1
        
        # 删除原记忆
        if original_ids_to_delete:
            print(f"\n🗑️ 删除 {len(original_ids_to_delete)} 条原记忆...")
            qdrant_client.delete_memories_batch(original_ids_to_delete)
        
        print(f"\n{'='*60}")
        print(f"✅ [完成] 重新分类完成！")
        print(f"   原记忆: {total_original} 条")
        print(f"   新记忆: {added_count} 条")
        print(f"   去重跳过: {duplicate_skipped} 条")
        print(f"   失败: {failed_count} 条")
        print(f"{'='*60}")
        
        return {
            "status": "success",
            "original_count": total_original,
            "deleted_count": len(original_ids_to_delete),
            "added_count": added_count,
            "duplicate_skipped": duplicate_skipped,
            "failed": failed_count,
            "skipped": skipped_count,
            "type_distribution": type_distribution
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"重新分类失败: {str(e)}")


@app.post("/extract-all-entities")
async def extract_entities_from_all_memories(
    dry_run: bool = False,
    limit: int = 10000
):
    """从所有记忆中批量提取实体和关系，丰富知识图谱
    
    Args:
        dry_run: 是否只预览不执行（True 时只返回预览结果，不修改数据）
        limit: 处理的最大记忆数量
    
    流程：
    1. 获取所有记忆
    2. 逐条用 LLM 提取实体和关系
    3. 去重后存入 Neo4j 知识图谱
    """
    global qdrant_client, entity_extractor, neo4j_client
    
    if not entity_extractor:
        raise HTTPException(status_code=503, detail="实体提取器未启用（需要配置 entity_extraction.enabled=true）")
    
    if not neo4j_client or not neo4j_client.is_available():
        raise HTTPException(status_code=503, detail="Neo4j 知识图谱不可用")
    
    if not qdrant_client or not qdrant_client.is_available():
        raise HTTPException(status_code=500, detail="存储不可用")
    
    try:
        # 1. 获取所有记忆
        all_memories = qdrant_client.get_all_memories(limit=limit)
        total_memories = len(all_memories)
        
        if total_memories == 0:
            return {"status": "success", "message": "没有记忆需要处理"}
        
        print(f"\n{'='*60}")
        print(f"🕸️ [实体提取] 开始从 {total_memories} 条记忆中提取实体...")
        print(f"{'='*60}")
        
        entities_created = 0
        entities_skipped = 0
        relations_created = 0
        failed_count = 0
        entity_types_count = {}
        
        preview_entities = []  # 预览模式下收集的实体
        preview_relations = []  # 预览模式下收集的关系
        
        user_id = USER_ID
        
        # 2. 逐条处理
        for idx, mem in enumerate(all_memories):
            content = mem.get('content', '')
            
            if not content or len(content) < 5:
                continue
            
            print(f"\n📝 [{idx+1}/{total_memories}] 处理: {content[:50]}...")
            
            try:
                # 调用实体提取器
                entities, relations = await entity_extractor.extract(content)
                
                if not entities:
                    print(f"   ℹ️ 未发现实体")
                    continue
                
                print(f"   发现 {len(entities)} 个实体, {len(relations) if relations else 0} 个关系")
                
                # 处理实体
                for entity in entities:
                    try:
                        entity_name = entity.name if hasattr(entity, 'name') else str(entity)
                        entity_type = entity.entity_type.value if hasattr(entity, 'entity_type') else 'unknown'
                        entity_desc = entity.description if hasattr(entity, 'description') else ''
                        
                        # 统计类型分布
                        entity_types_count[entity_type] = entity_types_count.get(entity_type, 0) + 1
                        
                        if dry_run:
                            # 预览模式：只收集不存储
                            preview_entities.append({
                                "name": entity_name,
                                "type": entity_type,
                                "description": entity_desc,
                                "source": content[:50]
                            })
                            continue
                        
                        # 检查实体是否已存在
                        existing = neo4j_client.find_entity_by_name(entity_name, user_id)
                        if existing:
                            entities_skipped += 1
                            print(f"   ⏭️ 实体已存在: {entity_name}")
                            continue
                        
                        # 创建新实体
                        new_entity_id = str(uuid.uuid4())
                        success = neo4j_client.create_entity(
                            entity_id=new_entity_id,
                            name=entity_name,
                            entity_type=entity_type,
                            user_id=user_id,
                            properties={'description': entity_desc} if entity_desc else {}
                        )
                        
                        if success:
                            entities_created += 1
                            print(f"   ✅ 创建实体: {entity_name} [{entity_type}]")
                        
                    except Exception as ee:
                        logger.warning(f"保存实体失败: {ee}")
                
                # 处理关系
                if relations:
                    for rel in relations:
                        try:
                            source_name = rel.source_name if hasattr(rel, 'source_name') else ''
                            target_name = rel.target_name if hasattr(rel, 'target_name') else ''
                            relation_type = rel.relation_type.value if hasattr(rel, 'relation_type') else 'related_to'
                            rel_desc = rel.description if hasattr(rel, 'description') else ''
                            
                            if dry_run:
                                # 预览模式
                                preview_relations.append({
                                    "source": source_name,
                                    "target": target_name,
                                    "type": relation_type,
                                    "description": rel_desc
                                })
                                continue
                            
                            # 查找源和目标实体
                            source_entity = neo4j_client.find_entity_by_name(source_name, user_id)
                            target_entity = neo4j_client.find_entity_by_name(target_name, user_id)
                            
                            if source_entity and target_entity:
                                neo4j_client.create_relation(
                                    source_id=source_entity['id'],
                                    target_id=target_entity['id'],
                                    relation_type=relation_type,
                                    properties={'description': rel_desc} if rel_desc else {}
                                )
                                relations_created += 1
                                print(f"   🔗 创建关系: {source_name} --[{relation_type}]--> {target_name}")
                                
                        except Exception as re:
                            logger.warning(f"保存关系失败: {re}")
                
            except Exception as e:
                print(f"   ❌ 提取失败: {e}")
                failed_count += 1
                continue
        
        # 3. 返回结果
        if dry_run:
            print(f"\n{'='*60}")
            print(f"🔍 [预览模式] 不执行实际修改")
            print(f"{'='*60}")
            
            return {
                "status": "preview",
                "dry_run": True,
                "memories_processed": total_memories,
                "entities_found": len(preview_entities),
                "relations_found": len(preview_relations),
                "entity_types": entity_types_count,
                "sample_entities": preview_entities[:20],  # 预览前 20 个实体
                "sample_relations": preview_relations[:10]  # 预览前 10 个关系
            }
        
        print(f"\n{'='*60}")
        print(f"✅ [完成] 实体提取完成！")
        print(f"   处理记忆: {total_memories} 条")
        print(f"   创建实体: {entities_created} 个")
        print(f"   跳过已存在: {entities_skipped} 个")
        print(f"   创建关系: {relations_created} 个")
        print(f"   失败: {failed_count} 条")
        print(f"{'='*60}")
        
        return {
            "status": "success",
            "memories_processed": total_memories,
            "entities_created": entities_created,
            "entities_skipped": entities_skipped,
            "relations_created": relations_created,
            "failed": failed_count,
            "entity_types": entity_types_count
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"实体提取失败: {str(e)}")


@app.post("/migrate")
async def migrate_from_json(force: bool = False):
    """将 JSON 备份数据迁移到 Qdrant
    
    Args:
        force: 是否强制迁移（即使 Qdrant 已有数据）
    """
    global memory_store_backup, qdrant_client, embedding_model
    
    if not qdrant_client or not qdrant_client.is_available():
        return {"status": "error", "message": "Qdrant 不可用"}
    
    if not memory_store_backup:
        return {"status": "error", "message": "没有 JSON 备份数据可迁移"}
    
    # 检查是否需要迁移
    current_count = qdrant_client.count_memories()
    if current_count > 0 and not force:
        return {
            "status": "skipped",
            "message": f"Qdrant 已有 {current_count} 条数据，使用 force=true 强制迁移",
            "json_count": len(memory_store_backup),
            "qdrant_count": current_count
        }
    
    # 执行迁移
    batch = []
    migrated = 0
    skipped = 0
    
    for i, mem in enumerate(memory_store_backup):
        content = mem.get('content', '')
        if not content or len(content) < 5:
            skipped += 1
            continue
        
        # 检查是否已存在（避免重复）
        existing = qdrant_client.search(
            query_vector=embedding_model.encode([content])[0].tolist(),
            top_k=1,
            user_id=mem.get('user_id', USER_ID)
        )
        if existing and existing[0].get('similarity', 0) > 0.95:
            skipped += 1
            continue
        
        # 获取或生成向量
        if 'embedding' in mem and mem['embedding']:
            vector = mem['embedding']
        else:
            vector = embedding_model.encode([content])[0].tolist()
        
        # 构建 payload
        payload = {
            'content': content,
            'user_id': mem.get('user_id', USER_ID),
            'importance': mem.get('importance', 0.5),
            'memory_type': mem.get('memory_type', 'general'),
            'tags': mem.get('tags', []),
            'created_at': mem.get('created_at') or mem.get('timestamp', datetime.now().isoformat()),
            'updated_at': mem.get('updated_at'),
            'merge_count': mem.get('merge_count', 0),
            'source': 'migrated_from_json'
        }
        
        memory_id = str(uuid.uuid4())
        
        batch.append({
            'id': memory_id,
            'vector': vector,
            'payload': payload
        })
        
        if len(batch) >= 50:
            count = qdrant_client.add_memories_batch(batch)
            migrated += count
            batch = []
    
    if batch:
        count = qdrant_client.add_memories_batch(batch)
        migrated += count
    
    return {
        "status": "success",
        "message": f"迁移完成",
        "migrated": migrated,
        "skipped": skipped,
        "total_json": len(memory_store_backup),
        "new_qdrant_count": qdrant_client.count_memories()
    }


# ==================== 偏好管理端点 ====================

class AddPreferenceRequest(BaseModel):
    """添加偏好请求"""
    item: str = Field(..., description="偏好对象（如：火锅、蓝色、编程）")
    category: str = Field(default="other", description="类别: food/color/hobby/music/movie/place/person/style/other")
    preference_type: str = Field(default="like", description="类型: like/dislike")
    strength: float = Field(default=0.8, ge=0.0, le=1.0, description="偏好强度")
    reason: Optional[str] = Field(default=None, description="原因说明")
    user_id: Optional[str] = USER_ID


class ExtractPreferencesRequest(BaseModel):
    """从文本提取偏好请求"""
    text: str = Field(..., description="要提取偏好的文本")
    user_id: Optional[str] = USER_ID


@app.get("/preferences")
async def get_preferences(
    user_id: str = Query(default=USER_ID),
    category: Optional[str] = Query(default=None, description="类别过滤"),
    preference_type: Optional[str] = Query(default=None, description="类型过滤: like/dislike")
):
    """获取用户偏好列表"""
    if not preference_memory:
        return {"preferences": [], "message": "偏好记忆未初始化"}
    
    try:
        from memories.preference_memory import PreferenceCategory, PreferenceType
        
        cat = PreferenceCategory(category) if category else None
        ptype = PreferenceType(preference_type) if preference_type else None
        
        prefs = await preference_memory.get_preferences(category=cat, preference_type=ptype)
        
        return {
            "preferences": [p.dict() for p in prefs],
            "count": len(prefs)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/preferences")
async def add_preference(request: AddPreferenceRequest):
    """添加用户偏好"""
    if not preference_memory:
        raise HTTPException(status_code=503, detail="偏好记忆未初始化")
    
    try:
        from memories.preference_memory import PreferenceCategory, PreferenceType
        
        pref = await preference_memory.add_preference(
            item=request.item,
            category=PreferenceCategory(request.category),
            preference_type=PreferenceType(request.preference_type),
            strength=request.strength
        )
        
        return {
            "status": "success",
            "preference": pref.dict(),
            "message": f"已添加偏好: {'喜欢' if request.preference_type == 'like' else '不喜欢'}{request.item}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/preferences/{pref_id}")
async def delete_preference(pref_id: str):
    """删除偏好"""
    if not preference_memory:
        raise HTTPException(status_code=503, detail="偏好记忆未初始化")
    
    try:
        success = await preference_memory.delete_preference(pref_id)
        if success:
            return {"status": "success", "message": "偏好已删除"}
        else:
            raise HTTPException(status_code=404, detail="未找到该偏好")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/preferences/summary")
async def get_preference_summary(user_id: str = Query(default=USER_ID)):
    """获取偏好摘要"""
    if not preference_memory:
        return {"summary": {}, "message": "偏好记忆未初始化"}
    
    try:
        summary = await preference_memory.get_summary()
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/preferences/extract")
async def extract_preferences(request: ExtractPreferencesRequest):
    """从文本中提取偏好（使用 LLM）"""
    if not llm_config:
        raise HTTPException(status_code=503, detail="LLM 未配置")
    
    try:
        from utils.entity_extractor import PreferenceExtractor
        
        # 传递备用模型配置
        fallback_cfg = full_config.get('llm_fallback', {}).get('config') if full_config else None
        extractor = PreferenceExtractor(llm_config, fallback_config=fallback_cfg)
        extracted = await extractor.extract_preferences(request.text)
        
        # 自动添加提取到的偏好
        added_count = 0
        if preference_memory and extracted:
            from memories.preference_memory import PreferenceCategory, PreferenceType
            
            for like in extracted.get('likes', []):
                try:
                    cat = PreferenceCategory(like.get('category', 'other'))
                    await preference_memory.add_preference(
                        item=like.get('item', ''),
                        category=cat,
                        preference_type=PreferenceType.LIKE,
                        strength=like.get('strength', 0.8)
                    )
                    added_count += 1
                except:
                    pass
            
            for dislike in extracted.get('dislikes', []):
                try:
                    cat = PreferenceCategory(dislike.get('category', 'other'))
                    await preference_memory.add_preference(
                        item=dislike.get('item', ''),
                        category=cat,
                        preference_type=PreferenceType.DISLIKE,
                        strength=dislike.get('strength', 0.8)
                    )
                    added_count += 1
                except:
                    pass
        
        return {
            "status": "success",
            "extracted": extracted,
            "added_count": added_count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/preferences/search")
async def search_preferences(query: str, user_id: str = Query(default=USER_ID), top_k: int = 5):
    """搜索相关偏好"""
    if not preference_memory:
        return {"preferences": [], "message": "偏好记忆未初始化"}
    
    try:
        prefs = await preference_memory.search_preferences(query, top_k)
        return {
            "preferences": [p.dict() for p in prefs],
            "count": len(prefs)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 记忆类型管理端点 ====================

@app.get("/memory-types")
async def get_memory_types():
    """获取所有记忆类型及其权重"""
    return {
        "types": MEMORY_TYPE_WEIGHTS,
        "description": {
            "episodic": "情景记忆 - 具体事件、对话、经历（有时间地点）",
            "semantic": "语义记忆 - 抽象知识、概念、事实（无具体时间）",
            "procedural": "程序记忆 - 技能、习惯、操作方式",
            "preference": "偏好记忆 - 用户喜好、厌恶",
            "fact": "事实记忆 - 客观事实信息",
            "tool": "工具记忆 - 工具使用记录",
            "event": "事件记忆 - 重要事件",
            "general": "通用记忆 - 未分类"
        }
    }


@app.get("/memories/by-type/{memory_type}")
async def get_memories_by_type(
    memory_type: str,
    user_id: str = Query(default=USER_ID),
    limit: int = Query(default=50, le=200)
):
    """按类型获取记忆"""
    if not qdrant_client or not qdrant_client.is_available():
        return {"memories": [], "message": "存储不可用"}
    
    valid_types = list(MEMORY_TYPE_WEIGHTS.keys())
    if memory_type not in valid_types:
        raise HTTPException(
            status_code=400, 
            detail=f"无效的记忆类型。有效类型: {valid_types}"
        )
    
    try:
        # 获取所有记忆并过滤
        all_memories = qdrant_client.get_all_memories(user_id=user_id, limit=limit * 3)
        filtered = [m for m in all_memories if m.get('memory_type') == memory_type][:limit]
        
        return {
            "memory_type": memory_type,
            "memories": filtered,
            "count": len(filtered)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/memories/classify")
async def classify_memory(content: str):
    """使用 LLM 对记忆内容进行类型分类"""
    if not llm_config:
        raise HTTPException(status_code=503, detail="LLM 未配置")
    
    try:
        import httpx
        
        prompt = f"""请对以下记忆内容进行分类，返回最合适的记忆类型。

记忆内容：{content}

可选类型：
- episodic: 情景记忆（具体事件、对话、经历，有时间地点）
- semantic: 语义记忆（抽象知识、用户属性，如"用户是医生"）
- procedural: 程序记忆（习惯、操作方式，如"用户习惯晚睡"）
- preference: 偏好记忆（喜好、厌恶，如"用户喜欢火锅"）
- fact: 事实记忆（客观事实）
- event: 事件记忆（重要事件）
- general: 通用记忆（无法分类）

请只返回一个类型名称（英文），不要其他内容。"""

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{llm_config['base_url']}/chat/completions",
                headers={"Authorization": f"Bearer {llm_config['api_key']}"},
                json={
                    "model": llm_config['model'],
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 50,
                    "temperature": 0.1
                }
            )
            
            if response.status_code == 200:
                result = response.json()
                classified_type = result['choices'][0]['message']['content'].strip().lower()
                
                # 验证类型
                if classified_type not in MEMORY_TYPE_WEIGHTS:
                    classified_type = "general"
                
                return {
                    "content": content,
                    "classified_type": classified_type,
                    "type_weight": MEMORY_TYPE_WEIGHTS.get(classified_type, 1.0)
                }
            else:
                return {"content": content, "classified_type": "general", "error": "LLM 调用失败"}
                
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 工具记忆端点 ====================

class RecordToolUsageRequest(BaseModel):
    tool_name: str
    tool_category: str = "other"  # search, media, utility, communication, creative, system, other
    parameters: Optional[Dict[str, Any]] = None
    success: bool = True
    result_summary: Optional[str] = None
    context: Optional[str] = None
    user_intent: Optional[str] = None
    user_id: Optional[str] = USER_ID


@app.delete("/tools/{record_id}")
async def delete_tool_record(record_id: str):
    """删除工具使用记录"""
    if not tool_memory:
        raise HTTPException(status_code=503, detail="工具记忆未初始化")
    
    try:
        success = await tool_memory.delete_record(record_id)
        if success:
            return {"status": "success", "message": "记录已删除"}
        else:
            raise HTTPException(status_code=404, detail="未找到该记录")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tools/stats")
async def get_tool_stats(user_id: str = Query(default=USER_ID)):
    """获取工具使用统计"""
    if not tool_memory:
        return {"status": "disabled", "message": "工具记忆未启用"}
    
    stats = await tool_memory.get_stats()
    return {
        "status": "enabled",
        **stats
    }


@app.post("/tools/record")
async def record_tool_usage(request: RecordToolUsageRequest):
    """记录工具使用"""
    if not tool_memory:
        raise HTTPException(status_code=503, detail="工具记忆未启用")
    
    try:
        from memories.tool_memory import ToolCategory
        
        # 转换类别
        try:
            category = ToolCategory(request.tool_category)
        except ValueError:
            category = ToolCategory.OTHER
        
        record = await tool_memory.record_usage(
            tool_name=request.tool_name,
            tool_category=category,
            parameters=request.parameters or {},
            success=request.success,
            result_summary=request.result_summary,
            context=request.context,
            user_intent=request.user_intent
        )
        
        return {
            "status": "success",
            "record_id": record.id,
            "tool_name": record.tool_name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tools/frequently-used")
async def get_frequently_used_tools(
    category: Optional[str] = None,
    top_k: int = 10,
    user_id: str = Query(default=USER_ID)
):
    """获取常用工具列表"""
    if not tool_memory:
        return {"tools": [], "message": "工具记忆未启用"}
    
    try:
        from memories.tool_memory import ToolCategory
        
        cat = ToolCategory(category) if category else None
        tools = await tool_memory.get_frequently_used_tools(cat, top_k)
        
        return {
            "tools": [
                {
                    "tool_name": t.tool_name,
                    "category": t.tool_category.value,
                    "use_count": t.use_count,
                    "success_rate": round(t.success_rate, 2),
                    "last_used": t.last_used_at.isoformat()
                }
                for t in tools
            ],
            "count": len(tools)
        }
    except Exception as e:
        return {"tools": [], "error": str(e)}


@app.get("/tools/recent")
async def get_recent_tool_usage(
    tool_name: Optional[str] = None,
    limit: int = 20,
    user_id: str = Query(default=USER_ID)
):
    """获取最近工具使用记录"""
    if not tool_memory:
        return {"records": [], "message": "工具记忆未启用"}
    
    records = await tool_memory.get_recent_usage(tool_name, limit)
    
    return {
        "records": [
            {
                "id": r.id,
                "tool_name": r.tool_name,
                "category": r.tool_category.value,
                "success": r.success,
                "result_summary": r.result_summary,
                "user_intent": r.user_intent,
                "used_at": r.used_at.isoformat()
            }
            for r in records
        ],
        "count": len(records)
    }


@app.get("/tools/suggest/{tool_name}")
async def suggest_tool_parameters(tool_name: str):
    """根据历史使用建议工具参数"""
    if not tool_memory:
        return {"suggestions": {}, "message": "工具记忆未启用"}
    
    suggestions = await tool_memory.suggest_parameters(tool_name)
    return {"tool_name": tool_name, "suggestions": suggestions}


# ==================== 记忆反馈修正端点 ====================

class MemoryFeedbackRequest(BaseModel):
    memory_id: str
    feedback_type: str  # correct, supplement, delete, merge
    correction: Optional[str] = None  # 修正后的内容
    reason: Optional[str] = None
    user_id: Optional[str] = USER_ID


@app.post("/memory/feedback")
async def submit_memory_feedback(request: MemoryFeedbackRequest):
    """提交记忆反馈（修正/补充/删除/合并）
    
    feedback_type:
    - correct: 修正记忆内容
    - supplement: 补充信息
    - delete: 标记删除
    - merge: 合并到其他记忆
    """
    if not qdrant_client or not qdrant_client.is_available():
        raise HTTPException(status_code=503, detail="存储不可用")
    
    try:
        # 获取原记忆
        original = qdrant_client.get_memory(request.memory_id)
        if not original:
            raise HTTPException(status_code=404, detail="记忆不存在")
        
        if request.feedback_type == "correct":
            # 修正记忆内容
            if not request.correction:
                raise HTTPException(status_code=400, detail="修正内容不能为空")
            
            # 更新内容
            new_vector = encode_text(request.correction)
            payload = original.get('payload', {})
            payload['content'] = request.correction
            payload['updated_at'] = datetime.now().isoformat()
            payload['correction_history'] = payload.get('correction_history', [])
            payload['correction_history'].append({
                'original': original.get('payload', {}).get('content'),
                'corrected_at': datetime.now().isoformat(),
                'reason': request.reason
            })
            
            qdrant_client.update_memory(request.memory_id, payload, new_vector)
            
            return {
                "status": "success",
                "action": "corrected",
                "memory_id": request.memory_id,
                "new_content": request.correction
            }
        
        elif request.feedback_type == "supplement":
            # 补充信息
            if not request.correction:
                raise HTTPException(status_code=400, detail="补充内容不能为空")
            
            payload = original.get('payload', {})
            original_content = payload.get('content', '')
            supplemented_content = f"{original_content}\n[补充] {request.correction}"
            
            new_vector = encode_text(supplemented_content)
            payload['content'] = supplemented_content
            payload['updated_at'] = datetime.now().isoformat()
            
            qdrant_client.update_memory(request.memory_id, payload, new_vector)
            
            return {
                "status": "success",
                "action": "supplemented",
                "memory_id": request.memory_id,
                "new_content": supplemented_content
            }
        
        elif request.feedback_type == "delete":
            # 标记删除
            success = qdrant_client.delete_memory(request.memory_id)
            
            return {
                "status": "success" if success else "failed",
                "action": "deleted",
                "memory_id": request.memory_id
            }
        
        elif request.feedback_type == "merge":
            # 合并到其他记忆（需要 correction 字段指定目标记忆 ID）
            if not request.correction:
                raise HTTPException(status_code=400, detail="请指定目标记忆 ID")
            
            target_id = request.correction
            target = qdrant_client.get_memory(target_id)
            if not target:
                raise HTTPException(status_code=404, detail="目标记忆不存在")
            
            # 合并内容
            original_content = original.get('payload', {}).get('content', '')
            target_content = target.get('payload', {}).get('content', '')
            merged_content = f"{target_content}\n[合并自 {request.memory_id}] {original_content}"
            
            # 更新目标记忆
            new_vector = encode_text(merged_content)
            target_payload = target.get('payload', {})
            target_payload['content'] = merged_content
            target_payload['updated_at'] = datetime.now().isoformat()
            target_payload['merge_count'] = target_payload.get('merge_count', 0) + 1
            target_payload['merged_from'] = target_payload.get('merged_from', [])
            target_payload['merged_from'].append(request.memory_id)
            
            qdrant_client.update_memory(target_id, target_payload, new_vector)
            
            # 删除原记忆
            qdrant_client.delete_memory(request.memory_id)
            
            return {
                "status": "success",
                "action": "merged",
                "source_id": request.memory_id,
                "target_id": target_id,
                "merged_content": merged_content
            }
        
        else:
            raise HTTPException(status_code=400, detail=f"未知的反馈类型: {request.feedback_type}")
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/memory/{memory_id}/history")
async def get_memory_history(memory_id: str):
    """获取记忆的修改历史"""
    if not qdrant_client or not qdrant_client.is_available():
        raise HTTPException(status_code=503, detail="存储不可用")
    
    memory = qdrant_client.get_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="记忆不存在")
    
    payload = memory.get('payload', {})
    
    return {
        "memory_id": memory_id,
        "current_content": payload.get('content'),
        "created_at": payload.get('created_at'),
        "updated_at": payload.get('updated_at'),
        "merge_count": payload.get('merge_count', 0),
        "merged_from": payload.get('merged_from', []),
        "correction_history": payload.get('correction_history', [])
    }


# ==================== 知识库导入端点 ====================

class ImportDocumentRequest(BaseModel):
    source: str  # 文件路径或 URL
    tags: Optional[List[str]] = None
    extract_entities: bool = False
    user_id: Optional[str] = USER_ID


class ImportBatchRequest(BaseModel):
    sources: List[str]
    tags: Optional[List[str]] = None
    extract_entities: bool = False
    user_id: Optional[str] = USER_ID


@app.post("/kb/import")
async def import_document(request: ImportDocumentRequest):
    """导入文档到知识库
    
    支持：
    - 文本文件 (.txt)
    - PDF 文件 (.pdf)
    - Markdown 文件 (.md)
    - 网页 URL (http/https)
    """
    if not document_loader:
        raise HTTPException(status_code=503, detail="文档加载器未初始化")
    
    if not qdrant_client or not qdrant_client.is_available():
        raise HTTPException(status_code=503, detail="存储不可用")
    
    try:
        user_id = request.user_id or USER_ID
        tags = request.tags or []
        
        # 加载文档
        chunks = document_loader.load(request.source)
        
        if not chunks:
            return {
                "status": "failed",
                "message": f"无法加载文档: {request.source}",
                "chunks_count": 0
            }
        
        # 导入每个块
        imported_count = 0
        memory_ids = []
        
        for chunk in chunks:
            content = chunk.content
            if not content or len(content) < 10:
                continue
            
            # 生成向量
            vector = encode_text(content)
            
            # 创建记忆
            memory_id = str(uuid.uuid4())
            payload = {
                'content': content,
                'user_id': user_id,
                'importance': 0.6,
                'memory_type': 'document',
                'tags': tags + [chunk.metadata.get('type', 'document')],
                'source': chunk.source,
                'source_type': chunk.metadata.get('type'),
                'chunk_index': chunk.chunk_index,
                'created_at': datetime.now().isoformat()
            }
            
            qdrant_client.add_memory(memory_id, vector, payload)
            memory_ids.append(memory_id)
            imported_count += 1
        
        return {
            "status": "success",
            "source": request.source,
            "chunks_count": len(chunks),
            "imported_count": imported_count,
            "memory_ids": memory_ids[:10],  # 只返回前10个
            "total_memory_ids": len(memory_ids)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/kb/import/batch")
async def import_documents_batch(request: ImportBatchRequest):
    """批量导入文档"""
    if not document_loader:
        raise HTTPException(status_code=503, detail="文档加载器未初始化")
    
    results = []
    total_imported = 0
    total_failed = 0
    
    for source in request.sources:
        try:
            single_request = ImportDocumentRequest(
                source=source,
                tags=request.tags,
                extract_entities=request.extract_entities,
                user_id=request.user_id
            )
            result = await import_document(single_request)
            results.append(result)
            
            if result.get('status') == 'success':
                total_imported += result.get('imported_count', 0)
            else:
                total_failed += 1
        except Exception as e:
            results.append({
                "source": source,
                "status": "failed",
                "error": str(e)
            })
            total_failed += 1
    
    return {
        "total_sources": len(request.sources),
        "total_imported": total_imported,
        "total_failed": total_failed,
        "details": results
    }


@app.post("/kb/import/url")
async def import_from_url(
    url: str,
    tags: Optional[List[str]] = None,
    user_id: str = Query(default=USER_ID)
):
    """从 URL 导入网页内容"""
    request = ImportDocumentRequest(
        source=url,
        tags=tags or ['web'],
        user_id=user_id
    )
    return await import_document(request)


# ==================== 图像记忆端点 ====================

class UploadImageRequest(BaseModel):
    image_base64: str = Field(..., alias="image_base64", description="Base64 编码的图像")
    filename: Optional[str] = "image.jpg"
    image_type: Optional[str] = "other"  # conversation, document, screenshot, avatar, reference, other
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    user_id: Optional[str] = USER_ID
    auto_describe: bool = True
    
    class Config:
        populate_by_name = True  # 允许使用字段名或别名


@app.get("/images/stats")
async def get_image_stats(user_id: str = Query(default=USER_ID)):
    """获取图像记忆统计"""
    if not image_memory:
        return {"status": "disabled", "message": "图像记忆未启用"}
    
    stats = image_memory.get_stats(user_id)
    return {"status": "enabled", **stats}


@app.post("/images/upload")
async def upload_image(request: UploadImageRequest):
    """上传图像
    
    图像以 Base64 格式上传，支持自动生成描述
    """
    if not image_memory:
        raise HTTPException(status_code=503, detail="图像记忆未启用")
    
    try:
        result = await image_memory.save_image_from_base64(
            base64_data=request.image_base64,
            original_name=request.filename,
            image_type=request.image_type,
            description=request.description,
            tags=request.tags,
            user_id=request.user_id,
            auto_describe=request.auto_describe
        )
        
        if result:
            return {
                "status": "success",
                "image_id": result.id,
                "filename": result.filename,
                "description": result.description,
                "size_bytes": result.size_bytes,
                "dimensions": f"{result.width}x{result.height}"
            }
        else:
            raise HTTPException(status_code=400, detail="图像保存失败")
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/images/search")
async def search_images(
    query: str,
    top_k: int = 5,
    image_type: Optional[str] = None,
    user_id: str = Query(default=USER_ID)
):
    """搜索图像
    
    使用文本描述搜索相关图像
    """
    if not image_memory:
        return {"images": [], "message": "图像记忆未启用"}
    
    results = await image_memory.search(
        query=query,
        user_id=user_id,
        top_k=top_k,
        image_type=image_type
    )
    
    return {
        "query": query,
        "images": results,
        "count": len(results)
    }


@app.get("/images/{image_id}")
async def get_image_info(image_id: str):
    """获取图像信息"""
    if not image_memory:
        raise HTTPException(status_code=503, detail="图像记忆未启用")
    
    metadata = await image_memory.get_image(image_id)
    if metadata:
        return metadata.to_dict()
    raise HTTPException(status_code=404, detail="图像不存在")


@app.get("/images/{image_id}/data")
async def get_image_data(
    image_id: str,
    thumbnail: bool = False
):
    """获取图像数据（Base64）"""
    if not image_memory:
        raise HTTPException(status_code=503, detail="图像记忆未启用")
    
    data = await image_memory.get_image_base64(image_id, thumbnail)
    if data:
        return {
            "image_id": image_id,
            "thumbnail": thumbnail,
            "data": data
        }
    raise HTTPException(status_code=404, detail="图像不存在")


@app.delete("/images/{image_id}")
async def delete_image(image_id: str):
    """删除图像"""
    if not image_memory:
        raise HTTPException(status_code=503, detail="图像记忆未启用")
    
    success = await image_memory.delete_image(image_id)
    if success:
        return {"status": "success", "message": f"已删除图像 {image_id}"}
    raise HTTPException(status_code=404, detail="图像不存在或删除失败")


@app.get("/images")
async def list_images(
    user_id: str = Query(default=USER_ID),
    image_type: Optional[str] = None,
    limit: int = 50
):
    """列出用户的图像"""
    if not image_memory:
        return {"images": [], "message": "图像记忆未启用"}
    
    images = await image_memory.list_images(user_id, image_type, limit)
    
    return {
        "images": [m.to_dict() for m in images],
        "count": len(images)
    }


@app.post("/images/regenerate-descriptions")
async def regenerate_image_descriptions(
    user_id: str = Query(default=USER_ID),
    force: bool = Query(default=False, description="是否强制重新生成所有描述")
):
    """为没有描述的图片重新生成描述
    
    - force=False: 只为没有描述的图片生成
    - force=True: 为所有图片重新生成描述
    """
    if not image_memory:
        raise HTTPException(status_code=503, detail="图像记忆未启用")
    
    try:
        images = await image_memory.list_images(user_id, limit=500)
        updated_count = 0
        failed_count = 0
        
        for img_meta in images:
            # 检查是否需要生成描述
            if not force and img_meta.description and img_meta.description.strip():
                continue
            
            try:
                # 读取图片数据
                img_data = await image_memory.get_image_data(img_meta.id, thumbnail=False)
                if not img_data:
                    failed_count += 1
                    continue
                
                # 生成描述
                from PIL import Image
                from io import BytesIO
                image = Image.open(BytesIO(img_data))
                
                description = await image_memory._generate_description(image, img_meta.original_name)
                
                if description:
                    # 更新元数据
                    img_meta.description = description
                    image_memory.metadata_cache[img_meta.id] = img_meta
                    updated_count += 1
                    logger.info(f"已为图片 {img_meta.id} 生成描述: {description[:50]}...")
                else:
                    failed_count += 1
                    
            except Exception as e:
                logger.error(f"生成图片 {img_meta.id} 描述失败: {e}")
                failed_count += 1
        
        # 保存更新后的元数据
        if updated_count > 0:
            image_memory._save_metadata_to_file()
        
        return {
            "status": "success",
            "message": f"已更新 {updated_count} 张图片的描述，{failed_count} 张失败",
            "updated_count": updated_count,
            "failed_count": failed_count
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 异步调度器端点 ====================

class SubmitTaskRequest(BaseModel):
    task_type: str  # add_memory, process_image, extract_entities
    payload: Dict[str, Any]
    priority: Optional[int] = 1  # 0=low, 1=normal, 2=high, 3=critical
    user_id: Optional[str] = USER_ID
    timeout: Optional[int] = 60


@app.get("/scheduler/stats")
async def get_scheduler_stats():
    """获取调度器统计"""
    if not scheduler:
        return {"status": "disabled", "message": "调度器未启用"}
    
    stats = scheduler.get_stats()
    return {"status": "enabled", **stats}


@app.post("/scheduler/submit")
async def submit_task(request: SubmitTaskRequest):
    """提交异步任务
    
    任务类型：
    - add_memory: 添加记忆（异步处理）
    - process_image: 处理图像
    - extract_entities: 提取实体
    """
    if not scheduler:
        raise HTTPException(status_code=503, detail="调度器未启用")
    
    try:
        from core.scheduler import TaskPriority
        
        # 转换优先级
        priority_map = {
            0: TaskPriority.LOW,
            1: TaskPriority.NORMAL,
            2: TaskPriority.HIGH,
            3: TaskPriority.CRITICAL
        }
        priority = priority_map.get(request.priority, TaskPriority.NORMAL)
        
        task_id = await scheduler.submit(
            task_type=request.task_type,
            payload=request.payload,
            priority=priority,
            user_id=request.user_id,
            timeout=request.timeout
        )
        
        return {
            "status": "submitted",
            "task_id": task_id,
            "task_type": request.task_type,
            "priority": request.priority
        }
    
    except RuntimeError as e:
        raise HTTPException(status_code=429, detail=str(e))  # 配额超限
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/scheduler/task/{task_id}")
async def get_task_status(task_id: str):
    """获取任务状态"""
    if not scheduler:
        raise HTTPException(status_code=503, detail="调度器未启用")
    
    status = await scheduler.get_task_status(task_id)
    if status:
        return status
    raise HTTPException(status_code=404, detail="任务不存在")


@app.post("/async/add")
async def async_add_memory(request: AddRawMemoryRequest):
    """异步添加记忆
    
    将记忆添加任务提交到队列异步处理
    同步接口: POST /add_raw
    """
    if not scheduler:
        # 回退到同步处理
        return await add_memory_raw(request)
    
    task_ids = []
    for msg in request.messages:
        task_id = await scheduler.submit(
            task_type='add_memory',
            payload={
                'content': msg.content,
                'importance': msg.importance,
                'memory_type': msg.memory_type,
                'user_id': request.user_id
            },
            user_id=request.user_id
        )
        task_ids.append(task_id)
    
    return {
        "status": "submitted",
        "message": f"已提交 {len(task_ids)} 个任务",
        "task_ids": task_ids
    }


# ==================== 图谱端点 ====================

@app.get("/graph/stats")
async def get_graph_stats():
    """获取知识图谱统计"""
    if not neo4j_client or not neo4j_client.is_available():
        return {"status": "disabled", "message": "知识图谱未启用"}
    
    stats = neo4j_client.get_stats()
    return {
        "status": "enabled",
        "entity_count": stats.get('entity_count', 0),
        "relation_count": stats.get('relation_count', 0)
    }


@app.get("/graph/entities")
async def list_entities(
    user_id: str = Query(default=USER_ID),
    entity_type: Optional[str] = None,
    limit: int = 50
):
    """列出实体"""
    if not neo4j_client or not neo4j_client.is_available():
        return {"entities": [], "message": "知识图谱未启用"}
    
    entities = neo4j_client.list_entities(user_id, entity_type, limit)
    return {"entities": entities, "count": len(entities)}


@app.get("/graph/relations")
async def list_relations(
    user_id: str = Query(default=USER_ID),
    limit: int = 500
):
    """列出所有关系（用于图谱可视化）"""
    if not neo4j_client or not neo4j_client.is_available():
        return {"relations": [], "message": "知识图谱未启用"}
    
    try:
        # 获取所有关系
        relations = neo4j_client.list_all_relations(user_id, limit)
        return {"relations": relations, "count": len(relations)}
    except Exception as e:
        logger.warning(f"获取关系列表失败: {e}")
        return {"relations": [], "error": str(e)}


# ==================== 实体提取端点 ====================

class ExtractEntitiesRequest(BaseModel):
    text: str
    context: Optional[str] = None
    store_to_graph: bool = False  # 是否存储到图谱
    link_to_memory_id: Optional[str] = None  # 关联的记忆 ID
    user_id: Optional[str] = USER_ID


@app.post("/entities/extract")
async def extract_entities(request: ExtractEntitiesRequest):
    """从文本中提取实体和关系
    
    使用 LLM 自动识别文本中的实体和它们之间的关系。
    可选择是否存储到知识图谱。
    """
    if not entity_extractor:
        raise HTTPException(status_code=503, detail="实体提取器未启用（需要配置 entity_extraction.enabled=true）")
    
    try:
        # 提取实体和关系
        entities, relations = await entity_extractor.extract(
            request.text,
            request.context
        )
        
        result = {
            "entities": [
                {
                    "name": e.name,
                    "type": e.entity_type.value,
                    "description": e.description,
                    "confidence": e.confidence
                }
                for e in entities
            ],
            "relations": [
                {
                    "source": r.source_name,
                    "target": r.target_name,
                    "type": r.relation_type.value,
                    "description": r.description,
                    "confidence": r.confidence
                }
                for r in relations
            ],
            "entity_count": len(entities),
            "relation_count": len(relations)
        }
        
        # 存储到图谱（如果启用）
        if request.store_to_graph and neo4j_client and neo4j_client.is_available():
            stored_entities = []
            entity_name_to_id = {}
            
            for entity in entities:
                ent_id = f"ent_{uuid.uuid4().hex[:12]}"
                
                # 检查是否已存在
                existing = neo4j_client.find_entity_by_name(entity.name, request.user_id)
                if existing:
                    ent_id = existing['id']
                    if request.link_to_memory_id and hasattr(neo4j_client, 'link_entity_to_memory'):
                        neo4j_client.link_entity_to_memory(ent_id, request.link_to_memory_id)
                else:
                    props = {
                        'description': entity.description,
                        'confidence': entity.confidence
                    }
                    if request.link_to_memory_id:
                        props['source_memory_ids'] = [request.link_to_memory_id]
                    
                    neo4j_client.add_entity(
                        entity_id=ent_id,
                        entity_type=entity.entity_type.value,
                        name=entity.name,
                        properties=props,
                        user_id=request.user_id
                    )
                
                entity_name_to_id[entity.name] = ent_id
                stored_entities.append({"id": ent_id, "name": entity.name})
            
            # 存储关系
            stored_relations = 0
            for relation in relations:
                src_id = entity_name_to_id.get(relation.source_name)
                tgt_id = entity_name_to_id.get(relation.target_name)
                if src_id and tgt_id:
                    neo4j_client.add_relation(
                        source_id=src_id,
                        target_id=tgt_id,
                        relation_type=relation.relation_type.value,
                        properties={
                            'description': relation.description,
                            'confidence': relation.confidence,
                            'source_memory_id': request.link_to_memory_id
                        }
                    )
                    stored_relations += 1
            
            result["stored_to_graph"] = True
            result["stored_entities"] = stored_entities
            result["stored_relations"] = stored_relations
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/entities/stats")
async def get_entity_stats(user_id: str = Query(default=USER_ID)):
    """获取实体统计"""
    if not entity_extractor:
        return {"status": "disabled", "message": "实体提取器未启用"}
    
    stats = {"status": "enabled"}
    
    if neo4j_client and neo4j_client.is_available():
        graph_stats = neo4j_client.get_stats(user_id)
        stats.update({
            "entity_count": graph_stats.get('entity_count', 0),
            "relation_count": graph_stats.get('relation_count', 0),
            "entity_types": graph_stats.get('entity_types', {}),
            "relation_types": graph_stats.get('relation_types', {})
        })
    
    return stats


@app.post("/graph/query/related")
async def find_related(
    entity_id: str,
    max_depth: int = 2
):
    """查找相关实体"""
    if not neo4j_client or not neo4j_client.is_available():
        return {"related": [], "message": "知识图谱未启用"}
    
    related = neo4j_client.find_related_entities(entity_id, max_depth)
    return {"entity_id": entity_id, "related": related}


class AddEntityRequest(BaseModel):
    entity_id: Optional[str] = None
    entity_type: str
    name: str
    properties: Optional[Dict[str, Any]] = None
    user_id: Optional[str] = USER_ID


class AddRelationRequest(BaseModel):
    source_id: str
    target_id: str
    relation_type: str
    properties: Optional[Dict[str, Any]] = None


@app.post("/graph/entity")
async def add_entity(request: AddEntityRequest):
    """添加实体"""
    if not neo4j_client or not neo4j_client.is_available():
        raise HTTPException(status_code=503, detail="图数据库未启用")
    
    entity_id = request.entity_id or str(uuid.uuid4())
    success = neo4j_client.add_entity(
        entity_id=entity_id,
        entity_type=request.entity_type,
        name=request.name,
        properties=request.properties,
        user_id=request.user_id
    )
    
    if success:
        return {"status": "success", "entity_id": entity_id, "name": request.name}
    else:
        raise HTTPException(status_code=500, detail="添加实体失败")


@app.get("/graph/entity/{entity_id}")
async def get_entity(entity_id: str):
    """获取实体详情"""
    if not neo4j_client or not neo4j_client.is_available():
        raise HTTPException(status_code=503, detail="图数据库未启用")
    
    entity = neo4j_client.get_entity(entity_id)
    if entity:
        return entity
    else:
        raise HTTPException(status_code=404, detail="实体不存在")


@app.delete("/graph/entity/{entity_id}")
async def delete_entity(entity_id: str):
    """删除实体"""
    if not neo4j_client or not neo4j_client.is_available():
        raise HTTPException(status_code=503, detail="图数据库未启用")
    
    success = neo4j_client.delete_entity(entity_id)
    if success:
        return {"status": "success", "message": f"已删除实体 {entity_id}"}
    else:
        raise HTTPException(status_code=404, detail="实体不存在或删除失败")


@app.post("/graph/relation")
async def add_relation(request: AddRelationRequest):
    """添加关系"""
    if not neo4j_client or not neo4j_client.is_available():
        raise HTTPException(status_code=503, detail="图数据库未启用")
    
    success = neo4j_client.add_relation(
        source_id=request.source_id,
        target_id=request.target_id,
        relation_type=request.relation_type,
        properties=request.properties
    )
    
    if success:
        return {
            "status": "success",
            "relation": f"{request.source_id} -[{request.relation_type}]-> {request.target_id}"
        }
    else:
        raise HTTPException(status_code=400, detail="添加关系失败（请确保两个实体都存在）")


@app.get("/graph/entity/{entity_id}/relations")
async def get_entity_relations(
    entity_id: str,
    direction: str = Query(default="both", regex="^(in|out|both)$")
):
    """获取实体的所有关系"""
    if not neo4j_client or not neo4j_client.is_available():
        raise HTTPException(status_code=503, detail="图数据库未启用")
    
    relations = neo4j_client.get_relations(entity_id, direction)
    return {"entity_id": entity_id, "relations": relations, "count": len(relations)}


@app.post("/graph/search")
async def graph_search(entity_names: List[str], user_id: str = USER_ID):
    """根据实体名称搜索图谱"""
    if not neo4j_client or not neo4j_client.is_available():
        return {"results": [], "message": "图数据库未启用"}
    
    results = neo4j_client.search_by_entities(entity_names, user_id)
    return {"results": results, "count": len(results)}


@app.get("/graph/path")
async def find_path(source_id: str, target_id: str, max_length: int = 5):
    """查找两个实体之间的路径"""
    if not neo4j_client or not neo4j_client.is_available():
        raise HTTPException(status_code=503, detail="图数据库未启用")
    
    path = neo4j_client.find_path(source_id, target_id, max_length)
    if path:
        return {"path": path, "length": len(path)}
    else:
        return {"path": None, "message": "未找到路径"}


# ==================== 主入口 ====================

if __name__ == "__main__":
    print("=" * 60)
    print("  MemOS 记忆服务 v2.0 (完整集成版)")
    print("=" * 60)
    print("  端口: 8003")
    print("  文档: http://127.0.0.1:8003/docs")
    print("=" * 60)
    
    uvicorn.run(app, host="0.0.0.0", port=8003)
