from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from funasr import AutoModel
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
MODEL_DIR = os.path.join("asr-hub", "model")
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

# 初始化模型状态
model_state = {
    "vad_model": None,
    "asr_model": None,
    "punc_model": None
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
    print("正在加载模型...")

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

    # 设置环境变量来指定模型下载位置
    asr_model_path = os.path.join(MODEL_DIR, "asr")
    if not os.path.exists(asr_model_path):
        os.makedirs(asr_model_path)

    # 保存原始环境变量
    original_modelscope_cache = os.environ.get('MODELSCOPE_CACHE', '')
    original_funasr_home = os.environ.get('FUNASR_HOME', '')

    # 设置环境变量
    os.environ['MODELSCOPE_CACHE'] = asr_model_path
    os.environ['FUNASR_HOME'] = MODEL_DIR

    # 加载ASR模型
    print("正在加载ASR模型...")
    model_state["asr_model"] = AutoModel(
        model="iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        device=device,
        model_type="pytorch",
        dtype="float32"
    )
    print("ASR模型加载完成")

    # 加载标点符号模型
    print("正在加载标点符号模型...")
    model_state["punc_model"] = AutoModel(
        model="ct-punc",
        model_revision="v2.0.4",
        device=device,
        model_type="pytorch",
        dtype="float32"
    )

    # 恢复原始环境变量
    if original_modelscope_cache:
        os.environ['MODELSCOPE_CACHE'] = original_modelscope_cache
    else:
        os.environ.pop('MODELSCOPE_CACHE', None)

    if original_funasr_home:
        os.environ['FUNASR_HOME'] = original_funasr_home
    else:
        os.environ.pop('FUNASR_HOME', None)
    print("标点符号模型加载完成")

    vad_state["model"] = model_state["vad_model"]


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


@app.post("/v1/upload_audio")
async def upload_audio(file: UploadFile = File(...)):
    try:
        # 直接读取音频数据到内存
        audio_bytes = await file.read()

        # 使用 soundfile 或 librosa 直接从内存中解析音频
        import io
        try:
            import soundfile as sf
            # 直接从内存中读取音频数据
            audio_data, sample_rate = sf.read(io.BytesIO(audio_bytes))
            print(f"音频数据形状: {audio_data.shape}, 采样率: {sample_rate}")
        except ImportError:
            print("soundfile 不可用，尝试使用 librosa")
            try:
                import librosa
                audio_data, sample_rate = librosa.load(io.BytesIO(audio_bytes), sr=16000)
                print(f"音频数据形状: {audio_data.shape}, 采样率: {sample_rate}")
            except ImportError:
                return {
                    "status": "error",
                    "message": "需要安装 soundfile 或 librosa 库来处理音频"
                }

        # 进行ASR处理 - 直接传入音频数组
        with torch.no_grad():
            # 语音识别 - 传入 numpy 数组而不是文件路径
            asr_result = model_state["asr_model"].generate(
                input=audio_data,  # 直接传入音频数组！
                dtype="float32"
            )

            # 添加标点符号
            if asr_result and len(asr_result) > 0:
                text_input = asr_result[0]["text"]
                final_result = model_state["punc_model"].generate(
                    input=text_input,
                    dtype="float32"
                )

                return {
                    "status": "success",
                    "filename": file.filename or "uploaded_audio",
                    "text": final_result[0]["text"] if final_result else text_input
                }
            else:
                return {
                    "status": "error",
                    "filename": file.filename or "uploaded_audio",
                    "message": "语音识别失败"
                }

    except Exception as e:
        print(f"处理音频时出错: {str(e)}")
        return {
            "status": "error",
            "message": str(e)
        }


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