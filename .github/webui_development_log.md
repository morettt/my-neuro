# WebUI 开发日志

## 最新开发记录 (2026-03-10)

### v1.10.0 (2026-03-10) - 模块化重构与广场下载修复

#### 重大变更

**1. WebUI 模块化重构**
- 将原来 730+ 行的 `webui_controller.py` 重构为 8 个独立模块
- 采用 Flask Blueprint 架构，每个功能模块独立管理路由
- 提高代码可维护性和可读性

**模块结构**：
```
webui/
├── __init__.py          # 模块入口，导出 create_app, run_app
├── utils.py             # 共享工具函数（PROJECT_ROOT, logger, service_pids）
├── main_app.py          # Flask 应用初始化、蓝图注册
├── service_controller.py # 服务控制 API（启动/停止/状态）
├── config_manager.py    # 配置管理 API（LLM/对话/UI/云端配置）
├── plugin_manager.py    # 插件管理 API（扫描/启用/禁用）
├── tool_manager.py      # 工具管理 API（FC/MCP工具列表）
├── marketplace.py       # 广场与资源 API（下载提示词/工具/插件）
└── log_monitor.py       # 日志监控 API（读取运行日志/心情分）
```

---

**2. 广场下载功能修复**

**问题描述**：
- 工具广场中只有北京时间工具能下载，其他工具和FC广场工具显示"下载失败：缺少参数"

**根本原因**：
1. 参数命名不一致：前端传递 `download_url`，后端期望 `tool_url`
2. 远程API返回的工具数据可能没有 `download_url` 字段，需要从 `id` 构建

**解决方案**：
1. 修改 `webui/marketplace.py` 中的下载函数，兼容两种参数名
2. 在获取工具列表时，自动为缺少 `download_url` 的工具构建下载URL
3. 添加详细的错误日志

**修改文件**：`webui/marketplace.py`

**关键代码**：
```python
@market_bp.route('/api/market/tools', methods=['GET'])
def get_tool_market():
    """获取工具广场列表（从远程服务器）"""
    # ...
    if data.get('success'):
        tools = data.get('tools', [])
        processed_tools = []
        for tool in tools:
            # 如果没有download_url，尝试从id构建
            if not tool.get('download_url') and tool.get('id'):
                tool['download_url'] = f"http://mynewbot.com/api/download-tool/{tool['id']}"
            processed_tools.append(tool)
        # ...

@market_bp.route('/api/market/tools/download', methods=['POST'])
def download_tool():
    """下载工具到 mcp/tools 目录"""
    data = request.get_json()
    tool_name = data.get('tool_name', '')
    # 兼容两种参数名：download_url 和 tool_url
    tool_url = data.get('download_url', '') or data.get('tool_url', '')
    # ...
```

---

**3. 删除独立测试服务器**

**删除文件**：
- `market_download_api.py` - 独立广场下载API测试服务器
- `market_patch.js` - 浏览器控制台补丁脚本

**原因**：主WebUI已完成模块化重构，不再需要独立测试服务器

---

#### API 路由清单

| 模块 | 路由 | 功能 |
|------|------|------|
| service_controller | `/api/start/<service>` | 启动服务 |
| service_controller | `/api/stop/<service>` | 停止服务 |
| service_controller | `/api/status` | 获取服务状态 |
| config_manager | `/api/config/llm` | LLM配置管理 |
| config_manager | `/api/settings/dialog` | 对话配置管理 |
| config_manager | `/api/settings/ui` | UI配置管理 |
| config_manager | `/api/settings/advanced` | 高级配置管理 |
| config_manager | `/api/settings/voice` | 云端配置管理 |
| plugin_manager | `/api/plugins/list` | 插件列表 |
| plugin_manager | `/api/plugins/<name>/toggle` | 切换插件状态 |
| tool_manager | `/api/tools/list/fc` | FC工具列表 |
| tool_manager | `/api/tools/list/mcp` | MCP工具列表 |
| tool_manager | `/api/tools/toggle` | 切换工具状态 |
| marketplace | `/api/market/prompts` | 提示词广场 |
| marketplace | `/api/market/tools` | 工具广场 |
| marketplace | `/api/market/fc-tools` | FC工具广场 |
| marketplace | `/api/market/plugins` | 插件广场 |
| log_monitor | `/api/logs/<type>` | 日志读取 |
| log_monitor | `/api/mood/status` | 心情分状态 |

---

## 历史记录 (2026-03-09)

### v1.9.1 (2026-03-09) - 配置加载修复

#### 问题修复

**1. 配置轮询禁用**
- **问题**：配置轮询导致复选框反复跳动
- **解决方案**：禁用 `setInterval(loadAllSettings, 2000)`
- **修改文件**：`static/js/app.js`

---

**2. 复选框加载逻辑修复（核心问题）**
- **问题**：直接修改 config.json 后刷新页面，复选框状态不同步
- **根本原因**：加载函数使用了错误的默认值逻辑
  ```javascript
  // ❌ 错误 - 当值为 false 时会被默认值覆盖
  document.getElementById('tts-enabled').checked = config.tts_enabled || true;
  
  // ✅ 正确 - 只有当值明确为 true 时才选中
  document.getElementById('tts-enabled').checked = config.tts_enabled === true;
  ```

- **修复的加载函数**：
  - `loadDialogConfig()` - tts-enabled, asr-enabled, voice-barge-in, show-chat-box, enable-limit, persistent-history
  - `loadBasicConfig()` - tools-enabled, mcp-enabled, show-chat-box, show-model, vision-enabled 等
  - `loadCloudSettings()` - cloud-tts-enabled, aliyun-tts-enabled, baidu-asr-enabled, gateway-enabled
  - `loadUISettings()` - show-chat-box, subtitle-enabled, hide-model

- **修改文件**：`static/js/app.js`

---

**3. 后端 API 字段修复**
- **问题**：后端 API 返回的字段名与前端期望不一致
- **修复**：
  - `/api/settings/ui` - 添加 `subtitle_enabled` 字段返回和保存
  - `/api/settings/voice` - 添加 `aliyun_tts` 和 `api_gateway` 字段返回
  - `/api/settings/dialog` - 将 `text_only_mode` 改为 `show_chat_box`

- **修改文件**：`webui_controller.py`

---

**4. 前端 API 读取逻辑修复**
- **问题**：`loadCloudSettings()` 期望嵌套结构但后端返回顶层字段
- **修复**：
  ```javascript
  // ❌ 错误 - 期望 cloud.tts 但后端返回 cloud_tts
  const cloud_tts = cloud.tts || {};
  
  // ✅ 正确 - 直接读取顶层字段
  const cloud_tts = data.cloud_tts || {};
  ```

- **修改文件**：`static/js/app.js`

---

**5. HTML 配置项对应关系修复**
- **问题**："文字输入框（可打字交互）"对应了错误的配置项
- **修复**：
  - "文字输入框（可打字交互）" → `show-chat-box`（是否显示聊天框）
  - 移除 `text-only-mode` 配置项（未使用）

