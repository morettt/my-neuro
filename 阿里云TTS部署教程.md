# 阿里云 TTS 部署教程（my-neuro 线上版）

> 📌 **网页版（推荐）：** 打开 [`docs/guide-aliyun-tts.html`](docs/guide-aliyun-tts.html)

> 适用版本：**my-neuro v6.6**（线上安装包）  
> 最后更新：2026-07-03

---

## 一、概述

my-neuro 线上版已内置 **阿里云百炼 CosyVoice 语音合成** 支持。启用后，AI 角色的语音会通过阿里云云端实时合成，**无需在本机运行 `2.TTS.bat`（本地 GPT-SoVITS）**，也**不需要显卡**。

### 技术说明

| 项目 | 说明 |
|------|------|
| 云服务 | 阿里云百炼（DashScope） |
| 默认模型 | `cosyvoice-v3-flash` |
| 通信方式 | WebSocket 流式合成 |
| 配置文件 | `live-2d/config.json` → `cloud.aliyun_tts` |
| 图形化配置 | WebUI → **云端配置** → **阿里云 TTS** |

---

## 二、你需要准备什么

1. **阿里云账号**（需完成实名认证）
2. **百炼 API Key**（格式类似 `sk-xxxxxxxx`）
3. **音色 ID**（二选一）：
   - **系统预设音色**：如 `longanyang`、`longanhuan`，开箱即用
   - **声音复刻音色**：上传 10~20 秒参考音频，克隆专属角色声线
4. **网络连接**：需能访问 `dashscope.aliyuncs.com`

---

## 三、开通百炼并获取 API Key

### 步骤 1：进入百炼控制台

