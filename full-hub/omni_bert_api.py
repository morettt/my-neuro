from fastapi import FastAPI
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
from pydantic import BaseModel
import os
import sys
import re

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

# 检测是否有可用的GPU
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

# 标签映射
label_mapping = {"0": "否", "1": "是"}

# 固定的模型路径
model_path = "bert-hub"
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModelForSequenceClassification.from_pretrained(model_path)

# 将模型移动到GPU
model = model.to(device)
model.eval()

@app.post("/classify")
async def classify_emotion(input_data: TextInput):
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=6007)