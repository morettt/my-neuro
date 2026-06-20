# evolution.py - 记忆生命周期自演化
"""
基于访问频率、最近访问、重要度和置信度的轻量记忆演化引擎。

只操作 Qdrant payload：晋升 layer、归档 status、衰减 importance。
不做物理删除，保证自动流程可恢复。
"""

import logging
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

VALID_LAYERS = {"WorkingMemory", "LongTermMemory", "UserMemory"}


class MemoryEvolution:
    """记忆生命周期自演化引擎。"""

    def __init__(self, qdrant_client, config: Optional[Dict[str, Any]] = None):
        self.qdrant_client = qdrant_client
        self.config = config or {}

    @staticmethod
    def _parse_time(value: Any) -> Optional[datetime]:
        if not value:
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                return None
        return None

    @staticmethod
    def _default_layer(payload: Dict[str, Any]) -> str:
        layer = payload.get("layer")
        if layer in VALID_LAYERS:
            return layer
        if payload.get("memory_type") == "preference":
            return "UserMemory"
        return "LongTermMemory"

    def _settings(self) -> Dict[str, Any]:
        return {
            "promote_access": int(self.config.get("promote_access", 3)),
            "promote_importance": float(self.config.get("promote_importance", 0.7)),
            "promote_age_days": int(self.config.get("promote_age_days", 7)),
            "user_confidence": float(self.config.get("user_confidence", 0.75)),
            "archive_days": int(self.config.get("archive_days", 60)),
            "archive_importance": float(self.config.get("archive_importance", 0.2)),
            "decay_rate": float(self.config.get("decay_rate", 0.05)),
            "decay_floor": float(self.config.get("decay_floor", 0.1)),
            "merge_threshold": float(self.config.get("merge_threshold", 0.95)),
        }

    @staticmethod
    def _layer_rank(layer: str) -> int:
        return {"WorkingMemory": 0, "LongTermMemory": 1, "UserMemory": 2}.get(layer, 1)

    def _choose_keeper(self, left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, Any]:
        """在两条高度相似记忆中选择保留条目。"""
        left_payload = left.get("payload", {}) or {}
        right_payload = right.get("payload", {}) or {}

        def score(item: Dict[str, Any], payload: Dict[str, Any]):
            created_at = self._parse_time(payload.get("created_at")) or datetime.max
            # 不用 timestamp()，避免 Windows 对极端日期/时区的 OSError。
            age_key = -(created_at.toordinal() * 86400 + created_at.hour * 3600 + created_at.minute * 60 + created_at.second)
            return (
                self._layer_rank(self._default_layer(payload)),
                float(payload.get("importance", 0.5) or 0.5),
                int(payload.get("access_count", 0) or 0),
                age_key,
            )

        return left if score(left, left_payload) >= score(right, right_payload) else right

    def _merge_similar_memories(self, memories, user_id: str, threshold: float) -> Dict[str, int]:
        """按高相似度合并重复记忆：保留一条，归档重复条，并记录 merge 元数据。"""
        stats = {"merged": 0, "failed": 0}
        if threshold <= 0 or not memories:
            return stats

        archived_ids = set()
        for mem in memories:
            mem_id = mem.get("id")
            if not mem_id or mem_id in archived_ids:
                continue

            try:
                full_mem = self.qdrant_client.get_memory(mem_id)
                vector = (full_mem or {}).get("vector")
                if not vector:
                    continue

                similar = self.qdrant_client.find_similar(
                    vector,
                    threshold=threshold,
                    exclude_id=mem_id,
                    user_id=user_id,
                )
                if not similar:
                    continue

                similar_id = similar.get("id")
                if not similar_id or similar_id in archived_ids:
                    continue

                similar_full = self.qdrant_client.get_memory(similar_id) or similar
                keeper = self._choose_keeper(full_mem or mem, similar_full)
                keeper_id = keeper.get("id")
                duplicate_id = similar_id if keeper_id == mem_id else mem_id
                if not keeper_id or duplicate_id == keeper_id:
                    continue

                keeper_payload = (keeper.get("payload", {}) or {}).copy()
                merged_from = keeper_payload.get("merged_from", [])
                if not isinstance(merged_from, list):
                    merged_from = [merged_from]
                if duplicate_id not in merged_from:
                    merged_from.append(duplicate_id)

                duplicate_payload = (similar_full if duplicate_id == similar_id else full_mem or mem).get("payload", {}) or {}
                updates = {
                    "merge_count": int(keeper_payload.get("merge_count", 0) or 0) + 1,
                    "merged_from": merged_from,
                    "importance": max(
                        float(keeper_payload.get("importance", 0.5) or 0.5),
                        float(duplicate_payload.get("importance", 0.5) or 0.5),
                    ),
                    "access_count": int(keeper_payload.get("access_count", 0) or 0)
                    + int(duplicate_payload.get("access_count", 0) or 0),
                }
                if self.qdrant_client.update_memory(keeper_id, updates) and self.qdrant_client.archive_memory(
                    duplicate_id,
                    reason=f"memory_evolution_merge:{keeper_id}",
                ):
                    archived_ids.add(duplicate_id)
                    stats["merged"] += 1
                else:
                    stats["failed"] += 1
            except Exception as e:
                logger.debug("合并相似记忆失败 %s: %s", mem_id, e)
                stats["failed"] += 1

        return stats

    async def evolve(self, user_id: str = "feiniu_default", limit: int = 10000) -> Dict[str, Any]:
        """执行一轮演化。"""
        if not self.qdrant_client or not self.qdrant_client.is_available():
            return {"status": "error", "message": "存储不可用"}

        settings = self._settings()
        now = datetime.now()
        memories = self.qdrant_client.get_all_memories(
            user_id=user_id,
            limit=limit,
            include_archived=False,
            include_deleted=False,
        )

        stats = {
            "status": "success",
            "user_id": user_id,
            "scanned": len(memories),
            "normalized": 0,
            "promoted_long_term": 0,
            "promoted_user": 0,
            "merged": 0,
            "archived": 0,
            "decayed": 0,
            "failed": 0,
        }

        merge_stats = self._merge_similar_memories(memories, user_id, settings["merge_threshold"])
        stats["merged"] += merge_stats["merged"]
        stats["archived"] += merge_stats["merged"]
        stats["failed"] += merge_stats["failed"]

        for mem in memories:
            mem_id = mem.get("id")
            payload = mem.get("payload", {}) or {}
            if not mem_id:
                continue

            updates: Dict[str, Any] = {}
            layer = self._default_layer(payload)
            if payload.get("layer") not in VALID_LAYERS:
                updates["layer"] = layer
                stats["normalized"] += 1
            if not payload.get("status"):
                updates["status"] = "active"
                stats["normalized"] += 1
            if payload.get("access_count") is None:
                updates["access_count"] = 0
                stats["normalized"] += 1

            created_at = self._parse_time(payload.get("created_at")) or now
            age_days = max((now - created_at).days, 0)
            access_count = int(payload.get("access_count", 0) or 0)
            importance = float(payload.get("importance", 0.5) or 0.5)
            confidence = float(payload.get("confidence", 1.0) or 1.0)
            memory_type = payload.get("memory_type", "general")

            if memory_type in {"preference", "semantic"} and confidence >= settings["user_confidence"] and layer != "UserMemory":
                updates["layer"] = "UserMemory"
                layer = "UserMemory"
                stats["promoted_user"] += 1
            elif layer == "WorkingMemory" and (
                access_count >= settings["promote_access"]
                or (importance >= settings["promote_importance"] and age_days >= settings["promote_age_days"])
            ):
                updates["layer"] = "LongTermMemory"
                layer = "LongTermMemory"
                stats["promoted_long_term"] += 1

            if (
                layer in {"WorkingMemory", "LongTermMemory"}
                and access_count == 0
                and age_days >= settings["archive_days"]
                and importance < settings["archive_importance"]
            ):
                ok = self.qdrant_client.archive_memory(mem_id, reason="memory_evolution")
                if ok:
                    stats["archived"] += 1
                    continue
                stats["failed"] += 1
                continue

            if layer != "UserMemory" and settings["decay_rate"] > 0 and importance > settings["decay_floor"]:
                decayed = max(settings["decay_floor"], importance * (1 - settings["decay_rate"]))
                if decayed < importance:
                    updates["importance"] = round(decayed, 4)
                    stats["decayed"] += 1

            if updates:
                ok = self.qdrant_client.update_memory(mem_id, updates)
                if not ok:
                    stats["failed"] += 1

        logger.info("记忆演化完成: %s", stats)
        return stats
