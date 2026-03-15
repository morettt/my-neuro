# MemOS 长期记忆插件

让 AI 拥有跨会话的长期记忆能力，基于 [MemOS](../../memos_system/) 后端（Qdrant 向量 + NetworkX 知识图谱 + BM25 混合检索）。

## 快速开始

1. 启动 MemOS 后端：运行 `memos_system/start_memos.bat`（首次启动需等待 Embedding 模型加载）
2. 在插件配置页面确认 **启用 MemOS** 为开启状态
3. 确认 **MemOS API 地址** 为 `http://127.0.0.1:8003`
4. 开始对话即可，插件会自动检索和保存记忆

## 配置说明

### 前端配置（插件行为）

| 配置项 | 说明 |
|--------|------|
| 启用 MemOS | 总开关，关闭后所有记忆功能停用 |
| MemOS API 地址 | 后端服务地址，默认 `http://127.0.0.1:8003` |
| 自动注入记忆 | 用户说话时自动检索相关记忆注入到系统提示词 |
| 注入记忆条数 | 每次注入的最大记忆条数，默认 3 |
| 相似度阈值 | 低于此值的记忆不注入，默认 0.6 |
| 自动保存对话 | LLM 回复后自动累积保存对话到长期记忆 |
| 保存间隔 | 每隔多少轮对话批量保存一次，默认 5 轮 |

### 后端配置（MemOS 服务）

以下配置会在插件启动时自动同步到 `memos_system/config/memos_config.json`，无需手动编辑后端配置文件。

| 配置项 | 说明 |
|--------|------|
| 后端 LLM 模型 / API Key / Base URL | MemOS 后端用于总结对话、提取实体的 LLM |
| 后端备用 LLM | 主 LLM 失败时的自动切换备用模型 |
| 启用 BM25 混合检索 | 开启向量 + 关键词双路检索，提升召回率 |
| BM25 权重 | BM25 在混合检索中的占比，默认 0.3 |
| 启用知识图谱增强 | 利用实体关系图谱扩展检索结果 |
| 自动实体提取 | 添加记忆时提取人名、地点等实体到知识图谱 |
| 图片记忆 | 启用图片上传、截图保存等功能 |
| 图片自动描述 | 上传图片时自动用 LLM 生成描述文本 |

## 主要功能

### 自动记忆注入

用户每次说话时，插件自动从后端检索相关记忆并注入到系统提示词。AI 无需调用工具就能"回忆起"历史信息。

### 自动对话保存

LLM 回复后，插件自动将对话累积到缓存，每 N 轮批量发送到后端，由后端 LLM 总结提取后存入向量库。程序退出时会自动保存未达到间隔的缓存。

### Function Call 工具

插件提供 12 个工具，AI 可主动调用：

| 工具 | 功能 |
|------|------|
| `memos_search_memory` | 深度搜索历史记忆 |
| `memos_add_memory` | 手动添加重要信息 |
| `memos_upload_image` | 上传图片到记忆 |
| `memos_search_images` | 搜索图片记忆 |
| `memos_save_screenshot` | 截屏并保存到记忆 |
| `memos_save_image_from_file` | 从本地文件保存图片 |
| `memos_record_tool_usage` | 记录工具使用情况 |
| `memos_search_tool_usage` | 搜索工具使用记录 |
| `memos_import_url` | 导入网页内容到记忆 |
| `memos_import_document` | 导入文档（txt/pdf/md） |
| `memos_correct_memory` | 修正/补充/删除记忆 |
| `memos_get_preferences` | 查询用户偏好摘要 |

## 后端服务

MemOS 后端是一个独立的 Python FastAPI 服务，提供 60+ 个 API 端点。

### 启动方式

```bash
# Windows
memos_system\start_memos.bat

# 或 PowerShell
memos_system\start_memos.ps1
```

### 技术栈

- **向量存储**：Qdrant（本地嵌入式）
- **知识图谱**：NetworkX（轻量图存储）
- **混合检索**：向量相似度 + BM25 关键词 + 图谱增强
- **Embedding**：SentenceTransformer（本地模型）
- **记忆处理**：LLM 自动总结、去重、合并、分类

### Web 管理界面

```bash
memos_system\启动WebUI_v3.bat
```

可在浏览器中管理所有记忆、查看知识图谱、测试检索效果。

## 常见问题

**Q: 启动后提示 "MemOS 服务不可用"？**
A: 确保先运行了 `start_memos.bat`，等待 "Embedding 模型已加载" 日志出现后再启动主程序。

**Q: 记忆为什么没有立即保存？**
A: 插件使用批量保存策略，默认每 5 轮对话保存一次。可在配置中调整保存间隔，或程序退出时会自动保存。

**Q: 修改了后端配置为什么没生效？**
A: 插件配置页的后端设置会在下次启动时自动同步。如果需要立即生效，请重启 MemOS 后端服务。
