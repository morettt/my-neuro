# memos_api_server_full.py - MemOS 完整框架版本（MemCube 模式）
import sys
sys.stdout.reconfigure(encoding='utf-8')

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
import uvicorn
import os
import re
from datetime import datetime

# 导入 MemCube
from memos.mem_cube.general import GeneralMemCube
from memos.memories.general_text_memory import GeneralTextMemory
from memos.embedders.sentence_transformer import SenTranEmbedder, SenTranEmbedderConfig
from memos.llms.openai import OpenAILLM, OpenAILLMConfig
from memos.vec_dbs.qdrant import QdrantVecDB, QdrantVecDBConfig

app = FastAPI(title="MemOS API (MemCube版) for 肥牛AI", version="2.0.0")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局变量
memcube = None
llm_processor = None
USER_ID = "feiniu_default"


# 请求模型
class AddMemoryRequest(BaseModel):
    messages: List[Dict[str, str]]
    user_id: Optional[str] = USER_ID


class SearchMemoryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 3
    user_id: Optional[str] = USER_ID


class MigrateRequest(BaseModel):
    file_path: str


# 初始化
@app.on_event("startup")
async def startup_event():
    global memcube, llm_processor
    
    print("="*60)
    print("  启动 MemOS 服务（MemCube 完整框架）")
    print("="*60)
    
    try:
        # 1. 创建 Embedder
        print("\n📦 加载 Embedding 模型...")
        rag_model_path = os.path.join(os.path.dirname(__file__), "..", "..", "full-hub", "rag-hub")
        embedder_config = SenTranEmbedderConfig(
            model_name_or_path=rag_model_path
        )
        embedder = SenTranEmbedder(embedder_config)
        print(f"✅ Embedder 创建成功: {rag_model_path}")
        
        # 2. 创建 LLM（用于记忆加工）
        print("\n🤖 配置记忆加工 LLM...")
        llm_config = OpenAILLMConfig(
            model_name_or_path="zai-org/GLM-4.6",
            api_key="sk-iosvzdshjjrzzldouqqnxefokpfncjfkwizvkwzxdjdmxvvm",
            api_base="https://api.siliconflow.cn/v1",
            temperature=0.2,
            max_tokens=2000  # 保留更多细节
        )
        llm_processor = OpenAILLM(llm_config)
        print("✅ LLM 创建成功: zai-org/GLM-4.6")
        
        # 3. 创建向量数据库
        print("\n💾 配置向量数据库...")
        data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
        os.makedirs(data_dir, exist_ok=True)
        
        vec_db_config = QdrantVecDBConfig(
            location=os.path.join(data_dir, "qdrant"),
            collection_name="feiniu_memory"
        )
        vec_db = QdrantVecDB(vec_db_config)
        print(f"✅ 向量数据库配置完成: {data_dir}/qdrant")
        
        # 4. 创建文本记忆
        print("\n🧠 创建文本记忆模块...")
        text_memory = GeneralTextMemory(
            embedder=embedder,
            vec_db=vec_db
        )
        print("✅ 文本记忆模块创建成功")
        
        # 5. 创建 MemCube
        print("\n📦 创建 MemCube...")
        memcube = GeneralMemCube(
            text_mem=text_memory
        )
        print("✅ MemCube 创建成功")
        
        # 6. 尝试加载已有记忆
        memcube_save_path = os.path.join(data_dir, "memcube")
        if os.path.exists(memcube_save_path):
            try:
                memcube = GeneralMemCube.init_from_dir(memcube_save_path)
                all_mems = memcube.text_mem.get_all()
                print(f"✅ 加载了 {len(all_mems)} 条历史记忆")
            except Exception as e:
                print(f"ℹ️  无法加载历史记忆，使用新 MemCube: {e}")
        
        print("\n" + "="*60)
        print("  ✅ MemOS 服务启动成功！")
        print("="*60)
        print(f"  📍 数据存储: {data_dir}")
        print(f"  🧠 Embedding: ./full-hub/rag-hub")
        print(f"  🤖 记忆加工: zai-org/GLM-4.6 (max_tokens=2000)")
        print(f"  🔧 完整 MemCube 框架已启用")
        print("="*60)
        
    except Exception as e:
        print(f"\n❌ 初始化失败: {e}")
        import traceback
        traceback.print_exc()
        raise


@app.get("/")
async def root():
    return {
        "service": "MemOS API (MemCube版) for 肥牛AI",
        "version": "2.0.0",
        "framework": "memcube",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "memcube_initialized": memcube is not None,
        "llm_initialized": llm_processor is not None,
        "framework": "memcube"
    }


async def process_memory_with_llm(content: str) -> str:
    """使用 LLM 加工记忆（提取关键信息并结构化）"""
    if not llm_processor:
        return content
    
    try:
        prompt = f"""从以下对话中提取关键事实，保留细节，生成结构化记忆。

规则：
1. 提取用户的偏好、习惯、个人信息、重要事件
2. 保留时间、地点、情感等细节
3. 多个要点用分号分隔
4. 每个要点15-30字，总长度不超过150字
5. 去除无关对话（如"嗯"、"好的"等）

对话内容：
{content}

提取的结构化记忆："""
        
        response = llm_processor.chat([{"role": "user", "content": prompt}])
        processed = response.strip()
        print(f"🔧 记忆加工: {content[:30]}... → {processed[:50]}...")
        return processed
    except Exception as e:
        print(f"⚠️ LLM 加工失败: {e}，使用原内容")
        return content


