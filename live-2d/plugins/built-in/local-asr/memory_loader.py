"""仅在 ASR 模型初始化期间替换 FunASR 的权重加载器，避免整份深拷贝。"""
from contextlib import contextmanager
import gc
import importlib
import logging


def load_local_weights(path, model, ignore_init_mismatch=True, map_location='cpu',
                       oss_bucket=None, scope_map=None, excludes=None, **kwargs):
    import torch

    if oss_bucket is not None:
        raise ValueError('本地 ASR 插件只支持已安装的本地模型')
    checkpoint = torch.load(path, map_location=map_location, weights_only=True, mmap=True)
    source = checkpoint
    for key in ('state_dict', 'model_state_dict', 'model'):
        if key in source:
            source = source[key]
    destination = model.state_dict()
    scopes = scope_map.split(',') if isinstance(scope_map, str) else list(scope_map or [])
    scopes += ['module.', 'None']
    excluded = excludes.split(',') if isinstance(excludes, str) else list(excludes or [])
    if len(scopes) % 2:
        raise ValueError('scope_map 必须成对声明')
    for key in destination:
        if any(key.startswith(prefix) for prefix in excluded):
            continue
        source_key = key
        for index in range(0, len(scopes), 2):
            src = '' if scopes[index].lower() == 'none' else scopes[index]
            dst = '' if scopes[index + 1].lower() == 'none' else scopes[index + 1]
            if dst == '' and src + key in source:
                source_key = src + key
            elif key.startswith(dst):
                candidate = key.replace(dst, src, 1)
                if candidate in source:
                    source_key = candidate
        if source_key not in source:
            logging.warning('模型权重缺少参数: %s', key)
            continue
        if ignore_init_mismatch and destination[key].shape != source[source_key].shape:
            logging.warning('跳过维度不一致的模型参数: %s', key)
            continue
        destination[key] = source[source_key]
    # 保持 FunASR 的参数拷贝语义；mmap 权重不占用同等大小的匿名内存。
    result = model.load_state_dict(destination, strict=True)
    del destination, source, checkpoint
    gc.collect()
    return result


@contextmanager
def memory_efficient_loading():
    module = importlib.import_module('funasr.auto.auto_model')
    original = module.load_pretrained_model
    module.load_pretrained_model = load_local_weights
    try:
        yield
    finally:
        module.load_pretrained_model = original
        gc.collect()
