# user.py - 用户数据模型
"""
用户数据模型定义
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class UserRole(str, Enum):
    """用户角色枚举"""
    ADMIN = "admin"      # 管理员
    USER = "user"        # 普通用户
    GUEST = "guest"      # 访客


class User(BaseModel):
    """用户模型"""
    
    # 基础字段
    id: str = Field(..., description="用户唯一 ID")
    name: Optional[str] = Field(default=None, description="用户名称")
    role: UserRole = Field(default=UserRole.USER, description="用户角色")
    
    # 配置
    settings: Dict[str, Any] = Field(
        default_factory=dict,
        description="用户设置"
    )
    
    # 统计
    memory_count: int = Field(default=0, description="记忆数量")
    entity_count: int = Field(default=0, description="实体数量")
    
    # Cube 信息
    owned_cube_ids: List[str] = Field(
        default_factory=list,
        description="拥有的 Cube ID"
    )
    accessible_cube_ids: List[str] = Field(
        default_factory=list,
        description="可访问的 Cube ID（含共享）"
    )
    
    # 时间戳
    created_at: datetime = Field(
        default_factory=datetime.now,
        description="创建时间"
    )
    last_active_at: Optional[datetime] = Field(
        default=None,
        description="最后活跃时间"
    )
    
    # 状态
    is_active: bool = Field(default=True, description="是否激活")
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            'id': self.id,
            'name': self.name,
            'role': self.role.value,
            'settings': self.settings,
            'memory_count': self.memory_count,
            'entity_count': self.entity_count,
            'owned_cube_ids': self.owned_cube_ids,
            'accessible_cube_ids': self.accessible_cube_ids,
            'created_at': self.created_at.isoformat(),
            'last_active_at': self.last_active_at.isoformat() if self.last_active_at else None,
            'is_active': self.is_active
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "User":
        """从字典创建实例"""
        return cls(
            id=data['id'],
            name=data.get('name'),
            role=UserRole(data.get('role', 'user')),
            settings=data.get('settings', {}),
            memory_count=data.get('memory_count', 0),
            entity_count=data.get('entity_count', 0),
            owned_cube_ids=data.get('owned_cube_ids', []),
            accessible_cube_ids=data.get('accessible_cube_ids', []),
            created_at=datetime.fromisoformat(data['created_at']) if data.get('created_at') else datetime.now(),
            last_active_at=datetime.fromisoformat(data['last_active_at']) if data.get('last_active_at') else None,
            is_active=data.get('is_active', True)
        )


class UserCreate(BaseModel):
    """创建用户请求模型"""
    
    id: str = Field(..., description="用户 ID")
    name: Optional[str] = Field(default=None, description="用户名称")
    role: UserRole = Field(default=UserRole.USER, description="用户角色")
    settings: Dict[str, Any] = Field(default_factory=dict, description="初始设置")


class UserUpdate(BaseModel):
    """更新用户请求模型"""
    
    name: Optional[str] = None
    role: Optional[UserRole] = None
    settings: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
