# memos_api_server.py - MemOS FastAPI 服务（简化版）
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import uvicorn
import json
import os
import re
import asyncio
from datetime import datetime
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity


class EmbeddingModel:
    """统一的 Embedding 接口，支持本地 SentenceTransformer 和 OpenAI 兼容 API 两种模式"""

    def __init__(self, emb_type: str, local_model=None,
                 api_key: str = None, api_base_url: str = None,
                 api_model: str = None, dimensions: int = None):
        self.emb_type = emb_type
        self._local = local_model
        self._api_key = api_key
        self._api_base_url = (api_base_url or '').rstrip('/')
        self._api_model = api_model
        self._dimensions = dimensions

    def encode(self, texts: list) -> np.ndarray:
        """与 SentenceTransformer.encode() 兼容的接口，始终返回 np.ndarray"""
        if self.emb_type == 'local':
            return self._local.encode(texts)
        return self._encode_api(texts)

    def _encode_api(self, texts: list) -> np.ndarray:
        import requests
        payload = {"model": self._api_model, "input": texts}
        if self._dimensions:
            payload["dimensions"] = self._dimensions
        resp = requests.post(
            f"{self._api_base_url}/embeddings",
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=30
        )
        resp.raise_for_status()
        data = resp.json()
        vectors = [item["embedding"] for item in sorted(data["data"], key=lambda x: x["index"])]
        return np.array(vectors, dtype=np.float32)

    def to(self, device):
        """兼容 .to('cuda') 调用（API 模式下为空操作）"""
        if self.emb_type == 'local' and self._local is not None:
            self._local = self._local.to(device)
        return self

app = FastAPI(title="MemOS API for 肥牛AI", version="1.0.0")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局变量
embedding_model = None
memory_store = []  # 简单的内存存储
USER_ID = "feiniu_default"
llm_config = None  # LLM 配置（用于记忆加工）
full_config = None  # 完整配置（包含备用模型等）


# 请求模型
class AddMemoryRequest(BaseModel):
    messages: List[Dict[str, str]]
    user_id: Optional[str] = USER_ID


# 🔥 直接存储的消息格式（支持浮点数 importance）
class RawMemoryMessage(BaseModel):
    content: str
    role: Optional[str] = "user"
    importance: Optional[float] = 0.8


class AddRawMemoryRequest(BaseModel):
    messages: List[RawMemoryMessage]
    user_id: Optional[str] = USER_ID


class SearchMemoryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 3
    user_id: Optional[str] = USER_ID
    similarity_threshold: Optional[float] = 0.5  # 🔥 相似度阈值，低于此值的记忆不返回


class MigrateRequest(BaseModel):
    file_path: str


