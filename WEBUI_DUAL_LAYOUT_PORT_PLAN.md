# 线上 my-neuro 双版面 WebUI + 通讯录运行时移植计划（方案 D）

> **本文件获批前，不得改实现代码、正式素材、运行配置或外部状态。**
> 用户要求「写计划」只授权写本文件，不授权开始实施。
> 实施必须以本文为准。若要改范围、技术方向或验收标准，必须先改本文件并再次取得批准。

---

## 〇、给执行者的入口说明

你是一个全新对话，只凭这份计划干活。不要凭旧计划、聊天记忆或「把本地 py 整文件盖上去」的直觉实施。

| 项 | 值 |
|---|---|
| 工作目录 | `K:\neruo\tmp\pr398\verify`（morettt/my-neuro 克隆，分支 `feat/webui-cyber-layout`） |
| 源版本（只读参考，禁止改源） | `K:\neruo\my-neuro-main`（本地肥牛） |
| 目标仓库 | morettt/my-neuro |
| 选定方案 | **方案 D**（见第一节） |
| 默认版面 | **新版**。第一次打开 WebUI 必须是新版，用户可切回旧版 |
| 撰写日期 | 2026-08-20 |

源与目标的路径对照：

- 源 WebUI：`K:\neruo\my-neuro-main\live-2d\webui\`
- 源桌宠 JS：`K:\neruo\my-neuro-main\live-2d\js\`
- 源预览库：`K:\neruo\my-neuro-main\live-2d\libs\v2\`
- 目标 WebUI：`K:\neruo\tmp\pr398\verify\live-2d\webui\`
- 目标桌宠 JS：`K:\neruo\tmp\pr398\verify\live-2d\js\`
- 目标预览库目录（目前不存在 v2）：`K:\neruo\tmp\pr398\verify\live-2d\libs\`

**禁止把参考稿、只改了 HTML 路径、或「API 能 200」汇报成最终完成。** 汇报必须区分：计划 / 参考稿 / 临时成果 / 正式成果 / 已接入 / 已验收。

---

## 一、目标

1. 线上老版 WebUI **完整保留**（只允许改一处：header 加「切到新版」按钮）。
2. 新增整套新版 WebUI（肥牛外观：galgame / cyber 双主题、总览仪表盘、基础配置、人格设置、通讯录式 LLM 页、火山 TTS 表单、更多日志页、广场 tool/fc 子 tab）。
3. 打开 WebUI 时 **默认就是新版**。用户可一键切到旧版，再一键切回来。选择写入 `config.json`，刷新后仍生效。
4. 桌宠运行时升级为「LLM 通讯录」：新版页面里保存的服务商/模型，桌宠说话、语音、压缩上下文、插件 `callLLM` 都真的用这一套。旧三格（`api_key` / `api_url` / `model`）首次启动时迁进通讯录，之后由通讯录驱动。
5. 旧版 LLM 页不能坏：三格表单继续能读写「当前正在用的那一条」。
6. **不迁肥牛小屋，不迁人格导演。** 新版仪表盘去掉「打开肥牛小屋」按钮；不要复制这两个插件目录。

---

## 二、选定方案（方案 D）是什么、不是什么

### 2.1 方案 D 定义（必须按这个做）

方案 D = 下面全部加在一起：

1. **双版面 WebUI**：老壳不动，新壳放隔离目录。
2. **通讯录运行时**：桌宠真正改成按 `provider_id` / `model_id` + `llm_providers.json` 打电话。
3. **新版其余能力**：主题、总览、telemetry 落盘、`libs/v2` 预览库、MemOS 启动路径适配、检查更新入口、火山 TTS 表单、保底模型字段、插件配置里的「选通讯录模型」下拉（有 schema 才显示）、`config.example.json`、gitignore 忽略密钥本。
4. **明确排除**：肥牛小屋插件（`built-in/auto-act`）、人格导演插件（`built-in/companion-director`）、以及任何把整份肥牛仓库倒进线上的做法。

### 2.2 禁止的错误做法

- 禁止用本地 `config_manager.py` / `service_controller.py` / `llm-handler.js` / `main.js` / `plugin-context.js` **整文件覆盖**线上文件。
- 禁止把本地 `llm-handler.js` 整份拷进来。它依赖肥牛独有的 `scene-routing-service.js`、`scene-tag-protocol.js`、`prompt-cache-aligner.js` 等，线上没有，拷进去桌宠会直接起不来。
- 禁止在 GET `/api/config/llm` 时把 `config.llm.api_key` 擦掉却还不写进 `llm_providers.json`。
- 禁止默认 flavor 写成 `old`。产品要求默认新版。

---

## 三、真实现状（2026-08-20 只读核对，以工作树为准）

### 3.1 当前工作树并没有「第一步已完成」

旧计划里勾掉的 `/api/webui/layout`、`cyber.css`、`cyber-layout.js` **在当前 `feat/webui-cyber-layout` 工作树里不存在**。全库搜索只有旧计划自己提到它们。有备份分支 `backup/cyber-css-approach`，那是已放弃的赛博皮方案，不要捡回来。

当前目标 `main_app.py` 的 `/` 仍然永远渲染 `index.html`。flavor API 要从零加。

### 3.2 两个 WebUI

| 维度 | 线上（旧，目标现状） | 本地肥牛（新，源） |
|---|---|---|
| 模板 | `templates/index.html` 约 915 行 | 约 1327 行 |
| 主题 | 无 | `themes.css` + `theme.js` + `galgame-deco.js`，localStorage 键 `webui-theme` |
| 总览 | 无 | `overview.js` + `chart.umd.min.js` + `/api/overview` |
| 检查更新 | header 按钮 + `releases.js` + `/api/releases` | 无此按钮 |
| 云端裁剪 `is_cloud` | 藏 `terminal` 和 `model-manager` | 模板零引用 |

**线上 tab（9 个）：** dashboard、terminal、llm-config、dialog-config、voice-settings、ui-settings、model-manager、market、plugins。

**本地 tab（10 个，不是 9 个）：** dashboard（服务控制）、basic-config、dialog-config、persona-config、llm-config、voice-settings、ui-settings、model-manager、market、plugins。本地没有独立「终端控制室」，服务启停合进 dashboard。

广场：线上 HTML 子 tab 叫 `mcp-tools`；本地叫 `tool` / `fc`。两边后端 **都已经有** `/api/market/tools` 和 `/api/market/fc-tools`，不要当成缺路由。

旧计划写的 `static/img/` **不存在**。樱花是 CSS 粒子，没有主题图可搬。

### 3.3 后端契约已经分叉（这是本计划的核心风险）

同一条 URL，两边含义不同。方案 D 必须做兼容，不能只保新前端。

**`GET/POST /api/config/llm`**

- 旧前端读写：`api_key`、`api_url`、`model`、`temperature`、`system_prompt`
- 新前端读写：`providers`、`provider_id`、`model_id`、`fallback_*`
- 本地 `apply_selections_and_scrub()` 会清空 `config.llm.api_key` / `api_url` / `model`
- 线上桌宠 `js/ai/llm-client.js` 仍读 `config.llm.api_key`

若只覆盖后端、不改桌宠且不桥梁：旧 LLM 页变空，桌宠失联。

**`GET/POST /api/settings/advanced`**

- 旧前端要：`bert_enabled`、`vision_model`（三个输入框）
- 新前端要：`ptt_key`、`ptt_enabled`、`vision_model_ref`、`tools_enabled`
- 覆盖后旧「功能配置」里的 BERT / 视觉三格会坏

**`GET /api/system/info`**

- 旧前端：`data.neuro_version` → `#neuro-version`
- 新前端：`data.version` → `#webui-version`
- 必须两个字段都返回

