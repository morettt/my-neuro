# chat_routes.py - 记忆增强 Chat API
"""
提供记忆增强的对话接口
支持 SSE 流式输出
"""

import json
import logging
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, AsyncGenerator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["记忆增强对话"])


# ==================== 请求模型 ====================

class ChatMessage(BaseModel):
    role: str = Field(..., description="角色: user, assistant, system")
    content: str = Field(..., description="消息内容")


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., description="对话历史")
    user_id: str = Field(default="feiniu_default", description="用户 ID")
    
    # 记忆检索配置
    use_memory: bool = Field(default=True, description="是否使用记忆")
    memory_top_k: int = Field(default=5, ge=1, le=20, description="检索记忆数量")
    use_graph: bool = Field(default=False, description="使用图增强")
    
    # 生成配置
    stream: bool = Field(default=False, description="是否流式输出")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2000, ge=100, le=8000)
    
    # 记忆保存
    save_to_memory: bool = Field(default=True, description="是否保存对话到记忆")


class ChatResponse(BaseModel):
    message: ChatMessage
    memory_context: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="使用的记忆上下文"
    )
    usage: Dict[str, int] = Field(default_factory=dict)


# ==================== 端点 ====================

@router.post("/completions", summary="记忆增强对话")
async def chat_completions(request: ChatRequest):
    """
    记忆增强的对话接口
    
    流程：
    1. 从对话中提取查询
    2. 检索相关记忆
    3. 构建增强的提示
    4. 调用 LLM 生成回复
    5. 可选保存对话到记忆
    """
    if request.stream:
        return StreamingResponse(
            _stream_chat(request),
            media_type="text/event-stream"
        )
    
    # 非流式响应
    return {
        "message": {
            "role": "assistant",
            "content": "Chat 接口需要在主服务器中集成 MOS 实例"
        },
        "memory_context": [],
        "usage": {}
    }


async def _stream_chat(request: ChatRequest) -> AsyncGenerator[str, None]:
    """流式对话生成器"""
    # 发送开始事件
    yield f"data: {json.dumps({'type': 'start'})}\n\n"
    
    # 发送记忆上下文（如果有）
    yield f"data: {json.dumps({'type': 'memory_context', 'data': []})}\n\n"
    
    # 模拟生成内容
    content = "这是一个示例回复。Chat 接口需要在主服务器中集成 MOS 实例才能使用完整功能。"
    
    for char in content:
        yield f"data: {json.dumps({'type': 'content', 'data': char})}\n\n"
    
    # 发送结束事件
    yield f"data: {json.dumps({'type': 'end'})}\n\n"


@router.post("/memory-chat", summary="带记忆的对话（简化版）")
async def memory_chat(
    query: str,
    user_id: str = Query(default="feiniu_default"),
    top_k: int = Query(default=5, ge=1, le=20)
):
    """
    简化版记忆对话
    
    - 检索相关记忆
    - 返回记忆和建议回复
    """
    return {
        "query": query,
        "user_id": user_id,
        "memories": [],
        "suggested_response": "需要集成 MOS 和 LLM"
    }


@router.get("/history", summary="获取对话历史")
async def get_chat_history(
    user_id: str = Query(...),
    limit: int = Query(default=50, ge=1, le=200)
):
    """获取用户的对话历史"""
    return {
        "user_id": user_id,
        "history": [],
        "total": 0
    }


# ==================== 记忆增强 Chat 实现 ====================