# 初始化
@app.on_event("startup")
async def startup_event():
    global embedding_model, memory_store, llm_config, full_config
    
    print("🚀 启动 MemOS 服务（简化版）...")
    
    try:
        # 加载 LLM 配置（用于记忆加工）
        config_path = os.path.join(os.path.dirname(__file__), "..", "config", "memos_config.json")
        print(f"📂 配置文件路径: {config_path}")
        
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                full_config = config  # 保存完整配置（含备用模型）
                llm_config = config.get('llm', {}).get('config', {})
                
                # 验证配置完整性
                if llm_config and all(llm_config.get(k) for k in ['model', 'api_key', 'base_url']):
                    print(f"✅ 加载 LLM 配置成功:")
                    print(f"   - model: {llm_config.get('model')}")
                    print(f"   - base_url: {llm_config.get('base_url')}")
                    print(f"   - api_key: {llm_config.get('api_key')[:10]}...")
                else:
                    print("⚠️ LLM 配置不完整！记忆加工功能将不可用")
                    print(f"   当前配置: {llm_config}")
        else:
            print(f"⚠️ 配置文件不存在: {config_path}")
            print("   记忆加工功能将不可用")
        
        # 加载 Embedding 模型
        data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
        os.makedirs(data_dir, exist_ok=True)
        memory_file = os.path.join(data_dir, "memory_store.json")
        marker_file = os.path.join(data_dir, "embedding_marker.json")

        emb_cfg = (full_config or {}).get('embedding', {})
        use_api = emb_cfg.get('use_api', False)

        if use_api:
            api_model = emb_cfg.get('api_model', 'text-embedding-3-large')
            dimensions = emb_cfg.get('api_dimensions', 1024)
            api_key = llm_config.get('api_key', '') if llm_config else ''
            api_base_url = llm_config.get('base_url', '') if llm_config else ''
            print(f"📦 使用 API Embedding 模型: {api_model} (维度: {dimensions})")
            new_marker = f"api:{api_model}:{dimensions}"
            embedding_model = EmbeddingModel(
                'api', api_key=api_key, api_base_url=api_base_url,
                api_model=api_model, dimensions=dimensions
            )
        else:
            rag_model_path = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'full-hub', 'rag-hub'))
            print(f"📦 加载本地 Embedding 模型: {rag_model_path}")
            try:
                from sentence_transformers import SentenceTransformer
                import torch
                local_model = SentenceTransformer(rag_model_path)
                if torch.cuda.is_available():
                    local_model = local_model.to('cuda')
                    print("✅ 使用 GPU 加速")
                else:
                    print("ℹ️ 使用 CPU")
            except ImportError as ie:
                raise RuntimeError(f"本地模式需要安装 sentence-transformers 和 torch: {ie}")
            new_marker = f"local:{rag_model_path}"
            embedding_model = EmbeddingModel('local', local_model=local_model)

        # 检测 Embedding 模型是否更换，若更换则清空旧记忆（向量空间不兼容）
        old_marker = None
        if os.path.exists(marker_file):
            try:
                with open(marker_file, 'r', encoding='utf-8') as f:
                    old_marker = json.load(f).get('marker')
            except Exception:
                pass
        if old_marker and old_marker != new_marker:
            print(f"⚠️ Embedding 模型已更换 ({old_marker} → {new_marker})")
            print("🗑️ 清空旧记忆（向量空间不兼容，将重新积累）...")
            if os.path.exists(memory_file):
                import shutil
                backup = memory_file + f".model_change_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                shutil.copy(memory_file, backup)
                print(f"📦 已备份旧记忆到: {backup}")
                os.remove(memory_file)
        with open(marker_file, 'w', encoding='utf-8') as f:
            json.dump({'marker': new_marker, 'updated_at': datetime.now().isoformat()}, f)

        # 加载已存在的记忆（如果有）
        
        if os.path.exists(memory_file):
            try:
                with open(memory_file, 'r', encoding='utf-8') as f:
                    memory_store = json.load(f)
                print(f"✅ 加载了 {len(memory_store)} 条历史记忆")
            except json.JSONDecodeError as e:
                print(f"⚠️ 记忆文件损坏: {e}")
                print("🔧 尝试修复...")
                
                # 尝试修复损坏的 JSON
                try:
                    with open(memory_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # 尝试找到最后一个完整的 JSON 对象
                    # 查找最后一个 "}," 或 "}" 并截断
                    last_valid = -1
                    bracket_count = 0
                    in_string = False
                    escape_next = False
                    
                    for i, char in enumerate(content):
                        if escape_next:
                            escape_next = False
                            continue
                        if char == '\\':
                            escape_next = True
                            continue
                        if char == '"' and not escape_next:
                            in_string = not in_string
                            continue
                        if in_string:
                            continue
                        if char == '{':
                            bracket_count += 1
                        elif char == '}':
                            bracket_count -= 1
                            if bracket_count == 1:  # 回到数组级别
                                last_valid = i + 1
                    
                    if last_valid > 0:
                        # 截断到最后一个有效位置并添加结尾
                        fixed_content = content[:last_valid] + "\n]"
                        memory_store = json.loads(fixed_content)
                        
                        # 备份损坏文件
                        backup_file = memory_file + f".broken_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                        import shutil
                        shutil.copy(memory_file, backup_file)
                        print(f"📦 已备份损坏文件到: {backup_file}")
                        
                        # 保存修复后的文件
                        with open(memory_file, 'w', encoding='utf-8') as f:
                            json.dump(memory_store, f, ensure_ascii=False, indent=2)
                        
                        print(f"✅ 修复成功！恢复了 {len(memory_store)} 条记忆")
                    else:
                        raise ValueError("无法找到有效的记忆数据")
                        
                except Exception as repair_error:
                    print(f"❌ 修复失败: {repair_error}")
                    # 备份并创建新文件
                    backup_file = memory_file + f".broken_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                    import shutil
                    shutil.copy(memory_file, backup_file)
                    print(f"📦 已备份损坏文件到: {backup_file}")
                    print("ℹ️ 创建新的记忆存储")
                    memory_store = []
        else:
            print("ℹ️ 创建新的记忆存储")
        
        print("✅ MemOS 服务启动成功!")
        print(f"📍 向量存储路径: ./memos_system/data")
        print(f"🧠 Embedding 模型: {new_marker}")
        print(f"🤖 记忆加工 LLM: {llm_config.get('model', 'N/A') if llm_config else '未配置'}")
        
    except Exception as e:
        print(f"❌ 初始化失败: {e}")
        import traceback
        traceback.print_exc()
        raise


async def process_memory_with_llm(content: str, role: str = "user") -> dict:
    """使用 LLM 加工记忆：提取关键信息并结构化，同时判断重要度
    
    Args:
        content: 对话内容
        role: 发言者角色 - "user"表示使用者（主人），"assistant"表示AI（肥牛）
    
    Returns:
        dict: {"content": 加工后的内容, "importance": 重要度0.1-1.0}
    """
    global llm_config
    
    if not llm_config:
        print("⚠️ LLM 未配置，跳过记忆加工")
        return {"content": content, "importance": 0.5}
    
    # 提取并验证 LLM 配置
    api_key = llm_config.get('api_key', '')
    model = llm_config.get('model', '')
    base_url = llm_config.get('base_url', '')
    
    if not api_key or not model or not base_url:
        print(f"⚠️ LLM 配置不完整，跳过记忆加工")
        return {"content": content, "importance": 0.5}
    
    try:
        import aiohttp
        import re
        
        # 根据角色设置不同的提示
        if role == "user":
            role_hint = "【主人说】"
        else:
            role_hint = "【肥牛说】"
        
        # 构建记忆加工 prompt（自然语言格式）
        prompt = f"""从对话中提取关键信息，用自然流畅的语言记录。

身份说明：
- "主人"是使用AI的真人用户
- "肥牛"是AI助手（不是真人）

{role_hint}
{content}

提取规则：
1. 用自然的中文描述，像写日记一样
2. 示例："主人喜欢在晚上聊天；说自己最近工作很忙"
3. 多个要点用分号连接，保留关键细节
4. 忽略无意义的闲聊

重要度（0.1-1.0）：
- 0.9-1.0: 极重要（生日、核心偏好、身份背景）
- 0.7-0.8: 重要（习惯、明确表态）
- 0.5-0.6: 一般（普通话题）
- 0.3以下: 可忽略

请用JSON回复：{{"memory": "自然语言记忆", "importance": 数值}}"""
        
        # 调用 LLM API
        async with aiohttp.ClientSession() as session:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 2000,
                "temperature": 0.2
            }
            
            async with session.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    response_text = result['choices'][0]['message']['content'].strip()
                    
                    # 尝试解析 JSON
                    try:
                        # 提取 JSON 部分（处理可能的额外文本）
                        json_match = re.search(r'\{[^}]+\}', response_text)
                        if json_match:
                            parsed = json.loads(json_match.group())
                            memory_content = parsed.get('memory', content)
                            try:
                                importance = float(parsed.get('importance', 0.5))
                            except:
                                importance = 0.5
                            # 确保重要度在有效范围内
                            importance = max(0.1, min(1.0, importance))
                            
                            print(f"🔧 记忆加工: {content[:30]}... → {memory_content[:50]}... (重要度: {importance})")
                            return {"content": memory_content, "importance": importance}
                        else:
                            # JSON匹配失败，使用原始响应
                            print(f"⚠️ 未找到JSON格式，使用原始响应")
                            return {"content": response_text, "importance": 0.5}
                    except (json.JSONDecodeError, ValueError) as e:
                        print(f"⚠️ JSON解析失败: {e}，使用原始响应")
                        return {"content": response_text, "importance": 0.5}
                else:
                    error_text = await response.text()
                    print(f"⚠️ LLM 加工失败 (status: {response.status}): {error_text[:200]}")
                    return {"content": content, "importance": 0.5}
    except aiohttp.ClientError as e:
        print(f"⚠️ 网络请求失败: {type(e).__name__}: {e}")
        return {"content": content, "importance": 0.5}
    except Exception as e:
        print(f"⚠️ 记忆加工出错: {type(e).__name__}: {e}")
        return {"content": content, "importance": 0.5}


