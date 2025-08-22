from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import torch
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import uvicorn
import time
import os
import sys
import re
import threading
import logging
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from pathlib import Path

# Fixed: 添加日志配置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/rag.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# 保存原始stdout和stderr
original_stdout = sys.stdout
original_stderr = sys.stderr

# 创建双重输出类
class TeeOutput:
    def __init__(self, file1, file2):
        self.file1 = file1
        self.file2 = file2
        self.ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

    def write(self, data):
        self.file1.write(data)
        clean_data = self.ansi_escape.sub('', data)
        self.file2.write(clean_data)
        self.file1.flush()
        self.file2.flush()

    def flush(self):
        self.file1.flush()
        self.file2.flush()

    def isatty(self):
        return self.file1.isatty()

    def fileno(self):
        return self.file1.fileno()

# 设置日志
LOGS_DIR = "logs"
if not os.path.exists(LOGS_DIR):
    os.makedirs(LOGS_DIR)

log_file = open(os.path.join(LOGS_DIR, 'rag.log'), 'w', encoding='utf-8')
sys.stdout = TeeOutput(original_stdout, log_file)
sys.stderr = TeeOutput(original_stderr, log_file)

# 全局变量
model = None
knowledge_base = []
knowledge_embeddings = None
reload_lock = threading.Lock()
model_loaded = False

class KnowledgeBaseHandler(FileSystemEventHandler):
    """监控记忆库文件变化"""

    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith("记忆库.txt"):
            time.sleep(0.5)  # 等待文件写入完成
            reload_knowledge_base()

def load_knowledge_base(file_path="./live-2d/记忆库.txt"):
    """加载知识库文件 - 使用连续横线分割段落"""
    try:
        if not os.path.exists(file_path):
            logger.warning(f"知识库文件不存在: {file_path}")
            return []

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        paragraphs = []

        # 使用正则表达式匹配10个以上连续的横线
        # 匹配10个或更多连续的横线（可能前后有空格）
        separator_pattern = r'\s*-{10,}\s*'

        # 按分隔符分割内容
        sections = re.split(separator_pattern, content)

        for section in sections:
            section = section.strip()
            # 过滤掉空内容和过短的内容
            if section and len(section) > 10:
                paragraphs.append(section)

        logger.info(f"知识库加载完成，共 {len(paragraphs)} 个段落")
        return paragraphs

    except Exception as e:
        logger.error(f"加载知识库失败: {e}")
        return []

def reload_knowledge_base():
    """重新加载知识库"""
    global knowledge_base, knowledge_embeddings

    with reload_lock:
        logger.info("检测到文件变化，重新加载知识库...")
        new_knowledge_base = load_knowledge_base()

        if new_knowledge_base and model is not None:
            try:
                knowledge_base = new_knowledge_base
                knowledge_embeddings = model.encode(knowledge_base)
                logger.info("知识库更新完成！")
            except Exception as e:
                logger.error(f"更新知识库嵌入时出错: {e}")

def load_model():
    """加载模型"""
    global model, model_loaded
    
    try:
        model_path = "./RAG-model"
        if not os.path.exists(model_path):
            logger.error(f"模型路径不存在: {model_path}")
            return False
            
        logger.info("正在加载模型...")
        model = SentenceTransformer(model_path)
        
        # Fixed: 改进GPU设备检测
        if torch.cuda.is_available():
            try:
                model = model.to('cuda')
                logger.info("模型加载完成，使用GPU")
            except Exception as e:
                logger.warning(f"GPU加载失败，使用CPU: {e}")
                model = model.to('cpu')
        else:
            model = model.to('cpu')
            logger.info("模型加载完成，使用CPU")
            
        model_loaded = True
        return True
        
    except Exception as e:
        logger.error(f"模型加载失败: {e}")
        model_loaded = False
        return False

# 创建FastAPI应用
app = FastAPI(title="BGE API", version="1.0.0")

@app.on_event("startup")
async def startup_event():
    global model, knowledge_base, knowledge_embeddings, model_loaded

    logger.info("启动BGE API服务...")
    
    # 加载模型
    if not load_model():
        logger.error("模型加载失败，服务启动失败")
        return

    # 加载知识库
    knowledge_base = load_knowledge_base()
    if knowledge_base:
        try:
            logger.info("生成知识库嵌入...")
            knowledge_embeddings = model.encode(knowledge_base)
            logger.info("知识库嵌入完成")
        except Exception as e:
            logger.error(f"生成知识库嵌入失败: {e}")
            knowledge_embeddings = None

    # 启动文件监控
    try:
        event_handler = KnowledgeBaseHandler()
        observer = Observer()
        observer.schedule(event_handler, "./live-2d", recursive=False)
        observer.start()
        logger.info("文件监控启动完成")
    except Exception as e:
        logger.error(f"文件监控启动失败: {e}")

    logger.info("API服务启动完成！")