### 3.4 桌宠运行时（目标现状）

线上 `live-2d/js/ai/llm-client.js` 构造函数只认 `config.llm.api_key`。  
线上没有：`llm-provider.js`、`llm-provider-store.js`、`telemetry.js`、`config-store.js`、`libs/v2/`。  
线上已有（不要当新功能重做）：火山 TTS 运行时、PTT、`event-bus.js`、`events.js`。

线上会直接用旧三格的位置：

- `js/ai/llm-handler.js`：`new LLMClient(config)`；视觉走 `config.vision.vision_model`
- `js/ai/conversation/VoiceChatFacade.js`：`this.API_KEY = config.llm.api_key`
- `js/ai/ContextCompressor.js`：请求头用 `config.llm.api_key`
- `js/live/barrage-manager.js`：`new LLMClient(config)`
- `js/core/plugin-context.js`：`callLLM` 用 `voiceChat.API_KEY`
- `live-2d/main.js` 的 `save-config`：整份 `config.json` 写盘，不拆通讯录

### 3.5 路径与环境差异

- 新版 `index.html` 引用 `/live-2d/libs/v2/live2dcubismcore.min.js` 等 4 个脚本。线上只有 `live-2d/libs/`（无 `v2/`，无 `index.min.js`）。不拷 v2、不改引用，新版 Live2D 预览 404。
- MemOS 脚本：本地/线上 WebUI 代码都写 `PROJECT_ROOT.parent / 'memos_system'`。线上实际目录是 `plugins-dlc/memos/memos_system/`（含 `start_memos.bat` 和 `启动WebUI_Cyberpunk.bat`）。
- 本地 `config_manager` 缺 `config.json` 时要读 `config.example.json`。线上 WebUI 没有这个模板。
- 线上 `.gitignore` 目前 **不忽略** `live-2d/config.json`，也 **不忽略** `llm_providers.json`。密钥本必须补进 gitignore。
- i18n 的 `loadPath` 是相对路径 `static/locales/{{lng}}/translation.json`，相对的是页面 URL `/`，不是脚本所在目录。只改 HTML 的 script 标签，新版仍会去加载旧版词条。
- 新版 HTML 路径不统一：头部是 `/static/css/...`，底部是 `static/js/theme.js`（无前导斜杠）。两套都要改。
- 本地 `main_app.py` 在 `GET /` 里调用 `find_free_port()` 再传 `port` 给模板，模板根本不用这个变量。不要把这行抄过来。

### 3.6 依赖自包含性

通讯录相关新模块只依赖 Node 标准库 + 现有 `api-utils` / `event-bus`。  
WebUI 新模块 `telemetry.py` / `process_metrics.py` / `state_io.py` 只依赖标准库 + Flask + 内部蓝图。  
不要 import `live-2d` 根目录之外的肥牛专用运行库。

---

## 四、工作范围

1. 双版面：`index_new.html` + `static/new/`，`GET /` 按 `config.ui.webui_flavor` 选模板，**缺省为 `new`**。
2. 切换 API：`GET/POST /api/webui/flavor`。
3. 通讯录：拷新文件 + **外科手术式**改线上现有 JS（见第六节），不要整文件替换心脏文件。
4. WebUI 后端：在线上文件上做加性合并与双契约，保留 `updater.py`。
5. 拷 `libs/v2`、telemetry 链路、总览前端、主题、测试、gitignore、脱敏 `config.example.json`。
6. MemOS 路径双候选。
7. 新版补上「检查更新」（复用线上 `releases.js` 逻辑，走 `/api/releases`）。
8. 新版去掉小屋按钮；云端模式给新模板补 `is_cloud` 裁剪。

---

## 五、明确不做的内容

1. 不复制、不接入 `live-2d/plugins/built-in/auto-act`（肥牛小屋）。
2. 不复制、不接入 `live-2d/plugins/built-in/companion-director`（人格导演）。
3. 不把肥牛其它独有插件（如 `feiniu-draw-guess`、`codex-bridge`、`world-eye` 那套）整包拷进线上。
4. 不把本地 `llm-handler.js`、`main.js`、`plugin-context.js`、`config_manager.py`、`service_controller.py` 整文件覆盖到目标。
5. 不把场景路由、小屋行走、prompt-cache 整条链路当成本次必做（那些是肥牛 `llm-handler.js` 的其它依赖，不是通讯录最小集）。
6. 不改旧版 `static/css/style.css`、`static/js/app.js`、`static/js/releases.js`、`static/locales/**`。
7. 不删除 `updater.py`，不让 `/api/releases` 消失。
8. 不提交 `live-2d/llm_providers.json`、不把真实 API Key 写进 `config.example.json` 或 git。
9. 不把用户本机 `K:\neruo\my-neuro-main\live-2d\config.json` 拷到目标仓库。
10. 不恢复已放弃的 `cyber.css` / `cyber-layout.js` / `/api/webui/layout` 方案。
11. 本次不改 Qt 桌面设置窗（`test.py` 那套），只动 WebUI + Electron/Node 桌宠。

