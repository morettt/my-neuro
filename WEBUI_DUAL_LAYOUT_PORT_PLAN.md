# 线上 my-neuro WebUI 双版面移植计划

> 目标：线上老版 WebUI **完整保留**，新增"切换版面"按钮，可一键切换到本地肥牛项目的整套新版 WebUI（含赛博主题）。
> 工作目录：`K:\neruo\tmp\pr398\verify`（morettt/my-neuro 克隆，分支 `feat/webui-cyber-layout`）
> 源版本：`K:\neruo\my-neuro-main\live-2d\webui`（本地肥牛新版 WebUI）
> 撰写日期：2026-08-20

---

## 一、现状对比（侦察结论）

### 1.1 两个 WebUI 的关系

本地肥牛的 WebUI 与线上 morettt/my-neuro 的 WebUI **已严重分叉**，本地是一个功能超前的独立大版本：

| 维度 | 线上（old） | 本地（new） |
|---|---|---|
| `templates/index.html` | 915 行 | 1327 行 |
| `static/css/style.css` | 2389 行 | 3169 行 |
| 主题系统 | 无 | `themes.css`(1099行) + `theme.js` + `galgame-deco.js`，galgame/cyber 双主题 |
| 总览仪表盘 | 无 | `overview.js` + `chart.umd.min.js` + `/api/overview` |
| 后端 py | 较小 | 多数文件多 200~800 行 |

### 1.2 Tab 对比

线上 tab（9 个）：
`dashboard` `terminal` `llm-config` `dialog-config` `voice-settings` `ui-settings` `model-manager` `market` `plugins`

本地 tab（9 个，**不同**）：
`dashboard` `basic-config`(基础配置) `persona-config`(人格设置) `llm-config` `dialog-config` `voice-settings` `ui-settings` `model-manager` `market` `plugins`

**关键差异：**
- 本地**新增**：`basic-config`（基础配置）、`persona-config`（人格设置）
- 本地**移除**：`terminal`（终端控制室）— 本地版用服务 readiness/总览替代
- 共有：dashboard / llm-config / dialog-config / voice-settings / ui-settings / model-manager / market / plugins

### 1.3 子 Tab 对比