# 请求模型
class TextRequest(BaseModel):
    text: str

class QuestionRequest(BaseModel):
    question: str
    top_k: int = Field(default=3, ge=1, le=10)

class SimilarityRequest(BaseModel):
    text1: str
    text2: str

# 响应模型
class EmbeddingResponse(BaseModel):
    embedding: List[float]
    dimension: int
    processing_time: float

class AnswerResponse(BaseModel):
    question: str
    relevant_passages: List[Dict[str, Any]]
    processing_time: float

class SimilarityResponse(BaseModel):
    similarity: float
    processing_time: float

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    knowledge_base_loaded: bool
    knowledge_base_size: int
    gpu_available: bool

@app.get("/")
async def root():
    return {
        "message": "BGE API服务运行中",
        "model_loaded": model_loaded,
        "knowledge_base_size": len(knowledge_base),
        "gpu_available": torch.cuda.is_available()
    }

@app.post("/encode", response_model=EmbeddingResponse)
async def encode_text(request: TextRequest):
    if not model_loaded or model is None:
        raise HTTPException(status_code=500, detail="模型未加载")
    
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="输入文本不能为空")

    try:
        start_time = time.time()
        embedding = model.encode([request.text])[0]
        processing_time = time.time() - start_time

        return EmbeddingResponse(
            embedding=embedding.tolist(),
            dimension=len(embedding),
            processing_time=processing_time
        )
    except Exception as e:
        logger.error(f"编码文本时出错: {e}")
        raise HTTPException(status_code=500, detail=f"编码失败: {str(e)}")

@app.post("/similarity", response_model=SimilarityResponse)
async def calculate_similarity(request: SimilarityRequest):
    if not model_loaded or model is None:
        raise HTTPException(status_code=500, detail="模型未加载")
    
    if not request.text1.strip() or not request.text2.strip():
        raise HTTPException(status_code=400, detail="输入文本不能为空")

    try:
        start_time = time.time()
        embeddings = model.encode([request.text1, request.text2])
        similarity = cosine_similarity([embeddings[0]], [embeddings[1]])[0][0]
        processing_time = time.time() - start_time

        return SimilarityResponse(
            similarity=float(similarity),
            processing_time=processing_time
        )
    except Exception as e:
        logger.error(f"计算相似度时出错: {e}")
        raise HTTPException(status_code=500, detail=f"计算失败: {str(e)}")

@app.post("/ask", response_model=AnswerResponse)
async def ask_question(request: QuestionRequest):
    if not model_loaded or model is None:
        raise HTTPException(status_code=500, detail="模型未加载")

    if not knowledge_base:
        raise HTTPException(status_code=404, detail="知识库未加载")
    
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    try:
        with reload_lock:  # 确保查询时数据不会被更新
            start_time = time.time()

            question_embedding = model.encode([request.question])
            similarities = cosine_similarity(question_embedding, knowledge_embeddings)[0]
            top_indices = np.argsort(similarities)[::-1][:request.top_k]

            relevant_passages = []
            for i, idx in enumerate(top_indices):
                relevant_passages.append({
                    "rank": i + 1,
                    "similarity": float(similarities[idx]),
                    "content": knowledge_base[idx]
                })

            processing_time = time.time() - start_time

            return AnswerResponse(
                question=request.question,
                relevant_passages=relevant_passages,
                processing_time=processing_time
            )
    except Exception as e:
        logger.error(f"查询问题时出错: {e}")
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")

@app.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="healthy" if model_loaded else "unhealthy",
        model_loaded=model_loaded,
        knowledge_base_loaded=len(knowledge_base) > 0,
        knowledge_base_size=len(knowledge_base),
        gpu_available=torch.cuda.is_available()
    )

@app.get("/reload")
async def reload_knowledge_base_endpoint():
    """手动重新加载知识库"""
    try:
        reload_knowledge_base()
        return {"message": "知识库重新加载成功"}
    except Exception as e:
        logger.error(f"手动重新加载知识库失败: {e}")
        raise HTTPException(status_code=500, detail=f"重新加载失败: {str(e)}")

if __name__ == "__main__":
    try:
        uvicorn.run(app, host="0.0.0.0", port=8002)
    except Exception as e:
        logger.error(f"启动服务失败: {e}")
        sys.exit(1)
