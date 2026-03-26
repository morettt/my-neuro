# MemOS 记忆系统 v2.0

为 [my-neuro](https://github.com/morettt/my-neuro) 提供跨会话长期记忆能力的后端服务，基于 Qdrant 向量数据库 + NetworkX 知识图谱 + BM25 关键词混合检索。

## 功能特性

- **向量 + BM25 混合检索**：语义相似度与关键词双路召回，提高检索准确率
- **知识图谱增强**：自动从对话中提取实体和关系，构建 NetworkX 图谱辅助检索
- **图片记忆**：支持截图/图片上传，LLM 自动生成描述文本，支持语义搜索图片
- **偏好系统**：自动学习用户喜好（食物、游戏、音乐等），提供偏好查询 API
- **工具使用记录**：记录 AI 工具调用历史，支持回溯和搜索
- **知识库导入**：支持 URL 网页、TXT/PDF/MD 文档导入到记忆
- **记忆修正**：支持对已有记忆进行修正、补充、删除
- **LLM 智能加工**：对话自动总结、去重、合并，由 LLM 提取关键信息存储
- **WebUI 管理界面**：Streamlit 可视化管理所有记忆、知识图谱、检索测试

## 目录结构

```
memos_system/
├── api/                          # API 服务
│   ├── memos_api_server_v2.py    # 主服务（推荐，60+ 端点）
│   ├── memos_api_server_full.py  # 完整框架版（基于 MemOS SDK）
│   ├── memos_api_server.py       # 简化版（兼容旧版）
│   └── routes/                   # 模块化路由
├── config/
│   └── memos_config.json         # 服务配置
├── core/                         # 核心模块
│   ├── mos.py                    # Memory Operating System
│   ├── graph_manager.py          # 知识图谱管理
│   ├── scheduler.py              # 异步任务调度
│   └── user_manager.py           # 多用户管理
├── memories/                     # 记忆类型
│   ├── image_memory.py           # 图片记忆
│   ├── preference_memory.py      # 偏好记忆
│   └── tool_memory.py            # 工具使用记录
├── storage/                      # 存储后端
│   ├── qdrant_client.py          # Qdrant 向量数据库
│   └── networkx_graph.py         # NetworkX 图存储
├── utils/                        # 工具函数
│   ├── search_utils.py           # 混合检索（BM25 + 向量）
│   ├── entity_extractor.py       # 实体/偏好提取
│   └── document_loader.py        # 文档/URL 导入
├── models/                       # 数据模型
├── memcube/                      # MemCube 模块
├── webui/                        # Web 管理界面
│   ├── memos_webui_v3.py         # WebUI v3（推荐）
│   └── webui_common.py           # 公共组件
├── scripts/                      # 工具脚本
├── data/                         # 数据目录（运行时生成）
├── start_memos.bat               # 启动服务（Windows）
├── start_memos.ps1               # 启动脚本
└── 启动WebUI_v3.bat              # 启动 WebUI
```

## 快速开始

### 1. 安装依赖

确保已安装 Python 3.10+，然后在 **项目根目录** 执行：

```bash
pip install -r requirements.txt
```

如果有 NVIDIA 显卡，建议先手动安装 GPU 版 PyTorch 以加速 Embedding 模型：

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
```

### 2. 配置

编辑 `memos_system/config/memos_config.json`，填入你的 LLM API 信息：

```json
{
  "llm": {
    "config": {
      "model": "deepseek-ai/DeepSeek-V3",
      "api_key": "sk-your-api-key",
      "base_url": "https://api.siliconflow.cn/v1"
    }
  }
}
```

> 如果使用 MemOS 插件（`plugins/built-in/memos`），可在插件配置页面统一设置，启动时会自动同步到此文件。

其他配置项（搜索参数、图谱开关等）一般无需修改，详见配置文件中的注释。

### 3. 准备 Embedding 模型

默认使用本地 SentenceTransformer 模型，路径配置在 `memos_config.json` 的 `embedding.model_path`。

首次启动时请确保模型文件已下载到指定路径（默认为 `../full-hub/rag-hub`）。

### 4. 启动服务

```bash
# Windows - 双击
start_memos.bat

# 或 PowerShell
powershell -ExecutionPolicy Bypass -File start_memos.ps1

# 或手动
python api/memos_api_server_v2.py
```

启动后访问：
- API 服务：`http://127.0.0.1:8003`
- API 文档：`http://127.0.0.1:8003/docs`

### 5. 启动 WebUI（可选）

```bash
# Windows - 双击
启动WebUI_v3.bat

# 或手动
streamlit run webui/memos_webui_v3.py
```

## 配置说明

`config/memos_config.json` 完整字段：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `storage.vector.type` | 向量数据库类型 | `qdrant` |
| `storage.graph.enabled` | 是否启用知识图谱 | `true` |
| `embedding.model_path` | Embedding 模型路径 | `../full-hub/rag-hub` |
| `embedding.vector_size` | 向量维度 | `1024` |
| `search.default_top_k` | 默认返回条数 | `5` |
| `search.similarity_threshold` | 相似度阈值 | `0.5` |
| `search.enable_bm25` | 启用 BM25 混合检索 | `true` |
| `search.bm25_weight` | BM25 权重（0~1） | `0.3` |
| `search.enable_graph_query` | 启用图谱增强检索 | `true` |
| `entity_extraction.enabled` | 自动提取实体 | `true` |
| `image.enabled` | 启用图片记忆 | `true` |
| `image.auto_describe` | 图片自动描述 | `true` |
| `llm.config` | 主 LLM（用于记忆加工） | 需手动填写 |
| `llm_fallback` | 备用 LLM | 可选 |

## 前端集成

MemOS 通过 HTTP API 与前端通信。my-neuro 的 live-2d 前端提供了配套的 **MemOS 插件**（`plugins/built-in/memos`），支持：

- 自动注入相关记忆到对话上下文
- 自动保存对话到长期记忆
- 12 个 Function Call 工具（搜索记忆、图片记忆、偏好查询等）
- 在插件配置页面统一管理前后端设置

插件仓库：[my-neuro-plugin-memos](https://github.com/A-night-owl-Rabbit/my-neuro-plugin-memos)

## 依赖说明

以下依赖已包含在项目根目录 `requirements.txt` 中：

| 包 | 用途 |
|----|------|
| `fastapi` + `uvicorn` | API 服务框架 |
| `sentence-transformers` | 本地 Embedding 模型 |
| `qdrant-client` | Qdrant 向量数据库 |
| `networkx` | 知识图谱存储 |
| `scikit-learn` | 相似度计算 |
| `numpy` | 数值计算 |
| `aiohttp` | 异步 HTTP（实体提取） |
| `rank-bm25` | BM25 关键词检索 |
| `pypdf` + `beautifulsoup4` | 文档/网页导入 |
| `streamlit` | WebUI 管理界面 |
| `pydantic` | 数据校验 |

> PyTorch 由 `sentence-transformers` 自动安装，有 GPU 时建议先手动装 CUDA 版。

## API 概览

服务启动后访问 `http://127.0.0.1:8003/docs` 查看完整 API 文档。核心端点：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/health` | GET | 服务健康检查 |
| `/search` | POST | 搜索记忆 |
| `/add` | POST | 添加记忆（支持 LLM 加工） |
| `/images/upload` | POST | 上传图片到记忆 |
| `/images/search` | POST | 搜索图片记忆 |
| `/tools/record` | POST | 记录工具使用 |
| `/tools/recent` | GET | 查询工具记录 |
| `/preferences` | GET | 查询用户偏好 |
| `/preferences/summary` | GET | 偏好摘要 |
| `/kb/import` | POST | 导入文档/URL |
| `/memory/feedback` | POST | 修正/补充/删除记忆 |
| `/graph/entities` | GET | 查询知识图谱实体 |
| `/deduplicate` | POST | 记忆去重 |