async def process_conversation_batch(conversation: str) -> Dict[str, Any]:
    """
    🔥 批量对话加工：从一段完整对话中提取多条关键记忆
    支持重试机制和备用模型
    
    返回格式:
    {
        "memories": [
            {"content": "记忆1内容", "importance": 0.8},
            {"content": "记忆2内容", "importance": 0.6},
            ...
        ]
    }
    """
    global llm_config, full_config
    
    if not llm_config:
        print("⚠️ LLM 未配置，无法加工记忆")
        return {"memories": []}
    
    # 构建模型列表：主模型 + 备用模型
    models_to_try = []
    
    # 主模型
    api_key = llm_config.get('api_key', '')
    model = llm_config.get('model', '')
    base_url = llm_config.get('base_url', '')
    
    if api_key and model and base_url:
        models_to_try.append({
            'name': '主模型',
            'api_key': api_key,
            'model': model,
            'base_url': base_url
        })
    
    # 备用模型
    fallback_config = full_config.get('llm_fallback', {}) if full_config else {}
    if fallback_config.get('enabled', False):
        fb_cfg = fallback_config.get('config', {})
        fb_api_key = fb_cfg.get('api_key', '')
        fb_model = fb_cfg.get('model', '')
        fb_base_url = fb_cfg.get('base_url', '')
        if fb_api_key and fb_model and fb_base_url:
            models_to_try.append({
                'name': '备用模型',
                'api_key': fb_api_key,
                'model': fb_model,
                'base_url': fb_base_url
            })
    
    if not models_to_try:
        print(f"⚠️ LLM 配置不完整，无可用模型")
        return {"memories": []}
    
    import aiohttp
    import re
    
    # 构建批量记忆提取 prompt
    prompt = f"""你是记忆提取专家。从以下多轮对话中提取关键事实，用自然流畅的语言记录。

身份说明：
- "主人"是使用AI的真人用户
- "肥牛"是AI助手（不是真人）

提取规则：
1. 用自然的中文描述，像写日记一样记录要点
2. 示例格式：
   - "主人常在晚上与AI互动，称呼AI为肥牛；喜欢听AI唱歌"
   - "主人说自己生日是5月20日，希望AI记住"
   - "主人最近在学Python，问了很多编程问题"
   - "AI承诺帮主人提醒明天的会议"
3. 多个要点可以用分号或逗号连接
4. 每条记忆15-80字，保留关键细节
5. 忽略无意义的闲聊（如"嗯"、"好的"、"知道了"）
6. 判断记忆重要性（0.1-1.0）：
   - 0.9-1.0：极重要（生日、重大事件、核心偏好）
   - 0.7-0.8：重要（习惯、经历、明确表态）
   - 0.5-0.6：一般（普通话题、临时想法）
   - 0.3-0.4：较低（闲聊、无实质内容）
7. 可以提取0-5条记忆，没有重要信息就返回空数组

对话内容：
{conversation}

请严格按照以下JSON格式返回：
```json
{{
    "memories": [
        {{"content": "提取的记忆1", "importance": 0.8}},
        {{"content": "提取的记忆2", "importance": 0.6}}
    ]
}}
```

如果对话中没有值得记忆的信息，返回：
```json
{{"memories": []}}
```
"""
    
    # 重试配置：每个模型最多重试2次，超时时间递增
    timeouts = [60, 120]  # 第1次60秒，第2次120秒
    last_error = None
    
    for model_info in models_to_try:
        model_name = model_info['name']
        current_model = model_info['model']
        current_api_key = model_info['api_key']
        current_base_url = model_info['base_url']
        
        for attempt, timeout_seconds in enumerate(timeouts, 1):
            try:
                print(f"🔄 正在调用 LLM ({model_name}) 加工记忆... (model: {current_model}, 第{attempt}次, 超时{timeout_seconds}秒)")
                
                async with aiohttp.ClientSession() as session:
                    headers = {
                        "Authorization": f"Bearer {current_api_key}",
                        "Content-Type": "application/json"
                    }
                    
                    payload = {
                        "model": current_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 2000,
                        "temperature": 0.3
                    }
                    
                    # 某些API不支持 response_format，尝试添加
                    try:
                        payload["response_format"] = {"type": "json_object"}
                    except:
                        pass
                    
                    async with session.post(
                        f"{current_base_url}/chat/completions",
                        headers=headers,
                        json=payload,
                        timeout=aiohttp.ClientTimeout(total=timeout_seconds)
                    ) as response:
                        if response.status == 200:
                            result = await response.json()
                            response_text = result['choices'][0]['message']['content'].strip()
                            
                            print(f"📥 LLM 返回: {response_text[:200]}...")
                            
                            try:
                                # 尝试直接解析
                                parsed = json.loads(response_text)
                            except json.JSONDecodeError:
                                # 尝试从返回文本中提取 JSON
                                json_match = re.search(r'\{[\s\S]*"memories"[\s\S]*\}', response_text)
                                if json_match:
                                    try:
                                        parsed = json.loads(json_match.group())
                                    except:
                                        print(f"⚠️ 无法解析JSON，跳过记忆提取")
                                        continue  # 继续尝试
                                else:
                                    print(f"⚠️ 返回内容不包含有效JSON")
                                    continue  # 继续尝试
                            
                            memories = parsed.get('memories', [])
                            
                            # 验证和清理
                            valid_memories = []
                            for mem in memories:
                                if isinstance(mem, dict) and mem.get('content'):
                                    content = str(mem['content']).strip()
                                    try:
                                        importance = float(mem.get('importance', 0.5))
                                    except:
                                        importance = 0.5
                                    importance = max(0.1, min(1.0, importance))
                                    if len(content) >= 5:
                                        valid_memories.append({
                                            "content": content,
                                            "importance": importance
                                        })
                            
                            print(f"🧠 从对话中提取了 {len(valid_memories)} 条记忆 ({model_name})")
                            for mem in valid_memories:
                                print(f"   - [{mem['importance']:.1f}] {mem['content'][:40]}...")
                            
                            return {"memories": valid_memories}
                        else:
                            error_text = await response.text()
                            last_error = f"status {response.status}: {error_text[:200]}"
                            print(f"⚠️ LLM 请求失败 ({model_name}, 第{attempt}次): {last_error}")
                            continue  # 继续尝试
                            
            except asyncio.TimeoutError:
                last_error = f"超时({timeout_seconds}秒)"
                print(f"⚠️ LLM 超时 ({model_name}, 第{attempt}次, {timeout_seconds}秒)")
                continue  # 继续尝试
            except aiohttp.ClientError as e:
                last_error = f"{type(e).__name__}: {e}"
                print(f"⚠️ 网络请求失败 ({model_name}, 第{attempt}次): {last_error}")
                continue  # 继续尝试
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                print(f"⚠️ 未知错误 ({model_name}, 第{attempt}次): {last_error}")
                continue  # 继续尝试
        
        # 当前模型所有重试都失败，尝试下一个模型
        print(f"⚠️ {model_name} 所有重试失败，尝试下一个模型...")
    
    # 所有模型都失败
    print(f"❌ 所有模型均失败，最后错误: {last_error}")
    return {"memories": []}


