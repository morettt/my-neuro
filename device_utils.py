"""
设备检测工具模块 - 支持 CUDA、DirectML 和 CPU 推理
Device Detection Utility Module - Supports CUDA, DirectML and CPU inference
"""

import torch
import os
import logging

# 设置日志
logger = logging.getLogger(__name__)

# 全局设备缓存
_device_cache = None
_device_type_cache = None


def get_optimal_device():
    """
    获取最优的推理设备
    Get the optimal inference device
    
    优先级顺序 Priority order:
    1. CUDA (NVIDIA GPUs)
    2. DirectML (AMD GPUs and other DirectX 12 compatible devices) 
    3. CPU (fallback)
    
    Returns:
        torch.device: 最优设备对象
        str: 设备类型 ('cuda', 'directml', 'cpu')
    """
    global _device_cache, _device_type_cache
    
    # 如果已经缓存了设备，直接返回
    if _device_cache is not None and _device_type_cache is not None:
        return _device_cache, _device_type_cache
    
    device = None
    device_type = None
    
    # 检查环境变量强制指定设备
    forced_device = os.environ.get('INFERENCE_DEVICE', '').lower()
    if forced_device in ['cuda', 'directml', 'cpu']:
        logger.info(f"使用环境变量指定的设备: {forced_device}")
        if forced_device == 'cuda' and torch.cuda.is_available():
            device = torch.device('cuda')
            device_type = 'cuda'
        elif forced_device == 'directml':
            try:
                import torch_directml
                device = torch_directml.device()
                device_type = 'directml'
            except ImportError:
                logger.warning("torch-directml 未安装，无法使用 DirectML 设备")
        elif forced_device == 'cpu':
            device = torch.device('cpu')
            device_type = 'cpu'
    
    # 自动检测最优设备
    if device is None:
        # 1. 优先检查 CUDA (NVIDIA GPUs)
        if torch.cuda.is_available():
            device = torch.device('cuda')
            device_type = 'cuda'
            cuda_name = torch.cuda.get_device_name(0)
            logger.info(f"检测到 CUDA 设备: {cuda_name}")
        else:
            # 2. 检查 DirectML (AMD GPUs and other DirectX 12 devices)
            try:
                import torch_directml
                if torch_directml.is_available():
                    device = torch_directml.device()
                    device_type = 'directml'
                    logger.info("检测到 DirectML 设备，适用于 AMD 显卡等")
                else:
                    raise RuntimeError("DirectML 不可用")
            except (ImportError, RuntimeError):
                # 3. 回退到 CPU
                device = torch.device('cpu')
                device_type = 'cpu'
                logger.info("使用 CPU 设备进行推理")
    
    # 缓存结果
    _device_cache = device
    _device_type_cache = device_type
    
    return device, device_type


def move_to_device(tensor_or_model, device=None):
    """
    将张量或模型移动到指定设备
    Move tensor or model to specified device
    
    Args:
        tensor_or_model: 要移动的张量或模型
        device: 目标设备，如果为None则使用最优设备
    
    Returns:
        移动到设备后的张量或模型
    """
    if device is None:
        device, _ = get_optimal_device()
    
    if hasattr(tensor_or_model, 'to'):
        return tensor_or_model.to(device)
    else:
        return tensor_or_model


def clear_device_cache():
    """
    清理设备缓存
    Clear device cache (memory cleanup)
    """
    device, device_type = get_optimal_device()
    
    if device_type == 'cuda':
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            logger.debug("清理 CUDA 缓存")
    elif device_type == 'directml':
        # DirectML 的内存管理由底层驱动处理
        # DirectML memory management is handled by the underlying driver
        logger.debug("DirectML 内存管理由系统处理")
    
    # CPU 不需要特殊的缓存清理
    # CPU doesn't need special cache clearing


def get_device_info():
    """
    获取当前设备信息
    Get current device information
    
    Returns:
        dict: 设备信息字典
    """
    device, device_type = get_optimal_device()
    
    info = {
        'device': str(device),
        'device_type': device_type,
        'is_gpu': device_type in ['cuda', 'directml']
    }
    
    if device_type == 'cuda':
        info['gpu_name'] = torch.cuda.get_device_name(0)
        info['gpu_memory'] = torch.cuda.get_device_properties(0).total_memory
    elif device_type == 'directml':
        try:
            import torch_directml
            info['directml_device'] = torch_directml.device_name()
        except:
            info['directml_device'] = "DirectML Device"
    
    return info


# 兼容性函数 - 向后兼容旧的使用方式
def get_device():
    """向后兼容：获取设备对象"""
    device, _ = get_optimal_device()
    return device


def get_device_type():
    """获取设备类型字符串"""
    _, device_type = get_optimal_device()
    return device_type


def is_gpu_available():
    """检查是否有可用的GPU设备（CUDA或DirectML）"""
    _, device_type = get_optimal_device()
    return device_type in ['cuda', 'directml']


if __name__ == "__main__":
    # 测试设备检测
    logging.basicConfig(level=logging.INFO)
    device, device_type = get_optimal_device()
    print(f"最优设备: {device} (类型: {device_type})")
    
    info = get_device_info()
    print("设备信息:", info)