- **修改文件**：`templates/index.html`

---

**6. 重复函数定义修复**
- **问题**：`saveUISettings()` 有两个定义，第二个覆盖了第一个
- **修复**：删除重复定义，保留完整的保存逻辑

- **修改文件**：`static/js/app.js`

---

#### 配置项对应关系（最终版）

| 前端 ID | 配置项名称 | 加载函数 | API 端点 | config.json 路径 |
|---------|-----------|----------|----------|-----------------|
| `show-chat-box` | 文字输入框（可打字交互） | `loadDialogConfig()` | `/api/settings/dialog` | `ui.show_chat_box` |
| `subtitle-enabled` | 启用字幕显示 | `loadUISettings()` | `/api/settings/ui` | `subtitle_labels.enabled` |
| `tts-enabled` | 启用 TTS | `loadDialogConfig()` | `/api/settings/dialog` | `tts.enabled` |
| `asr-enabled` | 启用 ASR | `loadDialogConfig()` | `/api/settings/dialog` | `asr.enabled` |
| `voice-barge-in` | 语音打断 | `loadDialogConfig()` | `/api/settings/dialog` | `asr.voice_barge_in` |
| `tools-enabled` | 启用 FC 工具 | `loadBasicConfig()` | `/api/settings/advanced` | `tools.enabled` |
| `mcp-enabled` | 启用 MCP 工具 | `loadBasicConfig()` | `/api/settings/advanced` | `mcp.enabled` |
| `cloud-tts-enabled` | 启用云端 TTS | `loadCloudSettings()` | `/api/settings/voice` | `cloud.tts.enabled` |
| `aliyun-tts-enabled` | 启用阿里云 TTS | `loadCloudSettings()` | `/api/settings/voice` | `cloud.aliyun_tts.enabled` |
| `baidu-asr-enabled` | 百度流式 ASR | `loadCloudSettings()` | `/api/settings/voice` | `cloud.baidu_asr.enabled` |
| `gateway-enabled` | 启动全云端 | `loadCloudSettings()` | `/api/settings/voice` | `api_gateway.use_gateway` |

---

#### 待解决的问题

**无** - 所有配置项加载问题已解决

---

#### 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v20260309n | 2026-03-09 | 修复 show_chat_box 对应关系 |
| v20260309m | 2026-03-09 | 修复 text-only-mode 对应关系 |
| v20260309l | 2026-03-09 | 修复 loadUISettings 默认值逻辑 |
| v20260309k | 2026-03-09 | 修复 loadCloudSettings API 读取 |
| v20260309j | 2026-03-09 | 修复所有加载函数默认值逻辑 |
| v20260309i | 2026-03-09 | 修复 subtitle_enabled 保存和加载 |
| v20260309h | 2026-03-09 | 添加 subtitle_enabled API 字段 |
| v20260309g | 2026-03-09 | 简化 loadConfigs、修复 loadUISettings |
| v20260309f | 2026-03-09 | 移除重复配置设置 |
| v20260309e | 2026-03-09 | 移除游戏配置 API 调用 |
| v20260309d | 2026-03-09 | 修复 loadConfigs DOM 操作 |
| v20260309c | 2026-03-09 | 配置轮询、工具卡片改进 |
| v20260309b | 2026-03-09 | 删除 Minecraft 配置、DOM null 检查 |
| v20260309a | 2026-03-09 | 工具屋重建、四列布局 |

---

## 文件结构

```
my-neuro-main/
├── webui_controller.py          # 后端控制器（Flask 应用）
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
├── live-2d/
│   ├── go.bat                   # Live2D 桌宠启动脚本
│   ├── runtime.log              # 实时日志（桌宠 + 工具）
│   └── config.json              # 配置文件
│
└── AI 记录室/
    └── mood_status.json         # 心情分数据
```

## 开发日志

### v1.8.2 (2026-03-06) - 声音克隆选项卡重做

#### 新增功能

**声音克隆选项卡（2 个分选项卡）**
- **模型文件配置**：
  - 模型文件（pth）[拖拽上传框]
    - 选择模型文件 或拖拽文件到此处
    - 状态显示：未上传模型文件（pth）→ 已选择：xxx.pth
  - 参考音频（wav）[拖拽上传框]
    - 选择音频文件 或拖拽文件到此处
    - 状态显示：未上传参考音频（wav）→ 已选择：xxx.wav
  - 角色名称 [输入框，placeholder: "输入角色名称，用于生成 bat 文件名"]
  - 参考音频语种 [下拉框：zh-中文 / en-英语 / ja-日语]
  - 参考音频的文本内容 [多行文本框]
  - [生成 TTS 的 bat 文件] 按钮
  - 状态显示：请上传文件并生成配置 → 已生成：xxx.bat

- **一键训练 TTS 模型**：
  - 🚧 此功能开发中… 敬请期待

**修改文件**：`templates/index.html`, `static/js/app.js`, `static/css/style.css`, `webui_controller.py`

**新增 API**：
```python
POST /api/voice-clone/generate-bat  # 生成 TTS 的 bat 文件
```

**后端逻辑**：
1. 接收上传的模型文件（.pth）和音频文件（.wav）
2. 保存到 `live-2d/Voice_Model_Factory/` 目录
3. 根据角色名称生成 bat 文件
4. bat 文件内容包含 TTS 推理命令

**bat 文件生成示例**：
```batch
@echo off
chcp 65001 >nul
echo.
echo ========================================
echo  TTS 声音克隆 - {role_name}
echo ========================================
echo.
echo 正在生成 TTS...
echo.

python -m tools.tts_inference \
    --model_path "Voice_Model_Factory/{role_name}.pth" \
    --audio_path "Voice_Model_Factory/{role_name}.wav" \
    --language {language} \
    --text "{text}"

echo.
echo 生成完成！
echo.
pause
```

**JS 函数**：
- `switchVoiceCloneTab(tab)` - 切换声音克隆子选项卡
- `handleModelFileSelect(files)` - 处理模型文件选择
- `handleAudioFileSelect(files)` - 处理音频文件选择
- `initFileDragDrop()` - 初始化拖拽事件
- `generateTTSBat()` - 生成 TTS 的 bat 文件

**CSS 样式**：
- `.voice-clone-panel` - 声音克隆面板（显示/隐藏）
- `.file-drop-area` - 文件拖拽区域（虚线边框）
- `.file-drop-area.drag-over` - 拖拽悬停状态
- `.file-status` - 文件状态显示
- `.file-status.has-file` - 已上传文件状态（绿色）

**交互流程**：
```
1. 用户选择/拖拽模型文件（.pth）
   ↓
2. 状态更新：未上传 → 已选择：xxx.pth
   ↓
3. 用户选择/拖拽音频文件（.wav）
   ↓
4. 状态更新：未上传 → 已选择：xxx.wav
   ↓
5. 填写角色名称、选择语种、输入文本
   ↓
6. 点击"生成 TTS 的 bat 文件"
   ↓
7. 后端保存文件并生成 bat
   ↓
8. 状态更新：已生成 TTS 的 bat 文件：xxx.bat
```

