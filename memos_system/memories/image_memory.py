# image_memory.py - 图像记忆
"""
图像记忆管理
支持：
- 图像存储（本地文件系统）
- 图像描述生成（可选 LLM）
- 图像向量化（CLIP 或文本描述向量化）
- 图像检索
"""

import os
import uuid
import base64
import hashlib
import logging
import shutil
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# 尝试导入图像处理库
try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    logger.warning("Pillow 未安装，图像功能受限")

# 尝试导入 CLIP（可选）
try:
    import torch
    from transformers import CLIPProcessor, CLIPModel
    CLIP_AVAILABLE = True
except ImportError:
    CLIP_AVAILABLE = False
    logger.info("CLIP 未安装，将使用文本描述进行图像检索")


class ImageType(str):
    """图像类型"""
    CONVERSATION = "conversation"  # 对话中的图像
    DOCUMENT = "document"          # 文档中的图像
    SCREENSHOT = "screenshot"      # 截图
    AVATAR = "avatar"              # 头像
    REFERENCE = "reference"        # 参考图
    OTHER = "other"


@dataclass
class ImageMetadata:
    """图像元数据"""
    id: str
    filename: str
    original_name: str
    file_path: str
    image_type: str
    width: int
    height: int
    size_bytes: int
    format: str
    hash: str
    description: Optional[str]
    tags: List[str]
    user_id: str
    created_at: datetime
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'filename': self.filename,
            'original_name': self.original_name,
            'file_path': self.file_path,
            'image_type': self.image_type,
            'width': self.width,
            'height': self.height,
            'size_bytes': self.size_bytes,
            'format': self.format,
            'hash': self.hash,
            'description': self.description,
            'tags': self.tags,
            'user_id': self.user_id,
            'created_at': self.created_at.isoformat()
        }


class ImageMemoryItem(BaseModel):
    """图像记忆项"""
    id: str = Field(..., description="记忆 ID")
    image_id: str = Field(..., description="图像 ID")
    content: str = Field(..., description="图像描述/上下文")
    image_type: str = Field(default="other")
    
    # 关联
    conversation_id: Optional[str] = Field(default=None, description="关联的对话 ID")
    memory_ids: List[str] = Field(default_factory=list, description="关联的文本记忆 ID")
    entity_ids: List[str] = Field(default_factory=list, description="关联的实体 ID")
    
    # 元数据
    tags: List[str] = Field(default_factory=list)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    
    # 时间
    created_at: datetime = Field(default_factory=datetime.now)
    
    # 用户
    user_id: str = Field(default="feiniu_default")


