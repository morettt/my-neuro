# Linux / Wayland 源码部署

Linux 可以从源码运行 Electron 控制面板与 Live2D 桌宠。Windows 整合包中的 Python、TTS 运行环境、`.bat` 和 `.exe` 不能直接用于 Linux。

## 安装与启动

需要 Node.js 22.12+、npm、Python 3（含 venv/pip）、图形桌面，以及 Electron 的系统库。支持 Electron 提供的 Linux x64 / arm64 二进制。Debian/Ubuntu 一类发行版需要 `python3-venv`、`libnss3`、`libatk-bridge2.0-0`、`libgtk-3-0`、`libgbm1`、`libasound2` 等；不同发行版及 t64 迁移后的包名会有差异。

```bash
cd ~/project/my-neuro
./scripts/setup-linux.sh
./scripts/start-linux.sh
```

安装脚本创建项目内的 `env/bin/python`，安装轻量 Python 依赖、Node 依赖及对应架构的 Electron，并注册当前用户的 My-Neuro 应用菜单入口。不会安装 CUDA 或下载大型语音模型。不需要 root，也不要用 root 启动 Electron。

首次打开后，在控制面板中配置 LLM 提供商，按需配置云端 TTS/ASR，再点击「启动桌宠」。未配置 LLM 时仍能显示角色，对话请求会报告缺少提供商。已有独立 Python 环境时，可用绝对路径设置 `MY_NEURO_PYTHON=/path/to/bin/python`。

## Wayland 的两种运行方式

| 模式 | 启动方式 | 能力与限制 |
| --- | --- | --- |
| XWayland 桌面覆盖层（默认） | `./scripts/start-linux.sh` | 自动覆盖桌面，无需手动全屏；模型可点击、拖动和缩放，空白区域鼠标穿透。Wayland 会话保持不变。 |
| 原生 Wayland 小窗（实验性、显式选择） | `MY_NEURO_DISPLAY_MODE=wayland ./scripts/start-linux.sh` | 仅用于验证原生渲染和窗口交互。窗口范围会拦截下层内容，不具备桌面覆盖层体验，不作为默认桌宠方案。 |

启动器在 Electron 启动前传入 Ozone 显示后端和 GL 参数；不要绕过启动器直接执行 Electron 二进制，否则新版 Electron 可能在读取应用代码之前选错后端，导致窗口不可见。`npm run control` / `npm start` 也使用相同的启动器。

默认使用 X11 后端：在 Wayland 桌面会话中通过 XWayland 提供透明覆盖层，在 X11 会话中直接运行。启动器、控制面板、桌宠子进程使用一致的选择。默认模式需要 `DISPLAY`；若没有 XWayland，会明确报错，不静默改成拦截桌面的透明小窗。

实验性原生 Wayland 模式提供 640×720 的透明窗口和移动把手，便于检查原生 GPU、模型、聊天及窗口交互。它不能替代真正的桌宠覆盖层：即使背景透明，窗口范围仍会拦截下层内容；把它手动全屏也不能解决穿透问题。

真正的原生 Wayland 桌宠需要合成器层面的覆盖、输入区域及定位支持。GNOME/KDE/wlroots 的扩展和协议不同，本实现尚未提供这层适配，因此不将普通透明窗口称为原生桌宠适配完成，也不默认启用。