class MemoryEnhancedChat:
    """记忆增强的对话类"""
    
    def __init__(self, mos, llm_config: Dict[str, Any]):
        """
        初始化
        
        Args:
            mos: MOS 实例
            llm_config: LLM 配置
        """
        self.mos = mos
        self.llm_config = llm_config
    
    async def chat(
        self,
        messages: List[ChatMessage],
        user_id: str,
        use_memory: bool = True,
        memory_top_k: int = 5,
        use_graph: bool = False,
        save_to_memory: bool = True,
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行记忆增强对话
        
        Args:
            messages: 对话历史
            user_id: 用户 ID
            use_memory: 是否使用记忆
            memory_top_k: 检索数量
            use_graph: 使用图增强
            save_to_memory: 保存到记忆
            **kwargs: LLM 参数
        
        Returns:
            对话结果
        """
        # 1. 提取用户最新消息作为查询
        query = ""
        for msg in reversed(messages):
            if msg.role == "user":
                query = msg.content
                break
        
        if not query:
            return {
                "message": {"role": "assistant", "content": "请输入您的问题"},
                "memory_context": []
            }
        
        # 2. 检索相关记忆
        memory_context = []
        if use_memory and self.mos:
            memories = await self.mos.search(
                query=query,
                user_id=user_id,
                top_k=memory_top_k,
                use_graph=use_graph
            )
            memory_context = memories
        
        # 3. 构建增强提示
        system_prompt = self._build_system_prompt(memory_context)
        
        # 4. 调用 LLM
        response_content = await self._call_llm(
            messages, system_prompt, **kwargs
        )
        
        # 5. 保存对话到记忆（可选）
        if save_to_memory and self.mos:
            # 保存用户消息
            await self.mos.add(
                content=f"用户说：{query}",
                user_id=user_id,
                memory_type="conversation",
                importance=0.5
            )
            # 保存助手回复
            await self.mos.add(
                content=f"AI回复：{response_content[:200]}...",
                user_id=user_id,
                memory_type="conversation",
                importance=0.3
            )
        
        return {
            "message": {"role": "assistant", "content": response_content},
            "memory_context": memory_context
        }
    
    def _build_system_prompt(
        self,
        memory_context: List[Dict[str, Any]]
    ) -> str:
        """构建包含记忆的系统提示"""
        base_prompt = "你是一个有记忆能力的 AI 助手。"
        
        if not memory_context:
            return base_prompt
        
        memory_text = "\n".join([
            f"- {m.get('content', '')[:100]}"
            for m in memory_context[:5]
        ])
        
        return f"""{base_prompt}

以下是与用户相关的记忆，请在回答时参考：

{memory_text}

请根据这些记忆和当前对话提供个性化的回答。"""
    
    async def _call_llm(
        self,
        messages: List[ChatMessage],
        system_prompt: str,
        **kwargs
    ) -> str:
        """调用 LLM"""
        import aiohttp
        
        try:
            # 构建消息
            api_messages = [{"role": "system", "content": system_prompt}]
            for msg in messages:
                api_messages.append({
                    "role": msg.role,
                    "content": msg.content
                })
            
            async with aiohttp.ClientSession() as session:
                headers = {
                    "Authorization": f"Bearer {self.llm_config.get('api_key', '')}",
                    "Content-Type": "application/json"
                }
                
                payload = {
                    "model": self.llm_config.get('model', ''),
                    "messages": api_messages,
                    "temperature": kwargs.get('temperature', 0.7),
                    "max_tokens": kwargs.get('max_tokens', 2000)
                }
                
                async with session.post(
                    f"{self.llm_config.get('base_url', '')}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data['choices'][0]['message']['content']
                    else:
                        logger.error(f"LLM API 返回 {resp.status}")
                        return "抱歉，AI 服务暂时不可用"
                        
        except Exception as e:
            logger.error(f"调用 LLM 失败: {e}")
            return "抱歉，AI 服务暂时不可用"
    
    async def stream_chat(
        self,
        messages: List[ChatMessage],
        user_id: str,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """流式对话"""
        import aiohttp
        
        # 检索记忆
        query = ""
        for msg in reversed(messages):
            if msg.role == "user":
                query = msg.content
                break
        
        memory_context = []
        if kwargs.get('use_memory', True) and self.mos:
            memories = await self.mos.search(
                query=query,
                user_id=user_id,
                top_k=kwargs.get('memory_top_k', 5)
            )
            memory_context = memories
        
        # 发送记忆上下文
        yield f"data: {json.dumps({'type': 'memory', 'data': memory_context})}\n\n"
        
        # 构建提示
        system_prompt = self._build_system_prompt(memory_context)
        api_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            api_messages.append({"role": msg.role, "content": msg.content})
        
        # 流式调用 LLM
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    "Authorization": f"Bearer {self.llm_config.get('api_key', '')}",
                    "Content-Type": "application/json"
                }
                
                payload = {
                    "model": self.llm_config.get('model', ''),
                    "messages": api_messages,
                    "temperature": kwargs.get('temperature', 0.7),
                    "max_tokens": kwargs.get('max_tokens', 2000),
                    "stream": True
                }
                
                async with session.post(
                    f"{self.llm_config.get('base_url', '')}/chat/completions",
                    headers=headers,
                    json=payload
                ) as resp:
                    async for line in resp.content:
                        line = line.decode('utf-8').strip()
                        if line.startswith('data: '):
                            data = line[6:]
                            if data == '[DONE]':
                                break
                            try:
                                chunk = json.loads(data)
                                content = chunk['choices'][0].get('delta', {}).get('content', '')
                                if content:
                                    yield f"data: {json.dumps({'type': 'content', 'data': content})}\n\n"
                            except:
                                pass
                        
        except Exception as e:
            logger.error(f"流式调用失败: {e}")
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"
        
        yield f"data: {json.dumps({'type': 'end'})}\n\n"
