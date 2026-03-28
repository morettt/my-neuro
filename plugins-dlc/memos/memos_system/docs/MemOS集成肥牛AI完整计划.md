# MemOS 记忆系统集成肥牛AI - 完整执行计划

## 项目背景

### 目标项目：肥牛AI (my-neuro)
- **项目路径**：`K:\neruo\my-neuro-main`
- **项目性质**：基于 Electron + Node.js 的 AI 虚拟角色对话系统
- **核心功能**：Live2D 虚拟角色 + TTS 语音合成 + ASR 语音识别 + LLM 对话

### 集成目标
将 MemOS（Memory Operating System）集成到肥牛AI，实现：
1. **智能记忆召回**：用户提到某件事时，AI 能自动回忆相关内容
2. **主动吐槽能力**：AI 能根据历史记忆吐槽用户的矛盾行为
3. **记忆生命周期管理**：自动归档、遗忘、合并记忆
4. **WebUI 管理界面**：独立启动的记忆管理后台

---

## 知识来源

### MemOS 官方资源
- **GitHub 仓库**：https://github.com/MemTensor/MemOS
- **官方文档**：https://memos-docs.openmem.net/cn/overview/introduction
- **安装包**：`pip install MemoryOS`

### MemOS 核心概念
1. **MOS (Memory Operating System)**：编排层，管理多种记忆类型
2. **MemCube**：模块化记忆容器，支持动态注册/移除
3. **MemScheduler**：记忆调度器，控制召回策略
4. **MemLifecycle**：生命周期管理，状态转换（活跃→归档→冻结→删除）

### MemOS 记忆加工机制
MemOS 使用独立的 LLM 进行记忆加工（与对话 LLM 分离）：
- 从对话中提取关键事实
- 判断信息重要性
- 去重和合并相似记忆
- 结构化存储

---

## 现有项目结构分析

### 核心文件位置
```
K:\neruo\my-neuro-main\
├── live-2d\
│   ├── js\ai\
│   │   ├── voice-chat.js       # 主对话类（VoiceChatInterface）
│   │   ├── MemoryManager.js    # 现有记忆管理器
│   │   ├── llm-handler.js      # LLM 处理逻辑
│   │   └── llm-client.js       # LLM API 客户端
│   ├── server-tools\           # MCP/Function Call 工具目录
│   │   ├── index.js            # 工具自动扫描加载器
│   │   ├── rag_server_module.js # 现有 RAG 工具
│   │   └── app_launcher.js     # 应用启动工具（参考格式）
│   ├── AI记录室\
│   │   ├── 记忆库.txt          # 现有记忆存储文件
│   │   └── 对话历史.jsonl      # 对话历史
│   └── config.json             # 主配置文件
├── RAG-model\                  # 现有 BGE embedding 模型
├── my-neuro\               # Python 虚拟环境
└── requirements.txt
```

### 现有记忆机制（voice-chat.js 第181-195行）
```javascript
// 启动时一次性读取记忆库并注入 system prompt
let memoryContent = fs.readFileSync(fullMemoryPath, 'utf8');
const systemPrompt = `${baseSystemPrompt}这些数据里面是有关用户的各种信息...：
${memoryContent}`;
```

**问题**：记忆是静态的，不会根据对话内容动态检索。

### 现有 MemoryManager.js 功能
- 使用 BERT 判断是否需要保存记忆
- 调用 LLM 生成记忆摘要（15字以内）
- 追加到 `记忆库.txt`

---

## 配置需求

### 用户确认的配置
| 配置项 | 用户选择 |
|-------|---------|
| Embedding 模型 | 使用现有 `./RAG-model`（本地 BGE） |
| 记忆加工 LLM | API 调用（OpenAI 兼容接口） |
| 多用户支持 | 不需要（单用户） |
| WebUI | 独立启动（Streamlit） |
| 启动方式 | 单独 bat 脚本 |

### API 配置参考
从现有 `live-2d/config.json` 可获取 API 配置格式：
```json
{
  "llm": {
    "api_key": "sk-xxx",
    "api_url": "https://api.zhizengzeng.com/v1",
    "model": "gpt-4o-mini"
  }
}
```

---

## 完整配置文件

### 1. memos_config.json（新建）
```json
{
  "embedder": {
    "provider": "huggingface",
    "config": {
      "model": "./RAG-model",
      "device": "cuda"
    }
  },
  "llm": {
    "provider": "openai",
    "config": {
      "model": "gpt-4o-mini",
      "api_key": "从config.json读取",
      "base_url": "从config.json读取"
    }
  },
  "scheduler": {
    "retrieval_strategy": "hybrid",
    "top_k": 5,
    "similarity_threshold": 0.7,
    "rerank_enabled": true,
    "time_decay_weight": 0.1,
    "importance_weight": 0.3
  },
  "lifecycle": {
    "auto_archive_days": 30,
    "auto_freeze_days": 90,
    "merge_similar_threshold": 0.95,
    "importance_decay_rate": 0.1,
    "forget_rules": [
      {"condition": "importance < 0.1", "action": "delete"},
      {"condition": "access_count == 0 && age > 60", "action": "archive"}
    ]
  },
  "vector_store": {
    "provider": "qdrant",
    "config": {
      "collection_name": "feiniu_memory",
      "path": "./memos_data"
    }
  }
}
```

