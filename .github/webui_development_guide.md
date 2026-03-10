# WebUI 开发指南

> 本文档旨在帮助新加入的开发者（包括 AI 助手）快速了解 My Neuro WebUI 项目的结构、功能和开发进度。

**文档版本**: v1.11.0  
**最后更新**: 2026-03-10  
**项目版本**: v1.11.0

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
- 声音克隆（模型文件上传、TTS 生成）
- 工具屋（Function Call / MCP Tools）
- 广场（提示词/工具/FC 工具资源市场）
- Live2D 动作管理（情绪分类、唱歌控制）

> 📝 **更新日志**：请查看 `webui_development_log.md` 获取详细的版本更新记录。

---

## 文件结构与关联

```
my-neuro-main/
│
├── webui/                       # WebUI 模块化目录
│   ├── __init__.py             # 模块入口
│   ├── utils.py                # 共享工具函数
│   ├── main_app.py             # Flask 应用初始化
│   ├── service_controller.py   # 服务控制 API
│   ├── config_manager.py       # 配置管理 API
│   ├── plugin_manager.py       # 插件管理 API
│   ├── tool_manager.py         # 工具管理 API
│   ├── marketplace.py          # 广场与资源 API
│   └── log_monitor.py          # 日志监控 API
│
├── webui_controller.py          # 后端入口（兼容旧版）
├── 启动 WebUI 控制面板.bat         # 启动脚本
│
├── templates/                    # HTML 模板目录
│   └── index.html               # 主页面模板
│
├── static/                       # 静态资源目录
│   ├── css/
│   │   └── style.css            # 样式表
│   └── js/
│       └── app.js               # 前端 JavaScript
│
├── live-2d/                      # Live2D 桌宠目录
│   ├── go.bat                   # 桌宠启动脚本
│   ├── runtime.log              # 实时日志
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
└── .github/
    ├── webui_development_guide.md     # 开发指南（本文档）
    └── webui_development_log.md       # 开发日志
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

### 已完成功能 (v1.11.0)

| 功能模块 | 状态 | 说明 |
|----------|------|------|
| 服务控制 | ✅ 完成 | 启动/停止/状态检测 |
| 配置管理 | ✅ 完成 | 所有配置项的读写 |
| 日志系统 | ✅ 完成 | 系统/桌宠/工具三日志系统 |
| 声音克隆 | ✅ 完成 | 模型文件上传、bat 文件生成 |
| 工具屋 | ✅ 完成 | Function Call / MCP Tools |
| 广场 | ✅ 完成 | 提示词/工具/FC 工具资源市场 |
| Live2D 动作管理 | ✅ 完成 | 6 情绪分类、唱歌控制 |
| 云端配置 | ✅ 完成 | 云端肥牛、云端 TTS、阿里云 TTS、百度流式 ASR |
| 插件系统 | ✅ 完成 | 自动扫描、启用/禁用 |

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

### 2. 日志系统

**日志来源**:
- `live-2d/runtime.log` - 桌宠和工具日志
- `logs/asr.log` - ASR 日志
- `logs/tts.log` - TTS 日志

**日志过滤**:
- **桌宠日志**: 不包含 `[TOOL]` 的行
- **工具日志**: 包含 `[TOOL]` 的行

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

---

## 开发规范

### 1. DOM 操作安全

使用安全函数避免 null 错误：
```javascript
function _setVal(id, value) { 
    const el = document.getElementById(id); 
    if (el && document.activeElement !== el) el.value = value; 
}
function _setChk(id, value) { 
    const el = document.getElementById(id); 
    if (el) el.checked = value; 
}
```

### 2. 配置项命名规范

- 前端使用 kebab-case：`tts-enabled`
- 后端使用 snake_case：`tts_enabled`

---

## 修改指南

| 要修改的内容 | 编辑的文件 |
|-------------|-----------|
| UI 布局/选项卡 | `templates/index.html` |
| 样式/颜色/字体 | `static/css/style.css` |
| 前端交互逻辑 | `static/js/app.js` |
| 后端 API | `webui/*.py` |
## 开发待办

### 高优先级（当前任务）

- [ ] **验证所有配置项保存功能** - 确保每个复选框都能正常保存
- [ ] **添加配置保存成功提示** - 用户操作反馈
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

---

## 联系与支持

如有问题，请参考：
1. 本文档
2. `webui_development_log.md`
3. 代码注释

**开发团队**: My Neuro 开发组
**主要贡献者**: terk 
**许可证**: 参考项目根目录 LICENSE
