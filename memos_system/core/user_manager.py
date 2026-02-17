# user_manager.py - 用户管理器
"""
用户管理功能
"""

import os
import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

try:
    from ..models.user import User, UserRole, UserCreate, UserUpdate
except ImportError:
    from models.user import User, UserRole, UserCreate, UserUpdate

logger = logging.getLogger(__name__)


class UserManager:
    """用户管理器"""
    
    def __init__(self, data_path: Optional[str] = None):
        """
        初始化用户管理器
        
        Args:
            data_path: 用户数据存储路径
        """
        if data_path:
            self.data_path = data_path
        else:
            self.data_path = os.path.join(
                os.path.dirname(__file__),
                '..', 'data', 'users.json'
            )
        
        self.users: Dict[str, User] = {}
        self._load_users()
    
    def _load_users(self):
        """加载用户数据"""
        if os.path.exists(self.data_path):
            try:
                with open(self.data_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for user_data in data:
                        user = User.from_dict(user_data)
                        self.users[user.id] = user
                logger.info(f"加载了 {len(self.users)} 个用户")
            except Exception as e:
                logger.error(f"加载用户数据失败: {e}")
        else:
            # 创建默认用户
            self._create_default_user()
    
    def _create_default_user(self):
        """创建默认用户"""
        default_user = User(
            id="feiniu_default",
            name="肥牛默认用户",
            role=UserRole.USER
        )
        self.users[default_user.id] = default_user
        self._save_users()
        logger.info("创建默认用户: feiniu_default")
    
    def _save_users(self):
        """保存用户数据"""
        try:
            os.makedirs(os.path.dirname(self.data_path), exist_ok=True)
            with open(self.data_path, 'w', encoding='utf-8') as f:
                data = [user.to_dict() for user in self.users.values()]
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存用户数据失败: {e}")
    
    def create_user(self, user_create: UserCreate) -> Optional[User]:
        """
        创建用户
        
        Args:
            user_create: 创建用户请求
        
        Returns:
            创建的用户对象
        """
        if user_create.id in self.users:
            logger.warning(f"用户已存在: {user_create.id}")
            return None
        
        user = User(
            id=user_create.id,
            name=user_create.name,
            role=user_create.role,
            settings=user_create.settings
        )
        
        self.users[user.id] = user
        self._save_users()
        
        logger.info(f"创建用户: {user.id}")
        return user
    
    def get_user(self, user_id: str) -> Optional[User]:
        """
        获取用户
        
        Args:
            user_id: 用户 ID
        
        Returns:
            用户对象
        """
        return self.users.get(user_id)
    
    def list_users(self, include_inactive: bool = False) -> List[User]:
        """
        列出用户
        
        Args:
            include_inactive: 是否包含非活跃用户
        
        Returns:
            用户列表
        """
        users = list(self.users.values())
        if not include_inactive:
            users = [u for u in users if u.is_active]
        return users
    
    def update_user(
        self,
        user_id: str,
        user_update: UserUpdate
    ) -> Optional[User]:
        """
        更新用户
        
        Args:
            user_id: 用户 ID
            user_update: 更新请求
        
        Returns:
            更新后的用户对象
        """
        user = self.users.get(user_id)
        if not user:
            return None
        
        if user_update.name is not None:
            user.name = user_update.name
        if user_update.role is not None:
            user.role = user_update.role
        if user_update.settings is not None:
            user.settings.update(user_update.settings)
        if user_update.is_active is not None:
            user.is_active = user_update.is_active
        
        self._save_users()
        return user
    
    def delete_user(self, user_id: str) -> bool:
        """
        删除用户
        
        Args:
            user_id: 用户 ID
        
        Returns:
            是否成功
        """
        if user_id not in self.users:
            return False
        
        del self.users[user_id]
        self._save_users()
        
        logger.info(f"删除用户: {user_id}")
        return True
    
    def update_last_active(self, user_id: str):
        """
        更新用户最后活跃时间
        
        Args:
            user_id: 用户 ID
        """
        user = self.users.get(user_id)
        if user:
            user.last_active_at = datetime.now()
            self._save_users()
    
    def update_stats(
        self,
        user_id: str,
        memory_count: Optional[int] = None,
        entity_count: Optional[int] = None
    ):
        """
        更新用户统计
        
        Args:
            user_id: 用户 ID
            memory_count: 记忆数量
            entity_count: 实体数量
        """
        user = self.users.get(user_id)
        if user:
            if memory_count is not None:
                user.memory_count = memory_count
            if entity_count is not None:
                user.entity_count = entity_count
            self._save_users()
    
    def add_cube_to_user(
        self,
        user_id: str,
        cube_id: str,
        is_owner: bool = True
    ) -> bool:
        """
        添加 Cube 到用户
        
        Args:
            user_id: 用户 ID
            cube_id: Cube ID
            is_owner: 是否为所有者
        
        Returns:
            是否成功
        """
        user = self.users.get(user_id)
        if not user:
            return False
        
        if is_owner:
            if cube_id not in user.owned_cube_ids:
                user.owned_cube_ids.append(cube_id)
        
        if cube_id not in user.accessible_cube_ids:
            user.accessible_cube_ids.append(cube_id)
        
        self._save_users()
        return True
    
    def share_cube(
        self,
        cube_id: str,
        from_user_id: str,
        to_user_id: str
    ) -> bool:
        """
        共享 Cube
        
        Args:
            cube_id: Cube ID
            from_user_id: 源用户 ID
            to_user_id: 目标用户 ID
        
        Returns:
            是否成功
        """
        from_user = self.users.get(from_user_id)
        to_user = self.users.get(to_user_id)
        
        if not from_user or not to_user:
            return False
        
        # 验证源用户拥有该 Cube
        if cube_id not in from_user.owned_cube_ids:
            logger.warning(f"用户 {from_user_id} 不拥有 Cube {cube_id}")
            return False
        
        # 添加到目标用户的可访问列表
        if cube_id not in to_user.accessible_cube_ids:
            to_user.accessible_cube_ids.append(cube_id)
            self._save_users()
        
        logger.info(f"Cube {cube_id} 已从 {from_user_id} 共享给 {to_user_id}")
        return True
    
    def get_accessible_cubes(self, user_id: str) -> List[str]:
        """
        获取用户可访问的 Cube
        
        Args:
            user_id: 用户 ID
        
        Returns:
            Cube ID 列表
        """
        user = self.users.get(user_id)
        if user:
            return user.accessible_cube_ids
        return []
