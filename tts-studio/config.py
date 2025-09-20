import sys,os

import torch

# 导入设备检测工具
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from device_utils import get_optimal_device, get_device_info
    DEVICE, DEVICE_TYPE = get_optimal_device()
    device_info = get_device_info()
    print(f"TTS推理设备: {DEVICE} (类型: {DEVICE_TYPE})")
    infer_device = DEVICE_TYPE if DEVICE_TYPE in ['cuda', 'cpu'] else 'cpu'  # DirectML映射到cpu用于兼容性
except ImportError:
    # 如果导入失败，使用原有的设备检测逻辑
    if torch.cuda.is_available():
        infer_device = "cuda"
    else:
        infer_device = "cpu"

# 推理用的指定模型
sovits_path = ""
gpt_path = ""
is_half_str = os.environ.get("is_half", "True")
is_half = True if is_half_str.lower() == 'true' else False
is_share_str = os.environ.get("is_share","False")
is_share= True if is_share_str.lower() == 'true' else False

cnhubert_path = "GPT_SoVITS/pretrained_models/chinese-hubert-base"
bert_path = "GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large"
pretrained_sovits_path = "GPT_SoVITS/pretrained_models/s2G488k.pth"
pretrained_gpt_path = "GPT_SoVITS/pretrained_models/s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt"

exp_root = "logs"
python_exec = sys.executable or "python"

# 设备检测逻辑已经在上面处理，这里注释掉原有逻辑
# if torch.cuda.is_available():
#     infer_device = "cuda"
# else:
#     infer_device = "cpu"

webui_port_main = 9874
webui_port_uvr5 = 9873
webui_port_infer_tts = 9872
webui_port_subfix = 9871

api_port = 9880

if infer_device == "cuda":
    gpu_name = torch.cuda.get_device_name(0)
    if (
            ("16" in gpu_name and "V100" not in gpu_name.upper())
            or "P40" in gpu_name.upper()
            or "P10" in gpu_name.upper()
            or "1060" in gpu_name
            or "1070" in gpu_name
            or "1080" in gpu_name
    ):
        is_half=False
elif DEVICE_TYPE == 'directml':
    # DirectML 设备通常使用半精度会更好
    is_half = True

if(infer_device=="cpu"):is_half=False

class Config:
    def __init__(self):
        self.sovits_path = sovits_path
        self.gpt_path = gpt_path
        self.is_half = is_half

        self.cnhubert_path = cnhubert_path
        self.bert_path = bert_path
        self.pretrained_sovits_path = pretrained_sovits_path
        self.pretrained_gpt_path = pretrained_gpt_path

        self.exp_root = exp_root
        self.python_exec = python_exec
        self.infer_device = infer_device

        self.webui_port_main = webui_port_main
        self.webui_port_uvr5 = webui_port_uvr5
        self.webui_port_infer_tts = webui_port_infer_tts
        self.webui_port_subfix = webui_port_subfix

        self.api_port = api_port