---

## 六、架构与关键设计（执行前先读懂）

### 6.1 双版面

```
GET /  读取 config.ui.webui_flavor（缺省/空/非法 → new）
    flavor=new  → templates/index_new.html + /static/new/...
    flavor=old  → templates/index.html     + /static/...（现行老文件）
两边共用合并后的 Flask API
```

两层开关互不干扰：

| 层 | 键 | 取值 | 存哪 |
|---|---|---|---|
| 版面 | `config.ui.webui_flavor` | `new`（默认）/ `old` | `config.json` |
| 新版皮肤 | `webui-theme` | `galgame` / `cyber` | 浏览器 localStorage |

旧实验值映射：`classic` → `old`；`cyber`（若出现在 flavor 而不是 theme）→ `new`。`webui_layout` 若偶尔写在配置里，只在 normalize 时读一次，不要作为正式键名继续用。

### 6.2 通讯录（桌宠侧）

旧世界：`config.json` 里 `llm.api_key` / `api_url` / `model`。  
新世界：

- `live-2d/llm_providers.json`：服务商列表（含密钥），gitignore。
- `config.json` 的 `llm` 只留 `provider_id`、`model_id`、`system_prompt`、`retry`。
- 内存里 `config.llm_providers` 由 store 注入，禁止写回 `config.json`。

第一次启动（还没有 `llm_providers.json`，但旧三格有值）：

1. 用旧 `api_key` + `api_url` 生成一个 provider（id 建议 `main`）。
2. 把旧 `model` 放进该 provider 的 `models`。
3. 写入 `llm_providers.json`。
4. 设置 `config.llm.provider_id = "main"`，`model_id` 为旧模型名。
5. **可以**把 `config.json` 里的 `api_key` 清成空字符串，但必须已经成功写入通讯录。写盘失败则禁止清洗。
6. 建议先备份 `config.json` 为 `config.json.pre-provider.bak`（仅当该备份尚不存在时）。

源文件行为以 `K:\neruo\my-neuro-main\live-2d\js\core\llm-provider-store.js` 的 `persistProviderStore` / `ensureProviderStore` 为准，拷到目标后不要改迁移语义。

### 6.3 旧版 WebUI 的桥（双契约）

`/api/config/llm` 必须同时服务两套前端。按 **请求体形状** 判断，不要按 flavor 判断（避免切版面后另一个页签还开着时打错契约）。

**GET 始终返回超集**，新旧字段都给：

```json
{
  "api_key": "<当前解析出的 key>",
  "api_url": "<当前解析出的 url>",
  "model": "<当前解析出的 model_id>",
  "temperature": 0.9,
  "temperature_enabled": false,
  "system_prompt": "...",
  "providers": [ ... ],
  "provider_id": "main",
  "model_id": "...",
  "fallback_model_ref": "",
  "fallback_provider_id": "",
  "fallback_model_id": ""
}
```

其中 `api_key` / `api_url` / `model` 从通讯录里 **当前选中的 provider+model** 填出来，供旧前端三格使用。不要从已经清空的 `config.llm.api_key` 读。

**POST：**

- 若 body 含 `providers` 数组（新前端）→ 按通讯录保存：写 `llm_providers.json`，更新 `provider_id` / `model_id` / `system_prompt` / fallback。
- 若 body 含 `api_key` 或 `api_url` 或 `model` 且不含 `providers`（旧前端）→ 把这三格写进当前 provider（没有当前 provider 就创建 `main`），并更新 `model_id`。`system_prompt` 两边都要能存。
- 禁止只收新字段、把旧 POST 当空操作还返回 success。

视觉同理：

- 旧：`vision.vision_model.{api_key,api_url,model}`
- 新：`vision.provider_id` + `vision.model_id`（前端合成 `vision_model_ref`）
- GET `/api/settings/advanced` 两套都返回。旧 POST 带 `vision_model` 必须仍能保存。新 POST 带 `vision_model_ref` 必须仍能保存。`bert_enabled` 必须保留，不得删掉线上这个字段。

### 6.4 肥牛小屋 / 人格导演怎么「不加」

- 不拷插件目录。
- 从源 `index.html` 拷成 `index_new.html` 之后，**删掉** 服务控制栏里的按钮：`<button ... onclick="openFeiniuHouse()" id="feiniu-house-open">打开肥牛小屋</button>`。
- 源 `plugin_manager.py` 里 `has_local_panel` 只对 `built-in/auto-act` 和 `built-in/companion-director` 为真。目标侧：这两个插件目录不存在，就不要把 `has_local_panel` 标真。可以保留 `panel-info` / `open-panel` 路由（没有插件时 404），这样以后若用户自己装了也不至于崩；但本次不要为它们做入口按钮。
- 源 `app.js` 里的 `openFeiniuHouse()` 可以留着当死函数，只要 HTML 没有按钮就不会被点到。更干净的做法：删掉该按钮后，相关函数可保留也可删，不影响验收。

---

## 七、涉及的模块与落地结构

### 7.1 新增文件（从源拷到目标，再按本节改）

从源拷到目标同相对路径：

```
live-2d/js/core/llm-provider.js
live-2d/js/core/llm-provider-store.js
live-2d/js/core/telemetry.js
live-2d/js/core/config-store.js          仅当 7.3 决定采用 ConfigStore 时才拷；默认不替换 config-loader，见 8.2
live-2d/webui/telemetry.py
live-2d/webui/process_metrics.py
live-2d/webui/state_io.py
live-2d/webui/test_telemetry_api.py
live-2d/webui/test_config_file_lifecycle.py   仅当引入缺文件复制逻辑时
live-2d/webui/test_ptt_key_config.py
live-2d/scripts/test-telemetry.js
live-2d/scripts/test-plugin-context-llm.js
live-2d/libs/v2/                            整目录拷贝
```

WebUI 新前端隔离目录（不要覆盖老 `static/`）：

```
live-2d/webui/templates/index_new.html
live-2d/webui/static/new/css/style.css
live-2d/webui/static/new/css/themes.css
live-2d/webui/static/new/js/app.js
live-2d/webui/static/new/js/theme.js
live-2d/webui/static/new/js/galgame-deco.js
live-2d/webui/static/new/js/overview.js
live-2d/webui/static/new/js/i18n.js
live-2d/webui/static/new/js/releases.js      从线上 static/js/releases.js 复制再改路径（若有）
live-2d/webui/static/new/js/libs/            i18next* + chart.umd.min.js
live-2d/webui/static/new/locales/zh/translation.json
live-2d/webui/static/new/locales/en/translation.json
```

