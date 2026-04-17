# scheduler.py - 异步任务调度器 (MemScheduler)
"""
轻量级异步任务调度器
支持：
- 基于 asyncio 的内存队列（默认）
- Redis Streams 队列（可选，需安装 redis）

功能：
- 任务优先级
- 任务重试
- 任务超时
- 配额控制
- 任务状态跟踪
"""

import asyncio
import uuid
import logging
import time
from typing import Dict, Any, Optional, List, Callable, Awaitable
from datetime import datetime, timedelta
from enum import Enum
from dataclasses import dataclass, field
from collections import defaultdict
import json

logger = logging.getLogger(__name__)

# 尝试导入 Redis
try:
    import redis.asyncio as aioredis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    logger.info("redis 未安装，使用内存队列模式")


class TaskPriority(int, Enum):
    """任务优先级"""
    LOW = 0
    NORMAL = 1
    HIGH = 2
    CRITICAL = 3


class TaskStatus(str, Enum):
    """任务状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


@dataclass
class Task:
    """任务数据类"""
    id: str
    task_type: str
    payload: Dict[str, Any]
    priority: TaskPriority = TaskPriority.NORMAL
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3
    timeout_seconds: int = 60
    user_id: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'task_type': self.task_type,
            'payload': self.payload,
            'priority': self.priority.value,
            'status': self.status.value,
            'created_at': self.created_at.isoformat(),
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'result': self.result,
            'error': self.error,
            'retry_count': self.retry_count,
            'user_id': self.user_id
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Task":
        return cls(
            id=data['id'],
            task_type=data['task_type'],
            payload=data['payload'],
            priority=TaskPriority(data.get('priority', 1)),
            status=TaskStatus(data.get('status', 'pending')),
            created_at=datetime.fromisoformat(data['created_at']) if data.get('created_at') else datetime.now(),
            started_at=datetime.fromisoformat(data['started_at']) if data.get('started_at') else None,
            completed_at=datetime.fromisoformat(data['completed_at']) if data.get('completed_at') else None,
            result=data.get('result'),
            error=data.get('error'),
            retry_count=data.get('retry_count', 0),
            max_retries=data.get('max_retries', 3),
            timeout_seconds=data.get('timeout_seconds', 60),
            user_id=data.get('user_id')
        )


class MemoryQueue:
    """基于 asyncio 的内存任务队列"""
    
    def __init__(self, max_size: int = 10000):
        self.max_size = max_size
        self.queues: Dict[TaskPriority, asyncio.PriorityQueue] = {
            priority: asyncio.PriorityQueue(maxsize=max_size)
            for priority in TaskPriority
        }
        self.tasks: Dict[str, Task] = {}
        self._lock = asyncio.Lock()
    
    async def put(self, task: Task):
        """添加任务到队列"""
        async with self._lock:
            self.tasks[task.id] = task
            # 优先级队列使用负数，因为 PriorityQueue 是最小堆
            priority_value = -task.priority.value
            await self.queues[task.priority].put((priority_value, task.created_at.timestamp(), task.id))
    
    async def get(self, timeout: float = None) -> Optional[Task]:
        """从队列获取任务（按优先级）"""
        # 按优先级从高到低检查队列
        for priority in reversed(list(TaskPriority)):
            queue = self.queues[priority]
            if not queue.empty():
                try:
                    _, _, task_id = queue.get_nowait()
                    async with self._lock:
                        if task_id in self.tasks:
                            return self.tasks[task_id]
                except asyncio.QueueEmpty:
                    continue
        
        # 如果所有队列都空，等待最高优先级队列
        if timeout:
            try:
                _, _, task_id = await asyncio.wait_for(
                    self.queues[TaskPriority.CRITICAL].get(),
                    timeout=timeout
                )
                async with self._lock:
                    if task_id in self.tasks:
                        return self.tasks[task_id]
            except asyncio.TimeoutError:
                return None
        
        return None
    
    async def update_task(self, task: Task):
        """更新任务状态"""
        async with self._lock:
            self.tasks[task.id] = task
    
    async def get_task(self, task_id: str) -> Optional[Task]:
        """获取任务"""
        return self.tasks.get(task_id)
    
    async def remove_task(self, task_id: str):
        """移除任务"""
        async with self._lock:
            if task_id in self.tasks:
                del self.tasks[task_id]
    
    def size(self) -> int:
        """获取队列大小"""
        return sum(q.qsize() for q in self.queues.values())
    
    async def get_pending_tasks(self, user_id: Optional[str] = None) -> List[Task]:
        """获取待处理任务"""
        tasks = [
            t for t in self.tasks.values()
            if t.status == TaskStatus.PENDING
        ]
        if user_id:
            tasks = [t for t in tasks if t.user_id == user_id]
        return tasks


class RedisQueue:
    """基于 Redis Streams 的任务队列"""
    
    def __init__(
        self,
        redis_url: str = "redis://localhost:6379",
        stream_prefix: str = "memos:tasks",
        consumer_group: str = "memos_workers",
        consumer_name: str = None
    ):
        self.redis_url = redis_url
        self.stream_prefix = stream_prefix
        self.consumer_group = consumer_group
        self.consumer_name = consumer_name or f"worker_{uuid.uuid4().hex[:8]}"
        self.client: Optional[aioredis.Redis] = None
        self._initialized = False
    
    async def connect(self):
        """连接 Redis"""
        if not REDIS_AVAILABLE:
            raise RuntimeError("redis 库未安装")
        
        try:
            self.client = await aioredis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
            
            # 为每个优先级创建消费者组
            for priority in TaskPriority:
                stream_name = f"{self.stream_prefix}:{priority.name.lower()}"
                try:
                    await self.client.xgroup_create(
                        stream_name,
                        self.consumer_group,
                        id="0",
                        mkstream=True
                    )
                except Exception:
                    pass  # 组可能已存在
            
            self._initialized = True
            logger.info(f"Redis 队列已连接: {self.redis_url}")
            
        except Exception as e:
            logger.error(f"Redis 连接失败: {e}")
            raise
    
    async def put(self, task: Task):
        """添加任务到 Redis Stream"""
        if not self._initialized:
            await self.connect()
        
        stream_name = f"{self.stream_prefix}:{task.priority.name.lower()}"
        task_data = json.dumps(task.to_dict())
        
        await self.client.xadd(
            stream_name,
            {"task": task_data},
            maxlen=10000
        )
        
        # 存储任务状态
        await self.client.hset(
            f"{self.stream_prefix}:status",
            task.id,
            task_data
        )
    
    async def get(self, timeout: float = 5.0) -> Optional[Task]:
        """从 Redis Stream 获取任务"""
        if not self._initialized:
            await self.connect()
        
        # 按优先级从高到低读取
        for priority in reversed(list(TaskPriority)):
            stream_name = f"{self.stream_prefix}:{priority.name.lower()}"
            
            try:
                messages = await self.client.xreadgroup(
                    self.consumer_group,
                    self.consumer_name,
                    {stream_name: ">"},
                    count=1,
                    block=int(timeout * 1000) if timeout else None
                )
                
                if messages:
                    for stream, entries in messages:
                        for entry_id, data in entries:
                            task_data = json.loads(data['task'])
                            task = Task.from_dict(task_data)
                            
                            # 确认消息
                            await self.client.xack(stream_name, self.consumer_group, entry_id)
                            
                            return task
            except Exception as e:
                logger.error(f"读取 Redis Stream 失败: {e}")
        
        return None
    
    async def update_task(self, task: Task):
        """更新任务状态"""
        if not self._initialized:
            return
        
        task_data = json.dumps(task.to_dict())
        await self.client.hset(
            f"{self.stream_prefix}:status",
            task.id,
            task_data
        )
    
    async def get_task(self, task_id: str) -> Optional[Task]:
        """获取任务状态"""
        if not self._initialized:
            return None
        
        task_data = await self.client.hget(f"{self.stream_prefix}:status", task_id)
        if task_data:
            return Task.from_dict(json.loads(task_data))
        return None
    
    async def close(self):
        """关闭连接"""
        if self.client:
            await self.client.close()


# 任务处理器类型
TaskHandler = Callable[[Task], Awaitable[Any]]


class MemScheduler:
    """MemOS 异步任务调度器"""
    
    def __init__(
        self,
        use_redis: bool = False,
        redis_url: str = "redis://localhost:6379",
        max_workers: int = 4,
        max_queue_size: int = 10000,
        default_timeout: int = 60,
        quota_per_user: int = 100  # 每用户每分钟最大任务数
    ):
        """
        初始化调度器
        
        Args:
            use_redis: 是否使用 Redis（默认使用内存队列）
            redis_url: Redis 连接 URL
            max_workers: 最大工作协程数
            max_queue_size: 队列最大容量
            default_timeout: 默认任务超时时间（秒）
            quota_per_user: 每用户每分钟配额
        """
        self.use_redis = use_redis and REDIS_AVAILABLE
        self.max_workers = max_workers
        self.default_timeout = default_timeout
        self.quota_per_user = quota_per_user
        
        # 初始化队列
        if self.use_redis:
            self.queue = RedisQueue(redis_url=redis_url)
        else:
            self.queue = MemoryQueue(max_size=max_queue_size)
        
        # 任务处理器
        self.handlers: Dict[str, TaskHandler] = {}
        
        # 工作协程
        self.workers: List[asyncio.Task] = []
        self._running = False
        
        # 配额跟踪
        self.user_quotas: Dict[str, List[datetime]] = defaultdict(list)
        
        # 统计
        self.stats = {
            'total_submitted': 0,
            'total_completed': 0,
            'total_failed': 0,
            'total_timeout': 0
        }
    
    def register_handler(self, task_type: str, handler: TaskHandler):
        """
        注册任务处理器
        
        Args:
            task_type: 任务类型
            handler: 异步处理函数
        """
        self.handlers[task_type] = handler
        logger.info(f"注册任务处理器: {task_type}")
    
    async def submit(
        self,
        task_type: str,
        payload: Dict[str, Any],
        priority: TaskPriority = TaskPriority.NORMAL,
        user_id: Optional[str] = None,
        timeout: Optional[int] = None
    ) -> str:
        """
        提交任务
        
        Args:
            task_type: 任务类型
            payload: 任务数据
            priority: 优先级
            user_id: 用户 ID
            timeout: 超时时间（秒）
        
        Returns:
            任务 ID
        """
        # 检查配额
        if user_id and not self._check_quota(user_id):
            raise RuntimeError(f"用户 {user_id} 已超过配额限制")
        
        # 创建任务
        task = Task(
            id=f"task_{uuid.uuid4().hex[:12]}",
            task_type=task_type,
            payload=payload,
            priority=priority,
            user_id=user_id,
            timeout_seconds=timeout or self.default_timeout
        )
        
        # 添加到队列
        await self.queue.put(task)
        
        # 更新配额
        if user_id:
            self.user_quotas[user_id].append(datetime.now())
        
        self.stats['total_submitted'] += 1
        logger.debug(f"任务已提交: {task.id} ({task_type})")
        
        return task.id
    
    def _check_quota(self, user_id: str) -> bool:
        """检查用户配额"""
        now = datetime.now()
        minute_ago = now - timedelta(minutes=1)
        
        # 清理过期记录
        self.user_quotas[user_id] = [
            t for t in self.user_quotas[user_id]
            if t > minute_ago
        ]
        
        return len(self.user_quotas[user_id]) < self.quota_per_user
    
    async def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务状态"""
        task = await self.queue.get_task(task_id)
        if task:
            return task.to_dict()
        return None
    
    async def start(self):
        """启动调度器"""
        if self._running:
            return
        
        self._running = True
        
        # 如果使用 Redis，先连接
        if self.use_redis:
            await self.queue.connect()
        
        # 启动工作协程
        for i in range(self.max_workers):
            worker = asyncio.create_task(self._worker(f"worker_{i}"))
            self.workers.append(worker)
        
        logger.info(f"调度器已启动: {self.max_workers} 个工作协程")
    
    async def stop(self):
        """停止调度器"""
        self._running = False
        
        # 取消所有工作协程
        for worker in self.workers:
            worker.cancel()
        
        # 等待工作协程结束
        await asyncio.gather(*self.workers, return_exceptions=True)
        self.workers = []
        
        # 关闭 Redis 连接
        if self.use_redis and hasattr(self.queue, 'close'):
            await self.queue.close()
        
        logger.info("调度器已停止")
    
    async def _worker(self, worker_name: str):
        """工作协程"""
        logger.debug(f"{worker_name} 已启动")
        
        while self._running:
            try:
                # 获取任务
                task = await self.queue.get(timeout=1.0)
                
                if not task:
                    continue
                
                # 处理任务
                await self._process_task(task, worker_name)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"{worker_name} 错误: {e}")
                await asyncio.sleep(1)
        
        logger.debug(f"{worker_name} 已停止")
    
    async def _process_task(self, task: Task, worker_name: str):
        """处理单个任务"""
        handler = self.handlers.get(task.task_type)
        
        if not handler:
            logger.warning(f"未知任务类型: {task.task_type}")
            task.status = TaskStatus.FAILED
            task.error = f"未知任务类型: {task.task_type}"
            await self.queue.update_task(task)
            self.stats['total_failed'] += 1
            return
        
        # 更新状态为运行中
        task.status = TaskStatus.RUNNING
        task.started_at = datetime.now()
        await self.queue.update_task(task)
        
        logger.debug(f"{worker_name} 处理任务: {task.id}")
        
        try:
            # 执行任务（带超时）
            result = await asyncio.wait_for(
                handler(task),
                timeout=task.timeout_seconds
            )
            
            # 成功
            task.status = TaskStatus.COMPLETED
            task.result = result
            task.completed_at = datetime.now()
            self.stats['total_completed'] += 1
            
        except asyncio.TimeoutError:
            # 超时
            task.status = TaskStatus.TIMEOUT
            task.error = f"任务超时 ({task.timeout_seconds}s)"
            task.completed_at = datetime.now()
            self.stats['total_timeout'] += 1
            
            # 检查是否需要重试
            if task.retry_count < task.max_retries:
                task.retry_count += 1
                task.status = TaskStatus.PENDING
                await self.queue.put(task)
                logger.warning(f"任务超时，重试 {task.retry_count}/{task.max_retries}: {task.id}")
                return
            
        except Exception as e:
            # 失败
            task.status = TaskStatus.FAILED
            task.error = str(e)
            task.completed_at = datetime.now()
            self.stats['total_failed'] += 1
            
            # 检查是否需要重试
            if task.retry_count < task.max_retries:
                task.retry_count += 1
                task.status = TaskStatus.PENDING
                await self.queue.put(task)
                logger.warning(f"任务失败，重试 {task.retry_count}/{task.max_retries}: {task.id}")
                return
        
        # 更新最终状态
        await self.queue.update_task(task)
        logger.debug(f"任务完成: {task.id} ({task.status.value})")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        queue_size = self.queue.size() if hasattr(self.queue, 'size') else 0
        
        return {
            'running': self._running,
            'workers': len(self.workers),
            'queue_size': queue_size,
            'use_redis': self.use_redis,
            **self.stats
        }


