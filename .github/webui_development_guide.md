# WebUI 开发指南

> 本文档旨在帮助新加入的开发者（包括 AI 助手）快速了解 My Neuro WebUI 项目的结构、功能和开发进度。

**文档版本**: v1.9.0  
**最后更新**: 2026-03-09  
**项目版本**: v1.9.0

---

## 最新更新 (v1.9.0 - 2026-03-09)

### 重大变更

**1. 工具屋完全重建**
- 四列响应式布局
- 工具状态内联显示在卡片右上角
- 信息显示规则：卡片显示名称 + 简介，展开显示 `name: description`

**2. 配置系统重构**
- 简化 `loadConfigs()` 只保留 LLM 配置
- 添加 `_setVal()` 和 `_setChk()` 安全函数
- 实现 2 秒配置轮询（测试用）

**3. 问题修复**
- 删除未定义函数调用
- DOM 元素 null 检查
- 配置重复加载问题

### 已知问题

| 问题 | 状态 | 可能原因 |
|------|------|----------|
| 复选框反复跳动 | ⚠️ 调查中 | 配置轮询与用户操作冲突 |
| 部分配置项无反应 | ⚠️ 调查中 | 前后端字段名不匹配 |

---

## 目录

1. [项目概述](#项目概述)
2. [文件结构与关联](#文件结构与关联)
3. [技术栈](#技术栈)
4. [开发进度概要](#开发进度概要)
5. [核心功能说明](#核心功能说明)
6. [API 端点列表](#api 端点列表)
7. [服务管理逻辑](#服务管理逻辑)
8. [日志系统](#日志系统)
9. [配置管理](#配置管理)
10. [开发规范](#开发规范)
11. [注意事项](#注意事项)
12. [常见问题](#常见问题)
13. [开发待办](#开发待办)

---

## 项目概述

My Neuro WebUI 是一个基于 Flask 的 Web 控制面板，用于统一管理 Live2D AI 助手的各项服务。它提供了图形化界面来启动/停止服务、配置参数、查看日志等。
基本目标：基本实现肥牛.exe（也就是test.py打包而来）功能；进阶目标：进一步优化相关功能并成为本项目可拓展的图形化控制中心

**核心功能**:
- 服务控制（启动/停止/重启）
- 配置管理（LLM、对话、声音、云端、直播等）
- 实时日志查看（系统/桌宠/工具）
- 心情分监控
- 声音克隆（模型文件上传、TTS 生成）
- 工具屋（Function Call / MCP Tools）
- 广场（提示词/工具/FC 工具资源市场）
- Live2D 动作管理（情绪分类、唱歌控制）

---

## 文件结构与关联

```
my-neuro-main/
│
├── webui_controller.py          # ⭐ 后端核心 - Flask 应用
├── 启动 WebUI 控制面板.bat         # 启动脚本（英文避免编码问题）
│
├── templates/                    # HTML 模板目录
│   └── index.html               # 主页面模板（14 个选项卡）
│
├── static/                       # 静态资源目录
│   ├── css/
│   │   └── style.css            # 样式表（渐变背景、卡片布局、响应式）
│   └── js/
│       └── app.js               # 前端逻辑（服务控制、日志轮询、配置同步）
│
├── live-2d/                      # Live2D 桌宠目录
│   ├── go.bat                   # 桌宠启动脚本（Electron）
│   ├── runtime.log              # 实时日志（桌宠 + 工具）
│   ├── config.json              # 主配置文件
│   ├── Voice_Model_Factory/     # 声音克隆模型目录
│   ├── server-tools/            # Function Call 工具目录
│   ├── mcp/                     # MCP 工具配置
│   └── motions/                 # 动作文件目录
│
├── logs/                         # 服务日志目录
│   ├── asr.log
│   ├── tts.log
│   ├── bert.log
│   └── rag.log
│
├── AI 记录室/                     # AI 数据目录
│   ├── mood_status.json         # 心情分数据
│   └── 核心用户记忆.txt          # 用户记忆
│
└── .github/
    ├── webui_development_guide.md     # 开发指南（本文档）
    └── webui_development_log.md       # 开发日志
```

### 文件关联图

```
┌─────────────────────────────────────────────────────────┐
│                   浏览器 (前端)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ index.html  │  │  style.css  │  │   app.js    │     │
│  └──────┬──────┘  └─────────────┘  └──────┬──────┘     │
└─────────┼─────────────────────────────────┼─────────────┘
          │ HTTP/JSON                        │ WebSocket
          │ API 调用                          │ 轮询
          ▼                                  ▼
┌─────────────────────────────────────────────────────────┐
│              webui_controller.py (Flask 后端)            │
│  ┌─────────────────────────────────────────────────┐   │
│  │  API Routes:                                    │   │
│  │  - /api/start/<service>  - 启动服务             │   │
│  │  - /api/stop/<service>   - 停止服务             │   │
│  │  - /api/status           - 获取状态             │   │
│  │  - /api/logs/<type>      - 获取日志             │   │
│  │  - /api/settings/*       - 配置管理             │   │
│  │  - /api/mood/status      - 心情分               │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  服务管理:                                      │   │
│  │  - service_pids: Dict[service_name -> bool]     │   │
│  │  - is_service_running(): tasklist 验证           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
          │
          │ 文件读写
          ▼
┌─────────────────────────────────────────────────────────┐
│                    文件系统                              │
│  - live-2d/config.json     (配置读写)                  │
│  - live-2d/runtime.log     (日志读取)                  │
│  - AI 记录室/mood_status.json (心情分读取)              │
└─────────────────────────────────────────────────────────┘
```

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 后端 | Python | 3.7+ |
| Web 框架 | Flask | 最新 |
| 前端 | HTML5 | - |
| 样式 | CSS3 | 渐变、Flexbox、Grid |
| 脚本 | JavaScript (ES6+) | - |
| 进程管理 | subprocess + tasklist/taskkill | Windows |

---

## 开发进度概要

### 已完成功能 (v1.8.2)

| 功能模块 | 状态 | 说明 |
|----------|------|------|
| 服务控制 | ✅ 完成 | 启动/停止/状态检测（使用 service_pids + PowerShell 进程树终止） |
| 配置管理 | ✅ 完成 | 所有配置项的读写（LLM、对话、云端、游戏、UI 等） |
| 日志系统 | ✅ 完成 | 系统/桌宠/工具三日志系统（增量加载、智能滚动） |
| 心情分监控 | ✅ 完成 | 每 3 秒轮询显示 |
| 声音克隆 | ✅ 完成 | 模型文件上传、参考音频、TTS 的 bat 文件生成（支持拖拽） |
| 工具屋 | ✅ 完成 | Function Call / MCP Tools 分选项卡显示 |
| 广场 | ✅ 完成 | 提示词/工具/FC 工具资源市场（远程服务器） |
| Live2D 动作管理 | ✅ 完成 | 6 情绪分类、唱歌控制、动作预览 |
| 云端配置 | ✅ 完成 | 云端肥牛、云端 TTS、阿里云 TTS、百度流式 ASR |
| 游戏中心 | ✅ 完成 | Minecraft 配置（对话模块映射到游戏） |
| 系统信息 | ✅ 完成 | 版本号、运行时间显示 |
| 一键启停 | ✅ 完成 | 一键启动/停止全部服务 |

### 历史版本

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v1.0 | 2026-03-04 | 代码分离（HTML/CSS/JS独立） |
| v1.1 | 2026-03-04 | 多日志系统、API Key 切换 |
| v1.2 | 2026-03-04 | Live2D 使用 go.bat、日志 API |
| v1.3 | 2026-03-04 | 动态主动对话、心情分轮询 |
| v1.4 | 2026-03-04 | 服务状态检测修复、日志清空 |
| v1.4.1 | 2026-03-04 | 删除启动脚本重复 get_status 函数 |
| v1.4.2 | 2026-03-04 | 启动脚本批处理编码问题修复 |
| v1.4.3 | 2026-03-05 | 服务停止逻辑修复、增量日志加载、系统信息栏 |
| v1.5 | 2026-03-05 | 服务状态检测简化、日志轮询优化 |
| v1.6 | 2026-03-05 | 工具屋重构（分选项卡、外部 MCP 工具支持） |
| v1.7 | 2026-03-06 | 插件系统自动扫描、配置优化 |
| v1.8 | 2026-03-06 | 广场功能、Live2D 动作管理、游戏选项卡修正 |
| v1.8.1 | 2026-03-06 | 云端配置重写（4 个分选项卡） |
| v1.8.2 | 2026-03-06 | 声音克隆选项卡重做（拖拽上传、bat 生成） |

---

## 核心功能说明

### 1. 服务管理

**服务列表**:
- `live2d` - Live2D 桌宠主服务（使用 `go.bat` 启动）
- `asr` - 语音识别
- `tts` - 语音合成
- `bert` - 情感分析
- `memos` - 记忆系统
- `rag` - 检索增强生成

**启动逻辑**:
```python
# 1. 检查服务是否已在运行
if is_service_running(service):
    return jsonify({'success': False, 'error': '服务已在运行中'})

# 2. 对于 Live2D，清空日志文件
if service == 'live2d':
    with open(log_file, 'w', encoding='utf-8') as f:
        f.write('')

# 3. 启动进程（使用 CREATE_NEW_CONSOLE 创建独立窗口）
proc = subprocess.Popen(
    config['args'],
    cwd=config['cwd'],
    creationflags=subprocess.CREATE_NEW_CONSOLE
)

# 4. 设置状态标记
service_pids[service] = True
logger.warning(f'{service} 服务已启动 (PID: {proc.pid})')
```

**停止逻辑** (v1.5 更新):
```python
# 使用 PowerShell 根据命令行查找 PID
ps_script = f'''
$procs = Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -like '*{bat_name}*' }}
foreach ($proc in $procs) {{
    Write-Output $proc.ProcessId
}}
'''

# 用 taskkill /F /T 终止整个进程树
for pid in pids:
    subprocess.run(['taskkill', '/F', '/T', '/PID', pid])
    
service_pids[service] = False  # 清除标记
```

**说明**: v1.5 版本使用 PowerShell + taskkill /T 组合，可可靠终止整个进程树（包括 node.exe 等子进程）。

**状态检测** (v1.5 简化):
```python
def is_service_running(service):
    """检查服务是否正在运行

    由于所有服务都使用 CREATE_NEW_CONSOLE 启动，窗口标题都是 cmd.exe，
    无法通过 tasklist 可靠检测，因此只依赖 service_pids 标记。
    """
    return service_pids.get(service, False)
```

**说明**: v1.5 版本简化为仅依赖 `service_pids` 标记，移除了不可靠的 tasklist 窗口标题匹配。

### 2. 日志系统

**日志来源**:
- `live-2d/runtime.log` - 桌宠和工具日志
- `logs/asr.log` - ASR 日志
- `logs/tts.log` - TTS 日志
- `logs/bert.log` - BERT 日志
- `logs/rag.log` - RAG 日志

**日志过滤**:
- **桌宠日志**: 读取 `runtime.log` 中不包含 `[TOOL]` 的行
- **工具日志**: 读取 `runtime.log` 中包含 `[TOOL]` 的行

**轮询机制** (v1.5 优化):
```javascript
// 每 500 毫秒轮询一次（提高实时性）
function startLogPolling() {
    setInterval(() => {
        loadLogs('pet');
        loadLogs('tool');
    }, 500);
}
```

**说明**: v1.5 版本将轮询频率从 2 秒提高到 500 毫秒，并实现增量日志加载避免页面回弹。

### 3. 心情分系统

**数据来源**: `AI 记录室/mood_status.json`

**数据结构**:
```json
{
  "score": 85,
  "interval": 30,
  "waitingResponse": false
}
```

**状态显示**:
| 分数范围 | 状态 | 颜色 |
|----------|------|------|
| 90+ | 兴奋😄 | 绿色 (#4ade80) |
| 80-89 | 正常😊 | 蓝色 (#60a5fa) |
| 60-79 | 低落😐 | 橙色 (#fb923c) |
| <60 | 沉默😔 | 红色 (#f87171) |

**轮询逻辑**:
```javascript
function startMoodPolling() {
    setInterval(() => {
        loadMoodStatus();  // GET /api/mood/status
    }, 3000);
}
```

---

## API 端点列表

### 服务控制

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 获取所有服务状态 |
| `/api/start/<service>` | POST | 启动服务 |
| `/api/stop/<service>` | POST | 停止服务 |
| `/api/system/info` | GET | 获取系统信息（版本、运行时间） |

### 配置管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config/llm` | GET/POST | LLM 配置 |
| `/api/settings/chat` | GET/POST | 对话设置 |
| `/api/settings/voice` | GET/POST | 声音/云端配置 |
| `/api/settings/bilibili` | GET/POST | 直播设置 |
| `/api/settings/ui` | GET/POST | UI 设置 |
| `/api/settings/autochat` | GET/POST | 主动对话 |
| `/api/settings/mood-chat` | GET/POST | 动态主动对话 |
| `/api/settings/advanced` | GET/POST | 高级设置 |
| `/api/settings/tools` | GET/POST | 工具设置 |
| `/api/settings/current-model` | POST | 切换模型 |
| `/api/settings/dialog` | GET/POST | 对话配置（新增） |

### 插件管理（v1.6+ 更新）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/plugins/list` | GET | 获取插件列表（自动扫描） |
| `/api/plugins/<name>/toggle` | POST | 切换插件启用状态 |
| `/api/plugins/<name>/open-config` | POST | 打开插件配置目录 |
| `/api/market/plugins` | GET | 获取插件广场列表 |
| `/api/market/plugins/download` | POST | 下载插件 |

**插件启用逻辑变更** (v1.6+)：
- 改用 `enabled_plugins.json` 管理启用状态
- 格式：`{"plugins": ["built-in/auto-chat", "community/check-in"]}`
- 不再使用 `config.json` 的 `plugins.{name}.enabled` 字段

---

### 已删除的 API（v1.6）

以下 API 已删除，因为 Minecraft 已改为插件：

| 端点 | 原功能 | 替代方案 |
|------|--------|---------|
| `/api/settings/game` | 游戏设置 | 通过 minecraft 插件管理 |
| `/api/settings/minecraft` | Minecraft 配置 | 通过 minecraft 插件管理 |
| `/api/game/minecraft/start` | 启动 Minecraft | 通过 minecraft 插件管理 |
| `/api/game/minecraft/download` | 下载 Minecraft | 通过 minecraft 插件管理 | |

### 日志系统

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/logs/<type>` | GET | 获取历史日志（100 行） |
| `/api/logs/tail/<type>` | GET | 获取最新日志（10 行） |

### 心情分

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/mood/status` | GET | 获取当前心情分状态 |

### 资源列表

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/tools/list` | GET | 获取工具列表 |
| `/api/tools/list/fc` | GET | 获取 FC 工具列表 |
| `/api/tools/list/mcp` | GET | 获取 MCP 工具列表 |
| `/api/models/list` | GET | 获取模型列表 |

### 广场（资源市场）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/market/prompts` | GET | 获取提示词列表 |
| `/api/market/prompts/apply` | POST | 应用提示词到 AI 人设 |
| `/api/market/tools` | GET | 获取工具列表 |
| `/api/market/tools/download` | POST | 下载工具 |
| `/api/market/fc-tools` | GET | 获取 FC 工具列表 |
| `/api/market/fc-tools/download` | POST | 下载 FC 工具 |

### Live2D 动作管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/live2d/singing/start` | POST | 开始唱歌 |
| `/api/live2d/singing/stop` | POST | 停止唱歌 |
| `/api/live2d/motion/reset` | POST | 复位动作 |
| `/api/live2d/motion/preview` | POST | 预览动作 |
| `/api/live2d/motions/uncategorized` | GET | 获取未分类动作 |
| `/api/live2d/motions/save` | POST | 保存动作配置 |

### 声音克隆

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/voice-clone/generate-bat` | POST | 生成 TTS 的 bat 文件 |

---

## 服务管理逻辑

### 状态跟踪机制

```python
# 两个关键数据结构
service_processes = {}  # subprocess.Popen 对象（可能立即结束）
service_pids = {}       # 状态标记 {service: True/False}
```

### 为什么需要 service_pids？

使用 `CREATE_NEW_CONSOLE` 启动进程时：
1. 父进程（Python）会立即返回
2. `proc.poll()` 可能返回非 None（表示父进程结束）
3. 但实际的 cmd 窗口仍在运行

**解决方案** (v1.5 更新):
- 使用 `service_pids` 记录"软状态"（唯一状态来源）
- ~~使用 `tasklist` 进行"硬验证"~~（v1.5 已移除，因为窗口标题都是 cmd.exe 不可靠）
- 使用 PowerShell + `taskkill /T` 终止整个进程树

**v1.5 重要变更**:
- 状态检测简化为仅检查 `service_pids` 标记
- 停止服务使用 PowerShell 查找 PID，然后用 `taskkill /F /T` 终止进程树

### 流程图

```
启动服务
    │
    ▼
检查 service_pids[service]
    │
    ├─ True → 使用 tasklist 验证 → 存在 → 返回"已在运行"
    │                              └─ 不存在 → 清除标记
    │
    └─ False → 启动新进程
               │
               ▼
           设置 service_pids[service] = True
               │
               ▼
           对于 Live2D: 清空 runtime.log
```

---

## 配置管理

### 配置文件位置

| 配置 | 文件路径 |
|------|----------|
| 主配置 | `live-2d/config.json` |
| 心情分 | `AI 记录室/mood_status.json` (只读) |
| MCP 配置 | `live-2d/mcp/mcp_config.json` |

### config.json 结构

```json
{
  "llm": { ... },
  "tts": { "enabled": true, "url": "...", "language": "zh" },
  "asr": { "enabled": true, "vad_url": "...", "voice_barge_in": true },
  "auto_chat": { "enabled": false, "idle_time": 30, "prompt": "..." },
  "mood_chat": { "enabled": true, "prompt": "..." },
  "bilibili": { "enabled": false, "roomId": "..." },
  "game": { "Minecraft": { "enabled": false, ... } },
  "vision": { "enabled": true, ... },
  "memory": { "enabled": false },
  "memos": { "enabled": true, ... },
  "tools": { "enabled": true },
  "mcp": { "enabled": true },
  "ai_diary": { "enabled": true, ... },
  "auto_close_services": { "enabled": false },
  "subtitle_labels": { "user": "用户", "ai": "Fake Neuro" },
  "ui": { ... },
  "context": { ... }
}
```

---

## 配置项说明（v1.6 更新）

### WebUI 中缺失的配置项

以下配置项存在于 `config.json` 中，但 WebUI 暂无对应配置界面：

| 配置路径 | 类型 | 默认值 | 作用说明 |
|---------|------|--------|---------|
| `tools.auto_reload` | boolean | `false` | 工具自动重载：启用后，工具文件变化时自动重新加载 |
| `mcp.config_path` | string | `"./mcp/mcp_config.json"` | MCP 配置文件路径 |
| `mcp.startup_timeout` | number | `30000` | MCP 服务器启动超时时间（毫秒） |
| `mcp.auto_start_servers` | boolean | `true` | 是否自动启动 MCP 服务器 |
| `subtitle_labels.enabled` | boolean | `true` | 是否启用字幕标签显示 |
| `ui.auto_show_chat_on_text_mode` | boolean | `true` | 文字模式下自动显示聊天框 |
| `ui.model_position` | object | `{x, y, remember_position}` | Live2D 模型位置记忆 |
| `rag.enabled` | boolean | `true` | RAG 服务启用开关（服务卡片可控制） |
| `rag.url` | string | `"http://127.0.0.1:8002/ask"` | RAG 服务地址 |
| `bert.enabled` | boolean | `true` | BERT 服务启用开关（服务卡片可控制） |
| `bert.url` | string | `"http://127.0.0.1:6007/classify"` | BERT 服务地址 |

### 插件相关配置

| 配置路径 | 类型 | 作用说明 |
|---------|------|---------|
| `plugins.auto_chat.enabled` | boolean | 自动对话插件启用状态（已迁移至 enabled_plugins.json） |
| `plugins.diary.enabled` | boolean | AI 日记插件启用状态（已迁移至 enabled_plugins.json） |
| `plugins.memos.enabled` | boolean | MemOS 插件启用状态（已迁移至 enabled_plugins.json） |
| `plugins.mood_chat.enabled` | boolean | 心情对话插件启用状态（已迁移至 enabled_plugins.json） |
| `plugins.context_compressor.enabled` | boolean | 上下文压缩插件启用状态 |
| `plugins.translation.enabled` | boolean | 翻译功能插件启用状态 |

**注意** (v1.6+)：插件启用状态已迁移到 `enabled_plugins.json`，格式为：
```json
{
  "plugins": [
    "built-in/auto-chat",
    "built-in/minecraft",
    "community/check-in"
  ]
}
```

---

## 开发规范

### 1. DOM 操作安全

**必须使用安全函数**：
```javascript
// ✅ 正确
_setVal('api-key', value);
_setChk('tts-enabled', true);

// ❌ 错误 - 可能导致 null 错误
document.getElementById('api-key').value = value;
```

**安全函数定义**：
```javascript
// 安全设置元素值（仅在元素未聚焦时设置）
function _setVal(id, value) { 
    const el = document.getElementById(id); 
    if (el && document.activeElement !== el) el.value = value; 
}
function _setChk(id, value) { 
    const el = document.getElementById(id); 
    if (el) el.checked = value; 
}
```

### 2. 配置加载规范

**每个配置项只能由一个函数加载**，避免重复：

```javascript
// ✅ 正确 - loadAllSettings 统一调度
async function loadAllSettings() {
    await loadConfigs();
    await loadBasicConfig();
    await loadDialogConfig();
    await loadCloudSettings();
    await loadUISettings();
}

// ❌ 错误 - loadConfigs 内部不应调用其他加载函数
async function loadConfigs() {
    await loadBasicConfig();  // 会导致重复加载！
}
```

### 3. 配置项命名规范

**前端 ID 与后端字段映射**：
- 前端使用 kebab-case：`tts-enabled`, `show-chat-box`
- 后端使用 snake_case：`tts_enabled`, `show_chat_box`

**映射规则**：
```javascript
// 前端 → 后端
'tts-enabled' → tts_enabled
'show-chat-box' → show_chat_box

// 后端 → 前端
{ tts_enabled: true } → document.getElementById('tts-enabled').checked = true
```

### 4. 工具屋开发规范

**工具文件结构**：
```javascript
/**
 * 工具显示名称
 */
// 或
module.exports = {
    name: "tool_name",
    description: "工具详细描述"
};
```

**描述提取优先级**：
1. 优先从 JS 代码中提取 `name:` 和 `description:` 字段
2. 回退从 `/** ... */` 注释中提取第一行

**前端显示规则**：
- **卡片标题**：`tool.name`（如 `click_tool`）
- **卡片简介**：`tool.short_desc`（注释第一行，如 `点击工具`）
- **展开详情**：`tool.name + ': ' + tool.description`

---

## 注意事项

### 1. 编码问题

**批处理文件**:
- 使用英文避免编码问题
- 不要使用 `chcp 65001`（可能导致字符解析错误）
- 或使用 ANSI 编码保存中文批处理

**Python 文件**:
- 使用 UTF-8 编码
- 读写文件时指定 `encoding='utf-8'`

### 2. 进程管理

**Windows 特性**:
- `CREATE_NEW_CONSOLE` 创建独立窗口
- 父进程立即返回，不能使用 `poll()` 检测
- 使用 `tasklist` 和 `taskkill` 管理进程

**进程清理** (v1.5 更新):
- 停止服务时清除 `service_pids` 标记
- 使用 PowerShell 查找包含 bat 文件名的进程 PID
- 使用 `taskkill /F /T` 终止整个进程树（包括 node.exe 等子进程）

### 3. 日志系统

**runtime.log**:
- 启动 Live2D 时自动清空
- 包含桌宠日志和工具日志
- 通过 `[TOOL]` 标记区分

**日志轮询** (v1.5 优化):
- 每 500 毫秒轮询一次（提高实时性）
- 增量加载：只添加新增的日志
- 智能滚动：用户在底部时自动滚动
- 保留原始时间戳：直接使用 runtime.log 中的时间

### 4. 前端状态同步

**服务状态**:
- 每 5 秒轮询 `/api/status`
- 更新按钮禁用状态
- 更新状态指示灯

**心情分**:
- 每 3 秒轮询 `/api/mood/status`
- 根据分数改变颜色
- 显示等待回应状态

### 5. 配置保存

**保存逻辑**:
```python
def save_config(config):
    config_path = PROJECT_ROOT / 'live-2d' / 'config.json'
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
```

**注意事项**:
- 使用 `ensure_ascii=False` 保留中文
- 使用 `indent=2` 格式化 JSON
- 捕获异常并返回错误信息

---

## 开发待办

### 高优先级（当前任务）

- [ ] **修复复选框跳动问题** - 配置轮询导致复选框自动切换状态
- [ ] **验证所有配置项保存功能** - 确保每个复选框都能正常保存
- [ ] **添加配置保存成功提示** - 用户操作反馈
- [ ] **优化配置轮询间隔** - 从 2 秒调整为 5-10 秒
- [ ] **清理未使用的 API 调用** - 减少不必要的网络请求

### 中优先级

- [ ] **服务启动超时检测**: 检测服务启动失败的情况
- [ ] **日志导出功能**: 支持下载日志文件
- [ ] **动作管理拖拽**: 实现动作文件的拖拽排序（当前使用文件选择）
- [ ] **配置备份/恢复**: 支持配置文件导出导入

### 低优先级

- [ ] **深色主题切换**: 添加深色/浅色主题切换功能（下一阶段）
- [ ] **WebUI 样式重构**: 整体样式优化（下一阶段）
- [ ] **移动端适配**: 响应式布局优化
- [ ] **WebSocket 实时日志**: 替代轮询机制
- [ ] **广场资源上传**: 支持用户上传提示词/工具到远程服务器

---

## 下一阶段：问题修复与样式重构

### 计划内容

1. **深色主题支持**
   - 添加主题切换按钮
   - 定义深色/浅色主题变量
   - 所有组件支持主题切换

2. **WebUI 样式重构**
   - 统一配色方案
   - 优化卡片布局
   - 改进按钮和表单样式
   - 增加过渡动画

3. **用户体验优化**
   - Toast 提示替代 alert
   - 加载状态显示
   - 表单验证优化

---

## 快速参考

### 添加新服务

1. 在 `script_map` 中添加服务配置
2. 在 `is_service_running()` 中添加检测逻辑
3. 在前端 HTML 中添加服务卡片
4. 测试启动/停止/状态检测

### 添加新配置项

1. 在 HTML 中添加表单字段
2. 在 `webui_controller.py` 中添加 API 端点
3. 在 `app.js` 中添加加载/保存函数
4. 更新 `config.json` 结构

### 修改日志逻辑

1. 修改 `get_logs()` 中的过滤逻辑
2. 更新前端 `loadLogs()` 函数
3. 测试日志显示效果

---

## 联系与支持

如有问题，请参考：
1. 本文档
2. `webui_development_log.md`
3. 代码注释

**开发团队**: My Neuro 开发组
**主要贡献者**: terk 
**许可证**: 参考项目根目录 LICENSE