@app.get("/")
async def root():
    return {
        "service": "MemOS API for 肥牛AI",
        "version": "1.0.0",
        "status": "running",
        "user_id": USER_ID
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model_loaded": embedding_model is not None,
        "memory_count": len(memory_store)
    }


@app.post("/add")
async def add_memory(request: AddMemoryRequest):
    """添加新记忆（批量对话合并后统一加工）
    
    🔥 核心逻辑：
    1. 将多轮对话合并成一段完整文本
    2. 只调用一次 LLM 从中提取关键记忆
    3. 支持提取多条记忆（用分号分隔）
    """
    global memory_store
    
    if not embedding_model:
        raise HTTPException(status_code=500, detail="Embedding 模型未加载")
    
    try:
        added_count = 0
        merged_count = 0
        skipped_count = 0
        
        # 🔥 步骤1：将所有对话合并成一段文本
        conversation_text = []
        for msg in request.messages:
            content = msg.get('content', '')
            role = msg.get('role', 'user')
            if content and len(content.strip()) > 0:
                role_label = "主人" if role == 'user' else "肥牛"
                conversation_text.append(f"【{role_label}】{content}")
        
        if not conversation_text:
            return {"status": "success", "message": "无有效对话", "added": 0, "merged": 0}
        
        full_conversation = "\n".join(conversation_text)
        print(f"📝 收到 {len(request.messages)} 条消息，合并后开始加工...")
        
        # 🔥 步骤2：一次性调用 LLM 提取关键记忆
        processed_result = await process_conversation_batch(full_conversation)
        
        if not processed_result or not processed_result.get("memories"):
            print("⚠️ 未提取到有效记忆")
            return {"status": "success", "message": "未提取到有效记忆", "added": 0, "merged": 0}
        
        # 🔥 步骤3：处理提取出的每条记忆
        for mem_item in processed_result["memories"]:
            content = mem_item.get("content", "").strip()
            importance = mem_item.get("importance", 0.5)
            
            if not content or len(content) < 5:
                continue
            
            # 如果重要度太低，跳过
            if importance < 0.3:
                print(f"⏭️ 跳过低重要度记忆 ({importance}): {content[:30]}...")
                skipped_count += 1
                continue
            
            # 生成 embedding
            embedding = embedding_model.encode([content])[0].tolist()
            
            # 去重：检查是否有相似记忆
            similar = find_similar_memory(embedding, threshold=0.95)
            
            if similar:
                idx, existing_mem, similarity = similar
                print(f"🔍 发现相似记忆 (相似度: {similarity:.2%})")
                
                # 尝试合并
                if await merge_memories(existing_mem, content, embedding):
                    merged_count += 1
                else:
                    # 合并失败，添加为新记忆
                    memory = {
                        "id": f"mem_{len(memory_store)}_{datetime.now().timestamp()}",
                        "content": content,
                        "timestamp": datetime.now().isoformat(),
                        "embedding": embedding,
                        "importance": importance,
                        "processed": True,
                        "merge_count": 0
                    }
                    memory_store.append(memory)
                    added_count += 1
            else:
                # 没有相似记忆，添加新记忆
                memory = {
                    "id": f"mem_{len(memory_store)}_{datetime.now().timestamp()}",
                    "content": content,
                    "timestamp": datetime.now().isoformat(),
                    "embedding": embedding,
                    "importance": importance,
                    "processed": True,
                    "merge_count": 0
                }
                memory_store.append(memory)
                added_count += 1
                print(f"✅ 新增记忆: {content[:50]}... (重要度: {importance})")
        
        # 保存到文件
        save_memory_store()
        
        # 构建返回消息
        result_parts = []
        if added_count > 0:
            result_parts.append(f"新增 {added_count} 条")
        if merged_count > 0:
            result_parts.append(f"合并 {merged_count} 条")
        if skipped_count > 0:
            result_parts.append(f"跳过 {skipped_count} 条")
        
        result_msg = "记忆已处理：" + "、".join(result_parts) if result_parts else "无有效记忆"
        
        return {
            "status": "success",
            "message": result_msg,
            "added": added_count,
            "merged": merged_count,
            "skipped": skipped_count
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"添加记忆失败: {str(e)}")