# ==================== 预定义任务处理器 ====================

async def add_memory_task(task: Task) -> Dict[str, Any]:
    """添加记忆任务处理器"""
    # 这个函数会在 API 服务器中被实际实现覆盖
    logger.info(f"处理添加记忆任务: {task.payload}")
    return {'status': 'processed'}


async def process_image_task(task: Task) -> Dict[str, Any]:
    """处理图像任务"""
    logger.info(f"处理图像任务: {task.payload}")
    return {'status': 'processed'}


async def extract_entities_task(task: Task) -> Dict[str, Any]:
    """提取实体任务"""
    logger.info(f"处理实体提取任务: {task.payload}")
    return {'status': 'processed'}


# ==================== 便捷函数 ====================

_scheduler: Optional[MemScheduler] = None


def get_scheduler() -> Optional[MemScheduler]:
    """获取全局调度器实例"""
    return _scheduler


async def init_scheduler(
    use_redis: bool = False,
    redis_url: str = "redis://localhost:6379",
    max_workers: int = 4
) -> MemScheduler:
    """初始化全局调度器"""
    global _scheduler
    
    _scheduler = MemScheduler(
        use_redis=use_redis,
        redis_url=redis_url,
        max_workers=max_workers
    )
    
    # 注册默认处理器
    _scheduler.register_handler('add_memory', add_memory_task)
    _scheduler.register_handler('process_image', process_image_task)
    _scheduler.register_handler('extract_entities', extract_entities_task)
    
    await _scheduler.start()
    return _scheduler


async def shutdown_scheduler():
    """关闭全局调度器"""
    global _scheduler
    if _scheduler:
        await _scheduler.stop()
        _scheduler = None