1. 打开 [阿里云百炼控制台](https://bailian.console.aliyun.com/)
2. 首次使用需开通「大模型服务平台百炼」服务

### 步骤 2：创建 API Key

1. 在控制台右上角或左侧菜单找到 **API-KEY 管理**
2. 点击 **创建 API Key**
3. 选择地域：**华北2（北京）**（my-neuro 默认连接北京节点）
4. 复制生成的 Key（以 `sk-` 开头），妥善保存

> **注意**：北京与新加坡的 API Key **不通用**。本教程及 my-neuro 默认使用北京地域。

官方文档：[获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)

---

## 四、获取音色 ID

你有两种方式获取「声音 ID」。

### 方式 A：使用系统预设音色（推荐新手快速体验）

无需上传音频，直接使用官方内置音色。

1. 打开 [CosyVoice 音色列表（官方）](https://help.aliyun.com/zh/model-studio/multimodal-timbre-list)
2. 在 **CosyVoice-v3-Flash** 分类下选择音色
3. 复制对应的 **voice 参数**（即声音 ID）

常用示例：

| 音色名称 | 声音 ID | 特点 |
|----------|---------|------|
| 龙安洋 | `longanyang` | 阳光大男孩，普通话 + 英文 |
| 龙安欢 | `longanhuan` | 欢脱元气女，普通话 + 英文 |
| 龙安欢（V3） | `longanhuan_v3` | 支持多种方言 |
| 龙呼呼 | `longhuhu_v3` | 童声 |

> 模型名填 `cosyvoice-v3-flash`，声音 ID 填上表中的参数即可。

---

### 方式 B：声音复刻（克隆专属角色声线）

适合想复刻特定人物、虚拟角色声音的用户。

#### 1. 准备参考音频

| 要求 | 说明 |
|------|------|
| 格式 | WAV（16bit）、MP3、M4A |
| 时长 | 推荐 **10~20 秒**，最长不超过 60 秒 |
| 大小 | ≤ 10 MB |
| 采样率 | ≥ 16 kHz |
| 内容 | 清晰人声朗读，**无背景音乐、无环境噪音** |
| 语言 | 与目标合成语言一致（中文角色用中文朗读） |

录音建议：在安静小房间录制，距离麦克风约 10 cm，用完整句子连续朗读，避免频繁停顿。

#### 2. 上传音频到公网可访问地址

声音复刻 API 需要音频的 **公网 URL**。常见做法：

- 上传到 **阿里云 OSS**，设置公共读权限，复制文件 URL
- 或使用其他可公网直接下载的链接

#### 3. 调用 API 创建音色

在 PowerShell 或 CMD 中执行（请替换占位符）：

```powershell
curl -X POST "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization" ^
  -H "Authorization: Bearer sk-你的API_KEY" ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"voice-enrollment\",\"input\":{\"action\":\"create_voice\",\"target_model\":\"cosyvoice-v3-flash\",\"prefix\":\"myvoice\",\"url\":\"https://你的音频公网地址.wav\",\"language_hints\":[\"zh\"]}}"
```

**关键参数说明：**

| 参数 | 说明 |
|------|------|
| `target_model` | 必须与 my-neuro 中填写的模型名一致，推荐 `cosyvoice-v3-flash` |
| `prefix` | 音色名称前缀（仅英文字母/数字，≤ 10 字符） |
| `url` | 参考音频的公网 URL |

#### 4. 获取返回的 voice_id

请求成功后，响应中会包含 `voice_id`，格式类似：

```
cosyvoice-v3-flash-myvoice-xxxxxxxxxxxxxxxx
```

这就是 my-neuro 里要填的 **声音 ID**。

> **重要**：创建音色时指定的 `target_model` 必须与合成时使用的模型 **完全一致**，否则合成会失败。

官方文档：[声音复刻用户指南](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide)

---

## 五、在 my-neuro 中配置

### 方式 1：通过 WebUI 配置（推荐）

1. 进入安装目录下的 `live-2d` 文件夹
2. 双击运行 **`启动 WebUI 控制面板.bat`**
3. 浏览器打开控制面板后，进入 **云端配置** 选项卡
4. 点击子选项卡 **阿里云 TTS**
5. 填写以下信息：

| 配置项 | 填写内容 |
|--------|----------|
| 启用阿里云 TTS | ✅ 勾选 |
| API KEY | 你的百炼 API Key（`sk-...`） |
| 模型名 | `cosyvoice-v3-flash` |
| 声音 ID | 系统音色或复刻返回的 voice_id |

6. 点击 **保存配置**

同时请确认：

- **字节 TTS**（火山引擎）→ **不要勾选**
- **云端 TTS**（SiliconFlow 等）→ **不要勾选**
- **云端肥牛（启动全云端）** → **已弃用，请勿勾选**

> WebUI 中可能仍显示「云端肥牛」「RAG 服务」等旧选项，均已不可用，请忽略。

> TTS 优先级为：**字节 TTS > 阿里云 TTS > 云端 TTS > 本地 TTS**。若多个同时启用，只有优先级最高的会生效。

---

### 方式 2：直接编辑 config.json

打开 `live-2d/config.json`，找到 `cloud.aliyun_tts` 段，修改为：

```json
"aliyun_tts": {
  "enabled": true,
  "api_key": "sk-你的API_KEY",
  "model": "cosyvoice-v3-flash",
  "voice": "longanyang",
  "sample_rate": 48000,
  "volume": 50,
  "rate": 1,
  "pitch": 1
}
```

**高级参数**（仅 config.json 可配，WebUI 暂不支持）：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `sample_rate` | 48000 | 采样率（Hz） |
| `volume` | 50 | 音量（0~100） |
| `rate` | 1 | 语速（0.5~2.0） |
| `pitch` | 1 | 音调（0.5~2.0） |

同时确保以下项为 **关闭** 状态，避免冲突：

```json
"volcengine_tts": { "enabled": false },
"tts": { "enabled": false }
```

---

## 六、启动与验证

### 1. 启动 my-neuro

在 WebUI **服务控制** 中，建议按顺序启动：

1. **ASR 语音识别**
2. **记忆系统（MemOS）** — 线上版 **必做**，否则桌宠无法正常运行
3. **Live2D 主服务**

**使用阿里云 TTS 时，无需启动 `2.TTS.bat`**（本地 GPT-SoVITS 服务）。

### 2. 验证是否生效

1. 与 AI 角色对话，观察是否有语音输出
2. 打开 WebUI 的 **桌宠日志**，若失败会看到类似：
   - `阿里云TTS失败: ...`
   - `阿里云TTS WebSocket错误: ...`

### 3. 常见失败原因速查

| 现象 | 可能原因 | 解决方法 |
|------|----------|----------|
| 无声音，日志报 task-failed | API Key 错误或过期 | 重新创建 Key 并更新配置 |
| 无声音，报 voice 相关错误 | 声音 ID 与模型不匹配 | 确认复刻时的 `target_model` 与配置中 `model` 一致 |
| 用了阿里云配置但仍走本地 TTS | 字节/云端 TTS 同时启用 | 关闭其他云端 TTS 选项 |
| WebSocket 连接失败 | 网络无法访问 dashscope | 检查防火墙、代理、DNS |
| 复刻音色合成失败 | 1 年内未使用被自动清理 | 重新创建音色 |
| 余额不足 | 百炼账户欠费 | 在阿里云控制台充值 |

---

## 七、费用说明

| 项目 | 费用 |
|------|------|
| CosyVoice 声音复刻 | **免费** |
| CosyVoice 语音合成 | 按调用量计费，详见 [百炼定价](https://help.aliyun.com/zh/model-studio/billing) |
| 系统预设音色 | 按语音合成单价计费 |

新用户通常有免费额度，建议在百炼控制台查看当前账户余额与用量。

---

## 八、与本地 TTS 的对比

| 对比项 | 阿里云 TTS（云端） | 本地 GPT-SoVITS（2.TTS.bat） |
|--------|-------------------|------------------------------|
| 显卡要求 | 无 | 需要 NVIDIA 显卡 |
| 启动步骤 | 只需配置 Key | 需先启动 TTS 服务 |
| 声音定制 | 声音复刻 API | 本地训练/微调 |
| 延迟 | 依赖网络 | 本地通常更低 |
| 费用 | 按量付费 | 免费（自备硬件） |

---

## 九、参考链接

- [阿里云百炼控制台](https://bailian.console.aliyun.com/)
- [获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)
- [CosyVoice 音色列表](https://help.aliyun.com/zh/model-studio/multimodal-timbre-list)
- [声音复刻用户指南](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide)
- [声音复刻 HTTP API 参考](https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api)
- [my-neuro 官方教程站](http://mynewbot.com/tutorials)

---

## 十、配置示例（完整片段）

以下为一份可直接参考的配置示例（请替换 API Key 和声音 ID）：

```json
{
  "tts": {
    "enabled": true,
    "url": "http://127.0.0.1:5000",
    "language": "zh"
  },
  "cloud": {
    "volcengine_tts": {
      "enabled": false
    },
    "aliyun_tts": {
      "enabled": true,
      "api_key": "sk-你的API_KEY",
      "model": "cosyvoice-v3-flash",
      "voice": "longanyang",
      "sample_rate": 48000,
      "volume": 50,
      "rate": 1,
      "pitch": 1
    },
    "tts": {
      "enabled": false
    }
  }
}
```

> `tts.enabled` 保持 `true` 表示启用语音输出功能；实际合成引擎由 `cloud.aliyun_tts.enabled` 决定。

---

如有问题，可在 my-neuro 社区或 GitHub Issues 反馈。