@app.post("/add_raw")
async def add_memory_raw(request: AddRawMemoryRequest):
    """直接添加记忆（不经过 LLM 加工）"""
    global memory_store
    
    if not embedding_model:
        raise HTTPException(status_code=500, detail="Embedding 模型未加载")
    
    try:
        added_count = 0
        
        for msg in request.messages:
            content = msg.content
            importance = msg.importance if msg.importance is not None else 0.8
            
            if content and len(content) > 5:
                # 直接使用原内容，不加工
                embedding = embedding_model.encode([content])[0].tolist()
                
                # 检查去重
                similar = find_similar_memory(embedding, threshold=0.95)
                
                if similar:
                    idx, existing_mem, similarity = similar
                    print(f"🔍 发现相似记忆，跳过添加 (相似度: {similarity:.2%})")
                    continue
                
                # 添加新记忆
                memory = {
                    "id": f"mem_{len(memory_store)}_{datetime.now().timestamp()}",
                    "content": content,
                    "role": msg.role or 'user',
                    "timestamp": datetime.now().isoformat(),
                    "created_at": datetime.now().isoformat(),
                    "embedding": embedding,
                    "importance": importance,
                    "processed": False,  # 标记未加工
                    "merge_count": 0
                }
                
                memory_store.append(memory)
                added_count += 1
                print(f"✅ 直接添加记忆: {content[:50]}...")
        
        save_memory_store()
        
        return {
            "status": "success",
            "message": f"直接添加 {added_count} 条记忆",
            "added": added_count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"添加失败: {str(e)}")


@app.put("/update/{memory_id}")
async def update_memory(memory_id: str, content: str, importance: Optional[float] = None):
    """更新记忆内容"""
    global memory_store
    
    if not embedding_model:
        raise HTTPException(status_code=500, detail="Embedding 模型未加载")
    
    try:
        # 查找记忆
        mem = next((m for m in memory_store if m['id'] == memory_id), None)
        
        if not mem:
            raise HTTPException(status_code=404, detail=f"记忆 {memory_id} 不存在")
        
        # 更新内容
        mem['content'] = content
        mem['timestamp'] = datetime.now().isoformat()
        
        if importance is not None:
            mem['importance'] = importance
        
        # 重新生成 embedding
        mem['embedding'] = embedding_model.encode([content])[0].tolist()
        
        save_memory_store()
        
        print(f"✅ 记忆已更新: {memory_id}")
        
        return {"status": "success", "message": "记忆已更新"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"更新失败: {str(e)}")


@app.post("/search")
async def search_memory(request: SearchMemoryRequest):
    """搜索相关记忆（综合考虑相似度和重要度）"""
    global memory_store
    
    if not embedding_model:
        raise HTTPException(status_code=500, detail="Embedding 模型未加载")
    
    if len(memory_store) == 0:
        return {"query": request.query, "memories": [], "count": 0}
    
    try:
        # 生成查询 embedding
        query_embedding = embedding_model.encode([request.query])[0]
        
        # 🔥 重要度加权因子（可调整）
        # 0.0 = 完全不考虑重要度，只看相似度
        # 0.3 = 重要度有一定影响（推荐）
        # 0.5 = 重要度影响较大
        IMPORTANCE_WEIGHT = 0.3
        
        # 计算相似度和综合得分
        scored_memories = []
        for mem in memory_store:
            mem_embedding = np.array(mem['embedding'])
            similarity = float(cosine_similarity([query_embedding], [mem_embedding])[0][0])
            importance = mem.get('importance', 0.5)
            
            # 🔥 综合得分 = 相似度 * (1 + 重要度 * 加权因子)
            # 例如：相似度0.8，重要度0.9 → 0.8 * (1 + 0.9 * 0.3) = 0.8 * 1.27 = 1.016
            # 例如：相似度0.8，重要度0.3 → 0.8 * (1 + 0.3 * 0.3) = 0.8 * 1.09 = 0.872
            final_score = similarity * (1 + importance * IMPORTANCE_WEIGHT)
            
            scored_memories.append((mem, similarity, final_score))
        
        # 🔥 按综合得分排序（不是纯相似度）
        scored_memories.sort(key=lambda x: x[2], reverse=True)
        
        # 🔥 应用相似度阈值过滤
        threshold = request.similarity_threshold or 0.5
        filtered_memories = [(mem, sim, score) for mem, sim, score in scored_memories if sim >= threshold]
        
        # 取 top_k
        top_memories = filtered_memories[:request.top_k]
        
        # 🔥 调试日志
        print(f"🔍 搜索 '{request.query[:30]}...': 总共 {len(memory_store)} 条，高于阈值 {threshold} 的有 {len(filtered_memories)} 条，返回 {len(top_memories)} 条")
        
        # 格式化返回
        results = [
            {
                "content": mem['content'],
                "similarity": round(sim, 4),
                "importance": mem.get('importance', 0.5),
                "final_score": round(score, 4),  # 返回综合得分
                # 🔥 返回创建时间（优先）和更新时间
                "timestamp": mem.get('created_at') or mem.get('timestamp'),
                "created_at": mem.get('created_at') or mem.get('timestamp'),
                "updated_at": mem.get('updated_at')
            }
            for mem, sim, score in top_memories
        ]
        
        return {
            "query": request.query,
            "memories": results,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"搜索记忆失败: {str(e)}")


