from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any
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
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

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


class KnowledgeBaseHandler(FileSystemEventHandler):
    """监控记忆库文件变化"""

    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith("记忆库.txt"):
            time.sleep(0.5)  # 等待文件写入完成
            reload_knowledge_base()


def load_knowledge_base(file_path="../live-2d/AI记录室/记忆库.txt"):
    """加载知识库文件 - 使用连续横线分割段落"""
    try:
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

        print(f"知识库加载完成，共 {len(paragraphs)} 个段落")
        return paragraphs

    except Exception as e:
        print(f"加载知识库失败: {e}")
        return []


def reload_knowledge_base():
    """重新加载知识库"""
    global knowledge_base, knowledge_embeddings

    with reload_lock:
        print("检测到文件变化，重新加载知识库...")
        new_knowledge_base = load_knowledge_base()

        if new_knowledge_base and model is not None:
            knowledge_base = new_knowledge_base
            knowledge_embeddings = model.encode(knowledge_base)
            print("知识库更新完成！")


# 创建FastAPI应用
app = FastAPI(title="BGE API", version="1.0.0")


@app.on_event("startup")
async def startup_event():
    global model, knowledge_base, knowledge_embeddings

    print("启动BGE API服务...")
    print("加载模型...")

    # 加载模型
    model = SentenceTransformer("./rag-hub")
    model = model.to('cuda')
    print("模型加载完成，使用GPU")

    # 加载知识库
    knowledge_base = load_knowledge_base()
    if knowledge_base:
        print("生成知识库嵌入...")
        knowledge_embeddings = model.encode(knowledge_base)
        print("知识库嵌入完成")

    # 启动文件监控
    event_handler = KnowledgeBaseHandler()
    observer = Observer()
    observer.schedule(event_handler, "../live-2d/AI记录室", recursive=False)
    observer.start()
    print("文件监控启动完成")

    print("API服务启动完成！")


# 请求模型
class TextRequest(BaseModel):
    text: str


class QuestionRequest(BaseModel):
    question: str
    top_k: int = 3


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


@app.get("/")
async def root():
    return {
        "message": "BGE API服务运行中",
        "model_loaded": model is not None,
        "knowledge_base_size": len(knowledge_base)
    }


@app.post("/encode", response_model=EmbeddingResponse)
async def encode_text(request: TextRequest):
    if model is None:
        raise HTTPException(status_code=500, detail="模型未加载")

    start_time = time.time()
    embedding = model.encode([request.text])[0]
    processing_time = time.time() - start_time

    return EmbeddingResponse(
        embedding=embedding.tolist(),
        dimension=len(embedding),
        processing_time=processing_time
    )


@app.post("/similarity", response_model=SimilarityResponse)
async def calculate_similarity(request: SimilarityRequest):
    if model is None:
        raise HTTPException(status_code=500, detail="模型未加载")

    start_time = time.time()
    embeddings = model.encode([request.text1, request.text2])
    similarity = cosine_similarity([embeddings[0]], [embeddings[1]])[0][0]
    processing_time = time.time() - start_time

    return SimilarityResponse(
        similarity=float(similarity),
        processing_time=processing_time
    )


@app.post("/ask", response_model=AnswerResponse)
async def ask_question(request: QuestionRequest):
    if model is None:
        raise HTTPException(status_code=500, detail="模型未加载")

    if not knowledge_base:
        raise HTTPException(status_code=404, detail="知识库未加载")

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


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "knowledge_base_loaded": len(knowledge_base) > 0
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)