另造：

```
live-2d/config.example.json                 脱敏模板，不要含真实密钥
```

### 7.2 改现有文件（合并，禁止整文件覆盖）

| 文件 | 做法 |
|---|---|
| `live-2d/webui/main_app.py` | 注册 `telemetry_bp` + 保留 `updater_bp`；`/` 按 flavor 选模板；启动 `process_metrics.start_sampler()` |
| `live-2d/webui/config_manager.py` | 加 flavor、通讯录读写、双契约 LLM、persona、volcengine、ptt；保留 bert / vision_model |
| `live-2d/webui/utils.py` | 加 `WEBUI_VERSION`、`SERVICE_PORTS`、`SERVICE_LOG_SERVICES`、`service_log_files`、`DATA_ROOT` 的 try/except；不要删现有符号 |
| `live-2d/webui/service_controller.py` | 加 readiness、memos webui start、info 双字段、MemOS 双路径；保留现有 start/stop |
| `live-2d/webui/log_monitor.py` | 加 `/api/logs/runtime` 与 `/api/logs/service/<service>`，保留旧 `/api/logs/<type>` |
| `live-2d/webui/plugin_manager.py` | 加 panel-info/open-panel；`has_local_panel` 仅当插件目录真的存在 |
| `live-2d/webui/marketplace.py` | 仅当 diff 显示有必要的行为修复时才合并；路由两边已有 tool/fc，禁止为了「对齐行数」整文件覆盖 |
| `live-2d/webui/tool_manager.py` | 若改用 `state_io`，从源合并锁逻辑，保持现有 API 路径不变 |
| `live-2d/webui/templates/index.html` | **只**在 header 图标组加「切到新版」按钮 |
| `live-2d/js/core/config-loader.js` | load 成功后调用 persistProviderStore + llmProviderManager.init |
| `live-2d/main.js` | save-config / 启动加载时拆写 `llm_providers.json`，config 里删 `llm_providers` |
| `live-2d/js/ai/llm-client.js` | 兼容平铺 resolved 对象 + `fromProviderConfig`；可选接 telemetry；不要换成依赖 prompt-cache 的整份源文件 |
| `live-2d/js/ai/llm-handler.js` | 只改进客户端创建与视觉解析 + 保底模型；不要整份替换 |
| `live-2d/js/ai/conversation/VoiceChatFacade.js` | 用 resolveProviderOrFallback 填 API_KEY/URL/MODEL |
| `live-2d/js/ai/ContextCompressor.js` | 请求改走解析后的 key/url/model |
| `live-2d/js/live/barrage-manager.js` | `new LLMClient` 改为 fromProviderConfig 或仍能吃完整 config（见 8.2） |
| `live-2d/js/core/plugin-context.js` | `callLLM` 增加 provider 解析；保留旧 `voiceChat.API_KEY` 回退 |
| `live-2d/js/ai/tool-executor.js` | 加 `emitTelemetry` 调用，不要换整文件除非依赖闭合 |
| `.gitignore` | 增加 `live-2d/llm_providers.json`、`live-2d/.runtime/`、`live-2d/config.json.pre-provider.bak` |
| 若目标跟踪 `live-2d/config.json` | 可写入 `"webui_flavor": "new"`；代码缺省也必须是 new |

`live2d_manager.py` / `avatar_manager.py`：先 `diff` 源与目标。若只是行数接近、行为无通讯录/新版依赖，**不要动**。

### 7.3 不要从源拷的东西

- `live-2d/plugins/built-in/auto-act/**`
- `live-2d/plugins/built-in/companion-director/**`
- 源的 `live-2d/config.json`（含本机密钥）
- 源 `llm-handler.js` 整文件
- 已放弃的 cyber-css 方案文件

---

## 八、逐步执行流程

每一步结束必须达到该步的「完成门闩」，才能进入下一步。不要平行把前端和整文件后端覆盖混在一起。

### 步骤 0 · 工作树复位确认

1. 在 `K:\neruo\tmp\pr398\verify` 确认当前分支是 `feat/webui-cyber-layout`。
2. 确认 **没有** `cyber.css`、`cyber-layout.js`、`/api/webui/layout`。若有残留，删掉赛博皮方案文件，恢复被改过的老 `index.html` 到「只差一个切换按钮」之前的线上原样。
3. 不要去合并 `backup/cyber-css-approach`。

**完成门闩：** 老版 `index.html` / `style.css` / `app.js` 与线上原版一致（或仅有你尚未做的切换按钮）；仓库能启动 Flask。

### 步骤 1 · 通讯录运行时（桌宠先能打电话）

**原则：拷新文件 + 补丁现有文件。禁止整文件替换 llm-handler / main / plugin-context。**

#### 1.1 拷新核心文件

把源的这两个文件原样放到目标：

- `live-2d/js/core/llm-provider-store.js`
- `live-2d/js/core/llm-provider.js`

把源的 `live-2d/js/core/telemetry.js` 原样放到目标（总览依赖桌宠往 `.runtime/telemetry.jsonl` 写事件）。

#### 1.2 打补丁 `config-loader.js`

文件：目标 `live-2d/js/core/config-loader.js`。  
在现有 `load()` 里，JSON 解析成功、`this.config` 赋值之后、`return` 之前插入：

1. `const path = require('path');`（若文件已有则不重复）。
2. `const { persistProviderStore } = require('./llm-provider-store.js');`
3. `const { llmProviderManager } = require('./llm-provider.js');`
4. `const baseDir = path.dirname(this.configPath);`
5. `persistProviderStore(baseDir, null, this.config);`
6. `llmProviderManager.init(this.config);`

不要整文件换成源 `config-loader.js`（源依赖 `ConfigStore`、事件热更新，线上没有这套调用链，换了容易把启动打崩）。

默认 **不要** 替换整个 `config-loader`。`config-store.js` 因此默认不拷。若后续发现线上保存配置会把 `llm_providers` 写回 `config.json`，再在步骤 1.3 的 `main.js` 里删掉该键，而不是先换 loader。

#### 1.3 打补丁 `main.js`

文件：目标 `live-2d/main.js`。