@app.get("/list")
async def list_memories(user_id: Optional[str] = USER_ID, limit: int = 100):
    """列出所有记忆"""
    global memory_store
    
    try:
        # 返回最近的记忆
        recent_memories = memory_store[-limit:] if len(memory_store) > limit else memory_store
        
        results = [
            {
                "id": mem['id'],
                "content": mem['content'],
                # 🔥 返回创建时间和更新时间
                "timestamp": mem.get('created_at') or mem.get('timestamp'),  # 优先返回创建时间
                "created_at": mem.get('created_at') or mem.get('timestamp'),
                "updated_at": mem.get('updated_at'),
                "importance": mem.get('importance', 0.5),
                "merge_count": mem.get('merge_count', 0)  # 显示合并次数
            }
            for mem in reversed(recent_memories)  # 最新的在前
        ]
        
        return {
            "user_id": user_id,
            "count": len(results),
            "memories": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"列出记忆失败: {str(e)}")


@app.get("/check_similarity")
async def check_similarity(id1: str, id2: str):
    """检查两条记忆的相似度"""
    global memory_store
    
    try:
        mem1 = next((m for m in memory_store if m['id'] == id1), None)
        mem2 = next((m for m in memory_store if m['id'] == id2), None)
        
        if not mem1:
            raise HTTPException(status_code=404, detail=f"记忆 {id1} 不存在")
        if not mem2:
            raise HTTPException(status_code=404, detail=f"记忆 {id2} 不存在")
        
        emb1 = np.array(mem1['embedding'])
        emb2 = np.array(mem2['embedding'])
        
        similarity = float(cosine_similarity([emb1], [emb2])[0][0])
        
        return {
            "memory_1": {"id": id1, "content": mem1['content'][:100]},
            "memory_2": {"id": id2, "content": mem2['content'][:100]},
            "similarity": round(similarity * 100, 2),
            "would_merge_at_threshold": {
                "0.95": similarity >= 0.95,
                "0.90": similarity >= 0.90,
                "0.85": similarity >= 0.85,
                "0.80": similarity >= 0.80
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"检查失败: {str(e)}")


@app.delete("/delete/{memory_id}")
async def delete_memory(memory_id: str, user_id: Optional[str] = USER_ID):
    """删除指定记忆"""
    global memory_store
    
    try:
        # 查找并删除
        original_length = len(memory_store)
        memory_store = [mem for mem in memory_store if mem['id'] != memory_id]
        
        if len(memory_store) < original_length:
            save_memory_store()
            return {"status": "success", "message": f"记忆 {memory_id} 已删除"}
        else:
            raise HTTPException(status_code=404, detail=f"记忆 {memory_id} 不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除记忆失败: {str(e)}")


def find_similar_memory(new_embedding, threshold=0.95):
    """查找相似的记忆（用于去重）"""
    global memory_store
    
    if len(memory_store) == 0:
        return None
    
    new_emb = np.array(new_embedding)
    max_similarity = 0
    most_similar_idx = -1
    
    for idx, mem in enumerate(memory_store):
        mem_emb = np.array(mem['embedding'])
        similarity = cosine_similarity([new_emb], [mem_emb])[0][0]
        
        if similarity > max_similarity:
            max_similarity = similarity
            most_similar_idx = idx
    
    if max_similarity >= threshold:
        return most_similar_idx, memory_store[most_similar_idx], float(max_similarity)
    
    return None


async def merge_memories(existing_mem, new_content, new_embedding):
    """合并两条相似的记忆（带重试机制）"""
    global llm_config
    
    # 检查 LLM 配置
    if not llm_config:
        print("⚠️ LLM 未配置，无法合并记忆")
        return False
    
    import aiohttp
    import asyncio
    
    # 构建合并 prompt
    prompt = f"""合并以下两条相似的记忆，保留所有有价值的信息，去除重复内容：

已有记忆：{existing_mem['content']}
新增信息：{new_content}

合并后的记忆（保留所有细节，用分号分隔要点）："""
    
    api_key = llm_config.get('api_key', '')
    model = llm_config.get('model', '')
    base_url = llm_config.get('base_url', '')
    
    if not all([api_key, model, base_url]):
        print("⚠️ LLM 配置不完整，无法合并记忆")
        return False
    
    # 🔥 重试机制：最多 3 次，超时逐次增加
    max_retries = 3
    timeouts = [60, 90, 120]  # 第1次60秒，第2次90秒，第3次120秒
    
    for attempt in range(max_retries):
        try:
            timeout_seconds = timeouts[attempt]
            
            async with aiohttp.ClientSession() as session:
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 2000,
                    "temperature": 0.2
                }
                
                async with session.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=timeout_seconds)
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        merged = result['choices'][0]['message']['content'].strip()
                        
                        # 🔥 保留最早的时间作为 created_at
                        if 'created_at' not in existing_mem:
                            existing_mem['created_at'] = existing_mem.get('timestamp', datetime.now().isoformat())
                        
                        # 更新记忆
                        existing_mem['content'] = merged
                        # 🔥 确保 embedding 是 list 类型（不是 numpy ndarray）
                        if hasattr(new_embedding, 'tolist'):
                            existing_mem['embedding'] = new_embedding.tolist()
                        else:
                            existing_mem['embedding'] = list(new_embedding) if new_embedding else []
                        existing_mem['updated_at'] = datetime.now().isoformat()
                        existing_mem['merge_count'] = existing_mem.get('merge_count', 0) + 1
                        
                        print(f"🔗 记忆已合并 (第 {existing_mem['merge_count']} 次): {merged[:50]}...")
                        return True
                    else:
                        error_text = await response.text()
                        print(f"⚠️ LLM API 返回错误 {response.status}: {error_text[:200]}")
                        return False  # API 错误不重试
                        
        except asyncio.TimeoutError:
            print(f"⚠️ 第 {attempt + 1}/{max_retries} 次尝试超时 ({timeout_seconds}秒)")
            if attempt < max_retries - 1:
                print(f"   🔄 等待 2 秒后重试...")
                await asyncio.sleep(2)
            continue
        except Exception as e:
            import traceback
            print(f"⚠️ 合并失败: {e}")
            traceback.print_exc()
            return False
    
    print(f"⚠️ 所有重试均失败")
    return False


