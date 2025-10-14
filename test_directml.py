#!/usr/bin/env python3
"""
测试 DirectML 设备检测和推理支持
Test DirectML device detection and inference support
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def test_device_detection():
    """测试设备检测功能"""
    print("=== 设备检测测试 ===")
    
    try:
        from device_utils import get_optimal_device, get_device_info, is_gpu_available
        
        device, device_type = get_optimal_device()
        print(f"检测到的最优设备: {device}")
        print(f"设备类型: {device_type}")
        
        device_info = get_device_info()
        print(f"设备信息: {device_info}")
        
        print(f"GPU可用: {is_gpu_available()}")
        
        return device, device_type
        
    except Exception as e:
        print(f"设备检测失败: {e}")
        return None, None

def test_torch_import():
    """测试 PyTorch 和 DirectML 导入"""
    print("\n=== PyTorch 和 DirectML 导入测试 ===")
    
    try:
        import torch
        print(f"PyTorch 版本: {torch.__version__}")
        print(f"CUDA 可用: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"CUDA 设备数量: {torch.cuda.device_count()}")
            print(f"CUDA 设备名称: {torch.cuda.get_device_name(0)}")
        
        try:
            import torch_directml
            print(f"DirectML 可用: {torch_directml.is_available()}")
            print(f"DirectML 设备: {torch_directml.device()}")
            if hasattr(torch_directml, 'device_name'):
                try:
                    print(f"DirectML 设备名称: {torch_directml.device_name()}")
                except:
                    print("DirectML 设备名称获取失败")
        except ImportError:
            print("torch-directml 未安装")
    
    except ImportError as e:
        print(f"PyTorch 导入失败: {e}")

def test_simple_inference():
    """测试简单推理"""
    print("\n=== 简单推理测试 ===")
    
    try:
        import torch
        from device_utils import get_optimal_device, move_to_device, clear_device_cache
        
        device, device_type = get_optimal_device()
        print(f"使用设备进行推理: {device}")
        
        # 创建简单张量
        x = torch.randn(2, 3, 4)
        print(f"原始张量在: {x.device}")
        
        # 移动到设备
        x = move_to_device(x, device)
        print(f"移动后张量在: {x.device}")
        
        # 简单计算
        y = x * 2 + 1
        print(f"计算结果张量在: {y.device}")
        print(f"计算结果形状: {y.shape}")
        
        # 清理缓存
        clear_device_cache()
        print("缓存清理完成")
        
    except Exception as e:
        print(f"推理测试失败: {e}")

def main():
    """主测试函数"""
    print("DirectML 支持测试脚本")
    print("=" * 50)
    
    test_torch_import()
    device, device_type = test_device_detection()
    
    if device is not None:
        test_simple_inference()
    else:
        print("设备检测失败，跳过推理测试")
    
    print("\n=== 测试完成 ===")

if __name__ == "__main__":
    main()