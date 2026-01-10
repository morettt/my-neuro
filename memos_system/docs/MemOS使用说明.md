# MemOS 记忆系统使用说明

## 🎉 集成完成！

MemOS 记忆系统已成功集成到肥牛AI项目中。

---

## 🚀 启动步骤

### 1. 启动 MemOS API 服务（必须）

**双击运行**: `MEMOS-API.bat`

```
========================================
  启动 MemOS 记忆服务 (端口: 8003)
========================================
```

等待看到 "✅ MemOS 服务启动成功!" 提示。

### 2. 启动肥牛主程序

正常启动肥牛AI（会自动连接 MemOS 服务）。

### 3. （可选）启动记忆管理 WebUI

**双击运行**: `MEMOS-WebUI.bat`

浏览器会自动打开 `http://localhost:8501`

---

## ✨ 新功能说明

### 1. 智能记忆召回

肥牛现在会自动记住并回忆相关内容：

```
你：我今天又熬夜了
肥牛：又熬夜？！你这个月已经熬了多少次了，不要命了是吧！<生气>
```

**原理**：每次对话前，系统自动检索相关记忆并注入到上下文中。

### 2. 主动吐槽能力

肥牛能根据历史记忆吐槽您的矛盾行为：

```
你：这游戏挺好玩的
肥牛：哦？上周你不是还说这游戏是垃圾来着，怎么这么快就真香了？<俏皮>
```

### 3. Function Call 深度检索

AI 可以主动调用工具搜索记忆：

```
你：我之前跟你说过什么来着？
肥牛：（调用 memos_search_memory 工具）
      让我想想...你说过喜欢足球、讨厌早起、生日是5月1日...
```

### 4. WebUI 管理界面

在 WebUI 中可以：
- 🔍 搜索记忆（语义搜索）
- ➕ 添加/编辑/删除记忆
- 📥 从旧记忆库导入
- ⚙️ 调整召回策略

---

## 🔧 配置说明

### 主配置文件：`live-2d/config.json`

新增 `memos` 配置节：

```json
{
  "memos": {
    "enabled": true,              // 是否启用 MemOS
    "api_url": "http://127.0.0.1:8003",  // API 地址
    "auto_inject": true,          // 自动注入记忆到对话
    "inject_top_k": 3,            // 每次注入记忆数量
    "similarity_threshold": 0.6   // 相似度阈值
  }
}
```

### MemOS 配置文件：`memos_config.json`

```json
{
  "embedder": {
    "provider": "huggingface",
    "config": {
      "model": "./RAG-model",     // 使用现有 BGE 模型
      "device": "cuda"
    }
  },
  "llm": {
    "provider": "openai",
    "config": {
      "model": "gpt-4o-mini",     // 记忆加工模型
      "api_key": "...",
      "base_url": "..."
    }
  }
}
```

---

## 📂 数据存储位置

| 数据类型 | 存储位置 |
|---------|---------|
| 向量数据库 | `./memos_data/` |
| 旧记忆库 | `live-2d/AI记录室/记忆库.txt` |
| 对话历史 | `live-2d/AI记录室/对话历史.jsonl` |

---

## 🎯 迁移旧记忆

### 方式1：通过 WebUI（推荐）

1. 启动 `MEMOS-WebUI.bat`
2. 选择"📥 导入记忆"页面
3. 点击"🚀 一键导入"按钮

### 方式2：通过 API

```bash
curl -X POST http://127.0.0.1:8003/migrate \
  -H "Content-Type: application/json" \
  -d '{"file_path": "./live-2d/AI记录室/记忆库.txt"}'
```

---

## 🔍 工作原理

```
用户说话
    ↓
MemOS 检索相关记忆（top 3）
    ↓
动态注入到对话上下文
    ↓
LLM 生成回复（带记忆回忆）
    ↓
对话自动添加到 MemOS
```

---

## ⚠️ 注意事项

1. **必须先启动 MemOS API**：否则记忆功能无效
2. **首次使用需要导入旧记忆**：否则记忆库为空
3. **端口占用**：确保 8003 和 8501 端口未被占用
4. **显存占用**：embedding 模型使用 GPU，需要显存

---

## 🐛 常见问题

### Q: 记忆注入不生效？
A: 检查 `config.json` 中 `memos.enabled` 是否为 `true`

### Q: WebUI 无法打开？
A: 确保已安装 streamlit：`pip install streamlit`

### Q: API 连接失败？
A: 检查 MEMOS-API.bat 是否正在运行

---

## 📞 技术支持

- MemOS GitHub: https://github.com/MemTensor/MemOS
- MemOS 文档: https://memos-docs.openmem.net

---

*集成完成时间：2025年12月20日*

