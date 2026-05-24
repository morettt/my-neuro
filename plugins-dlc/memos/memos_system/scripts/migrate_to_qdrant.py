# migrate_to_qdrant.py - 将现有 JSON 记忆迁移到 Qdrant
"""
迁移脚本：将现有的 memory_store.json 迁移到 Qdrant 向量数据库

使用方法：
    python migrate_to_qdrant.py

或指定路径：
    python migrate_to_qdrant.py --json-file ../data/memory_store.json --qdrant-path ../data/qdrant
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime

# 添加父目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description='迁移 JSON 记忆到 Qdrant')
    parser.add_argument(
        '--json-file',
        default='../data/memory_store.json',
        help='JSON 记忆文件路径'
    )
    parser.add_argument(
        '--qdrant-path',
        default='../data/qdrant',
        help='Qdrant 存储路径'
    )
    parser.add_argument(
        '--embedding-model',
        default='../../full-hub/rag-hub',
        help='Embedding 模型路径'
    )
    parser.add_argument(
        '--batch-size',
        type=int,
        default=50,
        help='批量插入大小'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='仅检查，不实际迁移'
    )
    
    args = parser.parse_args()
    
    # 获取脚本目录
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 处理相对路径
    json_file = os.path.normpath(os.path.join(script_dir, args.json_file))
    qdrant_path = os.path.normpath(os.path.join(script_dir, args.qdrant_path))
    embedding_model_path = os.path.normpath(os.path.join(script_dir, args.embedding_model))
    
    print("=" * 60)
    print("  MemOS 记忆迁移工具 - JSON to Qdrant")
    print("=" * 60)
    print(f"  JSON 文件: {json_file}")
    print(f"  Qdrant 路径: {qdrant_path}")
    print(f"  Embedding 模型: {embedding_model_path}")
    print("=" * 60)
    
    # 检查 JSON 文件
    if not os.path.exists(json_file):
        logger.error(f"JSON 文件不存在: {json_file}")
        logger.info("如果是首次使用，请跳过迁移步骤")
        return 1
    
    # 读取 JSON 数据
    try:
        with open(json_file, 'r', encoding='utf-8') as f:
            memories = json.load(f)
        logger.info(f"读取到 {len(memories)} 条记忆")
    except json.JSONDecodeError as e:
        logger.error(f"JSON 解析失败: {e}")
        return 1
    except Exception as e:
        logger.error(f"读取文件失败: {e}")
        return 1
    
    if not memories:
        logger.info("没有需要迁移的记忆")
        return 0
    
    # 显示示例数据
    print("\n📋 记忆示例:")
    for i, mem in enumerate(memories[:3]):
        content = mem.get('content', '')[:50]
        importance = mem.get('importance', 0.5)
        print(f"  {i+1}. [{importance:.1f}] {content}...")
    
    if len(memories) > 3:
        print(f"  ... 还有 {len(memories) - 3} 条")
    
    if args.dry_run:
        print("\n🔍 Dry-run 模式，不执行实际迁移")
        return 0
    
    # 确认迁移
    print(f"\n⚠️  将迁移 {len(memories)} 条记忆到 Qdrant")
    confirm = input("确认迁移？(y/N): ").strip().lower()
    if confirm != 'y':
        print("已取消")
        return 0
    
    # 加载 Embedding 模型
    print("\n📦 加载 Embedding 模型...")
    try:
        from sentence_transformers import SentenceTransformer
        import torch
        
        embedding_model = SentenceTransformer(embedding_model_path)
        if torch.cuda.is_available():
            embedding_model = embedding_model.to('cuda')
            print("✅ 使用 GPU 加速")
        else:
            print("ℹ️  使用 CPU")
    except Exception as e:
        logger.error(f"加载 Embedding 模型失败: {e}")
        return 1
    
    # 初始化 Qdrant
    print("\n🚀 初始化 Qdrant...")
    try:
        from storage.qdrant_client import MemosQdrantClient
        
        qdrant = MemosQdrantClient(
            path=qdrant_path,
            collection_name="memories",
            vector_size=768
        )
        
        if not qdrant.is_available():
            logger.error("Qdrant 初始化失败")
            return 1
        
        print("✅ Qdrant 已就绪")
    except ImportError:
        logger.error("请先安装 qdrant-client: pip install qdrant-client")
        return 1
    except Exception as e:
        logger.error(f"Qdrant 初始化失败: {e}")
        return 1
    
    # 开始迁移
    print("\n📊 开始迁移...")
    migrated = 0
    failed = 0
    batch = []
    
    for i, mem in enumerate(memories):
        try:
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
                'user_id': mem.get('user_id', 'default_user'),
                'importance': mem.get('importance', 0.5),
                'memory_type': mem.get('memory_type', 'general'),
                'tags': mem.get('tags', []),
                'created_at': mem.get('created_at') or mem.get('timestamp', datetime.now().isoformat()),
                'updated_at': mem.get('updated_at'),
                'merge_count': mem.get('merge_count', 0),
                'source': 'migrated_from_json',
                'original_id': mem.get('id', '')
            }
            
            # 生成新 ID
            memory_id = f"mem_{i}_{datetime.now().timestamp()}"
            
            batch.append({
                'id': memory_id,
                'vector': vector,
                'payload': payload
            })
            
            # 批量插入
            if len(batch) >= args.batch_size:
                count = qdrant.add_memories_batch(batch)
                migrated += count
                batch = []
                print(f"  进度: {migrated}/{len(memories)} ({100*migrated/len(memories):.1f}%)")
                
        except Exception as e:
            logger.warning(f"迁移记忆 {i} 失败: {e}")
            failed += 1
    
    # 处理剩余
    if batch:
        count = qdrant.add_memories_batch(batch)
        migrated += count
    
    # 备份原文件
    backup_file = json_file + f".backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    try:
        import shutil
        shutil.copy(json_file, backup_file)
        print(f"\n📦 原文件已备份: {backup_file}")
    except Exception as e:
        logger.warning(f"备份失败: {e}")
    
    # 完成
    print("\n" + "=" * 60)
    print("  ✅ 迁移完成!")
    print("=" * 60)
    print(f"  成功: {migrated} 条")
    print(f"  失败: {failed} 条")
    print(f"  Qdrant 路径: {qdrant_path}")
    print("=" * 60)
    
    # 显示集合信息
    info = qdrant.get_collection_info()
    if info:
        print(f"\n📊 Qdrant 集合信息:")
        print(f"  - 向量数量: {info.get('vectors_count', 0)}")
        print(f"  - 点数量: {info.get('points_count', 0)}")
        print(f"  - 状态: {info.get('status', 'unknown')}")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())