@app.post("/add")
async def add_memory(request: AddMemoryRequest):
    """添加新记忆（MemCube + LLM 加工）"""
    if not memcube:
        raise HTTPException(status_code=500, detail="MemCube 未初始化")
    
    try:
        added_count = 0
        for msg in request.messages:
            content = msg.get('content', '')
            if content and len(content) > 10:
                # 使用 LLM 加工记忆
                processed = await process_memory_with_llm(content)
                
                # 添加到 MemCube
                memcube.text_mem.add(processed)
                added_count += 1
        
        # 保存 MemCube
        save_path = os.path.join(os.path.dirname(__file__), "..", "data", "memcube")
        memcube.dump(save_path)
        
        print(f"✅ 已添加并加工 {added_count} 条记忆")
        return {"status": "success", "message": f"记忆已添加（{added_count} 条）"}
    except Exception as e:
        print(f"❌ 添加失败: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"添加记忆失败: {str(e)}")


@app.post("/search")
async def search_memory(request: SearchMemoryRequest):
    """搜索相关记忆（MemCube 语义检索）"""
    if not memcube:
        raise HTTPException(status_code=500, detail="MemCube 未初始化")
    
    try:
        # 使用 MemCube 搜索
        results = memcube.text_mem.search(
            query=request.query,
            top_k=request.top_k or 3
        )
        
        # 格式化返回
        formatted_memories = []
        for item in results:
            formatted_memories.append({
                "content": item if isinstance(item, str) else str(item)
            })
        
        print(f"🔍 搜索: \"{request.query}\" → {len(formatted_memories)} 条")
        
        return {
            "query": request.query,
            "memories": formatted_memories,
            "count": len(formatted_memories)
        }
    except Exception as e:
        print(f"❌ 搜索失败: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"搜索失败: {str(e)}")


@app.get("/list")
async def list_memories(user_id: Optional[str] = USER_ID, limit: int = 100):
    """列出所有记忆"""
    if not memcube:
        raise HTTPException(status_code=500, detail="MemCube 未初始化")
    
    try:
        all_memories = memcube.text_mem.get_all()
        limited = all_memories[-limit:] if len(all_memories) > limit else all_memories
        
        formatted = [
            {"id": f"mem_{i}", "content": mem if isinstance(mem, str) else str(mem)}
            for i, mem in enumerate(reversed(limited))
        ]
        
        return {
            "user_id": user_id,
            "count": len(formatted),
            "memories": formatted
        }
    except Exception as e:
        print(f"❌ 列出失败: {e}")
        raise HTTPException(status_code=500, detail=f"列出记忆失败: {str(e)}")


@app.delete("/delete/{memory_id}")
async def delete_memory(memory_id: str):
    """删除记忆（待实现）"""
    return {"status": "pending", "message": "删除功能待实现"}


@app.post("/migrate")
async def migrate_from_txt(request: MigrateRequest):
    """从旧记忆库导入（MemCube + LLM 加工）"""
    if not memcube:
        raise HTTPException(status_code=500, detail="MemCube 未初始化")
    
    try:
        file_path = request.file_path
        
        # 处理路径
        if not os.path.isabs(file_path):
            project_root = os.path.join(os.path.dirname(__file__), "..", "..")
            file_path = os.path.join(project_root, file_path)
        
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"文件不存在: {file_path}")
        
        print(f"\n📂 开始导入: {file_path}")
        
        # 读取文件
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 按分隔线分割
        separator_pattern = r'\s*-{10,}\s*'
        sections = re.split(separator_pattern, content)
        
        imported_count = 0
        for section in sections:
            section = section.strip()
            if section and len(section) > 10:
                # 使用 LLM 加工
                processed = await process_memory_with_llm(section)
                
                # 添加到 MemCube
                memcube.text_mem.add(processed)
                imported_count += 1
                
                if imported_count % 10 == 0:
                    print(f"  已导入并加工 {imported_count} 条...")
        
        # 保存 MemCube
        save_path = os.path.join(os.path.dirname(__file__), "..", "data", "memcube")
        memcube.dump(save_path)
        print(f"💾 MemCube 已保存到: {save_path}")
        
        print(f"✅ 导入完成！共 {imported_count} 条记忆")
        
        return {
            "status": "success",
            "imported_count": imported_count,
            "message": f"成功导入并加工 {imported_count} 条记忆"
        }
    except Exception as e:
        print(f"❌ 导入失败: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


@app.get("/stats")
async def get_statistics():
    """获取记忆统计"""
    if not memcube:
        raise HTTPException(status_code=500, detail="MemCube 未初始化")
    
    try:
        all_memories = memcube.text_mem.get_all()
        
        return {
            "total_count": len(all_memories),
            "today_count": 0,
            "week_count": 0,
            "avg_importance": 0.8,
            "framework": "memcube"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"统计失败: {str(e)}")


if __name__ == "__main__":
    print("\n" + "="*60)
    print("  MemOS 完整框架服务 (MemCube)")
    print("="*60)
    print("  端口: 8003")
    print("  文档: http://127.0.0.1:8003/docs")
    print("  框架: MemCube + LLM 记忆加工")
    print("="*60 + "\n")
    
    uvicorn.run(app, host="0.0.0.0", port=8003)
