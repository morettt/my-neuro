# tool_memory.py - 工具记忆
"""
管理工具使用记录的专用记忆类型
记录用户的工具偏好、使用模式等
"""

import uuid
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class ToolCategory(str, Enum):
    """工具类别"""
    SEARCH = "search"           # 搜索工具
    MEDIA = "media"             # 媒体工具（B站、YouTube等）
    UTILITY = "utility"         # 实用工具
    COMMUNICATION = "communication"  # 通信工具
    CREATIVE = "creative"       # 创作工具
    SYSTEM = "system"           # 系统工具
    OTHER = "other"


class ToolUsageRecord(BaseModel):
    """工具使用记录"""
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # 使用完整 UUID 格式
    tool_name: str = Field(..., description="工具名称")
    tool_category: ToolCategory = Field(..., description="工具类别")
    
    # 使用参数
    parameters: Dict[str, Any] = Field(
        default_factory=dict,
        description="使用参数"
    )
    
    # 结果
    success: bool = Field(default=True, description="是否成功")
    result_summary: Optional[str] = Field(default=None, description="结果摘要")
    
    # 上下文
    context: Optional[str] = Field(default=None, description="使用上下文")
    user_intent: Optional[str] = Field(default=None, description="用户意图")
    
    # 时间
    used_at: datetime = Field(default_factory=datetime.now)
    
    # 关联
    conversation_id: Optional[str] = Field(default=None)
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class ToolPreference(BaseModel):
    """工具偏好"""
    
    tool_name: str = Field(..., description="工具名称")
    tool_category: ToolCategory = Field(..., description="类别")
    
    # 统计
    use_count: int = Field(default=0, description="使用次数")
    success_count: int = Field(default=0, description="成功次数")
    success_rate: float = Field(default=1.0, description="成功率")
    
    # 常用参数
    common_parameters: Dict[str, List[Any]] = Field(
        default_factory=dict,
        description="常用参数值"
    )
    
    # 时间
    first_used_at: datetime = Field(default_factory=datetime.now)
    last_used_at: datetime = Field(default_factory=datetime.now)
    
    # 用户反馈
    user_rating: Optional[float] = Field(default=None, description="用户评分")