---

### v1.8.1 (2026-03-06) - 云端配置重写

#### 新增功能

**云端配置重写（4 个分选项卡）**
- **云端肥牛**：
  - 🐂 云端肥牛配置
  - 启动全云端 [复选框]
  - 肥牛 URL [输入框，默认：http://ominifn.natapp1.cc/api/v1]
  - 肥牛密钥 [密码输入框]
  - 💡 提示语（完整版本）
  - 🔗 获取 API KEY - 前往云端肥牛官网 [按钮]

- **云端 TTS**：
  - 🌐 云服务通用配置
    - 云服务提供商 [输入框]
    - API KEY [密码输入框]
  - 🔊 云端 TTS 配置
    - 启用云端 TTS [复选框]
    - TTS API URL [输入框]
    - 模型 [输入框]
    - 音色 [输入框]
    - 格式 [下拉框：MP3/WAV/OGG]
    - 速度 [数字输入框，0.5-2.0]

- **阿里云 TTS**：
  - 🔊 阿里云 TTS 配置
    - 启用阿里云 TTS [复选框]
    - API KEY [密码输入框]
    - 模型名 [输入框]
    - 声音 ID [输入框]

- **百度流式 ASR**：
  - 🎤 百度流式 ASR 配置
    - 启用百度流式 ASR [复选框]
    - WebSocket URL [输入框]
    - APP ID [输入框]
    - APP KEY [密码输入框]
    - DEV PID [输入框，默认：15372]

**修改文件**：`templates/index.html`, `static/js/app.js`, `static/css/style.css`

**配置对应**：
```json
{
  "api_gateway": {
    "use_gateway": false,
    "base_url": "http://ominifn.natapp1.cc/api/v1",
    "api_key": ""
  },
  "cloud": {
    "provider": "siliconflow",
    "api_key": "",
    "tts": {
      "enabled": false,
      "url": "https://api.siliconflow.cn/v1/audio/speech",
      "model": "FunAudioLLM/CosyVoice2-0.5B",
      "voice": "speech:fake-neuro:...",
      "response_format": "mp3",
      "speed": 1.0
    },
    "aliyun_tts": {
      "enabled": false,
      "api_key": "",
      "model": "cosyvoice-v3-flash",
      "voice": ""
    },
    "baidu_asr": {
      "enabled": false,
      "url": "ws://vop.baidu.com/realtime_asr",
      "appid": "",
      "appkey": "",
      "dev_pid": "15372"
    }
  }
}
```

**JS 函数**：
- `saveCloudSettings()` - 保存云端配置
- `loadCloudSettings()` - 加载云端配置
- `switchCloudTab(tab)` - 切换子选项卡
- `openGatewayWebsite()` - 打开云端肥牛官网

**CSS 样式**：
- `.cloud-panel` - 云端配置面板（显示/隐藏）
- `.info-tip` - 提示语样式（蓝色左边框）

---

### v1.8 (2026-03-06) - 广场功能与动作管理系统

#### 新增功能

**1. 广场选项卡（资源市场）**
- **功能**：从远程服务器获取提示词、工具、FC 工具资源
- **子选项卡**：
  - 提示词广场 - 应用提示词到 AI 人设
  - 工具广场 - 下载工具到 server-tools 目录
  - FC 广场 - 下载 FC 工具
- **远程 API**：`http://mynewbot.com/api/get-*`

**修改文件**：`templates/index.html`, `webui_controller.py`, `static/js/app.js`, `static/css/style.css`

**新增 API**：
```python
GET  /api/market/prompts       # 获取提示词列表
GET  /api/market/tools         # 获取工具列表
GET  /api/market/fc-tools      # 获取 FC 工具列表
POST /api/market/prompts/apply # 应用提示词到 AI 人设
POST /api/market/tools/download    # 下载工具
POST /api/market/fc-tools/download # 下载 FC 工具
```

**界面布局**：
```
┌─────────────────────────────────────────────────────────┐
│ 广场                                                    │
├─────────────────────────────────────────────────────────┤
│ [提示词广场] [工具广场] [FC 广场]                        │  ← 子选项卡
├─────────────────────────────────────────────────────────┤
│ 🔄 刷新提示词列表                                        │
├─────────────────────────────────────────────────────────┤
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ │
│ │ 💡 提示词标题 │ │ 💡 提示词标题 │ │ 💡 提示词标题 │ │
│ │ 简介...       │ │ 简介...       │ │ 简介...       │ │
│ │ ⚠️ 使用条件   │ │               │ │               │ │
│ │ [应用]        │ │ [应用]        │ │ [应用]        │ │
│ └───────────────┘ └───────────────┘ └───────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

**2. Live2D 动作管理系统**
- **子选项卡**：UI 设置 / 动作
- **动作管理功能**：
  - 唱歌控制：[开始唱歌] [停止唱歌] [一键复位]
  - 情绪分类区域（6 个固定分类，3 列网格布局）
  - 未分类动作列表
  - 文件选择添加动作（拖拽功能暂缓）

**情绪分类**：
| 表情 | 情绪 | 英文标识 |
|------|------|----------|
| 😊 | 开心 | happy |
| 😠 | 生气 | angry |
| 😢 | 难过 | sad |
| 😲 | 惊讶 | surprised |
| 😳 | 害羞 | shy |
| 😜 | 俏皮 | playful |

**修改文件**：`templates/index.html`, `webui_controller.py`, `static/js/app.js`, `static/css/style.css`

**新增 API**：
```python
POST /api/live2d/singing/start        # 开始唱歌
POST /api/live2d/singing/stop         # 停止唱歌
POST /api/live2d/motion/reset         # 复位动作
POST /api/live2d/motion/preview       # 预览动作
GET  /api/live2d/motions/uncategorized # 获取未分类动作
POST /api/live2d/motions/save         # 保存动作配置
```

**界面布局**：
```
┌─────────────────────────────────────────────────────────┐
│ Live2D 设置                                              │
├─────────────────────────────────────────────────────────┤
│ [UI 设置] [动作]                                         │  ← 子选项卡
├─────────────────────────────────────────────────────────┤
│ 动作管理                                                 │
├─────────────────────────────────────────────────────────┤
│ 唱歌控制：[开始唱歌] [停止唱歌] [一键复位]               │
├─────────────────────────────────────────────────────────┤
│ 情绪分类区域（3 列网格）                                  │
│ ┌───────────┐ ┌───────────┐ ┌───────────┐              │
│ │ 😊 开心   │ │ 😠 生气   │ │ 😢 难过   │              │
│ │ [动作列表]│ │ [动作列表]│ │ [动作列表]│              │
│ │ [+添加]   │ │ [+添加]   │ │ [+添加]   │              │
│ └───────────┘ └───────────┘ └───────────┘              │
│ ┌───────────┐ ┌───────────┐ ┌───────────┐              │
│ │ 😲 惊讶   │ │ 😳 害羞   │ │ 😜 俏皮   │              │
│ │ [动作列表]│ │ [动作列表]│ │ [动作列表]│              │
│ │ [+添加]   │ │ [+添加]   │ │ [+添加]   │              │
│ └───────────┘ └───────────┘ └───────────┘              │
├─────────────────────────────────────────────────────────┤
│ 未分类动作                                               │
│ ┌───────────┐ ┌───────────┐ ┌───────────┐              │
│ │ motion1   │ │ motion2   │ │ motion3   │              │
│ │ [预览]    │ │ [预览]    │ │ [预览]    │              │
│ └───────────┘ └───────────┘ └───────────┘              │
├─────────────────────────────────────────────────────────┤
│ [更新配置]                                               │
└─────────────────────────────────────────────────────────┘
```

**CSS 网格布局**：
```css
.emotion-categories-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);  /* 一行 3 个 */
    gap: 15px;
}