class NumpyEncoder(json.JSONEncoder):
    """自定义 JSON 编码器，处理 numpy 类型"""
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (np.float32, np.float64)):
            return float(obj)
        if isinstance(obj, (np.int32, np.int64)):
            return int(obj)
        return super().default(obj)


def save_memory_store():
    """保存记忆到文件（原子写入，防止损坏）"""
    try:
        data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
        os.makedirs(data_dir, exist_ok=True)
        memory_file = os.path.join(data_dir, "memory_store.json")
        temp_file = memory_file + ".tmp"
        
        # 🔥 先写入临时文件（使用自定义编码器处理 numpy 类型）
        with open(temp_file, 'w', encoding='utf-8') as f:
            json.dump(memory_store, f, ensure_ascii=False, indent=2, cls=NumpyEncoder)
        
        # 🔥 验证临时文件是否有效
        with open(temp_file, 'r', encoding='utf-8') as f:
            json.load(f)  # 尝试解析，确保 JSON 有效
        
        # 🔥 原子替换：删除旧文件，重命名临时文件
        if os.path.exists(memory_file):
            os.remove(memory_file)
        os.rename(temp_file, memory_file)
        
    except Exception as e:
        print(f"保存记忆失败: {e}")
        # 清理临时文件
        temp_file = os.path.join(os.path.dirname(__file__), "..", "data", "memory_store.json.tmp")
        if os.path.exists(temp_file):
            os.remove(temp_file)


@app.post("/migrate")
async def migrate_from_txt(request: MigrateRequest):
    """从旧记忆库.txt 文件导入记忆"""
    global memory_store
    
    if not embedding_model:
        raise HTTPException(status_code=500, detail="Embedding 模型未加载")
    
    try:
        file_path = request.file_path
        
        # 尝试相对路径和绝对路径
        if not os.path.isabs(file_path):
            file_path = os.path.join(os.getcwd(), file_path)
        
        if not os.path.exists(file_path):
            # 尝试 live-2d 目录
            alt_path = os.path.join("live-2d", request.file_path)
            if os.path.exists(alt_path):
                file_path = alt_path
            else:
                raise HTTPException(status_code=404, detail=f"文件不存在: {request.file_path}")
        
        print(f"📂 读取文件: {file_path}")
        
        # 读取文件内容
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 按分隔线分割内容
        separator_pattern = r'\s*-{10,}\s*'
        sections = re.split(separator_pattern, content)
        
        imported_count = 0
        for section in sections:
            section = section.strip()
            if section and len(section) > 10:
                # 生成 embedding
                embedding = embedding_model.encode([section])[0].tolist()
                
                # 创建记忆对象
                memory = {
                    "id": f"migrated_{imported_count}_{datetime.now().timestamp()}",
                    "content": section,
                    "role": "user",
                    "timestamp": datetime.now().isoformat(),
                    "embedding": embedding,
                    "importance": 0.7,
                    "source": "migrated"
                }
                
                memory_store.append(memory)
                imported_count += 1
        
        # 保存
        save_memory_store()
        
        print(f"✅ 成功导入 {imported_count} 条记忆")
        
        return {
            "status": "success",
            "imported_count": imported_count,
            "message": f"成功导入 {imported_count} 条记忆"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"导入记忆失败: {str(e)}")