1. 顶部增加：`const { persistProviderStore } = require('./js/core/llm-provider-store')`
2. 增加 `configBaseDir`：与 `config.json` 同目录（`path.dirname(configPath)`）。
3. 启动时第一次读 `config.json` 之后（现有 `loadConfigData()` 的调用点），对读出的对象调用 `persistProviderStore(configBaseDir, null, configData)`，然后 `delete persistable.llm_providers` 再写回磁盘 **仅当 store 报告 config 需要清洗**。如果 `persistProviderStore` 已经自己写 config，就不要再写一遍互相打架——以源 `main.js` 约 743–784 行的顺序为参考，但必须嵌进目标现有的 backup + dialog 流程，不要删掉目标「保存后询问是否重启」的对话框。
4. `ipcMain.handle('save-config', ...)` 里，在 `writeFileSync` 之前：

```javascript
const preparedConfig = JSON.parse(JSON.stringify(configData));
persistProviderStore(configBaseDir, null, preparedConfig);
delete preparedConfig.llm_providers;
fs.writeFileSync(configPath, JSON.stringify(preparedConfig, null, 2), 'utf8');
```

不要把源 `main.js` 整份拷过来（目标有一套自己的 avatar switch / shortcut 逻辑）。

#### 1.4 打补丁 `llm-client.js`

文件：目标 `live-2d/js/ai/llm-client.js`。

现在构造函数是 `this.apiKey = config.llm.api_key`。改成与源相同的兼容策略（源文件前 55 行），但 **不要** 引入 `PromptCachePolicy` / `text-tool-call-utils` / `applyThinkingContentFilter`，除非这些文件在目标里已经存在（当前不存在）。

最小补丁：

```javascript
constructor(config) {
    const llmConfig = (config && config.llm) ? config.llm : (config || {});
    this.apiKey = llmConfig.api_key;
    this.apiUrl = llmConfig.api_url;
    this.model = llmConfig.model;
    this.providerId = llmConfig.id || llmConfig.provider_id || '';
    this.temperature = llmConfig.temperature || 1.0;
    this.temperatureEnabled = llmConfig.temperature_enabled ?? false;
}
static fromProviderConfig(resolved, retryConfig) {
    return new LLMClient({ ...resolved, retry: retryConfig || resolved.retry || {} });
}
```

在请求成功/失败处若能安全 `require('../core/telemetry.js')` 的 `emitTelemetry`，就加上；失败必须吞掉，不能影响对话。参考源 `telemetry.js` 的硬规则：剥离密钥和正文。

#### 1.5 打补丁 `llm-handler.js`

文件：目标 `live-2d/js/ai/llm-handler.js`。  
只改 `createEnhancedSendToLLM` 开头创建 client 的那一段（约第 27–42 行），改成：

1. `require('../core/llm-provider.js')` 的 `llmProviderManager`。
2. `resolved = llmProviderManager.resolveProviderOrFallback(config.llm?.provider_id, config.llm?.model_id)`。
3. 有 resolved 就 `LLMClient.fromProviderConfig(resolved, config.llm?.retry)`，否则 `new LLMClient(config)`（旧三格回退）。
4. 视觉：若 `config.vision.use_vision_model`：
   - 优先 `config.vision.provider_id` → resolveProviderOrFallback；
   - 否则回退 `config.vision.vision_model` 三格（保持线上现有行为）。
5. 保底模型：若 `config.llm.retry.fallback_provider_id` 或 `fallback_model_id` 有值，再 resolve 一个 fallbackClient。主模型请求失败/空回复时再试保底。若与主模型相同则跳过。实现时对照源 `llm-handler.js` 约 391–419 行，但不要把 scene routing 一起搬进来。

#### 1.6 打补丁其它调用点

**VoiceChatFacade.js**（目标 `js/ai/conversation/VoiceChatFacade.js` 约 27–30 行）：按源文件 28–40 行，用 `resolveProviderOrFallback` 填 `this.API_KEY` / `API_URL` / `MODEL`，失败回退旧字段。

**ContextCompressor.js**：把写死的 `this.config.llm.api_key` / `api_url` / `model` 改成先 resolve，再回退旧字段。不要留下「只改了一处、另一处还在读空 key」的洞。全文搜索目标 `live-2d/js` 里的 `config.llm.api_key`，步骤 1 结束时对话链路上不应再有漏网（测试脚本和注释除外）。

**barrage-manager.js**：`this.llmClient = new LLMClient(config)` 在 provider 初始化之后应能工作（因为 LLMClient 仍接受完整 config）。若此时 `config.llm.api_key` 已空，必须改成 fromProviderConfig。所以这里 **要改**，不要赌「旧字段还在」。

**plugin-context.js** 的 `callLLM`：在现有 `voiceChat.API_KEY` 逻辑之前，若 `options.provider_id` 或全局 provider 能 resolve，就用 resolved 的 url/key/model 发请求；否则保持现在的 voiceChat 回退。对照源 `plugin-context.js` 145–180 行附近，但不要把源文件后半段 motion-director / prompt-cache 依赖一起拷进来。`test-plugin-context-llm.js` 拷过来后，按目标实际导出的方法改断言，跑不通就修补丁，不要为了绿测去拷整个源 plugin-context。

**tool-executor.js**：在工具开始/结束处加 `emitTelemetry`，参考源文件对 `cat: 'tool'` 的调用。require 失败或写盘失败必须吞掉。

#### 1.7 gitignore

在目标根目录 `.gitignore` 增加：

```
live-2d/llm_providers.json
live-2d/.runtime/
live-2d/config.json.pre-provider.bak
```

#### 1.8 步骤 1 测试（完成门闩）

准备一份临时 `config.json`，只含旧三格（有假的 api_url/model，key 可用占位符）。在隔离目录跑：

1. `node -e` 或小脚本：load config-loader → 应生成 `llm_providers.json`，里面有 `main`（或迁移出的 provider），`models` 含旧模型名。
2. 再 load 一次：不应把通讯录清空，不应重复造一堆 provider。
3. `llmProviderManager.resolveProviderOrFallback()` 返回的 `api_url` 与旧三格一致。
4. `node live-2d/scripts/test-telemetry.js`（拷过来后）通过。
5. 全文搜索：桌宠对话链路上 `config.llm.api_key` 不再是唯一数据源。

**未通过不得进入步骤 2。**

