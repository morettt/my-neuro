"""ASR 资源布局，与旧版 full-hub 保持一致。"""
from pathlib import Path

ASR_ID = "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
PUNC_ID = "iic/punc_ct-transformer_cn-en-common-vocab471067-large"
COMPONENTS = (
    {"name": "VAD 模型", "repo": "morelle/my-neuro-vad", "path": "asr-hub/model/torch_hub",
     "files": ("snakers4_silero-vad_master/hubconf.py",)},
    {"name": "ASR 主模型", "repo": ASR_ID, "path": f"asr-hub/model/asr/models/{ASR_ID}",
     "files": ("config.yaml", "model.pt")},
    {"name": "标点模型", "repo": PUNC_ID, "revision": "v2.0.4", "path": f"asr-hub/model/asr/models/{PUNC_ID}",
     "files": ("config.yaml", "model.pt")},
)


def component_ready(root, component):
    return all((Path(root) / component["path"] / name).is_file() for name in component["files"])


def resources_ready(root):
    return all(component_ready(root, component) for component in COMPONENTS)


def model_paths(root):
    root = Path(root)
    return {
        "vad": root / COMPONENTS[0]["path"] / "snakers4_silero-vad_master",
        "asr": root / COMPONENTS[1]["path"],
        "punc": root / COMPONENTS[2]["path"],
    }