@app.post("/reprocess")
async def reprocess_all_memories():
    """批量加工所有未处理的记忆"""
    global memory_store
    
    if not embedding_model or not llm_config:
        raise HTTPException(status_code=500, detail="模型未加载")
    
    try:
        processed_count = 0
        failed_count = 0
        
        print("🔧 开始批量加工记忆...")
        
        for i, mem in enumerate(memory_store):
            # 跳过已加工的记忆
            if mem.get('processed'):
                continue
            
            original_content = mem.get('content', '')
            if len(original_content) < 10:
                continue
            
            # 获取记忆的角色（默认为 user）
            mem_role = mem.get('role', 'user')
            print(f"处理 {i+1}/{len(memory_store)} [{mem_role}]: {original_content[:50]}...")
            
            try:
                # 使用 LLM 加工（返回内容和重要度）
                processed_result = await process_memory_with_llm(original_content, mem_role)
                processed_content = processed_result["content"]
                importance = processed_result["importance"]
                
                # 更新记忆
                mem['original_content'] = original_content
                mem['content'] = processed_content
                mem['importance'] = importance  # 更新重要度
                mem['processed'] = True
                
                # 重新生成 embedding（使用加工后的内容）
                new_embedding = embedding_model.encode([processed_content])[0].tolist()
                mem['embedding'] = new_embedding
                
                processed_count += 1
                print(f"  ✅ 重要度: {importance}")
                
                # 每处理 10 条保存一次
                if processed_count % 10 == 0:
                    save_memory_store()
                    print(f"  ✅ 已处理 {processed_count} 条")
                
            except Exception as e:
                print(f"  ❌ 处理失败: {e}")
                failed_count += 1
        
        # 最终保存
        save_memory_store()
        
        print(f"✅ 批量加工完成！成功: {processed_count}, 失败: {failed_count}")
        
        return {
            "status": "success",
            "processed_count": processed_count,
            "failed_count": failed_count,
            "message": f"成功加工 {processed_count} 条记忆"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批量加工失败: {str(e)}")


@app.post("/deduplicate")
async def deduplicate_all_memories(threshold: float = 0.90):
    """全局去重合并：扫描所有记忆，合并高度相似的记忆
    
    参数:
        threshold: 相似度阈值，0.90 表示 90% 相似则合并
    """
    global memory_store
    
    if not embedding_model:
        raise HTTPException(status_code=500, detail="Embedding 模型未加载")
    
    if len(memory_store) < 2:
        return {"status": "success", "merged_count": 0, "merge_details": [], "message": "记忆太少，无需去重"}
    
    try:
        print(f"🔍 开始全局去重（阈值: {threshold}）...")
        
        # 🔥 检查 LLM 配置状态
        if llm_config:
            print(f"✅ LLM 配置可用: {llm_config.get('model', 'N/A')}")
        else:
            print(f"⚠️ LLM 未配置，将使用简单合并策略")
        merged_count = 0
        deleted_ids = set()
        merge_details = []  # 🔥 记录合并详情
        
        # 双重循环检查所有记忆对
        for i in range(len(memory_store)):
            if memory_store[i]['id'] in deleted_ids:
                continue
            
            mem_i = memory_store[i]
            emb_i = np.array(mem_i['embedding'])
            original_content_i = mem_i['content']  # 保存原始内容
            
            for j in range(i + 1, len(memory_store)):
                if memory_store[j]['id'] in deleted_ids:
                    continue
                
                mem_j = memory_store[j]
                emb_j = np.array(mem_j['embedding'])
                
                # 计算相似度
                similarity = float(cosine_similarity([emb_i], [emb_j])[0][0])
                
                if similarity >= threshold:
                    print(f"🔗 发现相似记忆 (相似度: {similarity:.2%})")
                    print(f"   记忆1: {mem_i['content'][:50]}...")
                    print(f"   记忆2: {mem_j['content'][:50]}...")
                    
                    # 🔥 确定更早的时间作为 created_at
                    time_i = mem_i.get('created_at') or mem_i.get('timestamp', '')
                    time_j = mem_j.get('created_at') or mem_j.get('timestamp', '')
                    earlier_time = min(time_i, time_j) if time_i and time_j else (time_i or time_j)
                    
                    # 保存合并前的内容
                    content_before_i = mem_i['content']
                    content_before_j = mem_j['content']
                    
                    # 尝试用 LLM 合并
                    print(f"   🤖 正在调用 LLM 合并...")
                    merge_success = await merge_memories(mem_i, mem_j['content'], emb_j)
                    print(f"   🤖 LLM 合并结果: {'成功' if merge_success else '失败'}")
                    
                    # 🔥 记录合并详情
                    detail = {
                        "similarity": round(similarity * 100, 1),
                        "memory_1": content_before_i[:100] + ("..." if len(content_before_i) > 100 else ""),
                        "memory_2": content_before_j[:100] + ("..." if len(content_before_j) > 100 else ""),
                        "result": mem_i['content'][:100] + ("..." if len(mem_i['content']) > 100 else ""),
                        "method": "LLM合并" if merge_success else "保留高重要度"
                    }
                    merge_details.append(detail)
                    
                    if merge_success:
                        # 保留更早的时间
                        if earlier_time:
                            mem_i['created_at'] = earlier_time
                        # 标记 j 为删除
                        deleted_ids.add(mem_j['id'])
                        merged_count += 1
                        print(f"   ✅ 已合并，删除记忆2")
                    else:
                        # 🔥 合并失败，跳过这一对，保留两条记忆
                        print(f"   ⏭️ LLM合并失败，跳过此对记忆（两条均保留）")
                        merge_details.pop()  # 移除未完成的合并详情
        
        # 删除被标记的记忆
        if deleted_ids:
            memory_store = [m for m in memory_store if m['id'] not in deleted_ids]
            save_memory_store()
        
        print(f"✅ 去重完成！合并 {merged_count} 条记忆")
        
        return {
            "status": "success",
            "merged_count": merged_count,
            "remaining_count": len(memory_store),
            "merge_details": merge_details,  # 🔥 返回合并详情
            "message": f"合并 {merged_count} 条相似记忆，剩余 {len(memory_store)} 条"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"去重失败: {str(e)}")


@app.get("/stats")
async def get_statistics():
    """获取记忆统计信息"""
    global memory_store
    
    try:
        total_count = len(memory_store)
        
        # 计算本周新增
        from datetime import timedelta
        now = datetime.now()
        week_ago = now - timedelta(days=7)
        week_count = 0
        
        for mem in memory_store:
            try:
                mem_time = datetime.fromisoformat(mem.get('timestamp', ''))
                if mem_time >= week_ago:
                    week_count += 1
            except:
                pass
        
        # 计算今天新增
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_count = 0
        
        for mem in memory_store:
            try:
                mem_time = datetime.fromisoformat(mem.get('timestamp', ''))
                if mem_time >= today_start:
                    today_count += 1
            except:
                pass
        
        # 计算平均重要度
        if total_count > 0:
            avg_importance = sum(mem.get('importance', 0.5) for mem in memory_store) / total_count
        else:
            avg_importance = 0
        
        return {
            "total_count": total_count,
            "today_count": today_count,
            "week_count": week_count,
            "avg_importance": round(avg_importance, 2),
            "storage_path": "./memos_data"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取统计失败: {str(e)}")


if __name__ == "__main__":
    print("=" * 60)
    print("  MemOS 记忆服务 for 肥牛AI")
    print("=" * 60)
    print("  端口: 8003")
    print("  文档: http://127.0.0.1:8003/docs")
    print("=" * 60)
    
    uvicorn.run(app, host="0.0.0.0", port=8003)