/* 响应式 */
@media (max-width: 900px) {
    grid-template-columns: repeat(2, 1fr);  /* 平板一行 2 个 */
}
@media (max-width: 600px) {
    grid-template-columns: 1fr;  /* 手机单列 */
}
```

---

**3. 游戏选项卡修正**
- **"对话模块映射到游戏"**：改为复选框选项（而非说明文字）
- **删除**："启用 Minecraft 游戏支持"复选框

**修改文件**：`templates/index.html`, `webui_controller.py`, `static/js/app.js`

**配置对应**：
- `game_enabled` → `config.json` → `game.Minecraft.enabled`
- API 字段名从 `enabled` 改为 `game_enabled`

---

**4. LLM 配置重命名**
- **"系统提示词"** → **"AI 人设"**

**修改文件**：`templates/index.html`

---

**5. 配置选项迁移**

**基础配置（移除）**：
- ❌ 语音设置（小标题）
- ❌ 开启语音打断（实时语音打断 AI 说话）
- ❌ 界面显示（小标题）
- ❌ 显示聊天框
- ❌ 显示模型

**对话配置（新增）**：
- ✅ 开启语音打断（实时语音打断 AI 说话）
- ✅ 文字输入框（可打字交互）→ `ui.text_only_mode`

**Live2D 设置（新增）**：
- ✅ 隐藏皮套 → `ui.show_model` (false=隐藏)

**修改文件**：`templates/index.html`, `webui_controller.py`, `static/js/app.js`

**新增 API 字段**：
```python
# /api/settings/dialog
'voice_barge_in': asr_config.get('voice_barge_in', True)
'text_only_mode': ui_config.get('text_only_mode', False)

# /api/settings/ui
'show_model': ui_config.get('show_model', True)
```

---

#### 技术总结

1. **广场功能设计原则**：
   - 从远程服务器获取资源（`http://mynewbot.com`）
   - 提示词应用：更新 `config.json` 的 `llm.system_prompt`
   - 工具下载：保存 `.js` 文件到 `server-tools/` 目录
   - 卡片式布局，支持响应式

2. **动作管理系统实现**：
   - 情绪分类固定 6 个，不可增删
   - 使用 CSS Grid 实现 3 列布局
   - 文件选择代替拖拽（简化实现）
   - 动作配置保存到 `motion_config.json`
   - Live2D API 调用 `http://127.0.0.1:3000`（需根据实际调整）

3. **配置迁移逻辑**：
   - 语音打断从基础配置迁移到对话配置
   - 显示聊天框/模型从基础配置移除
   - 隐藏皮套添加到 Live2D 设置
   - 保持配置键名不变，只调整 UI 位置

4. **响应式设计**：
   - 情绪分类网格：桌面 3 列 / 平板 2 列 / 手机 1 列
   - 广场卡片：自适应列数
   - 动作列表：最小宽度 200px

---

### v1.7 (2026-03-06) - 插件系统重构与配置优化

#### 重大变更

**1. 插件系统自动扫描**
- **问题**：原硬编码插件列表，新增插件需修改代码，不支持社区插件
- **解决方案**：
  - 新增 `scan_plugins_directory()` 函数
  - 自动扫描 `plugins/built-in/` 和 `plugins/community/` 目录
  - 读取每个插件的 `metadata.json`
  - 支持未来新增插件无需修改后端代码

**修改文件**：`webui_controller.py`

```python
def scan_plugins_directory():
    """自动扫描插件目录（built-in 和 community）"""
    plugins = []
    plugins_base = PROJECT_ROOT / 'live-2d' / 'plugins'
    
    for category in ['built-in', 'community']:
        category_path = plugins_base / category
        if not category_path.exists():
            continue
        
        for plugin_dir in category_path.iterdir():
            metadata_path = plugin_dir / 'metadata.json'
            if not metadata_path.exists():
                continue
            
            with open(metadata_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
            
            # 获取插件配置状态
            plugin_config_key = metadata['name'].replace('-', '_')
            plugin_enabled = plugins_config.get(plugin_config_key, {}).get('enabled', False)
            
            plugins.append({
                'name': metadata['name'],
                'display_name': metadata.get('displayName', ''),
                'description': metadata.get('description', ''),
                'category': category,  # 'built-in' 或 'community'
                'enabled': plugin_enabled,
                'plugin_dir': str(plugin_dir)
            })
```

---

**2. 插件配置 UI 简化**
- **变更**：
  - 移除复杂配置表单
  - 只保留：启用/禁用按钮 + 打开配置按钮
  - 提示用户在 `config.json` 中配置详细参数

**修改文件**：`templates/index.html`, `static/js/app.js`, `static/css/style.css`