| 面板 | 线上 | 本地 | 差异 |
|---|---|---|---|
| 云端配置 voice-settings | gateway/tts/aliyun/baidu | gateway/tts/aliyun/baidu/**volcengine** | 本地多火山引擎 |
| 日志 switchLogTab | system/pet/tool | system/pet/tool/**asr/tts/memos/chat-history** | 本地多 4 个日志页 |
| 广场 market | prompt/plugin/mcp-tools | prompt/plugin/**tool/fc** | 子项不同（mcp-tools→tool/fc） |
| 插件 plugins | builtin/community | builtin/community | 一致 |
| ui-settings | ui/motion/expression | ui/motion/expression | 一致 |
| 声音克隆 | config/train | config/train | 一致 |

### 1.4 后端 API 路由对比（本地 83 条 vs 线上 72 条）

**本地独有（12 条，移植需补）：**
```
/api/config/llm/providers/models/fetch     LLM 提供商模型列表拉取
/api/config/llm/providers/models/test      LLM 提供商连通性测试
/api/logs/runtime                          运行日志
/api/logs/service/<service>                单服务日志
/api/logs/service/<service>/clear          清空单服务日志
/api/memos/webui/start                     memos 子面板启动
/api/overview                              总览仪表盘数据
/api/plugins/open-panel                    插件独立面板
/api/plugins/panel-info                    插件面板信息
/api/services/readiness                    服务就绪状态（替代 terminal）
/api/settings/persona                      人格设置读写
/api/system/metrics                        系统/进程指标
/api/telemetry                             遥测
```

**线上独有（2 条，移植后绝不能丢）：**
```
/api/releases     检查更新（updater_bp，本地无 updater.py）
/api/webui/layout 版面切换（本计划第一步已新增）
```

### 1.5 本地独有的支撑文件（需一并搬入）

后端 py：
- `telemetry.py` — 总览/指标/遥测蓝图（telemetry_bp）
- `process_metrics.py` — 进程指标采集（Windows ctypes + POSIX 双实现）
- `state_io.py` — 状态原子读写（msvcrt/fcntl 文件锁）
- 测试：`test_config_file_lifecycle.py` `test_ptt_key_config.py` `test_telemetry_api.py`

前端：
- `static/css/themes.css`、`static/js/theme.js`、`static/js/galgame-deco.js`
- `static/js/overview.js`、`static/js/libs/chart.umd.min.js`
- `static/img/`（主题装饰图）

后端大改：`config_manager.py`(587→1403) `service_controller.py`(286→656) `plugin_manager.py`(569→746) `marketplace.py`(719→866) `log_monitor.py`(329→451) `avatar_manager.py`(190→218) `utils.py`(68→81) `main_app.py`(92→102)

**依赖自包含性已确认**：本地独有模块仅依赖标准库 + Flask + 内部蓝图，不 import live-2d 根目录的运行库，可整体搬迁。

### 1.6 云端模式（is_cloud）

- 线上：`is_cloud` 包裹 `terminal`/`model-manager` 两个 tab（共 5 处）。
- 本地：模板**无 terminal tab**，`is_cloud` 仅用于少量位置（标题等），`model-manager` 本地版**始终存在**。
- 移植时需按本地逻辑保留 `model-manager`，并把线上"云端隐藏声音克隆"的语义对齐到本地结构。

---

## 二、总体策略

采用**双版面共存**架构，老版一个像素不动：

```
                 ┌─────────────────────────────────────┐
   GET / ───────▶│  按 config.ui.webui_flavor 渲染      │
                 └─────────────────────────────────────┘
                    │                      │
        flavor=old（默认）          flavor=new
                    │                      │
        templates/index.html      templates/index_new.html   ← 本地整套
        static/css|js/*(现行)     static/new/css|js/*        ← 本地整套(隔离目录)
                    │                      │
                    └──── 共用 Flask 后端 API（合并后）──────┘
```

**核心原则：**
1. **老版文件零改动**——线上 `index.html`/`style.css`/`app.js`/locales 一律不碰。
2. **新版用隔离目录** `static/new/` + 独立模板 `index_new.html`，类名/id 冲突天然避免。
3. **后端 API 合并**：本地新版所需的新路由并入线上后端，同时保留线上独有的 `updater.py`(/api/releases) 与本计划新增的 `/api/webui/layout`。
4. **切换 = 改配置 + 跳转**，两个版面各有切换按钮，无刷新跳转 `/`。

---

## 三、命名与落地结构

新增配置项：`config.ui.webui_flavor`，取值 `old`（默认）/ `new`。
> 已定（第六节）：此前第一步用的 `webui_layout`(classic/cyber) 仅表示"是否开赛博皮"，语义不够，**改名为 `webui_flavor`(old/new)**。新版内部的 galgame/cyber 主题（`webui-theme`，localStorage）保留且正交：flavor 选"哪套壳"，theme 选"新版里的皮肤"。

新增/改动文件：

```
live-2d/webui/
├── main_app.py                      改：/ 按 flavor 渲染；注册 telemetry_bp；保留 updater_bp
├── config_manager.py                改：+webui_flavor 读写、+normalize_webui_flavor、+/api/webui/flavor
│                                    并：本地 config_manager 的新接口（persona 等）
├── service_controller.py            并：本地新版（readiness、服务管理）
├── plugin_manager.py                并：本地新版（open-panel/panel-info）
├── marketplace.py                   并：本地新版（tool/fc 子类）
├── log_monitor.py                   并：本地新版（runtime/service 日志）
├── avatar_manager.py                并：本地新版
├── utils.py                         并：本地新版（WEBUI_VERSION 等）
├── live2d_manager.py                并：本地新版
├── telemetry.py                     新增（本地）
├── process_metrics.py               新增（本地）
├── state_io.py                      新增（本地）
├── updater.py                       保留（线上独有，勿删）
├── templates/
│   ├── index.html                   不动（老版）
│   └── index_new.html               新增（本地 index.html 改名，资源路径改 /static/new/）
└── static/
    ├── css/style.css                不动（老版）
    ├── js/app.js                    不动（老版）
    ├── locales/                     不动（老版 i18n）
    └── new/                         新增（本地整套前端）
        ├── css/style.css            本地 style.css
        ├── css/themes.css           本地 themes.css
        ├── js/theme.js / galgame-deco.js / overview.js / app.js ...
        ├── js/libs/chart.umd.min.js
        ├── img/                     本地 static/img
        └── locales/                 本地 i18n（若与线上不同则独立一份）
```

---

## 四、实施步骤

### 步骤 0 · 环境准备（已完成大半）
- [x] 克隆 morettt/my-neuro，建分支 `feat/webui-cyber-layout`
- [x] 后端 `/api/webui/layout` + `normalize`（将改造为 flavor 语义）
- [ ] 回滚第一步里直接改线上 `index.html`/`cyber.css`/`cyber-layout.js` 的做法（新方案不碰老版文件，这些改为在 `index_new.html`/`static/new/` 内实现）

### 步骤 1 · 后端合并（本地为准，保留线上独有）
1. 复制本地 `telemetry.py` `process_metrics.py` `state_io.py` 到工作区。
2. 用本地版覆盖 `config_manager.py` `service_controller.py` `plugin_manager.py` `marketplace.py` `log_monitor.py` `avatar_manager.py` `utils.py` `live2d_manager.py`。
3. `main_app.py`：以本地版为基础，**补回** `updater_bp` 注册；新增 flavor 路由逻辑。
4. `config_manager.py`：在本地版基础上**补** `webui_flavor` 归一化 + `/api/webui/flavor` 读写。
5. 冒烟测试（Flask test client）：
   - 老版默认能渲染、`/api/releases` 仍可用（updater 没丢）
   - 12 条本地新 API 全部 200（或合理响应）
   - `/api/webui/flavor` 读写正常

### 步骤 2 · 新版前端落地（隔离目录）
1. 建 `static/new/`，复制本地 `css/`、`js/`、`img/`、`locales/`。
2. 复制本地 `templates/index.html` → `templates/index_new.html`。
3. 把 `index_new.html` 里所有 `/static/css/...`、`/static/js/...` 引用改为 `/static/new/css/...`、`/static/new/js/...`（**不动**老版路径）。
4. 确认新版引用的图片/字体路径指向 `/static/new/img/`。

### 步骤 3 · 切换机制（双向）
1. `main_app.py` `/`：读 `config.ui.webui_flavor` → `old` 渲染 `index.html`，`new` 渲染 `index_new.html`。
2. 老版 `index.html`：在 header 图标组加一个"切换版面"按钮（POST flavor=new + 跳转 `/`）。
   > 已确认（第六节）：这是老版**唯一**的改动，其余零改动。
3. 新版 `index_new.html`：加"返回经典版面"按钮（POST flavor=old + 跳转）。
4. 切换写 `config.ui.webui_flavor`，刷新持久生效；与新版内部 `webui-theme`(galgame/cyber) 互不干扰。

### 步骤 4 · 云端模式对齐
1. 本地新版无 `terminal` tab——确认线上云端/本地都接受这一结构（readiness + overview 已覆盖服务管理）。
2. 线上 `is_cloud` 隐藏 `model-manager` 的语义 → 在新版模板上用 `{% if not is_cloud %}` 包裹对应入口。
3. 分别用 `IS_CLOUD_VERSION=True/False` 渲染两个版面，验证裁剪正确。

### 步骤 5 · i18n
1. 新版 `locales`（zh/en）若比线上多 key（基础配置/人格设置/总览/火山引擎等），随 `static/new/locales/` 独立携带。
2. 切换按钮文案进两份 locales。

### 步骤 6 · 验证
1. Flask test client：两版面渲染、API 存活、flavor 切换、云端裁剪。
2. headless Chrome + CDP 截图：老版 9 tab、新版 9 tab（含 basic-config/persona-config/overview）、新版 galgame↔cyber 主题、切换往返、移动端。
3. 确认 `/api/releases`（检查更新）在两版面下都能调通。

### 步骤 7 · 提 PR
- 整理 diff，写 PR 说明（老版保留、新版来源、切换方式、云端适配、截图）。
- 目标仓库 morettt/my-neuro。

---

## 五、风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 本地新版后端依赖线上没有的运行时文件 | 中 | 已确认仅依赖标准库+Flask+内部蓝图；步骤1 冒烟测试兜底 |
| 新版 `model-manager` 与线上 `is_cloud` 语义冲突 | 中 | 步骤4 显式包裹 + 双模式截图验证 |
| 丢掉线上 `updater.py`(/api/releases) | 高 | 步骤1 明确保留 + 冒烟断言 `/api/releases` 200 |
| 老版被意外改动 | 高 | 老版文件零改动写进原则；步骤2 用隔离目录；diff review 时老版文件应无变化 |
| 前后端版本不匹配（新版前端调旧 API） | 中 | 后端整体用本地版覆盖，前端整套搬入，版本天然对齐 |
| 大 PR 难 review | 中 | 按"后端合并 / 前端落地 / 切换机制"分 commit；PR 说明写清架构 |

---

## 六、已确认的开放点（用户拍板 2026-08-20）

1. **老版切换入口**：✅ **老版 `index.html` 加"一个"切换版面按钮**。理由（用户原话）：不放切换口就没法切到新版。这是老版唯一改动，其余部分零改动。
2. **配置键名**：✅ 采用 `webui_flavor`（`old` / `new`）。语义为"用哪一套 WebUI"，与新版内部主题键 `webui-theme`（galgame/cyber，localStorage）严格区分。
3. **新版内部主题切换**：✅ **保留** galgame / cyber 主题切换功能。它与版面切换（old/new flavor）是正交两层：flavor 选"哪套壳"，theme 选"新版里的皮肤"。

> 三个开放点已全部确认，无遗留。可直接按步骤 1 开始实施。