### 2. live-2d/config.json 新增配置
```json
{
  "memos": {
    "enabled": true,
    "api_url": "http://127.0.0.1:8003",
    "auto_inject": true,
    "inject_top_k": 3,
    "similarity_threshold": 0.6
  }
}
```

---

## 需要创建的新文件

### 1. memos_api_server.py
**位置**：`K:\neruo\my-neuro-main\memos_api_server.py`
**功能**：MemOS 的 FastAPI 封装，提供 REST API
**端口**：8003

**核心 API 端点**：
- `POST /add` - 添加记忆
- `POST /search` - 搜索记忆
- `GET /list` - 列出所有记忆
- `DELETE /delete/{id}` - 删除记忆
- `POST /migrate` - 从旧记忆库导入

### 2. live-2d/js/ai/memos-client.js
**位置**：`K:\neruo\my-neuro-main\live-2d\js\ai\memos-client.js`
**功能**：Node.js 端调用 MemOS API 的客户端

### 3. live-2d/server-tools/memos_tool.js
**位置**：`K:\neruo\my-neuro-main\live-2d\server-tools\memos_tool.js`
**功能**：Function Call 工具，供 LLM 深度检索记忆

**工具定义**（参考 app_launcher.js 格式）：
- `memos_search_memory` - 搜索相关记忆
- `memos_add_memory` - 添加新记忆
- `memos_list_memories` - 列出记忆
- `memos_delete_memory` - 删除记忆

### 4. memos_webui.py
**位置**：`K:\neruo\my-neuro-main\memos_webui.py`
**功能**：Streamlit WebUI 记忆管理界面
**端口**：8501

**页面功能**：
- 记忆列表（卡片视图）
- 语义搜索
- 添加/编辑/删除记忆
- 一键导入旧记忆库
- 召回策略配置
- 生命周期配置

### 5. MEMOS-API.bat
**位置**：`K:\neruo\my-neuro-main\MEMOS-API.bat`
```batch
@echo off
chcp 65001 >nul
echo ========================================
echo   启动 MemOS 记忆服务 (端口: 8003)
echo ========================================
cd /d %~dp0
call my-neuro-env\Scripts\activate
python memos_api_server.py
pause
```

### 6. MEMOS-WebUI.bat
**位置**：`K:\neruo\my-neuro-main\MEMOS-WebUI.bat`
```batch
@echo off
chcp 65001 >nul
echo ========================================
echo   启动 MemOS 记忆管理界面 (端口: 8501)
echo ========================================
cd /d %~dp0
call my-neuro-env\Scripts\activate
streamlit run memos_webui.py --server.port 8501
pause
```

---

## 需要修改的现有文件

### 1. live-2d/js/ai/voice-chat.js
**修改位置**：构造函数和 ASR 回调

**修改内容**：
1. 导入 memos-client
2. 在 `sendToLLM` 前调用记忆检索
3. 动态注入相关记忆到消息历史

**关键代码位置**：
- 第7行附近：添加导入
- 第48-65行附近：ASR 回调中添加记忆注入
- 第192-195行附近：修改 system prompt 构建逻辑

### 2. live-2d/config.json
**修改内容**：添加 `memos` 配置节

---

## 核心实现逻辑

### 记忆动态注入流程
```javascript
// voice-chat.js 修改
async onUserInput(text) {
    // 1. 调用 MemOS 检索相关记忆
    const relevantMemories = await this.memosClient.search(text, 3);
    
    // 2. 如果有相关记忆，构建注入内容
    if (relevantMemories && relevantMemories.length > 0) {
        const memoryContext = this.formatMemoriesForPrompt(relevantMemories);
        
        // 3. 创建临时系统消息注入记忆
        const memoryMessage = {
            role: 'system',
            content: `【关于这个用户的相关记忆】\n${memoryContext}\n请在回复中自然运用这些记忆，可以适当吐槽用户的矛盾行为。`
        };
        
        // 4. 注入到消息历史（临时，不持久化）
        this.messages.splice(1, 0, memoryMessage);
    }
    
    // 5. 调用原有的 sendToLLM
    await this.sendToLLM(text);
    
    // 6. 移除临时注入的记忆消息
    this.removeInjectedMemory();
}
```

