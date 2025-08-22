from fastapi import FastAPI, HTTPException
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
from pydantic import BaseModel
import os
import sys
import re
import logging
from pathlib import Path

# Fixed: 添加日志配置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/bert.log', encoding='utf-8'),
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

log_file = open(os.path.join(LOGS_DIR, 'bert.log'), 'w', encoding='utf-8')
sys.stdout = TeeOutput(original_stdout, log_file)
sys.stderr = TeeOutput(original_stderr, log_file)

app = FastAPI()

class TextInput(BaseModel):
    text: str

# 全局变量
model = None
tokenizer = None
model_loaded = False

# 检测是否有可用的GPU
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
logger.info(f"Using device: {device}")

# 标签映射
label_mapping = {"0": "否", "1": "是"}

def load_model():
    """加载模型"""
    global model, tokenizer, model_loaded
    
    try:
        # 固定的模型路径
        model_path = "omni_bert"
        
        if not os.path.exists(model_path):
            logger.error(f"模型路径不存在: {model_path}")
            return False
            
        logger.info("正在加载BERT模型...")
        tokenizer = AutoTokenizer.from_pretrained(model_path)
        model = AutoModelForSequenceClassification.from_pretrained(model_path)

        # 将模型移动到GPU
        model = model.to(device)
        model.eval()
        
        model_loaded = True
        logger.info("BERT模型加载完成")
        return True
        
    except Exception as e:
        logger.error(f"BERT模型加载失败: {e}")
        model_loaded = False
        return False

@app.on_event("startup")
async def startup_event():
    """服务启动时加载模型"""
    if not load_model():
        logger.error("模型加载失败，服务启动失败")
        return
    logger.info("BERT API服务启动完成")

@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {
        "status": "healthy" if model_loaded else "unhealthy",
        "model_loaded": model_loaded,
        "device": str(device),
        "cuda_available": torch.cuda.is_available()
    }

@app.post("/classify")
async def classify_emotion(input_data: TextInput):
    """情感分类接口"""
    if not model_loaded or model is None or tokenizer is None:
        raise HTTPException(status_code=500, detail="模型未加载")
    
    if not input_data.text.strip():
        raise HTTPException(status_code=400, detail="输入文本不能为空")
    
    try:
        text = input_data.text
        
        # 预测
        inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=512)
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = model(**inputs)
            probabilities = torch.sigmoid(outputs.logits).cpu().numpy()[0]
            predictions = (probabilities > 0.5).astype(int)

        # 转换为文本标签并分开返回
        result_labels = [label_mapping[str(pred)] for pred in predictions]

        # 返回分开的标签结果
        return {
            "text": text,
            "Vision": result_labels[0],  # 第一个标签
            "core memory": result_labels[1]  # 第二个标签
        }
        
    except Exception as e:
        logger.error(f"情感分类失败: {e}")
        raise HTTPException(status_code=500, detail=f"分类失败: {str(e)}")

@app.get("/")
async def root():
    """根路径接口"""
    return {
        "message": "BERT API服务运行中",
        "model_loaded": model_loaded,
        "device": str(device)
    }

if __name__ == "__main__":
    import uvicorn
    try:
        uvicorn.run(app, host="0.0.0.0", port=6007)
    except Exception as e:
        logger.error(f"启动BERT服务失败: {e}")
        sys.exit(1)