class ToolMemory:
    """工具记忆管理器"""
    
    def __init__(
        self,
        user_id: str,
        vector_storage=None,
        max_records: int = 1000
    ):
        """
        初始化工具记忆
        
        Args:
            user_id: 用户 ID
            vector_storage: 向量存储
            max_records: 最大记录数
        """
        self.user_id = user_id
        self.vector_storage = vector_storage
        self.max_records = max_records
        
        # 使用记录
        self.usage_records: List[ToolUsageRecord] = []
        
        # 工具偏好缓存
        self.tool_preferences: Dict[str, ToolPreference] = {}
        
        self._loaded = False
    
    async def load(self):
        """加载历史记录"""
        if self._loaded:
            return
        
        if self.vector_storage and self.vector_storage.is_available():
            results = self.vector_storage.get_all_memories(
                user_id=self.user_id,
                limit=self.max_records
            )
            
            for result in results:
                payload = result.get('payload', {})
                if payload.get('memory_type') == 'tool_usage':
                    try:
                        record = ToolUsageRecord(
                            id=result['id'],
                            tool_name=payload.get('tool_name', ''),
                            tool_category=ToolCategory(payload.get('tool_category', 'other')),
                            parameters=payload.get('parameters', {}),
                            success=payload.get('success', True),
                            result_summary=payload.get('result_summary'),
                            context=payload.get('context'),
                            user_intent=payload.get('user_intent')
                        )
                        self.usage_records.append(record)
                        
                        # 更新偏好
                        self._update_preference_from_record(record)
                    except Exception as e:
                        logger.warning(f"加载工具记录失败: {e}")
        
        self._loaded = True
        logger.info(f"加载 {len(self.usage_records)} 条工具使用记录")
    
    def _update_preference_from_record(self, record: ToolUsageRecord):
        """根据记录更新偏好"""
        tool_name = record.tool_name
        
        if tool_name not in self.tool_preferences:
            self.tool_preferences[tool_name] = ToolPreference(
                tool_name=tool_name,
                tool_category=record.tool_category,
                first_used_at=record.used_at
            )
        
        pref = self.tool_preferences[tool_name]
        pref.use_count += 1
        if record.success:
            pref.success_count += 1
        pref.success_rate = pref.success_count / pref.use_count
        pref.last_used_at = record.used_at
        
        # 记录常用参数
        for key, value in record.parameters.items():
            if key not in pref.common_parameters:
                pref.common_parameters[key] = []
            if value not in pref.common_parameters[key]:
                pref.common_parameters[key].append(value)
                # 只保留最近 10 个值
                pref.common_parameters[key] = pref.common_parameters[key][-10:]
    
    async def record_usage(
        self,
        tool_name: str,
        tool_category: ToolCategory,
        parameters: Dict[str, Any],
        success: bool = True,
        result_summary: Optional[str] = None,
        context: Optional[str] = None,
        user_intent: Optional[str] = None
    ) -> ToolUsageRecord:
        """
        记录工具使用
        
        Args:
            tool_name: 工具名称
            tool_category: 类别
            parameters: 参数
            success: 是否成功
            result_summary: 结果摘要
            context: 上下文
            user_intent: 用户意图
        
        Returns:
            使用记录
        """
        await self.load()
        
        record = ToolUsageRecord(
            tool_name=tool_name,
            tool_category=tool_category,
            parameters=parameters,
            success=success,
            result_summary=result_summary,
            context=context,
            user_intent=user_intent
        )
        
        self.usage_records.append(record)
        self._update_preference_from_record(record)
        
        # 存储
        await self._save_record(record)
        
        # 清理旧记录
        if len(self.usage_records) > self.max_records:
            self.usage_records = self.usage_records[-self.max_records:]
        
        return record
    
    async def _save_record(self, record: ToolUsageRecord):
        """保存记录到存储"""
        if not self.vector_storage or not self.vector_storage.is_available():
            return
        
        # 构建内容
        content = f"使用工具 {record.tool_name}"
        if record.user_intent:
            content += f"，意图：{record.user_intent}"
        if record.result_summary:
            content += f"，结果：{record.result_summary}"
        
        # 生成向量（使用占位向量，实际应由 embedder 生成）
        # 工具记录主要用于统计，不依赖向量搜索
        # 创建一个与配置维度匹配的零向量作为占位
        vector_size = getattr(self.vector_storage, 'vector_size', 1024)
        vector = [0.0] * vector_size
        
        payload = {
            'content': content,
            'user_id': self.user_id,
            'memory_type': 'tool_usage',
            'tool_name': record.tool_name,
            'tool_category': record.tool_category.value,
            'parameters': record.parameters,
            'success': record.success,
            'result_summary': record.result_summary,
            'context': record.context,
            'user_intent': record.user_intent,
            'created_at': record.used_at.isoformat()
        }
        
        self.vector_storage.add_memory(record.id, vector, payload)
    
    async def get_tool_preference(
        self,
        tool_name: str
    ) -> Optional[ToolPreference]:
        """获取工具偏好"""
        await self.load()
        return self.tool_preferences.get(tool_name)
    
    async def get_frequently_used_tools(
        self,
        category: Optional[ToolCategory] = None,
        top_k: int = 10
    ) -> List[ToolPreference]:
        """
        获取常用工具
        
        Args:
            category: 类别过滤
            top_k: 返回数量
        
        Returns:
            工具偏好列表
        """
        await self.load()
        
        prefs = list(self.tool_preferences.values())
        
        if category:
            prefs = [p for p in prefs if p.tool_category == category]
        
        # 按使用次数排序
        prefs.sort(key=lambda x: x.use_count, reverse=True)
        
        return prefs[:top_k]
    
    async def get_recent_usage(
        self,
        tool_name: Optional[str] = None,
        limit: int = 20
    ) -> List[ToolUsageRecord]:
        """
        获取最近使用记录
        
        Args:
            tool_name: 工具名称过滤
            limit: 返回数量
        
        Returns:
            使用记录列表
        """
        await self.load()
        
        records = self.usage_records
        
        if tool_name:
            records = [r for r in records if r.tool_name == tool_name]
        
        # 按时间倒序
        records = sorted(records, key=lambda x: x.used_at, reverse=True)
        
        return records[:limit]
    
    async def suggest_parameters(
        self,
        tool_name: str
    ) -> Dict[str, List[Any]]:
        """
        根据历史使用建议参数
        
        Args:
            tool_name: 工具名称
        
        Returns:
            参数建议 {param_name: [suggested_values]}
        """
        pref = await self.get_tool_preference(tool_name)
        if pref:
            return pref.common_parameters
        return {}
    
    async def delete_record(self, record_id: str) -> bool:
        """删除工具使用记录"""
        await self.load()
        
        # 查找并删除内存中的记录
        original_count = len(self.usage_records)
        self.usage_records = [r for r in self.usage_records if r.id != record_id]
        
        if len(self.usage_records) < original_count:
            # 从向量库删除
            if self.vector_storage:
                self.vector_storage.delete_memory(record_id)
            return True
        return False

    async def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        await self.load()
        
        total_usage = len(self.usage_records)
        total_tools = len(self.tool_preferences)
        
        # 按类别统计
        by_category = {}
        for pref in self.tool_preferences.values():
            cat = pref.tool_category.value
            if cat not in by_category:
                by_category[cat] = 0
            by_category[cat] += pref.use_count
        
        # 成功率
        success_count = sum(1 for r in self.usage_records if r.success)
        overall_success_rate = success_count / total_usage if total_usage > 0 else 1.0
        
        return {
            'total_usage': total_usage,
            'total_tools': total_tools,
            'overall_success_rate': overall_success_rate,
            'by_category': by_category,
            'top_tools': [p.tool_name for p in 
                        sorted(self.tool_preferences.values(), 
                              key=lambda x: x.use_count, reverse=True)[:5]]
        }
