from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import torch
import json
import numpy as np
import os
import sys
import re

from datetime import datetime
from queue import Queue
from modelscope.hub.snapshot_download import snapshot_download

# 保存原始的stdout和stderr
original_stdout = sys.stdout
original_stderr = sys.stderr


# 创建一个可以同时写到文件和终端的类，并过滤ANSI颜色码
class TeeOutput:
    def __init__(self, file1, file2):
        self.file1 = file1
        self.file2 = file2
        # 用于匹配ANSI颜色码的正则表达式
        self.ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

    def write(self, data):
        # 终端输出保持原样（带颜色）
        self.file1.write(data)
        # 文件输出去掉颜色码
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


# 创建logs目录
LOGS_DIR = "logs"
if not os.path.exists(LOGS_DIR):
    os.makedirs(LOGS_DIR)

# 设置双重输出
log_file = open(os.path.join(LOGS_DIR, 'asr.log'), 'w', encoding='utf-8')
sys.stdout = TeeOutput(original_stdout, log_file)
sys.stderr = TeeOutput(original_stderr, log_file)

app = FastAPI()

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 创建模型存储目录
MODEL_DIR = "model"
if not os.path.exists(MODEL_DIR):
    os.makedirs(MODEL_DIR)

# 全局变量
SAMPLE_RATE = 16000
WINDOW_SIZE = 512
VAD_THRESHOLD = 0.5

# VAD状态
vad_state = {
    "is_running": False,
    "active_websockets": set(),
    "model": None,
    "result_queue": Queue()
}

# 设置设备和数据类型
device = "cuda" if torch.cuda.is_available() else "cpu"
torch.set_default_dtype(torch.float32)

# 初始化模型状态（仅VAD）
model_state = {
    "vad_model": None
}


def download_vad_models():
    """下载asr的vad"""
    vad_dir = os.getcwd()

    target_dir = os.path.join(vad_dir, 'model', 'torch_hub')
    os.makedirs(target_dir, exist_ok=True)

    model_dir = snapshot_download('morelle/my-neuro-vad', local_dir=target_dir)

    print(f'已将asr vad下载到{model_dir}')


# 使用 FastAPI 的生命周期事件装饰器
@app.on_event("startup")
async def startup_event():
    print("正在加载VAD模型...")

    # 检查VAD模型目录是否存在
    torch_hub_dir = os.path.join(MODEL_DIR, "torch_hub")
    local_vad_path = os.path.join(torch_hub_dir, "snakers4_silero-vad_master")

    # 如果VAD模型目录不存在，则下载
    if not os.path.exists(local_vad_path):
        print("未找到VAD模型目录，开始下载...")
        download_vad_models()
    else:
        print("VAD模型目录已存在，跳过下载步骤")

    # 加载VAD模型（严格本地模式，避免torch.hub解析路径）
    try:
        print("正在从本地加载VAD模型...")
        # 关键：通过`source='local'`强制使用本地模式，避免torch.hub解析repo_or_dir为远程仓库
        model_state["vad_model"] = torch.hub.load(
            repo_or_dir=local_vad_path,
            model='silero_vad',
            force_reload=False,
            onnx=True,
            trust_repo=True,
            source='local'  # 添加这一行，强制本地加载模式
        )

        # 解包模型（silero-vad的torch.hub.load返回元组 (model, example)）
        vad_model_tuple = model_state["vad_model"]
        model_state["vad_model"] = vad_model_tuple[0]  # 提取第一个元素（模型本体）
        print("VAD模型加载完成")
    except Exception as e:
        print(f"VAD模型加载失败: {str(e)}")
        raise e

    vad_state["model"] = model_state["vad_model"]
    print("✅ VAD服务启动完成（ASR识别请使用云端API）")


@app.websocket("/v1/ws/vad")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    vad_state["active_websockets"].add(websocket)
    try:
        print("新的WebSocket连接")
        while True:
            try:
                data = await websocket.receive_bytes()
                audio = np.frombuffer(data, dtype=np.float32).copy()

                if len(audio) == WINDOW_SIZE:
                    audio_tensor = torch.FloatTensor(audio)
                    speech_prob = vad_state["model"](audio_tensor, SAMPLE_RATE).item()
                    result = {
                        "is_speech": speech_prob > VAD_THRESHOLD,
                        "probability": float(speech_prob)
                    }
                    await websocket.send_text(json.dumps(result))
            except WebSocketDisconnect:
                print("客户端断开连接")
                break
            except Exception as e:
                print(f"处理音频数据时出错: {str(e)}")
                break
    except Exception as e:
        print(f"WebSocket错误: {str(e)}")
    finally:
        if websocket in vad_state["active_websockets"]:
            vad_state["active_websockets"].remove(websocket)
        print("WebSocket连接关闭")
        try:
            await websocket.close()
        except:
            pass


# ASR识别接口已移除，本服务仅提供VAD功能
# ASR识别请使用云端API（配置在 config.json 的 siliconflow 部分）


@app.get("/vad/status")
def get_status():
    closed_websockets = set()
    for ws in vad_state["active_websockets"]:
        try:
            if ws.client_state.state.name == "DISCONNECTED":
                closed_websockets.add(ws)
        except:
            closed_websockets.add(ws)

    for ws in closed_websockets:
        vad_state["active_websockets"].remove(ws)

    return {
        "is_running": bool(vad_state["active_websockets"]),
        "active_connections": len(vad_state["active_websockets"])
    }


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=1000)