### 步骤 2 · WebUI 后端加性合并

工作文件都在目标 `live-2d/webui/`。源文件只作参考。

#### 2.1 拷纯新模块

拷：`telemetry.py`、`process_metrics.py`、`state_io.py`。

`telemetry.py` 读 `PROJECT_ROOT/.runtime/telemetry.jsonl`，与桌宠 `telemetry.js` 一致。不要改路径。

#### 2.2 `utils.py`

保留现有 `PROJECT_ROOT`、`IS_CLOUD_VERSION`、`service_processes`、`service_pids`、`LOG_FILE_PATHS`、`find_free_port`、`is_service_running`。  
增加源里有而目标没有的：`WEBUI_VERSION`（可用 `'v2.5'` 或与源一致）、`DATA_ROOT`、`service_log_files`、`SERVICE_PORTS`、`SERVICE_LOG_SERVICES`。  
`IS_CLOUD_VERSION` 的探测逻辑用源的 try/except 包一层，避免目录不存在时抛错。

#### 2.3 `config_manager.py`（本步最容易写坏，按清单改）

从源 **复制函数，不要覆盖整个文件**：

- provider store 那一段（源约 `PROVIDER_STORE_PATH` 到 `ensure_provider_store` / `apply_selections_and_scrub`）。
- **改 `apply_selections_and_scrub`：** 只有在 `llm_providers.json` 已经成功写出之后，才允许清空 `config.llm.api_key`。若你无法保证顺序，这一步可以 **暂时不清洗旧字段**，只做注入和迁移。宁可旧字段与通讯录同时存在，也不许只擦不迁。
- `normalize_webui_flavor(value)`：`new`/`old` 原样；`classic`→`old`；空/非法/`cyber`（出现在 flavor 槽）→ **`new`**（产品默认新版）。
- 路由 `GET/POST /api/webui/flavor`：读写真身 `config.ui.webui_flavor`；GET 缺省返回 `new`；POST body `{ "flavor": "old" | "new" }`，非法 400。
- `/api/config/llm` 改成 6.3 的双契约。把源的 `/api/config/llm/providers/models/fetch` 和 `/test` 原样加进来。
- 增加 `/api/settings/persona`（只读写 `llm.system_prompt`）。
- `/api/settings/voice`：GET 增加 `volcengine_tts`；POST 仅当 body 含该键才更新。旧前端不带该键时不得把火山配置抹掉。
- `/api/settings/advanced`：响应和保存必须同时支持旧字段（`bert_enabled`、`vision_model`）和新字段（`ptt_*`、`vision_model_ref`、`tools_enabled`）。旧 POST 不带 ptt 时，不要用默认值把用户已有 `ptt_key` 覆盖坏；用「仅当键存在才写」。
- 若引入源的「缺 config.json 就从模板复制」：必须同时落下 `live-2d/config.example.json`（从目标现有 `config.json` 结构脱敏：清空所有 key/token/prompt 个人信息，补 `ui.webui_flavor: "new"` 和空的 `llm.provider_id`）。没有模板就不要引入该逻辑。

#### 2.4 `main_app.py`

1. 保留 `from .updater import updater_bp` 和 `register_blueprint(updater_bp)`。
2. 增加 `from .telemetry import telemetry_bp` 并注册。
3. `from . import process_metrics`，`create_app` 里 `process_metrics.start_sampler()`，异常吞掉。
4. `/` 路由：

```python
from .config_manager import load_config, normalize_webui_flavor
flavor = normalize_webui_flavor((load_config().get('ui') or {}).get('webui_flavor'))
template = 'index_new.html' if flavor == 'new' else 'index.html'
return render_template(template, start_time=start_time_str, is_cloud=IS_CLOUD_VERSION)
```

不要调用 `find_free_port()` 当模板变量。不要删 `/live-2d/<path:filename>`。

#### 2.5 `service_controller.py`

保留现有 `/api/status`、`/api/start/<service>`、`/api/stop/<service>` 的服务名与 bat 映射。  
增加：

- `/api/services/readiness`（对照源，但 script 探测用下面的路径函数）。
- `/api/memos/webui/start`：先确认 memos 后端端口；再启动 `启动WebUI_Cyberpunk.bat`。
- MemOS 根目录解析函数（两处 start memos / start memos webui 都用它）：

```python
def resolve_memos_dir():
    candidates = [
        PROJECT_ROOT.parent / 'memos_system',
        PROJECT_ROOT.parent / 'plugins-dlc' / 'memos' / 'memos_system',
    ]
    for path in candidates:
        if path.is_dir():
            return path
    return candidates[-1]  # 线上常见布局
```

- `/api/system/info` 同时返回：
  - `neuro_version`：继续从 `config.json` 的 `version` 读（旧前端）
  - `version`：`WEBUI_VERSION`（新前端）
  - 现有 `uptime` / `start_time` / `start_timestamp`

若合并源的 `state_io` 文件锁：可以，但 start/stop 失败时错误信息必须仍是 JSON `{success, error}`，旧终端 tab 才能显示。

#### 2.6 `log_monitor.py`

保留 `/api/logs/<log_type>`、`/api/logs/tail/<log_type>`、chat-history、voice-clone。  
增加源中的 `/api/logs/runtime`、`/api/logs/service/<service>`、`/api/logs/service/<service>/clear`。注意 Flask 路由顺序：更具体的 `/api/logs/runtime` 必须注册在 `/api/logs/<log_type>` **前面**，否则 `runtime` 会被当成 log_type。

#### 2.7 `plugin_manager.py`

增加源中的 `panel-info` / `open-panel`。  
`has_local_panel`：仅当 `plugin_path` 在已知名单 **且** `plugin_dir` 存在时为 True。本次仓库没有那两个插件，列表里就不会出现打开面板按钮。不要为了「看起来像肥牛」去伪造面板。

#### 2.8 步骤 2 测试（完成门闩）

用 Flask test client（可写在 `live-2d/webui/test_flavor_and_llm_contract.py`）：