class ImageMemory:
    """图像记忆管理器"""
    
    def __init__(
        self,
        storage_path: str = "./data/images",
        vector_storage=None,
        embedder=None,
        llm_config: Optional[Dict[str, Any]] = None,
        use_clip: bool = False,
        clip_model_name: str = "openai/clip-vit-base-patch32",
        max_image_size: int = 20 * 1024 * 1024,  # 20MB
        thumbnail_size: Tuple[int, int] = (256, 256)
    ):
        """
        初始化图像记忆管理器
        
        Args:
            storage_path: 图像存储目录
            vector_storage: 向量存储客户端
            embedder: 文本嵌入模型（当不使用 CLIP 时）
            llm_config: LLM 配置（用于生成图像描述）
            use_clip: 是否使用 CLIP 进行图像向量化
            clip_model_name: CLIP 模型名称
            max_image_size: 最大图像大小（字节）
            thumbnail_size: 缩略图大小
        """
        self.storage_path = Path(storage_path)
        self.vector_storage = vector_storage
        self.embedder = embedder
        self.llm_config = llm_config
        self.use_clip = use_clip and CLIP_AVAILABLE
        self.max_image_size = max_image_size
        self.thumbnail_size = thumbnail_size
        
        # CLIP 模型（可选）
        self.clip_model = None
        self.clip_processor = None
        
        # 图像元数据缓存
        self.metadata_cache: Dict[str, ImageMetadata] = {}
        
        # 初始化
        self._init_storage()
        
        if self.use_clip:
            self._init_clip(clip_model_name)
    
    def _init_storage(self):
        """初始化存储目录"""
        self.storage_path.mkdir(parents=True, exist_ok=True)
        (self.storage_path / "originals").mkdir(exist_ok=True)
        (self.storage_path / "thumbnails").mkdir(exist_ok=True)
        logger.info(f"图像存储目录: {self.storage_path}")
    
    def _init_clip(self, model_name: str):
        """初始化 CLIP 模型"""
        try:
            self.clip_model = CLIPModel.from_pretrained(model_name)
            self.clip_processor = CLIPProcessor.from_pretrained(model_name)
            
            if torch.cuda.is_available():
                self.clip_model = self.clip_model.to('cuda')
            
            logger.info(f"CLIP 模型已加载: {model_name}")
        except Exception as e:
            logger.error(f"加载 CLIP 模型失败: {e}")
            self.use_clip = False
    
    def _compute_hash(self, data: bytes) -> str:
        """计算文件哈希"""
        return hashlib.md5(data).hexdigest()
    
    def _get_image_info(self, image: Image.Image) -> Dict[str, Any]:
        """获取图像信息"""
        return {
            'width': image.width,
            'height': image.height,
            'format': image.format or 'UNKNOWN'
        }
    
    async def save_image(
        self,
        image_data: bytes,
        original_name: str,
        image_type: str = "other",
        description: Optional[str] = None,
        tags: Optional[List[str]] = None,
        user_id: str = "feiniu_default",
        auto_describe: bool = True
    ) -> Optional[ImageMetadata]:
        """
        保存图像
        
        Args:
            image_data: 图像字节数据
            original_name: 原始文件名
            image_type: 图像类型
            description: 描述（如果为空且 auto_describe=True，则自动生成）
            tags: 标签
            user_id: 用户 ID
            auto_describe: 是否自动生成描述
        
        Returns:
            图像元数据，失败返回 None
        """
        if not PIL_AVAILABLE:
            logger.error("Pillow 未安装，无法处理图像")
            return None
        
        try:
            # 打开图像
            from io import BytesIO
            image = Image.open(BytesIO(image_data))
            
            # 如果图片过大，自动压缩
            if len(image_data) > self.max_image_size:
                logger.warning(f"图像过大 ({len(image_data) / 1024 / 1024:.1f}MB)，正在自动压缩...")
                
                # 转换为 RGB（处理 RGBA 等格式）
                if image.mode in ('RGBA', 'P'):
                    image = image.convert('RGB')
                
                # 计算需要的压缩比例
                target_size = self.max_image_size * 0.9  # 目标为限制的 90%
                quality = 85
                
                # 逐步降低质量直到满足大小要求
                while quality >= 30:
                    buffer = BytesIO()
                    image.save(buffer, format='JPEG', quality=quality, optimize=True)
                    compressed_data = buffer.getvalue()
                    
                    if len(compressed_data) <= target_size:
                        image_data = compressed_data
                        logger.info(f"图像已压缩: {len(compressed_data) / 1024 / 1024:.1f}MB (质量: {quality}%)")
                        # 重新打开压缩后的图像
                        image = Image.open(BytesIO(image_data))
                        break
                    
                    quality -= 10
                else:
                    # 如果降低质量还不够，缩小尺寸
                    scale = (target_size / len(image_data)) ** 0.5
                    new_size = (int(image.width * scale), int(image.height * scale))
                    image = image.resize(new_size, Image.Resampling.LANCZOS)
                    
                    buffer = BytesIO()
                    image.save(buffer, format='JPEG', quality=60, optimize=True)
                    image_data = buffer.getvalue()
                    logger.info(f"图像已压缩并缩小: {len(image_data) / 1024 / 1024:.1f}MB, 尺寸: {new_size}")
                    image = Image.open(BytesIO(image_data))
            
            # 获取信息
            image_info = self._get_image_info(image)
            file_hash = self._compute_hash(image_data)
            
            # 检查是否已存在（去重）
            for meta in self.metadata_cache.values():
                if meta.hash == file_hash and meta.user_id == user_id:
                    logger.info(f"图像已存在: {meta.id}")
                    return meta
            
            # 生成 ID 和文件名（使用完整 UUID 格式以兼容 Qdrant）
            image_id = str(uuid.uuid4())
            ext = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else 'jpg'
            filename = f"{image_id}.{ext}"
            
            # 保存原图
            original_path = self.storage_path / "originals" / filename
            with open(original_path, 'wb') as f:
                f.write(image_data)
            
            # 生成并保存缩略图
            thumbnail = image.copy()
            thumbnail.thumbnail(self.thumbnail_size, Image.Resampling.LANCZOS)
            thumbnail_path = self.storage_path / "thumbnails" / filename
            
            # 转换为 RGB（处理 RGBA 等格式）
            if thumbnail.mode in ('RGBA', 'P'):
                thumbnail = thumbnail.convert('RGB')
            thumbnail.save(thumbnail_path, 'JPEG', quality=85)
            
            # 自动生成描述
            if not description and auto_describe:
                description = await self._generate_description(image, original_name)
            
            # 创建元数据
            metadata = ImageMetadata(
                id=image_id,
                filename=filename,
                original_name=original_name,
                file_path=str(original_path),
                image_type=image_type,
                width=image_info['width'],
                height=image_info['height'],
                size_bytes=len(image_data),
                format=image_info['format'],
                hash=file_hash,
                description=description,
                tags=tags or [],
                user_id=user_id,
                created_at=datetime.now()
            )
            
            # 缓存元数据
            self.metadata_cache[image_id] = metadata
            
            # 存储到向量库（用于检索）
            await self._store_to_vector(metadata, image)
            
            logger.info(f"图像已保存: {image_id}")
            return metadata
            
        except Exception as e:
            logger.error(f"保存图像失败: {e}")
            return None
    
    async def save_image_from_base64(
        self,
        base64_data: str,
        original_name: str = "image.jpg",
        **kwargs
    ) -> Optional[ImageMetadata]:
        """从 Base64 保存图像"""
        try:
            # 去除可能的 data URL 前缀
            if ',' in base64_data:
                base64_data = base64_data.split(',', 1)[1]
            
            image_data = base64.b64decode(base64_data)
            return await self.save_image(image_data, original_name, **kwargs)
        except Exception as e:
            logger.error(f"解码 Base64 失败: {e}")
            return None
    
    async def save_image_from_file(
        self,
        file_path: str,
        **kwargs
    ) -> Optional[ImageMetadata]:
        """从文件保存图像"""
        try:
            with open(file_path, 'rb') as f:
                image_data = f.read()
            
            original_name = os.path.basename(file_path)
            return await self.save_image(image_data, original_name, **kwargs)
        except Exception as e:
            logger.error(f"读取文件失败: {e}")
            return None
    
    async def _generate_description(
        self,
        image: Image.Image,
        filename: str
    ) -> Optional[str]:
        """使用 LLM 生成图像描述"""
        if not self.llm_config:
            return f"图像: {filename}"
        
        try:
            import aiohttp
            from io import BytesIO
            
            # 转换图像为 base64
            if image.mode in ('RGBA', 'P'):
                image = image.convert('RGB')
            
            # 缩小图像以节省 token
            max_size = 512
            if max(image.size) > max_size:
                ratio = max_size / max(image.size)
                new_size = (int(image.width * ratio), int(image.height * ratio))
                image = image.resize(new_size, Image.Resampling.LANCZOS)
            
            buffer = BytesIO()
            image.save(buffer, format='JPEG', quality=80)
            image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
            
            # 调用多模态 LLM
            async with aiohttp.ClientSession() as session:
                headers = {
                    "Authorization": f"Bearer {self.llm_config.get('api_key', '')}",
                    "Content-Type": "application/json"
                }
                
                payload = {
                    "model": self.llm_config.get('model', 'gpt-4o-mini'),
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "请简洁描述这张图片的内容（50字以内）。只输出描述，不要其他内容。"
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{image_base64}"
                                    }
                                }
                            ]
                        }
                    ],
                    "max_tokens": 100
                }
                
                async with session.post(
                    f"{self.llm_config.get('base_url', '')}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data['choices'][0]['message']['content'].strip()
            
        except Exception as e:
            logger.warning(f"生成图像描述失败: {e}")
        
        return f"图像: {filename}"
    
    async def _store_to_vector(self, metadata: ImageMetadata, image: Image.Image):
        """存储到向量库"""
        if not self.vector_storage or not self.vector_storage.is_available():
            return
        
        # 生成向量
        vector = await self._get_image_vector(image, metadata.description)
        
        if not vector:
            return
        
        # 构建 payload
        payload = {
            'content': metadata.description or f"图像: {metadata.original_name}",
            'user_id': metadata.user_id,
            'memory_type': 'image',
            'image_id': metadata.id,
            'image_type': metadata.image_type,
            'filename': metadata.filename,
            'width': metadata.width,
            'height': metadata.height,
            'tags': metadata.tags,
            'created_at': metadata.created_at.isoformat()
        }
        
        self.vector_storage.add_memory(metadata.id, vector, payload)
    
    async def _get_image_vector(
        self,
        image: Image.Image,
        description: Optional[str]
    ) -> Optional[List[float]]:
        """获取图像向量"""
        # 优先使用 CLIP
        if self.use_clip and self.clip_model:
            try:
                inputs = self.clip_processor(images=image, return_tensors="pt")
                
                if torch.cuda.is_available():
                    inputs = {k: v.to('cuda') for k, v in inputs.items()}
                
                with torch.no_grad():
                    features = self.clip_model.get_image_features(**inputs)
                
                return features[0].cpu().numpy().tolist()
            except Exception as e:
                logger.warning(f"CLIP 向量化失败: {e}")
        
        # 回退到文本描述向量化
        if self.embedder:
            try:
                # 使用描述或默认文本
                text = description or "图像内容"
                return self.embedder.encode([text])[0].tolist()
            except Exception as e:
                logger.warning(f"文本向量化失败: {e}")
        
        # 最终回退：返回零向量（仅用于存储，不用于搜索）
        logger.warning("无法生成向量，使用占位向量")
        if hasattr(self.vector_storage, 'vector_size'):
            return [0.0] * self.vector_storage.vector_size
        
        return None
    
    async def search(
        self,
        query: str,
        user_id: str = "feiniu_default",
        top_k: int = 5,
        image_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        搜索图像
        
        Args:
            query: 查询文本
            user_id: 用户 ID
            top_k: 返回数量
            image_type: 图像类型过滤
        
        Returns:
            搜索结果列表
        """
        if not self.vector_storage or not self.vector_storage.is_available():
            return []
        
        # 生成查询向量
        query_vector = None
        
        if self.use_clip and self.clip_model:
            try:
                inputs = self.clip_processor(text=[query], return_tensors="pt", padding=True)
                
                if torch.cuda.is_available():
                    inputs = {k: v.to('cuda') for k, v in inputs.items()}
                
                with torch.no_grad():
                    features = self.clip_model.get_text_features(**inputs)
                
                query_vector = features[0].cpu().numpy().tolist()
            except Exception as e:
                logger.warning(f"CLIP 文本向量化失败: {e}")
        
        if not query_vector and self.embedder:
            query_vector = self.embedder.encode([query])[0].tolist()
        
        if not query_vector:
            return []
        
        # 搜索
        results = self.vector_storage.search(
            query_vector=query_vector,
            top_k=top_k,
            user_id=user_id,
            memory_type='image'
        )
        
        # 过滤类型
        if image_type:
            results = [r for r in results if r.get('image_type') == image_type]
        
        # 添加图像 URL
        for result in results:
            image_id = result.get('image_id')
            if image_id in self.metadata_cache:
                meta = self.metadata_cache[image_id]
                result['thumbnail_path'] = str(self.storage_path / "thumbnails" / meta.filename)
                result['original_path'] = str(self.storage_path / "originals" / meta.filename)
        
        return results
    
    async def get_image(self, image_id: str) -> Optional[ImageMetadata]:
        """获取图像元数据"""
        return self.metadata_cache.get(image_id)
    
    async def get_image_data(self, image_id: str, thumbnail: bool = False) -> Optional[bytes]:
        """获取图像数据"""
        metadata = self.metadata_cache.get(image_id)
        if not metadata:
            return None
        
        try:
            if thumbnail:
                path = self.storage_path / "thumbnails" / metadata.filename
            else:
                path = self.storage_path / "originals" / metadata.filename
            
            with open(path, 'rb') as f:
                return f.read()
        except Exception as e:
            logger.error(f"读取图像失败: {e}")
            return None
    
    async def get_image_base64(self, image_id: str, thumbnail: bool = False) -> Optional[str]:
        """获取 Base64 编码的图像"""
        data = await self.get_image_data(image_id, thumbnail)
        if data:
            return base64.b64encode(data).decode('utf-8')
        return None
    
    async def delete_image(self, image_id: str) -> bool:
        """删除图像"""
        metadata = self.metadata_cache.get(image_id)
        if not metadata:
            return False
        
        try:
            # 删除文件
            original_path = self.storage_path / "originals" / metadata.filename
            thumbnail_path = self.storage_path / "thumbnails" / metadata.filename
            
            if original_path.exists():
                original_path.unlink()
            if thumbnail_path.exists():
                thumbnail_path.unlink()
            
            # 从向量库删除
            if self.vector_storage:
                self.vector_storage.delete_memory(image_id)
            
            # 从缓存删除
            del self.metadata_cache[image_id]
            
            logger.info(f"图像已删除: {image_id}")
            return True
            
        except Exception as e:
            logger.error(f"删除图像失败: {e}")
            return False
    
    async def list_images(
        self,
        user_id: str = "feiniu_default",
        image_type: Optional[str] = None,
        limit: int = 50
    ) -> List[ImageMetadata]:
        """列出图像"""
        images = [
            m for m in self.metadata_cache.values()
            if m.user_id == user_id
        ]
        
        if image_type:
            images = [m for m in images if m.image_type == image_type]
        
        # 按时间倒序
        images.sort(key=lambda x: x.created_at, reverse=True)
        
        return images[:limit]
    
    def get_stats(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """获取统计信息"""
        images = list(self.metadata_cache.values())
        
        if user_id:
            images = [m for m in images if m.user_id == user_id]
        
        total_size = sum(m.size_bytes for m in images)
        
        # 按类型统计
        by_type = {}
        for m in images:
            by_type[m.image_type] = by_type.get(m.image_type, 0) + 1
        
        return {
            'total_images': len(images),
            'total_size_bytes': total_size,
            'total_size_mb': round(total_size / 1024 / 1024, 2),
            'by_type': by_type,
            'use_clip': self.use_clip
        }
    
    async def load_metadata(self):
        """从存储目录加载元数据"""
        # 扫描 originals 目录
        originals_dir = self.storage_path / "originals"
        
        if not originals_dir.exists():
            return
        
        for file_path in originals_dir.iterdir():
            if file_path.is_file():
                image_id = file_path.stem
                
                if image_id in self.metadata_cache:
                    continue
                
                try:
                    if PIL_AVAILABLE:
                        from PIL import Image
                        with Image.open(file_path) as img:
                            info = self._get_image_info(img)
                        
                        stat = file_path.stat()
                        
                        metadata = ImageMetadata(
                            id=image_id,
                            filename=file_path.name,
                            original_name=file_path.name,
                            file_path=str(file_path),
                            image_type="other",
                            width=info['width'],
                            height=info['height'],
                            size_bytes=stat.st_size,
                            format=info['format'],
                            hash="",
                            description=None,
                            tags=[],
                            user_id="feiniu_default",
                            created_at=datetime.fromtimestamp(stat.st_ctime)
                        )
                        
                        self.metadata_cache[image_id] = metadata
                        
                except Exception as e:
                    logger.warning(f"加载图像元数据失败 {file_path}: {e}")
        
        logger.info(f"加载 {len(self.metadata_cache)} 个图像元数据")
