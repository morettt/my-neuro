# user_routes.py - 用户 API 路由
"""
用户管理相关的 API 端点
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

router = APIRouter(prefix="/users", tags=["用户管理"])


# ==================== 请求模型 ====================

class CreateUserRequest(BaseModel):
    user_id: str = Field(..., description="用户 ID")
    name: Optional[str] = Field(default=None, description="用户名称")
    role: str = Field(default="user", description="角色: admin, user, guest")
    settings: Dict[str, Any] = Field(default_factory=dict, description="初始设置")


class UpdateUserRequest(BaseModel):
    name: Optional[str] = Field(default=None, description="新名称")
    role: Optional[str] = Field(default=None, description="新角色")
    settings: Optional[Dict[str, Any]] = Field(default=None, description="更新设置")
    is_active: Optional[bool] = Field(default=None, description="是否激活")


# ==================== 响应模型 ====================

class UserResponse(BaseModel):
    id: str
    name: Optional[str]
    role: str
    memory_count: int
    entity_count: int
    is_active: bool
    created_at: str


class UserListResponse(BaseModel):
    users: List[UserResponse]
    total: int


# ==================== 端点 ====================

@router.post("/", summary="创建用户")
async def create_user(request: CreateUserRequest):
    """
    创建新用户
    
    - 自动创建默认 Cube
    """
    return {
        "success": True,
        "user_id": request.user_id,
        "message": "用户创建成功"
    }


@router.get("/{user_id}", summary="获取用户")
async def get_user(user_id: str):
    """获取用户详情"""
    return {
        "user": {
            "id": user_id,
            "name": None,
            "role": "user",
            "memory_count": 0,
            "entity_count": 0,
            "is_active": True
        }
    }


@router.put("/{user_id}", summary="更新用户")
async def update_user(user_id: str, request: UpdateUserRequest):
    """更新用户信息"""
    return {
        "success": True,
        "user_id": user_id
    }


@router.delete("/{user_id}", summary="删除用户")
async def delete_user(user_id: str):
    """
    删除用户
    
    - 不会删除用户的记忆数据
    """
    return {
        "success": True,
        "user_id": user_id
    }


@router.get("/", summary="列出用户")
async def list_users(
    include_inactive: bool = Query(default=False, description="包含非活跃用户")
):
    """列出所有用户"""
    return {
        "users": [],
        "total": 0
    }


@router.get("/{user_id}/stats", summary="用户统计")
async def get_user_stats(user_id: str):
    """获取用户统计信息"""
    return {
        "user_id": user_id,
        "memory_count": 0,
        "entity_count": 0,
        "cube_count": 0,
        "last_active_at": None
    }


@router.get("/{user_id}/cubes", summary="用户的 Cube")
async def get_user_cubes(user_id: str, include_shared: bool = Query(default=True)):
    """获取用户可访问的所有 Cube"""
    return {
        "owned": [],
        "shared": []
    }


@router.post("/{user_id}/settings", summary="更新设置")
async def update_user_settings(user_id: str, settings: Dict[str, Any]):
    """更新用户设置"""
    return {
        "success": True,
        "settings": settings
    }