1. 默认（配置无 flavor 键）`GET /` 的 HTML 是新版特征：含 `data-theme` 或 `basic-config` 或 `themes.css`，不是旧版「终端控制室」当默认壳。若此时 `index_new.html` 还不存在，本断言放到步骤 3 后再跑；步骤 2 先测 API。
2. `GET /api/webui/flavor` 无键时返回 `new`。
3. `POST /api/webui/flavor` `{"flavor":"old"}` 后 GET 为 `old`；再 POST `new` 回来。
4. `GET /api/releases` 不是 404。
5. `GET /api/config/llm` 同时含 `api_key` 与 `providers`。
6. `POST /api/config/llm` 只发旧三格 → 通讯录更新，再 GET 旧字段能读回来。
7. `POST /api/config/llm` 发 `providers` → 再 GET 新字段能读回来。
8. `GET /api/settings/advanced` 含 `bert_enabled`。
9. `GET /api/system/info` 含 `neuro_version` 和 `version`。
10. `GET /api/overview`、`GET /api/services/readiness` 有合理 JSON（空数据可以，不能 500）。

**未通过不得进入步骤 3。**

### 步骤 3 · 新版前端隔离落地

1. 创建 `live-2d/webui/static/new/`。从源 `webui/static/` 拷 `css/`、`js/`、`locales/` 进去（没有 `img/` 就不要造空目录当完成）。
2. 从源 `webui/templates/index.html` 拷为目的 `webui/templates/index_new.html`。
3. 从目标现有 `static/js/releases.js` 拷到 `static/new/js/releases.js`。
4. **路径改写（必须全做）：**

在 `index_new.html`：

- `/static/css/` → `/static/new/css/`
- `/static/js/` → `/static/new/js/`
- `static/js/`（无前导斜杠）→ `/static/new/js/`
- 保留 `/live-2d/` 不动（图标、libs）
- 底部增加 `<script src="/static/new/js/releases.js"></script>`（若源没有）

在 `static/new/js/i18n.js`：

- `loadPath` 改为 `static/new/locales/{{lng}}/translation.json`

全文搜索 `static/new` 目录，不应再出现指向老资源的 `/static/css/style.css` 或 `loadPath: 'static/locales/`。

5. **删小屋按钮：** 去掉 `id="feiniu-house-open"` 那颗按钮。
6. **加「返回经典版面」：** 放在主题按钮旁边（源 `index.html` 约 47–50 行 `theme-toggle-btn` 附近）。按钮文案写死：「经典版面 / Classic」。点击后 `POST /api/webui/flavor` body `{"flavor":"old"}`，成功则 `location.href='/'`，失败 toast，禁止假切换。
7. **加检查更新：** 在新版 `header-icon-group` 里按旧版 `#checkUpdateBtn` 同样的图标和 `openReleasesModal` 调用。确保 `releases.js` 在 `app.js` 之后加载。
8. **云端裁剪：** 给声音克隆 tab 按钮和 `#model-manager` 面板包 `{% if not is_cloud %}`。仪表盘里依赖本地 bat 的 ASR/TTS/MemOS 卡片：云端用 `{% if not is_cloud %}` 包起来，避免云端出现必然失败的启动按钮。对照旧版 `index.html` 第 59、64、144、378 行的包裹方式。
9. 拷 `live-2d/libs/v2/` 整目录，使 `index_new.html` 里这四条成立：

```
/live-2d/libs/v2/live2dcubismcore.min.js
/live-2d/libs/v2/live2d.min.js
/live-2d/libs/v2/pixi.min.js
/live-2d/libs/v2/index.min.js
```

**完成门闩：** 浏览器直接打开 `GET /`（flavor 默认 new）能加载 `/static/new/css/themes.css` 和 `/static/new/js/app.js`，控制台没有 404 这些资源；没有「打开肥牛小屋」按钮。

### 步骤 4 · 旧版只加一个切换口

文件：目标 `live-2d/webui/templates/index.html`，约第 33–51 行 `header-icon-group` 内、检查更新按钮旁边，加一个图标按钮。

- `id="switchToNewLayoutBtn"`
- `title="切换到新版面 / New layout"`
- 点击：`POST /api/webui/flavor` `{"flavor":"new"}`，成功 `location.href='/'`
- 不要改旧版 css/js/locales。不要引入 cyber.css。
- 不要给旧版 locales 加词条。

**完成门闩：** `git diff` 里旧版 `static/css/style.css`、`static/js/app.js`、`static/locales/**` 为空；`index.html` 的 diff 只有这一处按钮及相关的最小 inline 或沿用已有 onclick 风格。实现脚本可以写在 `index.html` 末尾一个极短的 `<script>`，仍算「只改 index.html」。不要新建旧版 `static/js` 文件。

### 步骤 5 · 新版 i18n 与切换词条

只改 `static/new/locales/`。给切换按钮、新 tab（基础配置/人格设置）、总览、火山 TTS 补齐中英文。旧版 locales 不动。

**完成门闩：** 新版切到 English 后，新加按钮不是漏翻译的 key 原文（允许按钮 title 中英写死）。

### 步骤 6 · 验证

按第九节清单跑完。分「自动化」和「浏览器」两层。浏览器可用 headless Chrome + 截图，至少覆盖：

1. 清空 flavor 键后打开 `/`，是新版（10 个 tab，有基础配置/人格设置，无终端控制室 tab）。
2. 新版内 galgame ↔ cyber。
3. 点「经典版面」后是旧版 9 tab（含终端控制室）。
4. 旧版点「新版面」回来。
5. 旧版 LLM 三格：填假值保存，再打开仍在；桌宠侧 `llm_providers.json` 有对应条目。
6. 新版 LLM 通讯录：增加一个 provider 保存，旧版三格读到的是当前选中那条。
7. `/api/releases` 在两版都能点开检查更新（新版步骤 3 已加按钮）。
8. 云端：临时把 `IS_CLOUD_VERSION` 置 True 渲染，两版都没有声音克隆入口。
9. 移动宽度下 header 不把切换按钮挤没。

### 步骤 7 · 提 PR

目标：morettt/my-neuro，分支 `feat/webui-cyber-layout`。

PR 说明必须写清：

- 默认新版，可切旧版
- 老版文件几乎不动
- 通讯录迁移行为（旧 key 进 `llm_providers.json`）
- 没有小屋、没有人格导演
- 云端裁剪
- 截图

Commit 建议拆成：

1. 运行时通讯录 + telemetry.js
2. WebUI 后端加性 API + flavor
3. static/new + index_new + libs/v2
4. 旧版一个按钮
5. 测试

不要一个 commit 十万行无说明。

---

## 九、测试方法

### 9.1 自动化（必须写进仓库，步骤 6 全绿）

