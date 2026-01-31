# cube_manager.py - Cube 管理器
"""
管理所有 MemCube 实例
"""

import os
import json
import logging
from typing import List, Dict, Any, Optional

from .cube import MemCube, CubeMetadata, CubeVisibility

logger = logging.getLogger(__name__)


class CubeManager:
    """Cube 管理器"""
    
    def __init__(
        self,
        data_path: Optional[str] = None,
        vector_storage=None,
        graph_storage=None,
        embedder=None
    ):
        """
        初始化 Cube 管理器
        
        Args:
            data_path: Cube 元数据存储路径
            vector_storage: 向量存储客户端
            graph_storage: 图存储客户端
            embedder: 嵌入模型
        """
        if data_path:
            self.data_path = data_path
        else:
            self.data_path = os.path.join(
                os.path.dirname(__file__),
                '..', 'data', 'cubes.json'
            )
        
        self.vector_storage = vector_storage
        self.graph_storage = graph_storage
        self.embedder = embedder
        
        # Cube 元数据缓存
        self.cube_metadata: Dict[str, CubeMetadata] = {}
        
        # 已加载的 Cube 实例缓存
        self.cube_instances: Dict[str, MemCube] = {}
        
        self._load_metadata()
    
    def _load_metadata(self):
        """加载 Cube 元数据"""
        if os.path.exists(self.data_path):
            try:
                with open(self.data_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for cube_data in data:
                        metadata = CubeMetadata.from_dict(cube_data)
                        self.cube_metadata[metadata.id] = metadata
                logger.info(f"加载了 {len(self.cube_metadata)} 个 Cube 元数据")
            except Exception as e:
                logger.error(f"加载 Cube 元数据失败: {e}")
    
    def _save_metadata(self):
        """保存 Cube 元数据"""
        try:
            os.makedirs(os.path.dirname(self.data_path), exist_ok=True)
            with open(self.data_path, 'w', encoding='utf-8') as f:
                data = [m.to_dict() for m in self.cube_metadata.values()]
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存 Cube 元数据失败: {e}")
    
    def create_cube(
        self,
        cube_id: str,
        name: str,
        owner_id: str,
        description: Optional[str] = None,
        visibility: CubeVisibility = CubeVisibility.PRIVATE,
        settings: Optional[Dict[str, Any]] = None
    ) -> Optional[MemCube]:
        """
        创建新 Cube
        
        Args:
            cube_id: Cube ID
            name: 名称
            owner_id: 所有者 ID
            description: 描述
            visibility: 可见性
            settings: 设置
        
        Returns:
            创建的 Cube
        """
        if cube_id in self.cube_metadata:
            logger.warning(f"Cube 已存在: {cube_id}")
            return None
        
        metadata = CubeMetadata(
            id=cube_id,
            name=name,
            description=description,
            owner_id=owner_id,
            visibility=visibility,
            settings=settings or {}
        )
        
        self.cube_metadata[cube_id] = metadata
        self._save_metadata()
        
        # 创建并缓存实例
        cube = MemCube(
            metadata=metadata,
            vector_storage=self.vector_storage,
            graph_storage=self.graph_storage,
            embedder=self.embedder
        )
        self.cube_instances[cube_id] = cube
        
        logger.info(f"创建 Cube: {cube_id} ({name})")
        return cube
    
    def get_cube(self, cube_id: str) -> Optional[MemCube]:
        """
        获取 Cube
        
        Args:
            cube_id: Cube ID
        
        Returns:
            Cube 实例
        """
        # 检查缓存
        if cube_id in self.cube_instances:
            return self.cube_instances[cube_id]
        
        # 检查元数据
        metadata = self.cube_metadata.get(cube_id)
        if not metadata:
            return None
        
        # 创建实例并缓存
        cube = MemCube(
            metadata=metadata,
            vector_storage=self.vector_storage,
            graph_storage=self.graph_storage,
            embedder=self.embedder
        )
        self.cube_instances[cube_id] = cube
        
        return cube
    
    def list_cubes(
        self,
        user_id: Optional[str] = None,
        include_shared: bool = True
    ) -> List[CubeMetadata]:
        """
        列出 Cube
        
        Args:
            user_id: 用户 ID（过滤可访问的）
            include_shared: 是否包含共享的
        
        Returns:
            Cube 元数据列表
        """
        cubes = list(self.cube_metadata.values())
        
        if user_id:
            accessible = []
            for cube in cubes:
                # 公开的
                if cube.visibility == CubeVisibility.PUBLIC:
                    accessible.append(cube)
                # 自己拥有的
                elif cube.owner_id == user_id:
                    accessible.append(cube)
                # 共享给自己的
                elif include_shared and user_id in cube.shared_with:
                    accessible.append(cube)
            cubes = accessible
        
        return cubes
    
    def list_owned_cubes(self, user_id: str) -> List[CubeMetadata]:
        """
        列出用户拥有的 Cube
        
        Args:
            user_id: 用户 ID
        
        Returns:
            Cube 元数据列表
        """
        return [
            c for c in self.cube_metadata.values()
            if c.owner_id == user_id
        ]
    
    def update_cube(
        self,
        cube_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        visibility: Optional[CubeVisibility] = None,
        settings: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        更新 Cube
        
        Args:
            cube_id: Cube ID
            name: 新名称
            description: 新描述
            visibility: 新可见性
            settings: 新设置
        
        Returns:
            是否成功
        """
        metadata = self.cube_metadata.get(cube_id)
        if not metadata:
            return False
        
        if name is not None:
            metadata.name = name
        if description is not None:
            metadata.description = description
        if visibility is not None:
            metadata.visibility = visibility
        if settings is not None:
            metadata.settings.update(settings)
        
        from datetime import datetime
        metadata.updated_at = datetime.now()
        
        self._save_metadata()
        return True
    
    def delete_cube(self, cube_id: str) -> bool:
        """
        删除 Cube
        
        Args:
            cube_id: Cube ID
        
        Returns:
            是否成功
        """
        if cube_id not in self.cube_metadata:
            return False
        
        # TODO: 删除 Cube 中的所有记忆和实体
        
        del self.cube_metadata[cube_id]
        if cube_id in self.cube_instances:
            del self.cube_instances[cube_id]
        
        self._save_metadata()
        logger.info(f"删除 Cube: {cube_id}")
        return True
    
    def share_cube(
        self,
        cube_id: str,
        share_with_user_id: str,
        owner_id: str
    ) -> bool:
        """
        共享 Cube
        
        Args:
            cube_id: Cube ID
            share_with_user_id: 共享给的用户 ID
            owner_id: 当前操作用户（必须是所有者）
        
        Returns:
            是否成功
        """
        metadata = self.cube_metadata.get(cube_id)
        if not metadata:
            return False
        
        if metadata.owner_id != owner_id:
            logger.warning(f"用户 {owner_id} 无权共享 Cube {cube_id}")
            return False
        
        if share_with_user_id not in metadata.shared_with:
            metadata.shared_with.append(share_with_user_id)
            
            from datetime import datetime
            metadata.updated_at = datetime.now()
            
            self._save_metadata()
            logger.info(f"Cube {cube_id} 已共享给 {share_with_user_id}")
        
        return True
    
    def unshare_cube(
        self,
        cube_id: str,
        user_id: str,
        owner_id: str
    ) -> bool:
        """
        取消共享
        
        Args:
            cube_id: Cube ID
            user_id: 取消共享的用户 ID
            owner_id: 当前操作用户
        
        Returns:
            是否成功
        """
        metadata = self.cube_metadata.get(cube_id)
        if not metadata:
            return False
        
        if metadata.owner_id != owner_id:
            return False
        
        if user_id in metadata.shared_with:
            metadata.shared_with.remove(user_id)
            self._save_metadata()
        
        return True
    
    def get_user_accessible_cubes(self, user_id: str) -> List[str]:
        """
        获取用户可访问的所有 Cube ID
        
        Args:
            user_id: 用户 ID
        
        Returns:
            Cube ID 列表
        """
        cube_ids = []
        
        for metadata in self.cube_metadata.values():
            if metadata.visibility == CubeVisibility.PUBLIC:
                cube_ids.append(metadata.id)
            elif metadata.owner_id == user_id:
                cube_ids.append(metadata.id)
            elif user_id in metadata.shared_with:
                cube_ids.append(metadata.id)
        
        return cube_ids
    
    def update_cube_stats(
        self,
        cube_id: str,
        memory_count: Optional[int] = None,
        entity_count: Optional[int] = None
    ):
        """
        更新 Cube 统计
        
        Args:
            cube_id: Cube ID
            memory_count: 记忆数量
            entity_count: 实体数量
        """
        metadata = self.cube_metadata.get(cube_id)
        if metadata:
            if memory_count is not None:
                metadata.memory_count = memory_count
            if entity_count is not None:
                metadata.entity_count = entity_count
            self._save_metadata()
    
    def get_default_cube(self, user_id: str) -> MemCube:
        """
        获取或创建用户的默认 Cube
        
        Args:
            user_id: 用户 ID
        
        Returns:
            默认 Cube
        """
        default_cube_id = f"default_{user_id}"
        
        cube = self.get_cube(default_cube_id)
        if cube:
            return cube
        
        # 创建默认 Cube
        return self.create_cube(
            cube_id=default_cube_id,
            name=f"{user_id} 的默认记忆库",
            owner_id=user_id,
            description="自动创建的默认记忆库"
        )
