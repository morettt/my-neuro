from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from funasr import AutoModel
import torch
import json
import numpy as np
import os
import sys
import re
import logging
from datetime import datetime
from queue import Queue
from modelscope.hub.snapshot_download import snapshot_download
from pathlib import Path

# Fixed: 添加日志配置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/asr.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

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
log_file = open(os.path.join(LOGS_DIR, 'asr.log'), 'w', encoding='utf-8')  # 保存到logs文件夹
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

# 创建存储音频文件的目录
AUDIO_DIR = "recorded_audio"
if not os.path.exists(AUDIO_DIR):
    os.makedirs(AUDIO_DIR)

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

# 初始化模型状态
model_state = {
    "vad_model": None,
    "asr_model": None,
    "punc_model": None
}

def download_vad_models():
    """下载asr的vad"""
    try:
        vad_dir = os.getcwd()
        target_dir = os.path.join(vad_dir, 'model', 'torch_hub')
        os.makedirs(target_dir, exist_ok=True)

        logger.info("开始下载VAD模型...")
        model_dir = snapshot_download('morelle/my-neuro-vad', local_dir=target_dir)
        logger.info(f'已将asr vad下载到{model_dir}')
        return True
    except Exception as e:
        logger.error(f"下载VAD模型失败: {e}")
        return False

def load_vad_model():
    """加载VAD模型"""
    try:
        # 检查VAD模型目录是否存在
        torch_hub_dir = os.path.join(MODEL_DIR, "torch_hub")
        local_vad_path = os.path.join(torch_hub_dir, "snakers4_silero-vad_master")

        # 如果VAD模型目录不存在，则下载
        if not os.path.exists(local_vad_path):
            logger.info("未找到VAD模型目录，开始下载...")
            if not download_vad_models():
                return False
        else:
            logger.info("VAD模型目录已存在，跳过下载步骤")

        # 加载VAD模型（严格本地模式，避免torch.hub解析路径）
        logger.info("正在从本地加载VAD模型...")
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
        logger.info("VAD模型加载完成")
        return True
    except Exception as e:
        logger.error(f"VAD模型加载失败: {str(e)}")
        return False

def load_asr_model():
    """加载ASR模型"""
    try:
        # 设置环境变量来指定模型下载位置
        # 尝试多个可能的环境变量名以提高兼容性
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
        logger.info("正在加载ASR模型...")
        model_state["asr_model"] = AutoModel(
            model="iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
            device=device,
            model_type="pytorch",
            dtype="float32"
        )
        logger.info("ASR模型加载完成")

        # 恢复原始环境变量
        if original_modelscope_cache:
            os.environ['MODELSCOPE_CACHE'] = original_modelscope_cache
        else:
            os.environ.pop('MODELSCOPE_CACHE', None)
            
        if original_funasr_home:
            os.environ['FUNASR_HOME'] = original_funasr_home
        else:
            os.environ.pop('FUNASR_HOME', None)
            
        return True
    except Exception as e:
        logger.error(f"ASR模型加载失败: {e}")
        return False

def load_punc_model():
    """加载标点符号模型"""
    try:
        logger.info("正在加载标点符号模型...")
        model_state["punc_model"] = AutoModel(
            model="ct-punc",
            model_revision="v2.0.4",
            device=device,
            model_type="pytorch",
            dtype="float32"
        )
        logger.info("标点符号模型加载完成")
        return True
    except Exception as e:
        logger.error(f"标点符号模型加载失败: {e}")
        return False

# 使用 FastAPI 的生命周期事件装饰器
@app.on_event("startup")
async def startup_event():
    logger.info("正在加载模型...")

    # 加载VAD模型
    if not load_vad_model():
        logger.error("VAD模型加载失败，服务启动失败")
        return

    # 加载ASR模型
    if not load_asr_model():
        logger.error("ASR模型加载失败，服务启动失败")
        return

    # 加载标点符号模型
    if not load_punc_model():
        logger.warning("标点符号模型加载失败，将使用无标点模式")

    logger.info("所有模型加载完成")

@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {
        "status": "healthy",
        "vad_model_loaded": model_state["vad_model"] is not None,
        "asr_model_loaded": model_state["asr_model"] is not None,
        "punc_model_loaded": model_state["punc_model"] is not None,
        "device": device,
        "cuda_available": torch.cuda.is_available()
    }

@app.post("/v1/upload_audio")
async def upload_audio(file: UploadFile = File(...)):
    """上传音频文件进行识别"""
    try:
        if not model_state["asr_model"]:
            raise HTTPException(status_code=500, detail="ASR模型未加载")

        # 保存上传的文件
        file_path = os.path.join(AUDIO_DIR, f"upload_{datetime.now().strftime('%Y%m%d_%H%M%S')}.wav")
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)

        # 进行语音识别
        result = model_state["asr_model"].generate(input=file_path)
        
        # 提取识别结果
        if result and len(result) > 0:
            text = result[0]['text']
            
            # 如果有标点符号模型，进行标点符号处理
            if model_state["punc_model"]:
                try:
                    punc_result = model_state["punc_model"].generate(input=text)
                    if punc_result and len(punc_result) > 0:
                        text = punc_result[0]['text']
                except Exception as e:
                    logger.warning(f"标点符号处理失败: {e}")

            # 清理临时文件
            try:
                os.remove(file_path)
            except:
                pass

            return {"text": text}
        else:
            return {"text": ""}

    except Exception as e:
        logger.error(f"音频识别失败: {e}")
        raise HTTPException(status_code=500, detail=f"识别失败: {str(e)}")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket接口用于实时语音识别"""
    await websocket.accept()
    try:
        while True:
            # 接收音频数据
            data = await websocket.receive_bytes()
            
            # 这里可以添加实时语音识别的逻辑
            # 目前只是简单的回显
            await websocket.send_text(f"收到音频数据，长度: {len(data)}")
            
    except WebSocketDisconnect:
        logger.info("WebSocket连接断开")
    except Exception as e:
        logger.error(f"WebSocket处理错误: {e}")

if __name__ == "__main__":
    import uvicorn
    try:
        uvicorn.run(app, host="0.0.0.0", port=1000)
    except Exception as e:
        logger.error(f"启动ASR服务失败: {e}")
        sys.exit(1)