**界面变更**：
```
┌─────────────────────────────────────────────────────────┐
│ 插件管理                                                 │
├─────────────────────────────────────────────────────────┤
│ 🔧 内置插件（8 个）                                      │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ │
│ │ 自动对话      │ │ 动态主动对话  │ │ B 站直播      │ │
│ │ 作者：official│ │ v1.0          │ │ v1.0          │ │
│ │ 空闲时自动... │ │ 基于心情分数  │ │ 监听直播间... │ │
│ │ ● 已启用      │ │ ○ 已禁用      │ │ ● 已启用      │ │
│ │ [禁用][打开]  │ │ [启用][打开]  │ │ [禁用][打开]  │ │
│ └───────────────┘ └───────────────┘ └───────────────┘ │
├─────────────────────────────────────────────────────────┤
│ 🌐 社区插件（6 个）                                      │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ │
│ │ 签到插件      │ │ 动态人格      │ │ Python 示例   │ │
│ └───────────────┘ └───────────────┘ └───────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

**3. 打开配置文件修复**
- **问题**：原打开项目配置文件，而非插件自有文件
- **解决方案**：
  - 新 API：`POST /api/plugins/<plugin_name>/open-config`
  - 打开 `index.js` 文件（所有插件都有）
  - 使用 `os.startfile()` 直接调用系统默认程序
  - 提示在 `config.json` 的 `plugins.xxx` 中配置

**修改文件**：`webui_controller.py`, `static/js/app.js`

---

#### 配置系统重构

**1. 基础配置选项卡（重构）**
- **视觉功能**：
  - 启用视觉功能
  - 开启后，每次对话 AI 都会去识图（会增加延迟）
  - 启用辅助视觉模型
  - 视觉模型 API 配置（API Key、URL、模型名称）
  - 添加详细说明文字
- **Live2D 模型选择**（新增）：
  - 展开滚动式下拉框
  - 当前选项：肥牛（fake-neuro）
  - 应用模型按钮
- **语音设置**：
  - 开启语音打断（实时语音打断 AI 说话）
- **工具配置**：
  - 启用 Function Call 工具
  - 启用 MCP 工具
- **界面显示**：
  - 显示聊天框（从 UI 设置迁移）
  - 显示模型（从 UI 设置迁移）
- **系统设置**：
  - 关闭 UI 时自动关闭所有服务

**修改文件**：`webui_controller.py`, `templates/index.html`, `static/js/app.js`

---

**2. 对话配置选项卡（新建）**
- **基础设置**：
  - 开场白（文字输入框，可打字交互）
  - 最大消息数
- **功能开关**：
  - 启用 ASR（语音识别）
  - 启用 TTS（语音合成）
  - 启用上下文限制（超出对话轮次截断）
  - 启用对话历史记忆（带 bug 警告）

**修改文件**：`webui_controller.py`, `templates/index.html`, `static/js/app.js`

**新增 API**：
- `GET/POST /api/settings/dialog` - 对话配置管理

---

**3. UI 设置选项卡（简化）**
- 启用字幕显示（新增）
- 模型缩放比例
- 用户标签 / AI 标签

**移出项**：
- 显示聊天框 → 基础配置
- 显示模型 → 基础配置

---

#### 界面优化

**选项卡结构调整**：
```
[服务控制] [基础配置] [对话配置] [LLM 配置] [云端配置] 
[游戏] [模型管理] [工具屋] [UI 设置] [插件管理]
```

**变更**：
- 删除：聊天记录选项卡（无需转移）
- 新增：对话配置选项卡
- 改名：游戏中心 → 游戏，声音设置 → 云端配置

---

#### 技术总结

1. **插件系统设计原则**：
   - 自动扫描目录，支持社区插件
   - 简化配置 UI，详细配置在 config.json
   - 分组显示（内置/社区）

2. **配置管理最佳实践**：
   - 按功能分组（基础、对话、UI）
   - 迁移相关配置到合适位置
   - 添加详细说明和警告

3. **用户体验优化**：
   - "打开配置"按钮直接调用系统默认程序
   - Live2D 模型选择采用滚动下拉框
   - 配置项添加详细说明文字

---

### v1.6 (2026-03-05) - 工具屋功能重构与优化

#### 新增功能

**1. 运行时间秒级更新**
- **问题**：运行时间每分钟更新一次，实时性不足
- **解决方案**：
  - 后端 `/api/system/info` 添加 `start_timestamp` 字段
  - 前端每秒计算时间差并更新显示
  - 显示格式自动适配：`X 秒` / `X 分钟 X 秒` / `X 小时 X 分钟 X 秒` / `X 天 X 小时 X 分钟 X 秒`

**修改文件**：`webui_controller.py`, `static/js/app.js`

```python
# webui_controller.py
@app.route('/api/system/info')
def get_system_info():
    return jsonify({
        'version': WEBUI_VERSION,
        'uptime': uptime_str,
        'start_time': START_TIME.strftime('%Y-%m-%d %H:%M:%S'),
        'start_timestamp': START_TIME.timestamp()  # 添加时间戳
    })
```

```javascript
// app.js
function updateUptime() {
    const now = Date.now() / 1000;
    const uptimeSeconds = Math.floor(now - window.startTimestamp);
    // 计算并显示...
}
setInterval(updateUptime, 1000);  // 每秒更新
```

---

**2. 工具屋重构 - 分选项卡显示**
- **功能**：
  - 新增子选项卡：Function Call 工具 / MCP Tools
  - 工具列表改为两列布局（响应式：窄屏单列）
  - 折叠式工具卡片设计（默认折叠）
  - 工具标题旁显示简短描述
  - 单个工具独立启用/禁用按钮

- **工具状态管理**：
  - 本地工具：`.js` ↔ `.txt` 文件重命名
  - 外部工具：`mcp_config.json` 中 `name` ↔ `name_disabled` 键名切换

**修改文件**：`webui_controller.py`, `templates/index.html`, `static/js/app.js`, `static/css/style.css`

**新增 API**：
- `GET /api/tools/list/fc` - 获取 Function Call 工具列表
- `GET /api/tools/list/mcp` - 获取 MCP 工具列表（含外部工具）
- `POST /api/tools/toggle` - 切换工具启用状态

**关键代码**：
```python
# webui_controller.py
def scan_tools_directory(dir_path, tool_type):
    """扫描工具目录，返回工具列表（支持 .js 和 .txt）"""
    # ...

def get_external_mcp_tools():
    """从 mcp_config.json 读取外部 MCP 工具（排除有本地文件的工具）"""
    # 检查是否有本地文件
    local_js = mcp_tools_path / f"{actual_name}.js"
    local_txt = mcp_tools_path / f"{actual_name}.txt"
    has_local_file = local_js.exists() or local_txt.exists()
    if has_local_file:
        continue  # 跳过，作为本地工具处理
```

```javascript
// app.js
function createToolCard(tool) {
    // 卡片包含：标题 + 简短描述 + 状态 + 启用/禁用按钮 + 折叠图标
    card.innerHTML = `
        <div class="tool-card-header" onclick="toggleToolDetail(this)">
            <h4>📦 ${displayName} <span class="tool-short-desc">${tool.short_desc}</span></h4>
            <div>
                <span class="tool-status">${statusIcon} ${statusText}</span>
                <button class="btn-toggle-tool">${tool.enabled ? '禁用' : '启用'}</button>
                <span class="toggle-icon">▼</span>
            </div>
        </div>
        <div class="tool-card-detail">
            <p class="tool-description">${tool.description}</p>
        </div>
    `;
}
```

---

**3. 外部 MCP 工具支持**
- **问题**：playwright 等外部工具（通过 node.exe 启动）无法在 WebUI 中管理
- **解决方案**：
  - 从 `mcp_config.json` 读取外部工具配置
  - 通过 `name` ↔ `name_disabled` 重命名切换状态
  - 排除有本地文件的工具（如 random-acg-pic 有本地 .js 文件，作为本地工具处理）

**外部工具配置示例**：
```json
{
  "playwright_disabled": {
    "command": "./node/node.exe",
    "args": ["./mcp/node_modules/@playwright/mcp/cli.js"]
  }
}
```

---

#### 问题修复

**1. 工具卡片展开时拉伸同行卡片**
- **问题**：展开内容使用静态布局，撑开卡片高度影响 Grid 布局中的同行卡片
- **解决方案**：
  - 展开内容使用 `position: absolute` 脱离文档流
  - 向下覆盖显示，不影响其他卡片布局
  - 展开卡片 `z-index: 100` 确保覆盖在其他卡片上方
  - 添加阴影效果增强浮起感

**修改文件**：`static/css/style.css`

```css
.tool-card {
    position: relative;
    z-index: 1;
    overflow: visible;
}

