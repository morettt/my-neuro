# DirectML 支持说明文档

## 概述

本项目现已支持 DirectML，使得 AMD 显卡、Intel 显卡等非 NVIDIA 显卡用户也能使用 GPU 加速推理。DirectML 是微软开发的机器学习框架，支持所有兼容 DirectX 12 的显卡。

## 支持的设备类型

1. **CUDA (NVIDIA 显卡)** - 优先级最高，提供最佳性能
2. **DirectML (AMD/Intel 等显卡)** - 支持 AMD RX 系列、Intel Arc 系列等
3. **CPU** - 兜底方案，适用于没有独立显卡的情况

## 安装要求

### 基础要求

- Windows 10 版本 1903 (19H1) 或更高版本
- 支持 DirectX 12 的显卡
- 至少 4GB 系统内存，推荐 8GB 或更多

### AMD 显卡要求

- AMD Radeon RX 5000 系列或更新
- AMD Radeon RX Vega 系列
- 最新的 AMD 显卡驱动程序

### Intel 显卡要求

- Intel Arc 系列显卡
- Intel Iris Xe 集成显卡
- 最新的 Intel 显卡驱动程序

## 安装步骤

### 1. 安装 DirectML

项目的 `requirements.txt` 已经包含了 `torch-directml`，安装依赖时会自动安装：

```bash
pip install -r requirements.txt
```

### 2. 手动安装 DirectML（如果自动安装失败）

```bash
pip install torch-directml
```

### 3. 验证 DirectML 安装

运行测试脚本验证 DirectML 是否正确安装：

```bash
python test_directml.py
```

## 使用方式

### 自动设备检测

项目会自动检测并选择最佳可用设备：

1. 如果有 NVIDIA 显卡且 CUDA 可用，优先使用 CUDA
2. 如果没有 CUDA 但有 DirectML，使用 DirectML
3. 如果都不可用，回退到 CPU

### 手动指定设备

通过环境变量强制指定使用的设备：

```bash
# 强制使用 DirectML
set INFERENCE_DEVICE=directml
python your_script.py

# 强制使用 CUDA
set INFERENCE_DEVICE=cuda
python your_script.py

# 强制使用 CPU
set INFERENCE_DEVICE=cpu
python your_script.py
```

### Linux/macOS 用户

```bash
export INFERENCE_DEVICE=directml
python your_script.py
```

## 性能对比

| 设备类型 | 相对性能 | 内存使用 | 兼容性 |
|---------|---------|---------|--------|
| NVIDIA RTX 4090 | 100% | 高 | 最佳 |
| NVIDIA RTX 3070 | 80% | 中等 | 最佳 |
| AMD RX 7800 XT | 60-70% | 中等 | 良好 |
| AMD RX 6700 XT | 50-60% | 中等 | 良好 |
| Intel Arc A770 | 40-50% | 中等 | 良好 |
| CPU (i7-12700K) | 20% | 低 | 完美 |

*性能数据仅供参考，实际性能取决于具体模型和任务*

## 故障排除

### DirectML 安装失败

1. 确保 Windows 版本支持（Windows 10 1903+）
2. 更新显卡驱动到最新版本
3. 尝试手动安装：
   ```bash
   pip install --upgrade torch-directml
   ```

### DirectML 运行失败

1. 检查显卡是否支持 DirectX 12
2. 运行 `dxdiag` 确认 DirectX 12 可用
3. 尝试重启系统
4. 检查系统内存是否足够

### 性能不佳

1. 确保显卡驱动是最新版本
2. 关闭其他占用 GPU 的程序
3. 适当调整模型精度设置
4. 监控 GPU 内存使用情况

### 兼容性问题

如果 DirectML 出现问题，可以通过环境变量强制使用 CPU：

```bash
set INFERENCE_DEVICE=cpu
```

## 支持的功能模块

- ✅ **LLM 推理** - 大语言模型推理完全支持 DirectML
- ✅ **TTS 推理** - 语音合成推理支持 DirectML
- ✅ **BigVGAN 推理** - 音频生成推理支持 DirectML
- ✅ **Fine-tuning** - 模型微调支持 DirectML（实验性）

## 已知限制

1. DirectML 性能通常低于同级别 NVIDIA 显卡的 CUDA
2. 某些高级 PyTorch 功能可能不支持
3. 内存管理可能不如 CUDA 优化
4. 首次运行可能需要较长时间进行优化

## 更新记录

- **v1.0** - 初始 DirectML 支持
  - 支持自动设备检测
  - 支持 LLM、TTS、BigVGAN 推理
  - 添加设备工具模块

## 反馈和支持

如果在使用 DirectML 时遇到问题，请：

1. 运行 `test_directml.py` 获取详细设备信息
2. 在 GitHub Issue 中提供设备信息和错误日志
3. 加入 QQ 群：756741478 寻求帮助

## 贡献

欢迎提交 DirectML 相关的改进和优化！