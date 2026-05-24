================================================================
  My-Neuro 长期记忆系统 (MemOS) - 开箱即用包
================================================================

本压缩包提供 MemOS 长期记忆系统，让 AI 拥有跨会话的记忆能力。

----------------------------------------------------------------
一、前置条件
----------------------------------------------------------------

1. 你必须先在 my-neuro 根目录运行过 installer.py 安装 Python 环境
   （会产生 my-neuro/env/python.exe 和 my-neuro/full-hub/rag-hub/ 等目录）

2. installer.py 安装时必须勾选 BERT 或 RAG（用于 embedding 模型）
   - 如果没装，记忆检索功能将无法工作


----------------------------------------------------------------
二、解压步骤
----------------------------------------------------------------

将本 zip 解压到 my-neuro 根目录（与 installer.py 同级），选择 "覆盖" 即可。

正确的目标结构（解压后）：

  my-neuro/
    env/                          (installer.py 装的)
    full-hub/                     (installer.py 装的)
    plugins-dlc/
      memos/                      (本包提供)
        MEMOS-API.bat
        MEMOS-WebUI.bat
        sync_plugin_config.py
        memos_system/
          ...
    live-2d/
      plugins/built-in/memos/    (本包提供)
        index.js
        ...
    README-记忆系统使用说明.txt  (本文件)


----------------------------------------------------------------
三、首次使用
----------------------------------------------------------------

【步骤 1】配置 API Key

打开任一文件填入你自己的 LLM API Key：

  方式 A（推荐）：在 live-2d 插件配置面板里直接填
    - 文件位置：my-neuro/live-2d/plugins/built-in/memos/plugin_config.json
    - 找 "backend_llm" 和 "backend_llm_fallback" 下的 "api_key.value"
    - 把 "your-api-key-here" 改成你的真实 Key

  方式 B：直接编辑后端配置
    - 文件位置：my-neuro/plugins-dlc/memos/memos_system/config/memos_config.json
    - 找 "llm.config.api_key" 和 "llm_fallback.config.api_key"
    - 把 "your-api-key-here" 改成你的真实 Key

注：方式 A 的 plugin_config.json 会在每次启动 MEMOS-API.bat 时自动同步到
    memos_config.json，所以推荐方式 A。

【步骤 2】启动后端服务

双击 my-neuro/plugins-dlc/memos/MEMOS-API.bat
窗口里看到 "Embedding 模型已加载" + "Uvicorn running on http://127.0.0.1:8003" 即成功
保持这个窗口开着，不要关。

【步骤 3】（可选）启动 Web 管理界面 (Cyberpunk Edition)

双击 my-neuro/plugins-dlc/memos/MEMOS-WebUI.bat
浏览器会自动打开 http://localhost:8004
可在里面浏览/搜索/编辑所有记忆、查看知识图谱、管理图片记忆等。

【步骤 4】启动主程序

正常启动 my-neuro 主程序，记忆系统会自动接入。


----------------------------------------------------------------
四、常见问题
----------------------------------------------------------------

Q: 双击 MEMOS-API.bat 弹出 "[错误] 未检测到 env\python.exe"
A: 你还没跑 installer.py，或装错了位置。先去根目录跑 installer.py。

Q: 启动后报 "Embedding 模型加载失败 / 找不到 rag-hub"
A: installer.py 时没装 RAG 模型。重新跑 installer.py 并勾选 RAG 选项。

Q: WebUI 启动失败，提示 "API 服务未启动"
A: 先双击 MEMOS-API.bat 启动后端，等出现 "Uvicorn running" 再启动 WebUI。

Q: 记忆没保存 / LLM 调用报错
A: 检查 API Key 是否填对、对应平台有余额、网络是否能访问 base_url。

Q: 端口被占用（8003 或 8004）
A: bat 脚本会自动尝试 kill 占用进程；不行就重启电脑。

Q: WebUI 打开后页面元素加载失败 / 没字体
A: WebUI 用了 Google Fonts CDN 和 unpkg CDN，需要能访问外网。
   如果在墙内无法访问，记忆数据本身不受影响，只是 UI 样式可能降级。

Q: 想换默认 LLM
A: 编辑 plugin_config.json 里 backend_llm.model / base_url（兼容 OpenAI 协议
   的任意服务都行，例如 DeepSeek、智谱、OpenRouter、SiliconFlow 等）。


----------------------------------------------------------------
五、技术细节
----------------------------------------------------------------

- API 端口：8003（FastAPI + Uvicorn）
- WebUI 端口：8004（Flask + HTML/JS/CSS Cyberpunk）
- 向量库：Qdrant（本地嵌入式，存 plugins-dlc/memos/memos_system/data/qdrant/）
- 知识图谱：NetworkX（plugins-dlc/memos/memos_system/data/graph_store.json）
- 记忆备份：JSON（plugins-dlc/memos/memos_system/data/memory_store.json）
- 图像存储：plugins-dlc/memos/memos_system/data/images/
- Embedding：SentenceTransformer，模型读自 full-hub/rag-hub/

依赖：本包不包含任何 Python 依赖；installer.py 装出的 env 已经预装齐全。

================================================================