.tool-card-detail {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: #1a1a2e;  /* 不透明背景，避免文字看不清 */
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    z-index: 100;
}

.tool-card.expanded {
    z-index: 100;
}
```

---

**2. 工具卡片半透明背景导致文字看不清**
- **问题**：展开内容使用 `rgba(0, 0, 0, 0.35)` 半透明背景，与底层卡片颜色混合
- **解决方案**：改用不透明深色背景 `#1a1a2e`

**修改文件**：`static/css/style.css`

---

**3. MCP 工具重复显示（random-acg-pic）**
- **问题**：random-acg-pic 同时在 `mcp_config.json` 和 `mcp/tools/` 目录中存在，被重复显示
- **解决方案**：`get_external_mcp_tools()` 检查本地文件，有本地文件则跳过

---

#### 界面变更

**工具屋选项卡重构**：
```
┌─────────────────────────────────────────────────────────┐
│ 工具屋                                                  │
├─────────────────────────────────────────────────────────┤
│ ☐ 启用 Function Call 工具  ☐ 启用 MCP 工具              │
├─────────────────────────────────────────────────────────┤
│ [Function Call 工具] [MCP Tools]                        │  ← 子选项卡
├─────────────────────────────────────────────────────────┤
│ ┌──────────────────┐  ┌──────────────────┐             │
│ │ 📦 工具名称      │  │ 📦 工具名称      │             │  ← 两列布局
│ │ 简短描述  ●已启用│  │ 简短描述  ○已禁用│             │
│ │ [禁用] ▼         │  │ [启用] ▼         │             │
│ └──────────────────┘  └──────────────────┘             │
│                                                         │
│ 展开后（绝对定位覆盖）：                                │
│ ┌──────────────────┐  ┌──────────────────┐             │
│ │ 📦 工具名称      │  │ 📦 工具名称      │             │
│ │ 简短描述  ●已启用│  │ 简短描述  ○已禁用│             │
│ │ [禁用] ▼         │  │ [启用] ▼         │             │
│ └──────────────────┘  └──────────────────┘             │
│ ┌─────────────────────────────────────────────────┐    │
│ │ 工具详细描述...                                 │    │  ← 覆盖显示
│ └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

#### 技术总结

1. **工具状态管理设计原则**：
   - 本地工具：文件后缀 `.js` ↔ `.txt`（与原 test.py 一致）
   - 外部工具：配置键名 `name` ↔ `name_disabled`
   - 优先使用本地文件，外部工具配置作为补充

2. **绝对定位布局优势**：
   - 不影响 Grid 布局
   - 支持内容溢出
   - 提升用户体验（展开不挤压其他卡片）

3. **外部工具检测逻辑**：
   - 检查 `mcp_config.json` 配置
   - 验证是否有本地 `.js`/`.txt` 文件
   - 有本地文件则跳过（避免重复）

---

### v1.5 (2026-03-05) - 服务停止逻辑彻底修复

#### 问题修复

**1. 服务状态检测逻辑简化**
- **问题**：使用 `tasklist /FI WINDOWTITLE eq *{service}*` 检测服务状态，但所有 cmd 窗口标题都是 `cmd.exe`，导致检测不可靠
- **原因**：
  1. 所有服务都使用 `cmd /c start cmd /k` 启动
  2. 窗口标题统一显示为 `cmd.exe`，无法通过标题区分
  3. `service_pids` 标记成为"僵尸标记"，一旦设为 `True` 即使进程崩溃也不会清除
- **解决方案**：
  - 简化 `is_service_running()` 函数，只依赖 `service_pids` 标记
  - 移除不可靠的 `tasklist` 窗口标题匹配逻辑

**修改文件**：`webui_controller.py`

```python
def is_service_running(service):
    """检查服务是否正在运行
    
    由于所有服务都使用 CREATE_NEW_CONSOLE 启动，窗口标题都是 cmd.exe，
    无法通过 tasklist 可靠检测，因此只依赖 service_pids 标记。
    """
    return service_pids.get(service, False)
```

---

**2. 服务停止逻辑修复（核心问题）**
- **问题**：停止服务时提示"[WinError 2] 系统找不到指定的文件"，且 cmd 窗口和子进程（如 node.exe）仍然运行
- **根本原因分析**：
  1. **进程链结构**：
     ```
     webui_controller.py (Python)
         │
         └─→ cmd.exe (执行：cmd /c start cmd /k ...)  ← 父进程
                 │
                 └─→ cmd.exe (新窗口，执行 bat 文件)
                         │
                         ├─→ go.bat
                         │    └─→ node.exe (运行 Electron)  ← 实际运行的应用
                         │
                         └─→ pause 命令 ← 等待用户按键
     ```
  2. **原停止逻辑缺陷**：
     - 使用 `wmic process where commandline like '%go.bat%' delete`
     - 只能终止命令行中包含 `go.bat` 的 cmd.exe 进程
     - `node.exe` 因为命令行不包含 `go.bat` 而幸存
     - `pause` 命令导致 cmd 窗口等待用户输入，即使父进程被终止也不会自动关闭

- **解决方案**：
  1. 使用 PowerShell 根据命令行参数查找进程 PID
  2. 对每个 PID 使用 `taskkill /F /T` 终止整个进程树（`/T` 参数递归终止所有子进程）
  3. 添加严格的错误检查：未找到进程时返回明确提示

**修改文件**：`webui_controller.py`

```python
@app.route('/api/stop/<service>', methods=['POST'])
def stop_service(service):
    """停止指定服务"""
    try:
        # 检查服务是否运行
        if not is_service_running(service):
            return jsonify({'success': False, 'error': '服务未运行'})

        # 使用 PowerShell 根据命令行参数查找 PID，然后用 taskkill /T 终止进程树
        if sys.platform.startswith('win'):
            import subprocess
            
            # 构建 bat 文件名
            if service == 'live2d':
                bat_name = 'go.bat'
            elif service == 'memos':
                bat_name = 'MEMOS-API.bat'
            elif service == 'rag':
                bat_name = 'RAG.bat'
            else:
                bat_name = f'{service}.bat'
            
            # 使用 PowerShell 查找包含 bat 文件名的进程 PID
            ps_script = f"""
            $ErrorActionPreference = 'SilentlyContinue'
            $procs = Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -and $_.CommandLine -like '*{bat_name}*' }}
            foreach ($proc in $procs) {{
                Write-Output $proc.ProcessId
            }}
            """
            
            result = subprocess.run(
                ['powershell', '-Command', ps_script],
                capture_output=True, text=True, timeout=10
            )
            
            # 解析输出的 PID 列表
            pids = [line.strip() for line in result.stdout.split('\n') if line.strip().isdigit()]
            
            # 如果没有找到进程，返回错误
            if not pids:
                logger.error(f'停止 {service} 服务失败：未找到相关进程（可能已意外终止）')
                service_pids[service] = False
                return jsonify({'success': False, 'error': f'未找到 {service} 服务进程，可能已意外终止'})
            
            # 对每个 PID 使用 taskkill /T 终止进程树
            killed_count = 0
            failed_pids = []
            for pid in pids:
                kill_result = subprocess.run(
                    ['taskkill', '/F', '/T', '/PID', pid],
                    capture_output=True, text=True, timeout=10
                )
                if '成功' in kill_result.stdout or '成功' in kill_result.stderr:
                    killed_count += 1
                else:
                    failed_pids.append(pid)
            
            # 检查是否有终止失败的进程
            if failed_pids and killed_count == 0:
                return jsonify({'success': False, 'error': f'停止服务失败：无法终止进程'})
            
            # 清除服务标记
            service_pids[service] = False
            logger.warning(f'{service} 服务已停止（终止了 {killed_count} 个进程树）')
            return jsonify({'success': True, 'message': f'成功终止 {killed_count} 个进程'})