| 测试 | 验证什么 |
|---|---|
| Flask：flavor 缺省 `new` | 无键、空字符串、垃圾值 → `new` |
| Flask：flavor 读写 | POST old/new 往返 |
| Flask：`/api/releases` | 非 404 |
| Flask：LLM GET 超集 | 同时有 `api_key` 和 `providers` |
| Flask：旧 POST | 只发三格能写进通讯录 |
| Flask：新 POST | 发 providers 能读回 |
| Flask：advanced | GET 含 `bert_enabled`；旧 POST `vision_model` 不丢 |
| Flask：system/info | `neuro_version` + `version` |
| Flask：overview / readiness | 非 500 |
| Flask：日志路由顺序 | `/api/logs/runtime` 不是被 `<log_type>` 吃掉 |
| `node live-2d/scripts/test-telemetry.js` | 脱敏、落盘 |
| `node live-2d/scripts/test-plugin-context-llm.js` | 按目标补丁后的 callLLM 调整 |
| 迁移测试 | 仅有旧三格的 config → 生成 llm_providers.json → 第二次 load 稳定 |

### 9.2 手工 / 浏览器

见步骤 6。没有截图不得把步骤 6 标完成。

### 9.3 明确不是完成的东西

- 只把文件拷到 `static/new` 但 i18n 仍打旧路径
- API 200 但旧 LLM 页空
- 新版能保存但桌宠仍读空的 `config.llm.api_key` 且通讯录没生成
- 新版还有「打开肥牛小屋」
- 默认打开仍是旧版

---

## 十、分阶段验收与进度口径

| 阶段 | 统计口径 | 才算完成 |
|---|---|---|
| 步骤 0 | 0% | 工作树无赛博皮残留 |
| 步骤 1 | 25% | 通讯录迁移测试绿，桌宠调用点已改 |
| 步骤 2 | 45% | 双契约 API 测试绿，updater 仍在 |
| 步骤 3 | 70% | 默认 `/` 出新版，资源无 404，无小屋按钮 |
| 步骤 4–5 | 80% | 旧版仅一按钮；新版 i18n 不漏 key |
| 步骤 6 | 95% | 第九节自动化全绿 + 截图齐 |
| 步骤 7 | 100% | PR 已开，说明与截图已贴 |

进度不得按「拷了多少文件」报。

---

## 十一、风险与失败处理

| 风险 | 等级 | 处理 |
|---|---|---|
| 整文件覆盖 llm-handler 导致缺 scene-routing 起不来 | 高 | 本计划禁止整文件覆盖。若已误覆盖：从 git 恢复目标原文件，改打补丁 |
| GET LLM 清洗掉 key 但通讯录没写成 | 高 | 清洗必须在 store 写成功之后；做不到就不清洗。回滚：用 `config.json.pre-provider.bak` 或 git 里的 config |
| 旧 advanced 丢 BERT | 高 | 契约测试卡住步骤 2 |
| MemOS 路径抄本地 | 中 | 双候选目录，优先已存在的 |
| libs/v2 漏拷 | 中 | 步骤 3 用浏览器网络面板看 4 个 js 是否 200 |
| 大 PR 难 review | 中 | 按步骤 7 拆 commit |
| 误提交 llm_providers.json | 高 | gitignore + PR 前 `git status` 检查 |
| 默认仍做成 old | 高 | normalize 缺省 new；步骤 6 第一条截图必须是新版 |
| 旧版 locales/css 被改 | 中 | diff review 卡住步骤 4 |
| 小屋按钮残留 | 中 | 步骤 3 门闩：页面搜索「肥牛小屋」应为 0 |

回滚：

- 仅前端问题：把 flavor POST 成 `old` 即可继续用旧壳。
- 通讯录写坏：恢复 `config.json.pre-provider.bak`，删除损坏的 `llm_providers.json`，重启桌宠。
- 整步失败：该步骤涉及的文件 `git checkout -- <files>`，不要用 `git reset --hard` 除非用户明确要求。

---

## 十二、最终完成标准

同时满足才算方案 D 完成：

1. 用户打开 WebUI（配置里没有 flavor 或值为空）**第一眼是新版**。
2. 新版能切到旧版，旧版能切回新版，刷新后保持选择。
3. 旧版外观除 header 一颗切换按钮外，与移植前一致。
4. 新版含主题切换、总览、10 个 tab、火山 TTS、检查更新；**没有**肥牛小屋按钮。
5. 旧 LLM 三格与新通讯录读写的是同一套运行时数据；保存后重启桌宠，对话用的是通讯录里当前模型，不是空 key。
6. `/api/releases` 两版都能用。
7. 仓库不含 `llm_providers.json`，不含真实密钥。
8. 未拷贝 auto-act、companion-director 插件目录。
9. 第九节自动化全绿。
10. 云端渲染下声音克隆入口隐藏。

---

## 十三、执行时的自我检查（每次准备报完成前）

- [ ] 有没有整文件覆盖 `llm-handler.js` / `main.js` / `config_manager.py` / `service_controller.py`？有则退回。
- [ ] `normalize_webui_flavor` 缺省是不是 `new`？
- [ ] `GET /api/config/llm` 有没有同时给旧三格和新 providers？
- [ ] 旧 POST 三格会不会被当成空操作？
- [ ] 目标 `live-2d/js` 对话链路上是不是还能只靠空的 `config.llm.api_key` 打电话？
- [ ] `index_new.html` 有没有「打开肥牛小屋」？
- [ ] `i18n.js` loadPath 是不是 `static/new/locales/...`？
- [ ] `git diff` 旧版 css/js/locales 是不是空的？
- [ ] `git status` 有没有 `llm_providers.json`？
- [ ] 有没有把源 `config.json` 拷进目标？

---

## 十四、开放点（已全部拍板，执行时不要再问）

1. 方案 D，不是「只换皮」的方案 A，也不是「把肥牛整仓倒进去」。
2. 默认新版，可切旧版。
3. 不加肥牛小屋，不加人格导演。
4. 旧版只改 `index.html` 一个切换按钮。
5. 新版保留 galgame/cyber 主题，与 flavor 正交。
6. 通讯录运行时要加；libs/v2、telemetry、MemOS 双路径、检查更新、火山表单、双契约、config.example.json、gitignore 都要加。

无未决开放点。获批后从步骤 0 开始。
