from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Union, Generator, Callable
import uvicorn
import time
import uuid
import json
import torch
import os
from transformers import AutoModelForCausalLM, AutoTokenizer
from transformers import TextIteratorStreamer
from threading import Thread

# 模型路径配置 - 如果为空字符串则进行自动检测
MODEL_PATH = ""  # 可以直接在这里硬编码路径，例如："models/你的LLM模型"

# 获取模型路径 - 自动检测或使用硬编码路径
def get_model_path():
    # 如果MODEL_PATH已设置，则使用这个路径
    if MODEL_PATH:
        print(f"使用硬编码的模型路径: {MODEL_PATH}")
        return MODEL_PATH
    
    # 否则自动检测
    models_dir = "models"
    if not os.path.exists(models_dir):
        raise FileNotFoundError(f"模型目录 '{models_dir}' 不存在")
    
    # 获取models目录下的所有文件夹
    subdirs = [d for d in os.listdir(models_dir) if os.path.isdir(os.path.join(models_dir, d))]
    
    if not subdirs:
        raise FileNotFoundError(f"模型目录 '{models_dir}' 下没有找到任何模型文件夹")
    
    # 使用第一个检测到的文件夹
    model_folder = subdirs[0]
    model_path = os.path.join(models_dir, model_folder)
    
    print(f"已自动检测到模型文件夹: {model_folder}")
    return model_path

# 初始化模型和分词器
print("正在加载模型...")
try:
    model_dir = get_model_path()
    model = AutoModelForCausalLM.from_pretrained(
        model_dir,
        device_map='auto',
        torch_dtype='auto'
    )
    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    print(f"模型加载完成! 使用模型路径: {model_dir}")
except Exception as e:
    print(f"模型加载失败: {str(e)}")
    raise

# FastAPI应用
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 数据模型
class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: List[Message]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 512
    stream: Optional[bool] = False


# 真正的流式响应生成器函数
def generate_real_stream_response(request: ChatRequest) -> Generator:
    try:
        request_id = f"chatcmpl-{str(uuid.uuid4())}"
        created_time = int(time.time())

        # 准备消息
        messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]

        # 应用聊天模板
        text = tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=False
        )

        # 准备模型输入
        model_inputs = tokenizer([text], return_tensors='pt').to(model.device)
        input_length = len(model_inputs.input_ids[0])

        # 创建流式迭代器
        streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

        # 发送开始事件
        start_event = {
            "id": request_id,
            "object": "chat.completion.chunk",
            "created": created_time,
            "model": request.model,
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant"},
                    "finish_reason": None
                }
            ]
        }
        yield f"data: {json.dumps(start_event)}\n\n"

        # 在后台线程中运行生成过程
        generation_kwargs = {
            **model_inputs,
            "streamer": streamer,
            "max_new_tokens": request.max_tokens,
            "temperature": request.temperature if request.temperature > 0 else 1.0,
        }

        thread = Thread(target=model.generate, kwargs=generation_kwargs)
        thread.start()

        # 实时获取并发送生成的tokens
        for new_text in streamer:
            if new_text:
                chunk_event = {
                    "id": request_id,
                    "object": "chat.completion.chunk",
                    "created": created_time,
                    "model": request.model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": new_text},
                            "finish_reason": None
                        }
                    ]
                }
                yield f"data: {json.dumps(chunk_event)}\n\n"

        # 发送结束事件
        end_event = {
            "id": request_id,
            "object": "chat.completion.chunk",
            "created": created_time,
            "model": request.model,
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop"
                }
            ]
        }
        yield f"data: {json.dumps(end_event)}\n\n"
        yield "data: [DONE]\n\n"

    except Exception as e:
        import traceback
        print(f"流式生成错误: {str(e)}")
        print(traceback.format_exc())
        # 在出错时发送错误事件
        error_event = {
            "error": {
                "message": str(e),
                "type": "server_error"
            }
        }
        yield f"data: {json.dumps(error_event)}\n\n"
        yield "data: [DONE]\n\n"


# OpenAI兼容的聊天接口
@app.post("/v1/chat/completions")
async def chat_completion(request: ChatRequest):
    # 检查是否需要流式输出
    if request.stream:
        return StreamingResponse(
            generate_real_stream_response(request),
            media_type="text/event-stream"
        )

    # 非流式输出处理
    try:
        start_time = time.time()

        # 准备消息
        messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]

        # 应用聊天模板
        text = tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=False
        )

        # 准备模型输入
        model_inputs = tokenizer([text], return_tensors='pt').to(model.device)

        # 计算输入token数
        input_tokens = len(model_inputs.input_ids[0])

        # 生成文本
        with torch.no_grad():
            generated_ids = model.generate(
                **model_inputs,
                max_new_tokens=request.max_tokens,
                temperature=request.temperature if request.temperature > 0 else 1.0
            )

        # 提取生成的内容
        generated_ids = [
            output_ids[len(input_ids):] for input_ids, output_ids in zip(model_inputs.input_ids, generated_ids)
        ]

        # 解码回复
        response_text = tokenizer.batch_decode(generated_ids, skip_special_tokens=True)[0]

        # 计算生成token数
        completion_tokens = len(generated_ids[0])

        end_time = time.time()
        print(f"生成完成，耗时: {end_time - start_time:.2f}秒")

        # 返回OpenAI兼容格式
        return {
            "id": f"chatcmpl-{str(uuid.uuid4())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": request.model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": response_text
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": input_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": input_tokens + completion_tokens
            }
        }
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        print(f"发生错误: {str(e)}")
        print(error_traceback)
        return {"error": str(e), "traceback": error_traceback}


# 健康检查
@app.get("/health")
async def health():
    return {"status": "ok"}


# 模型列表
@app.get("/v1/models")
async def list_models():
    # 从检测到的模型文件夹提取模型名称
    model_name = os.path.basename(model_dir)
    return {
        "object": "list",
        "data": [
            {
                "id": model_name,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "user"
            },
            {
                "id": "gpt-3.5-turbo",
                "object": "model",
                "created": int(time.time()),
                "owned_by": "user"
            }
        ]
    }


if __name__ == "__main__":
    print("启动服务器...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