```

---

**3. 日志系统优化**
- **问题 1**：日志时间戳不断更新，没有意义
- **问题 2**：日志页面滚动时会不断回弹到开头
- **问题 3**：日志面板标题冗余

**解决方案**：
1. **增量日志加载**：
   - 使用 `lastPetLogCount` 和 `lastToolLogCount` 记录上次日志数量
   - 只添加新增的日志，避免全量刷新
2. **智能滚动**：
   - 只有当用户在日志底部时才自动滚动
   - 阅读历史日志时不会被打断
3. **移除额外时间戳**：
   - 直接使用 `runtime.log` 中的原始时间戳
   - 不再添加前端时间戳
4. **移除冗余标题**：
   - 删除 `🖥️ 系统启动日志 `、`🐱 桌宠运行日志 `、`🔧 工具调用日志` 标题

**修改文件**：`static/js/app.js`、`templates/index.html`

```javascript
// 增量加载日志（只添加新日志，避免回弹）
function appendNewLogs(logType, newLogs) {
    const logOutput = document.getElementById(logType + '-log-output');
    
    newLogs.forEach(log => {
        const level = /* 判断日志级别 */;
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry log-' + level;
        logEntry.textContent = log;  // 直接使用日志内容，不添加额外时间戳
        logOutput.appendChild(logEntry);
    });
    
    // 只有当用户已经在底部时才自动滚动到底部
    const isAtBottom = logOutput.scrollHeight - logOutput.clientHeight - logOutput.scrollTop < 50;
    if (isAtBottom) {
        logOutput.scrollTop = logOutput.scrollHeight;
    }
}

// 加载日志（增量更新）
async function loadLogs(logType) {
    const data = await fetch('/api/logs/' + logType).then(r => r.json());
    const currentCount = logType === 'pet' ? lastPetLogCount : lastToolLogCount;
    const newCount = data.logs.length;
    
    // 只有当日志数量增加时才添加新日志
    if (newCount > currentCount) {
        const newLogs = data.logs.slice(currentCount);  // 只取新增的日志
        appendNewLogs(logType, newLogs);
        lastPetLogCount = newCount;  // 更新计数
    }
    // 如果日志数量减少（文件被清空），重置并重新加载
    else if (newCount < currentCount) {
        logOutput.innerHTML = '';
        lastPetLogCount = 0;
        appendNewLogs(logType, data.logs);
    }
}
```

---

**4. 日志轮询频率提高**
- **修改前**：2000ms（2 秒）
- **修改后**：500ms（0.5 秒），提高 4 倍实时性

---

#### 新增功能

**1. 系统信息栏**
- 显示 WebUI 版本号（v1.5）
- 显示系统运行时间（自动更新）
- 添加"一键启动全部"和"一键停止全部"按钮

**2. 服务卡片 3 列布局**
- 修改 CSS Grid 布局为固定 3 列
- 添加响应式断点：1200px 以下 2 列，768px 以下 1 列

**3. 一键启动/停止增强**
- 显示详细进度日志
- 统计成功/失败数量
- 完成后显示汇总信息

**修改文件**：`templates/index.html`、`static/css/style.css`、`static/js/app.js`、`webui_controller.py`

```html
<!-- 系统信息栏 -->
<div class="system-info-bar">
    <div class="info-item">
        <span class="info-label">WebUI 版本:</span>
        <span class="info-value" id="webui-version">加载中...</span>
    </div>
    <div class="info-item">
        <span class="info-label">运行时间:</span>
        <span class="info-value" id="system-uptime">0 小时 0 分钟 0 秒</span>
    </div>
    <div class="info-actions">
        <button class="btn-start" onclick="startAllServices()">一键启动全部</button>
        <button class="btn-stop" onclick="stopAllServices()">一键停止全部</button>
    </div>
</div>
```

```python
# webui_controller.py - 添加系统信息 API
WEBUI_VERSION = 'v1.5'
START_TIME = datetime.datetime.now()

