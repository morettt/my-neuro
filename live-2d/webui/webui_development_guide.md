# WebUI 开发指南

> 本文档旨在帮助新加入的开发者（包括 AI 助手）快速了解 My Neuro WebUI 项目的结构、功能和开发进度。

**文档版本**: v2.6  
**最后更新**: 2026-04-16  
**项目版本**: v2.6 

---

## 目录

1. [项目概述](#项目概述)
2. [文件结构与关联](#文件结构与关联)
3. [技术栈](#技术栈)
4. [开发进度概要](#开发进度概要)
5. [核心功能说明](#核心功能说明)
6. [API 端点列表](#api-端点列表)
7. [服务管理逻辑](#服务管理逻辑)
8. [日志系统](#日志系统)
9. [配置管理](#配置管理)
10. [插件系统](#插件系统)
11. [开发规范](#开发规范)
12. [注意事项](#注意事项)
13. [常见问题](#常见问题)
14. [开发待办](#开发待办)

---

## 项目概述

My Neuro WebUI 是一个基于 Flask 的 Web 控制面板，用于统一管理 Live2D AI 助手的各项服务。它提供了图形化界面来启动/停止服务、配置参数、查看日志等。

**核心目标**：
- 基本目标：实现肥牛.exe（test.py 打包）的所有功能
- 进阶目标：成为本项目可扩展的图形化控制中心

**当前状态**：🎉 **v2.6 稳定版本**

核心功能已完善，界面布局优化完成，移除 FC 功能，新增启用温度开关、版本显示优化等。

**核心功能**:
- 服务控制（启动/停止/重启）
- 配置管理（LLM、对话、声音、云端、直播等）
- 实时日志查看（系统/桌宠/工具）
- 声音克隆（模型文件上传、TTS 生成）
- MCP管理（MCP 工具列表）
- 广场（提示词/工具/插件资源市场）
- Live2D 动作管理（情绪分类、唱歌控制）

---

## 文件结构与关联

```
my-neuro-main/
├── live-2d/
│   ├── webui/                         # WebUI 模块化目录
│   │   ├── __init__.py                # 模块入口
│   │   ├── utils.py                   # 共享工具函数
│   │   ├── main_app.py                # Flask 应用初始化
│   │   ├── config_manager.py          # 配置管理 API
│   │   ├── log_monitor.py             # 日志监控 API
│   │   ├── marketplace.py             # 广场与资源 API
│   │   ├── plugin_manager.py          # 插件管理 API
│   │   ├── service_controller.py      # 服务控制 API
│   │   ├── tool_manager.py            # 工具管理 API
│   │   ├── live2d_manager.py           # Live2D管理API
│   │   ├── templates/
│   │   │   └── index.html             # 主页面模板
│   │   └── static/
│   │       ├── css/                   # 样式表
│   │       │   └── style.css
│   │       └── js/                    # 前端 JavaScript
│   │           └── app.js
│   ├── 启动 WebUI 控制面板.bat
│   │   （其他文件↓）
│   ├── config.json
│   ├── go.bat
│   ├── main.js
│   ├── plugins/
│   ├── server-tools/
│   ├── mcp/
│   └── ...
└── .github/
    ├── webui_development_guide.md      # 开发指南（本文档）
    └── webui_development_log.md        # 开发日志（略）

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
| 异步任务 | threading | 内置 |

---

## 开发进度概要

### 已完成功能 (v2.6)

| 功能模块 | 状态 | 说明 |
|----------|------|------|
| 服务控制 | ✅ 完成 | 启动/停止/重启/状态检测 |
| 配置管理 | ✅ 完成 | LLM/对话/云端/UI/高级配置，新增启用温度开关 |
| 日志系统 | ✅ 完成 | 系统/桌宠/工具三日志系统 |
| 声音克隆 | ✅ 完成 | 模型文件上传、TTS 生成、bat 文件生成 |
| MCP管理 | ✅ 完成 | MCP 工具列表（已移除 Function Call） |
| 广场 | ✅ 完成 | 提示词/工具/插件资源市场（已移除 FC 广场） |
| Live2D 动作管理 | ✅ 完成 | 6 情绪分类、拖拽绑定、唱歌控制 |
| 插件系统 | ✅ 完成 | 自动扫描、启用/禁用、插件广场异步安装 |
| 网页图标 | ✅ 完成 | favicon + 标题圆形图标 |
| 暗夜模式标识 | ✅ 完成 | 添加 color-scheme 和 theme-color 元标签 |

---

## 核心功能说明

### 1. 服务管理

**服务列表**:
- `live2d` - Live2D 桌宠主服务
- `asr` - 语音识别
- `tts` - 语音合成
- `bert` - 情感分析
- `memos` - 记忆系统
- `rag` - 检索增强生成

**控制逻辑**:
- 启动：执行对应的 `.bat` 脚本
- 停止：使用 `taskkill` 命令终止进程
- 状态检测：使用 `tasklist` 检查进程是否存在

---

### 2. 日志系统

**日志来源**:
- `live-2d/runtime.log` - 桌宠和工具日志
- `logs/asr.log` - ASR 日志
- `logs/tts.log` - TTS 日志

**日志过滤**:
- **桌宠日志**: 不包含 `[TOOL]` 的行
- **工具日志**: 包含 `[TOOL]` 的行

**轮询机制**: 每 2 秒轮询一次最新日志

---

### 4. 配置管理

**配置分类**:
| 配置类型 | API 端点 | config.json 路径 |
|---------|---------|-----------------|
| LLM 配置 | `/api/config/llm` | `llm.*` |
| 对话配置 | `/api/settings/dialog` | `ui.*`, `context.*`, `tts.*`, `asr.*` |
| UI 配置 | `/api/settings/ui` | `ui.*`, `subtitle_labels.*` |
| 云端配置 | `/api/settings/voice` | `cloud.*`, `api_gateway.*` |
| 高级配置 | `/api/settings/advanced` | `vision.*`, `tools.*`, `mcp.*` |

**配置加载流程**:
```
页面加载 → loadAllSettings()
           ├── loadConfigs()       → tools, mcp, plugins
           ├── loadLLMConfig()     → llm.*
           ├── loadBasicConfig()   → vision, ui, tools, mcp
           ├── loadDialogConfig()  → ui.intro_text, context, tts, asr
           ├── loadCloudSettings() → cloud.*, api_gateway.*
           └── loadUISettings()    → ui.*, subtitle_labels.*
```

---

## API 端点列表

### 服务控制

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 获取所有服务状态 |
| `/api/start/<service>` | POST | 启动服务 |
| `/api/stop/<service>` | POST | 停止服务 |
| `/api/system/info` | GET | 获取系统信息 |

### 配置管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config/llm` | GET/POST | LLM 配置 |
| `/api/settings/chat` | GET/POST | 对话设置 |
| `/api/settings/voice` | GET/POST | 云端配置 |
| `/api/settings/ui` | GET/POST | UI 设置 |
| `/api/settings/advanced` | GET/POST | 高级设置 |
| `/api/settings/dialog` | GET/POST | 对话配置 |

### 插件管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/plugins/list` | GET | 获取插件列表 |
| `/api/plugins/<name>/toggle` | POST | 切换插件状态 |
| `/api/market/plugins` | GET | 获取插件广场列表 |
| `/api/market/plugins/download` | POST | 下载插件（异步安装） |
| `/api/market/plugins/check-installed/<name>` | GET | 检查插件是否已安装 |

### 日志系统

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/logs/<type>` | GET | 获取历史日志 |
| `/api/logs/tail/<type>` | GET | 获取最新日志 |

### 广场

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/market/prompts` | GET | 获取提示词列表 |
| `/api/market/tools` | GET | 获取工具列表 |
| `/api/market/fc-tools` | GET | 获取 FC 工具列表 |
| `/api/market/plugins` | GET | 获取插件广场列表 |

---

## 开发规范
（略）

---

## 注意事项

### 1. 配置文件编码
- 所有配置文件使用 UTF-8 编码
- 读写文件时指定 `encoding='utf-8'`

### 2. 路径处理
- 使用 `pathlib.Path` 处理路径
- 使用 `PROJECT_ROOT` 作为项目根目录基准

### 3. 异步任务
- 耗时操作使用后台线程
- 避免阻塞 Flask 请求
- 安装任务需清理记录

### 4. 状态同步
- 文件系统为真相源
- 不依赖中间状态
- 定期自动刷新

---

## 开发待办

### 优先级从高往低

- [ ] **VRM、DLC、字节TTS适配**: 
- [ ] **英文界面**: 
- [ ] **拆分js，进一步模块化**: 
- [ ] **自动日志滚动选项**: 
- [ ] **插件卸载功能**: 支持从插件管理卸载社区插件
- [ ] **插件版本管理**: 显示插件版本，支持更新检测
- [ ] **LLM提供商管理**: 支持管理多个LLM配置
- [ ] **移动端适配**: 响应式布局优化


---

## 最近版本历史

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v2.6 | 2026-04-16 | 界面重构：移除FC、工具屋改名MCP管理、新增启用温度开关、版本显示优化、暗夜模式标识、复位皮套按钮迁移、样式调整 |
| v2.5.0 | 2026-03-22 | bug修复、新增历史对话 |
| v2.0.0 | 2026-03-10 | 插件安装系统完善、正式进入测试阶段 |
| v1.11.0 | 2026-03-10 | 图标支持、云端配置修复、去硬编码化 |
| v1.10.0 | 2026-03-10 | WebUI 模块化重构 |
| v1.9.0 | 2026-03-09 | 工具屋重建、配置系统重构 |

> 📝 **更新详细日志**：请查看 `webui_development_log.md` 获取详细的版本更新记录。
---

## 联系与支持

如有问题，请参考：
1. 本文档
2. `webui_development_log.md`
3. 代码注释

**开发团队**: My Neuro 开发组  
**主要贡献者**: terk  
**许可证**: 见项目根目录 LICENSE

