# MemOS 记忆系统

## 📁 文件夹结构

```
memos_system/
├── api/                          # API 服务
│   ├── memos_api_server.py       # 简化版服务
│   └── memos_api_server_full.py  # 完整框架版服务
├── webui/                        # Web 管理界面
│   └── memos_webui.py            # Streamlit WebUI
├── config/                       # 配置文件
│   └── memos_config.json         # MemOS 配置
├── data/                         # 数据存储
│   └── memory_store.json         # 记忆数据
├── scripts/                      # 工具脚本
│   ├── migrate_memories.py       # 迁移脚本
│   └── test_memos.py             # 测试脚本
├── docs/                         # 文档
│   ├── README.md                 # 快速参考
│   ├── MemOS快速启动指南.md
│   ├── MemOS使用说明.md
│   ├── MemOS完整框架说明.md
│   ├── MemOS功能检查清单.md
│   └── MemOS集成总结.md
└── README.md                     # 本文件
```

---

## 🚀 快速启动

### 1. 启动 API 服务
```
在项目根目录双击: MEMOS-API.bat
选择: 1 (完整框架版 - 推荐)
```

### 2. 启动 WebUI
```
在项目根目录双击: MEMOS-WebUI.bat
```

### 3. 导入记忆
```
在项目根目录双击: 迁移记忆.bat
```

---

## 📖 文档

- **快速入门**: `docs/MemOS快速启动指南.md`
- **完整说明**: `docs/MemOS使用说明.md`
- **功能检查**: `docs/MemOS功能检查清单.md`
- **完整框架**: `docs/MemOS完整框架说明.md`

---

## 🔧 配置文件

`config/memos_config.json` - MemOS 配置（完整框架版暂不使用）

---

## 💾 数据存储

`data/memory_store.json` - 所有记忆数据

---

*MemOS 记忆系统 v2.0*