### 记忆格式化示例
```
【关于这个用户的相关记忆】
- 用户喜欢足球，经常踢球（2025-12-15，重要度：高）
- 用户上周说过讨厌早起（2025-12-10，重要度：中）
- 用户的生日是5月1日（2025-11-20，重要度：高）
```

---

## 实施步骤（详细）

### 步骤1：安装依赖
```bash
cd K:\neruo\my-neuro-main
my-neuro-env\Scripts\activate
pip install MemoryOS streamlit qdrant-client
```

### 步骤2：创建 memos_config.json
创建配置文件，使用现有 RAG-model 作为 embedding

### 步骤3：创建 memos_api_server.py
实现 FastAPI 服务，封装 MemOS 的 MOS 类

### 步骤4：创建 memos-client.js
实现 Node.js 客户端，调用 MemOS API

### 步骤5：修改 voice-chat.js
添加记忆动态注入逻辑

### 步骤6：创建 memos_tool.js
实现 Function Call 工具

### 步骤7：创建 memos_webui.py
实现 Streamlit 管理界面

### 步骤8：创建启动脚本
创建 MEMOS-API.bat 和 MEMOS-WebUI.bat

### 步骤9：迁移现有记忆
从 `AI记录室/记忆库.txt` 导入到 MemOS

---

## 端口分配

| 服务 | 端口 | 说明 |
|-----|------|-----|
| MemOS API | 8003 | 后端服务 |
| WebUI | 8501 | Streamlit 管理界面 |
| RAG 服务 | 8002 | 现有服务（可保留或替换） |
| TTS 服务 | 5000 | 现有 |
| ASR 服务 | 6006 | 现有 |
| BERT 服务 | 6007 | 现有 |

---

## 启动顺序

1. 启动 MemOS API：双击 `MEMOS-API.bat`
2. 启动肥牛主程序（会自动连接 MemOS）
3. （可选）启动 WebUI：双击 `MEMOS-WebUI.bat`

---

## 预期效果

### 场景1：基础记忆回忆
```
用户：我今天又熬夜了
AI：（自动检索到"用户经常熬夜"的记忆）
    又熬夜？！你这个月已经熬了多少次了，不要命了是吧！
```

### 场景2：主动吐槽矛盾
```
用户：这游戏挺好玩的
AI：（检索到"用户上周说这游戏垃圾"）
    哦？上周你不是还说这游戏是垃圾来着，怎么这么快就真香了？
```

### 场景3：深度检索（Function Call）
```
用户：我之前跟你说过什么来着？
AI：（触发 memos_search_memory 工具）
    让我想想...你说过喜欢足球、讨厌早起、生日是5月1日...
```

---

## WebUI 界面设计（新手友好）

### 界面布局
```
┌──────────────────────────────────────────────────────┐
│  🧠 肥牛记忆管理中心                    [设置] [帮助] │
├───────────┬──────────────────────────────────────────┤
│           │                                          │
│ 📋 记忆列表│         主内容区域                       │
│ 🔍 搜索   │         (卡片式展示记忆)                 │
│ ➕ 添加   │                                          │
│ 📥 一键导入│                                          │
│ ────────  │                                          │
│ ⚙️ 召回设置│                                          │
│ 🔄 生命周期│                                          │
│ 📊 统计   │                                          │
│           │                                          │
└───────────┴──────────────────────────────────────────┘
```

### 新手友好设计
- 开箱即用：预设合理默认配置
- 可视化优先：记忆以卡片形式展示
- 一键操作：大按钮 + 明确文字
- 帮助提示：每个设置旁有说明

---

## 注意事项

1. **虚拟环境**：所有 Python 命令需在 `my-neuro` 虚拟环境中执行
2. **端口冲突**：确保 8003 和 8501 端口未被占用
3. **API Key**：记忆加工 LLM 使用的 API Key 需要有效
4. **显存**：如果使用 GPU 加速 embedding，确保显存足够

---

## 文件创建清单

| 文件 | 类型 | 状态 |
|-----|------|-----|
| `memos_config.json` | 新建 | ⬜ |
| `memos_api_server.py` | 新建 | ⬜ |
| `live-2d/js/ai/memos-client.js` | 新建 | ⬜ |
| `live-2d/server-tools/memos_tool.js` | 新建 | ⬜ |
| `memos_webui.py` | 新建 | ⬜ |
| `MEMOS-API.bat` | 新建 | ⬜ |
| `MEMOS-WebUI.bat` | 新建 | ⬜ |
| `live-2d/js/ai/voice-chat.js` | 修改 | ⬜ |
| `live-2d/config.json` | 修改 | ⬜ |

---

*计划创建时间：2025年12月18日*
*项目：肥牛AI MemOS 记忆系统集成*