@app.route('/api/system/info')
def get_system_info():
    """获取系统信息（版本、运行时间等）"""
    uptime = datetime.datetime.now() - START_TIME
    days = uptime.days
    hours, remainder = divmod(uptime.seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    
    uptime_str = f"{days}天{hours}小时{minutes}分钟{seconds}秒" if days > 0 else f"{hours}小时{minutes}分钟{seconds}秒"
    
    return jsonify({
        'version': WEBUI_VERSION,
        'uptime': uptime_str,
        'start_time': START_TIME.strftime('%Y-%m-%d %H:%M:%S')
    })
```

---

#### 技术总结

1. **Windows 进程管理关键点**：
   - `CREATE_NEW_CONSOLE` 启动的进程，父进程会立即返回
   - 窗口标题不可靠（都是 `cmd.exe`）
   - 必须使用 `taskkill /T` 终止整个进程树
   - `pause` 命令会导致 cmd 窗口等待，需要强制终止

2. **日志系统设计原则**：
   - 增量更新优于全量刷新
   - 智能滚动提升用户体验
   - 保留原始时间戳更准确

3. **错误处理最佳实践**：
   - 未找到进程时返回明确提示
   - 统计成功/失败数量
   - 即使部分失败也清除标记

---

### v1.4.2 (2026-03-04)

#### 问题修复
**批处理文件编码问题**
- **问题**：运行批处理文件时出现乱码错误，如 `'鎴栨洿楂樼増鏈？' 不是内部或外部命令`
- **原因**：
  1. 批处理文件使用 UTF-8 编码保存
  2. Windows cmd 默认使用 GBK/ANSI 编码
  3. `chcp 65001` 命令在某些情况下会导致字符解析错误
- **解决方案**：
  - 移除 `chcp 65001` 命令
  - 使用英文提示语避免编码问题
  - 简化批处理脚本内容

**修改后的批处理**：
```batch
@echo off
echo.
echo ========================================
echo  My Neuro WebUI Control Panel v1.4
echo ========================================
```

---

### v1.4.1 (2026-03-04)

#### 问题修复
**启动脚本报错修复**
- **问题**：启动时出现 `AssertionError: View function mapping is overwriting an existing endpoint function: get_status`
- **原因**：`get_status` 函数被重复定义了两次
- **解决方案**：删除重复的 `@app.route('/api/status')` 装饰器和函数定义
- **修改文件**：`webui_controller.py`

**启动脚本优化**
- 更新版本号为 v1.4
- 添加错误处理（`if errorlevel 1`）
- 改进显示效果

---

### v1.4 (2026-03-04)

#### 问题修复

**1. 服务状态检测修复**
- **问题**：使用 `CREATE_NEW_CONSOLE` 启动服务后，进程对象立即返回，导致无法正确检测服务状态
- **原因**：`cmd /c start cmd /k` 命令会创建新窗口并立即返回父进程
- **解决方案**：
  - 引入 `service_pids` 字典记录服务启动状态
  - 使用 `is_service_running()` 函数通过 `tasklist` 命令验证进程是否存在
  - 停止服务时使用 `taskkill` 命令根据窗口标题过滤并终止进程

**2. 日志系统修复**
- **问题 1**：Web 桌宠日志与 `runtime.log` 内容不同步
- **问题 2**：Web 日志显示 `runtime.log` 中不存在的额外内容（如"桌宠服务已初始化"）
- **解决方案**：
  - 移除前端自动添加的虚拟日志（"桌宠服务已初始化"、"Live2D 模型加载中..."等）
  - 启动 Live2D 服务时自动清空 `runtime.log` 文件
  - Web 日志完全同步 `runtime.log` 内容，不做额外添加

**3. 停止按钮修复**
- **问题**：停止服务后显示"服务未运行"错误
- **原因**：`is_service_running()` 检测逻辑不完善
- **解决方案**：
  - 在 `stop_service()` 中先检查服务状态
  - 使用 `taskkill /F /IM cmd.exe /FI "WINDOWTITLE eq *go.bat*"` 精确终止进程
  - 清除 `service_pids` 标记

#### 新增功能

**1. 动态主动对话支持**
- 心情分实时显示（每 3 秒轮询）
- 心情分颜色状态（绿/蓝/橙/红）
- 独立的动态主动对话配置保存

**2. 日志文件管理**
- 启动 Live2D 时自动清空 `runtime.log`
- 日志按 `[TOOL]` 标记过滤显示

#### 代码修改

**webui_controller.py**
```python
# 新增服务状态跟踪
service_pids = {}

def is_service_running(service):
    """检查服务是否正在运行（使用多种方法）"""
    if service_pids.get(service, False):
        # 使用 tasklist 验证进程是否存在
        result = subprocess.run(
            ['tasklist', '/FI', f'WINDOWTITLE eq *{service}*'],
            capture_output=True, text=True
        )
        if service in result.stdout:
            return True
    return False

@app.route('/api/stop/<service>', methods=['POST'])
def stop_service(service):
    """停止指定服务"""
    if not is_service_running(service):
        return jsonify({'success': False, 'error': '服务未运行'})
    
    # 使用 taskkill 停止服务
    subprocess.run(
        ['taskkill', '/F', '/IM', 'cmd.exe', '/FI', f'WINDOWTITLE eq *{service}*']
    )
    service_pids[service] = False  # 清除标记
```

**static/js/app.js**
```javascript
// 移除虚拟日志
async function startService(serviceName) {
    // 不再添加 "桌宠服务已初始化" 等额外日志
    const response = await fetch('/api/start/' + serviceName, { method: 'POST' });
    // 只显示 API 返回的结果
}

// 心情分轮询
function startMoodPolling() {
    setInterval(() => {
        loadMoodStatus();
    }, 3000);
}
```

#### 思考与逻辑

1. **进程检测的复杂性**：
   - Windows 下使用 `CREATE_NEW_CONSOLE` 启动的进程，父进程会立即返回
   - 不能依赖 `subprocess.Popen` 对象的 `poll()` 方法
   - 需要使用系统工具（`tasklist`、`taskkill`）进行进程管理

2. **日志同步原则**：
   - WebUI 日志应该完全反映 `runtime.log` 的内容
   - 不应添加任何虚拟日志条目
   - 启动时清空日志文件，确保每次启动都是新的开始

3. **服务状态管理**：
   - 使用 `service_pids` 字典作为"软状态"标记
   - 结合 `tasklist` 进行"硬验证"
   - 停止服务时同时清除标记和终止进程

---

### v1.3 (2026-03-04)

#### 新增功能
- 动态主动对话配置界面
- 心情分实时显示
- 日志文件读取 API

#### API 端点
- `GET /api/logs/<type>` - 获取历史日志
- `GET /api/logs/tail/<type>` - 获取最新日志
- `GET /api/mood/status` - 获取心情分状态
- `POST /api/settings/mood-chat` - 保存动态主动对话配置

---

### v1.2 (2026-03-04)

#### 核心修复
- Live2D 启动脚本从 `start.py` 改为 `go.bat`
- 日志路径修正为 `live-2d/runtime.log`
- 工具日志通过 `[TOOL]` 标记过滤

---

### v1.1 (2026-03-04)

#### 界面优化
- 移除"系统状态"栏
- 多日志系统（系统/桌宠/工具）
- API Key 显示/隐藏切换

---

### v1.0 (2026-03-04)

#### 架构重构
- 代码分离：HTML/CSS/JS独立文件
- Flask 模板与静态资源分离
- 日志级别优化

## 修改指南

| 要修改的内容 | 编辑的文件 |
|-------------|-----------|
| UI 布局/选项卡 | `templates/index.html` |
| 样式/颜色/字体 | `static/css/style.css` |
| 前端交互逻辑 | `static/js/app.js` |
| 后端 API/服务启动 | `webui_controller.py` |

## 服务管理逻辑

### 启动流程
1. 检查 `service_pids` 标记
2. 使用 `tasklist` 验证进程是否存在
3. 启动新进程（`CREATE_NEW_CONSOLE`）
4. 设置 `service_pids[service] = True`
5. 对于 Live2D，清空 `runtime.log`

### 停止流程
1. 检查 `service_pids` 标记
2. 使用 `taskkill` 终止进程（根据窗口标题过滤）
3. 清除 `service_pids[service] = False`

### 状态检测
- 每 5 秒轮询 `/api/status`
- 后端检查 `service_pids` 标记
- 前端更新按钮状态和指示灯
