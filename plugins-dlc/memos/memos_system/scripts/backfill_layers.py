# backfill_layers.py - 回填记忆生命周期层
"""
为存量 Qdrant 记忆补齐 layer/status/access_count/last_accessed_at。

规则：
- memory_type == preference -> UserMemory
- 其他缺 layer 的旧记忆 -> LongTermMemory
- status 缺失 -> active
- access_count 缺失 -> 0

用法：
    python scripts/backfill_layers.py
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from storage.qdrant_client import MemosQdrantClient  # noqa: E402


def load_config():
    config_path = ROOT / "config" / "memos_config.json"
    with config_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def resolve_path(path_value: str) -> str:
    path = Path(path_value)
    if not path.is_absolute():
        path = ROOT / path
    return str(path.resolve())


def main():
    config = load_config()
    vector_cfg = config.get("storage", {}).get("vector", {})
    embedding_cfg = config.get("embedding", {})

    client = MemosQdrantClient(
        path=resolve_path(vector_cfg.get("path", "./data/qdrant")),
        collection_name=vector_cfg.get("collection_name", "memories"),
        vector_size=embedding_cfg.get("vector_size", vector_cfg.get("vector_size", 768)),
    )
    if not client.is_available():
        raise RuntimeError("Qdrant 不可用")

    memories = client.get_all_memories(include_archived=True, include_deleted=True, limit=0)
    updated = 0
    skipped = 0
    failed = 0

    for mem in memories:
        payload = mem.get("payload", {}) or {}
        updates = {}
        memory_type = payload.get("memory_type", "general")

        if not payload.get("layer"):
            updates["layer"] = "UserMemory" if memory_type == "preference" else "LongTermMemory"
        if not payload.get("status"):
            updates["status"] = "active"
        if payload.get("access_count") is None:
            updates["access_count"] = 0
        if "last_accessed_at" not in payload:
            updates["last_accessed_at"] = None

        if not updates:
            skipped += 1
            continue

        if client.update_memory(mem["id"], updates):
            updated += 1
        else:
            failed += 1

    print(json.dumps({
        "status": "success" if failed == 0 else "partial",
        "total": len(memories),
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