XWayland 覆盖层通过低频鼠标位置采样恢复模型/控件命中检测：移入模型时接收原生点击、拖动和滚轮，空白区域保持穿透。坐标使用 Electron 的 DIP，不再乘显示缩放比例；拖动中即使暂时离开命中框也保持接收松开事件。这样避免依赖 [Electron 仅在 macOS/Windows 支持的鼠标移动转发](https://www.electronjs.org/docs/latest/api/base-window#winsetignoremouseeventsignore-options)。原生 Wayland 透明小窗无需这条采样路径，也不轮询全局鼠标位置。

Wayland 会话中不启动 `uiohook-napi` 全局键盘钩子：X11 钩子不能可靠捕获其他 Wayland 应用的按下/松开事件。**按住说话需要先聚焦桌宠窗口**；也可使用语音自动检测。普通全局快捷键交给 Electron 的 GlobalShortcuts portal，是否可用取决于桌面后端和用户授权，不保证所有合成器都支持。菜单入口的 `.desktop` 身份由安装脚本注册；若不需要全局快捷键，设置 `MY_NEURO_DISABLE_GLOBAL_SHORTCUTS=1`。

## 截图与屏幕权限

Wayland 会话中的视觉截图通过 Electron / PipeWire / `xdg-desktop-portal` 获取，**包括 XWayland 模式**，不使用只能看到 X11 窗口的传统截图工具。桌面会弹出屏幕选择/共享授权；截图使用你选中的屏幕，不按全局鼠标位置推断屏幕。拒绝或取消授权会返回错误，不退回绕过权限的方式。

需要运行 PipeWire、`xdg-desktop-portal` 及匹配桌面的后端（GNOME、KDE、wlroots 等）。只安装 portal 主包而没有桌面后端不足以完成截图。普通 X11 会话继续使用原有截图路径。

## ARM / GPU 驱动问题

如果控制面板打开了但角色报 `WebGL unsupported`，或日志出现 GPU 进程崩溃，可以启用 SwiftShader 软件渲染：

```bash
./scripts/start-linux.sh --software-rendering
```

这个选项会把软件渲染偏好保存在本机的 `live-2d/.runtime/linux-settings.json`（不提交 Git）。菜单、`npm run control`、`npm start` 和控制面板启动的桌宠子进程都会读取它；因此无需每次重复传参。设置 `MY_NEURO_SOFTWARE_RENDERING=0` 可以临时使用硬件渲染；`./scripts/start-linux.sh --hardware-rendering` 会保存硬件渲染偏好。软件渲染的 3D 模型可能占用多个 CPU 核心并明显发热，有可用 GPU 时优先恢复硬件渲染。

这个选项会启用 Chromium 的软件 WebGL（`enable-unsafe-swiftshader`），只用于需要该兼容路径的机器，CPU 占用可能增加。硬件渲染仍是默认选项。若希望应用菜单也使用软件渲染，重新注册入口：

```bash
MY_NEURO_SOFTWARE_RENDERING=1 python3 scripts/install-linux-desktop.py
```

## 硬件渲染与 VRM 负载

显示后端和 GPU 参数都必须在 Electron 启动前传入。修复启动参数顺序后，不应仅因为旧的显示故障就永久启用 SwiftShader。可先使用硬件模式：

```bash
./scripts/start-linux.sh --hardware-rendering
```

如果默认硬件路径不适配本机驱动，可用 `MY_NEURO_ANGLE_BACKEND=gles` 或 `gl` 指定 ANGLE 的 OpenGL ES / OpenGL 后端；`auto` 恢复 Electron 默认选择。也可在本地 `live-2d/.runtime/linux-settings.json` 中设置 `"softwareRendering": false, "angleBackend": "gles"`。菜单入口读取同一设置，不写死 SwiftShader。

判断是否使用 GPU 要看 `runtime.log` 中 VRM 的 `WebGL渲染器`，例如 `ANGLE (freedreno, Adreno X1-85, OpenGL ES 3.2)`；存在 GPU 进程本身不代表使用硬件，`SwiftShader` / `llvmpipe` 仍是软件实现。

VRM 默认限制为 30 FPS，减少桌宠持续渲染负载；需要更流畅动画时可在 `config.json` 的 `ui.vrm_max_fps` 中设置 60，重新启动桌宠生效。主光源跟随相机方向，避免默认负 Z 视角下角色被背光照暗；保留模型原有 MToon 材质、贴图与阴影色。

## 本地语音模型和插件

- 默认安装仅覆盖显示、控制面板和轻量 Python 插件；云端服务仍需你自己的账号和密钥。
- 本地 ASR、BERT 插件已经使用 Python 入口，可以由控制面板在 Linux 中启动/停止。下载 DLC 前，需要在所选 Python 环境中自行安装 `modelscope`；推理还需要与本机架构匹配的 PyTorch 和模型依赖。ASR 使用 `fastapi uvicorn python-multipart funasr torchaudio numpy soundfile librosa` 等；BERT 使用 `fastapi uvicorn transformers torch` 等。CPU/显卡及 PyTorch 版本选择按相应上游项目要求，不安装 Windows 的 CUDA 环境包。
- ASR 使用 1000 端口。在限制普通用户绑定低端口的发行版上，需要同时修改服务端端口、插件元数据和客户端配置；不要为此以 root 运行整个桌宠。
- GPT-SoVITS 的整合下载、声音 `.bat` 生成、只有 Windows 启动器的社区 DLC 会明确提示不可用。Linux 请另行部署上游 GPT-SoVITS 并填写 TTS API 地址，或使用云端 TTS。
- Linux 控制面板只终止自己创建的进程组，不根据端口杀死外部进程。手动启动的服务也应在原终端停止。
- 旧的 Flask WebUI 服务启动/停止仍包含 Windows 批处理逻辑；Linux 请使用这里的 Electron 控制面板。第三方插件中的 Windows 桌面控制工具不自动获得 Wayland 控制权限。

## 验证范围

已在 ARM64 Linux / Wayland 会话中验证安装、控制面板启动桌宠、Live2D 进入 `ready`、停止流程。XWayland 模式已核对控制面板与桌宠均处于系统的 `IsViewable` 状态，并由用户确认两者同时可见。原生 Wayland 实验窗口已验证模型显示、把手移动和窗口内部交互，但其窗口范围拦截下层内容，不满足桌宠覆盖层要求。原生渲染器为 Adreno X1-85 / OpenGL ES 3.2。该机器已验证 Adreno X1-85 / freedreno 硬件 WebGL（ANGLE OpenGL 与 OpenGL ES 两条路径）；软件渲染仅作为可选兼容方案。未配置提供商的对话、云语音和大型本地模型不算作端到端通过。截图的 portal 路径有自动测试，真实屏幕选择授权及其他合成器/显卡仍需各自桌面环境验证。

```bash
node --test $(find live-2d/js -name '*.test.js')
```

启动时传入 `--start-pet` 可以在控制面板加载后自动启动桌宠，例如 `./scripts/start-linux.sh --start-pet`。

日志位于 `live-2d/runtime.log`。删除 `env/`、`live-2d/node_modules/` 可移除本地依赖；删除 `~/.local/share/applications/io.github.morettt.MyNeuro.desktop` 可移除默认菜单入口（设置了 `XDG_DATA_HOME` 时在对应目录）。
