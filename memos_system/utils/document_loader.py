# document_loader.py - 文档加载器
"""
支持从各种来源加载文档内容
- 文本文件
- PDF
- URL/网页
- Markdown
"""

import os
import re
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

# 尝试导入可选依赖
try:
    from pypdf import PdfReader
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

try:
    from bs4 import BeautifulSoup
    BS4_AVAILABLE = True
except ImportError:
    BS4_AVAILABLE = False

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


class DocumentChunk:
    """文档块"""
    
    def __init__(
        self,
        content: str,
        source: str,
        chunk_index: int = 0,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.content = content
        self.source = source
        self.chunk_index = chunk_index
        self.metadata = metadata or {}
        self.created_at = datetime.now()
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'content': self.content,
            'source': self.source,
            'chunk_index': self.chunk_index,
            'metadata': self.metadata,
            'created_at': self.created_at.isoformat()
        }


class TextSplitter:
    """文本分割器"""
    
    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        separators: Optional[List[str]] = None
    ):
        """
        初始化分割器
        
        Args:
            chunk_size: 块大小（字符数）
            chunk_overlap: 块重叠（字符数）
            separators: 分隔符列表
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separators = separators or ['\n\n', '\n', '。', '.', ' ']
    
    def split(self, text: str) -> List[str]:
        """
        分割文本
        
        Args:
            text: 原始文本
        
        Returns:
            文本块列表
        """
        if len(text) <= self.chunk_size:
            return [text]
        
        chunks = []
        current_chunk = ""
        
        # 先按段落分割
        paragraphs = text.split('\n\n')
        
        for para in paragraphs:
            if len(current_chunk) + len(para) <= self.chunk_size:
                current_chunk += para + '\n\n'
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                
                # 如果段落本身太长，进一步分割
                if len(para) > self.chunk_size:
                    sub_chunks = self._split_long_text(para)
                    chunks.extend(sub_chunks)
                    current_chunk = ""
                else:
                    current_chunk = para + '\n\n'
        
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
        
        # 添加重叠
        if self.chunk_overlap > 0 and len(chunks) > 1:
            overlapped_chunks = []
            for i, chunk in enumerate(chunks):
                if i > 0:
                    # 从前一个块末尾取一些内容作为上下文
                    prev_end = chunks[i-1][-self.chunk_overlap:]
                    chunk = prev_end + ' ' + chunk
                overlapped_chunks.append(chunk)
            return overlapped_chunks
        
        return chunks
    
    def _split_long_text(self, text: str) -> List[str]:
        """分割长文本"""
        chunks = []
        
        for separator in self.separators:
            if separator in text:
                parts = text.split(separator)
                current = ""
                
                for part in parts:
                    if len(current) + len(part) <= self.chunk_size:
                        current += part + separator
                    else:
                        if current:
                            chunks.append(current.strip())
                        current = part + separator
                
                if current.strip():
                    chunks.append(current.strip())
                
                if chunks:
                    return chunks
        
        # 如果所有分隔符都不行，强制按长度切分
        for i in range(0, len(text), self.chunk_size):
            chunks.append(text[i:i + self.chunk_size])
        
        return chunks


class DocumentLoader:
    """文档加载器"""
    
    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50
    ):
        self.splitter = TextSplitter(chunk_size, chunk_overlap)
    
    def load_text_file(self, file_path: str) -> List[DocumentChunk]:
        """加载文本文件"""
        if not os.path.exists(file_path):
            logger.error(f"文件不存在: {file_path}")
            return []
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            chunks = self.splitter.split(content)
            
            return [
                DocumentChunk(
                    content=chunk,
                    source=file_path,
                    chunk_index=i,
                    metadata={'type': 'text_file', 'filename': os.path.basename(file_path)}
                )
                for i, chunk in enumerate(chunks)
            ]
        except Exception as e:
            logger.error(f"加载文本文件失败: {e}")
            return []
    
    def load_pdf(self, file_path: str) -> List[DocumentChunk]:
        """加载 PDF 文件"""
        if not PDF_AVAILABLE:
            logger.warning("pypdf 未安装，无法加载 PDF")
            return []
        
        if not os.path.exists(file_path):
            logger.error(f"文件不存在: {file_path}")
            return []
        
        try:
            reader = PdfReader(file_path)
            all_text = ""
            
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    all_text += text + "\n\n"
            
            chunks = self.splitter.split(all_text)
            
            return [
                DocumentChunk(
                    content=chunk,
                    source=file_path,
                    chunk_index=i,
                    metadata={
                        'type': 'pdf',
                        'filename': os.path.basename(file_path),
                        'total_pages': len(reader.pages)
                    }
                )
                for i, chunk in enumerate(chunks)
            ]
        except Exception as e:
            logger.error(f"加载 PDF 失败: {e}")
            return []
    
    def load_url(self, url: str) -> List[DocumentChunk]:
        """加载网页内容"""
        if not REQUESTS_AVAILABLE or not BS4_AVAILABLE:
            logger.warning("requests 或 beautifulsoup4 未安装，无法加载网页")
            return []
        
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # 移除脚本和样式
            for script in soup(['script', 'style', 'nav', 'footer', 'header']):
                script.decompose()
            
            # 获取标题
            title = soup.find('title')
            title_text = title.get_text() if title else url
            
            # 获取主要内容
            # 尝试找到主要内容区域
            main_content = soup.find('main') or soup.find('article') or soup.find('body')
            
            if main_content:
                # 获取所有段落
                paragraphs = main_content.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'li'])
                text_parts = []
                
                for p in paragraphs:
                    text = p.get_text().strip()
                    if text and len(text) > 20:  # 过滤太短的内容
                        text_parts.append(text)
                
                content = '\n\n'.join(text_parts)
            else:
                content = soup.get_text()
            
            # 清理文本
            content = re.sub(r'\s+', ' ', content)
            content = re.sub(r'\n\s*\n', '\n\n', content)
            
            chunks = self.splitter.split(content)
            
            return [
                DocumentChunk(
                    content=chunk,
                    source=url,
                    chunk_index=i,
                    metadata={'type': 'url', 'title': title_text, 'url': url}
                )
                for i, chunk in enumerate(chunks)
            ]
        except Exception as e:
            logger.error(f"加载网页失败: {e}")
            return []
    
    def load_markdown(self, file_path: str) -> List[DocumentChunk]:
        """加载 Markdown 文件"""
        if not os.path.exists(file_path):
            logger.error(f"文件不存在: {file_path}")
            return []
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # 简单处理 Markdown：移除代码块、图片等
            # 保留标题作为上下文
            content = re.sub(r'```[\s\S]*?```', '', content)  # 移除代码块
            content = re.sub(r'!\[.*?\]\(.*?\)', '', content)  # 移除图片
            content = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', content)  # 简化链接
            
            chunks = self.splitter.split(content)
            
            return [
                DocumentChunk(
                    content=chunk,
                    source=file_path,
                    chunk_index=i,
                    metadata={'type': 'markdown', 'filename': os.path.basename(file_path)}
                )
                for i, chunk in enumerate(chunks)
            ]
        except Exception as e:
            logger.error(f"加载 Markdown 失败: {e}")
            return []
    
    def load(self, source: str) -> List[DocumentChunk]:
        """
        自动检测并加载文档
        
        Args:
            source: 文件路径或 URL
        
        Returns:
            文档块列表
        """
        # URL
        if source.startswith('http://') or source.startswith('https://'):
            return self.load_url(source)
        
        # 文件
        if os.path.exists(source):
            ext = os.path.splitext(source)[1].lower()
            
            if ext == '.pdf':
                return self.load_pdf(source)
            elif ext in ['.md', '.markdown']:
                return self.load_markdown(source)
            else:
                return self.load_text_file(source)
        
        logger.error(f"无法加载: {source}")
        return []


class KnowledgeBaseImporter:
    """知识库导入器"""
    
    def __init__(
        self,
        mos,
        entity_extractor=None
    ):
        """
        初始化导入器
        
        Args:
            mos: MOS 实例
            entity_extractor: 实体提取器
        """
        self.mos = mos
        self.entity_extractor = entity_extractor
        self.loader = DocumentLoader()
    
    async def import_document(
        self,
        source: str,
        user_id: str,
        tags: Optional[List[str]] = None,
        extract_entities: bool = False
    ) -> Dict[str, Any]:
        """
        导入文档到知识库
        
        Args:
            source: 文件路径或 URL
            user_id: 用户 ID
            tags: 标签
            extract_entities: 是否提取实体
        
        Returns:
            导入结果
        """
        tags = tags or []
        
        # 加载文档
        chunks = self.loader.load(source)
        
        if not chunks:
            return {
                'success': False,
                'message': f'无法加载文档: {source}',
                'chunks_count': 0
            }
        
        # 导入每个块
        imported_count = 0
        memory_ids = []
        entity_ids = []
        
        for chunk in chunks:
            # 添加记忆
            result = await self.mos.add(
                content=chunk.content,
                user_id=user_id,
                memory_type='document',
                importance=0.6,
                tags=tags + [chunk.metadata.get('type', 'document')],
                extract_entities=extract_entities
            )
            
            if result.get('success'):
                imported_count += 1
                memory_ids.append(result.get('memory_id'))
                entity_ids.extend(result.get('entity_ids', []))
        
        return {
            'success': True,
            'source': source,
            'chunks_count': len(chunks),
            'imported_count': imported_count,
            'memory_ids': memory_ids,
            'entity_ids': list(set(entity_ids))
        }
    
    async def import_batch(
        self,
        sources: List[str],
        user_id: str,
        tags: Optional[List[str]] = None,
        extract_entities: bool = False
    ) -> Dict[str, Any]:
        """
        批量导入文档
        
        Args:
            sources: 文件路径或 URL 列表
            user_id: 用户 ID
            tags: 标签
            extract_entities: 是否提取实体
        
        Returns:
            导入结果
        """
        results = []
        total_imported = 0
        total_failed = 0
        
        for source in sources:
            result = await self.import_document(
                source, user_id, tags, extract_entities
            )
            results.append(result)
            
            if result.get('success'):
                total_imported += result.get('imported_count', 0)
            else:
                total_failed += 1
        
        return {
            'total_sources': len(sources),
            'total_imported': total_imported,
            'total_failed': total_failed,
            'details': results
        }
