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
| XWayland 桌宠覆盖层（默认） | `./scripts/start-linux.sh` | 当 `DISPLAY` 可用时使用 X11 后端，保留透明、模型交互、桌面定位和跨屏窗口逻辑；置顶、缩放及跨屏效果仍受合成器约束。桌面会话保持 Wayland。 |
| 原生 Wayland 窗口 | `MY_NEURO_DISPLAY_MODE=wayland ./scripts/start-linux.sh` | 角色显示在可交互、有边框的普通窗口内。由合成器负责窗口定位，不做全桌面覆盖、鼠标穿透或强制置顶。窗口内拖动角色、打字和聚焦按键录音可用。 |

启动器在 Electron 启动前传入 Ozone 显示后端和 GL 参数；不要绕过启动器直接执行 Electron 二进制，否则新版 Electron 可能在读取应用代码之前选错后端，导致窗口不可见。`npm run control` / `npm start` 也使用相同的启动器。

无 `DISPLAY` 时自动使用原生 Wayland 窗口。需要覆盖层时安装/启用发行版的 XWayland。不在原生 Wayland 上反复调用窗口定位修正，避免窗口被错误拉伸或隐藏。

Wayland 会话中不启动 `uiohook-napi` 全局键盘钩子：X11 钩子不能可靠捕获其他 Wayland 应用的按下/松开事件。**按住说话需要先聚焦桌宠窗口**；也可使用语音自动检测。普通全局快捷键交给 Electron 的 GlobalShortcuts portal，是否可用取决于桌面后端和用户授权，不保证所有合成器都支持。菜单入口的 `.desktop` 身份由安装脚本注册；若不需要全局快捷键，设置 `MY_NEURO_DISABLE_GLOBAL_SHORTCUTS=1`。

## 截图与屏幕权限

Wayland 会话中的视觉截图通过 Electron / PipeWire / `xdg-desktop-portal` 获取，**包括 XWayland 模式**，不使用只能看到 X11 窗口的传统截图工具。桌面会弹出屏幕选择/共享授权；截图使用你选中的屏幕，不按全局鼠标位置推断屏幕。拒绝或取消授权会返回错误，不退回绕过权限的方式。

需要运行 PipeWire、`xdg-desktop-portal` 及匹配桌面的后端（GNOME、KDE、wlroots 等）。只安装 portal 主包而没有桌面后端不足以完成截图。普通 X11 会话继续使用原有截图路径。

## ARM / GPU 驱动问题

如果控制面板打开了但角色报 `WebGL unsupported`，或日志出现 GPU 进程崩溃，可以启用 SwiftShader 软件渲染：

```bash
./scripts/start-linux.sh --software-rendering
```

这个选项会把软件渲染偏好保存在本机的 `live-2d/.runtime/linux-settings.json`（不提交 Git）。菜单、`npm run control`、`npm start` 和控制面板启动的桌宠子进程都会读取它；因此无需每次重复传参。设置 `MY_NEURO_SOFTWARE_RENDERING=0` 可以临时使用硬件渲染。

这个选项会启用 Chromium 的软件 WebGL（`enable-unsafe-swiftshader`），只用于需要该兼容路径的机器，CPU 占用可能增加。硬件渲染仍是默认选项。若希望应用菜单也使用软件渲染，重新注册入口：

```bash
MY_NEURO_SOFTWARE_RENDERING=1 python3 scripts/install-linux-desktop.py
```

## 本地语音模型和插件

- 默认安装仅覆盖显示、控制面板和轻量 Python 插件；云端服务仍需你自己的账号和密钥。
- 本地 ASR、BERT 插件已经使用 Python 入口，可以由控制面板在 Linux 中启动/停止。下载 DLC 前，需要在所选 Python 环境中自行安装 `modelscope`；推理还需要与本机架构匹配的 PyTorch 和模型依赖。ASR 使用 `fastapi uvicorn python-multipart funasr torchaudio numpy soundfile librosa` 等；BERT 使用 `fastapi uvicorn transformers torch` 等。CPU/显卡及 PyTorch 版本选择按相应上游项目要求，不安装 Windows 的 CUDA 环境包。
- ASR 使用 1000 端口。在限制普通用户绑定低端口的发行版上，需要同时修改服务端端口、插件元数据和客户端配置；不要为此以 root 运行整个桌宠。
- GPT-SoVITS 的整合下载、声音 `.bat` 生成、只有 Windows 启动器的社区 DLC 会明确提示不可用。Linux 请另行部署上游 GPT-SoVITS 并填写 TTS API 地址，或使用云端 TTS。
- Linux 控制面板只终止自己创建的进程组，不根据端口杀死外部进程。手动启动的服务也应在原终端停止。
- 旧的 Flask WebUI 服务启动/停止仍包含 Windows 批处理逻辑；Linux 请使用这里的 Electron 控制面板。第三方插件中的 Windows 桌面控制工具不自动获得 Wayland 控制权限。

## 验证范围

已在 ARM64 Linux / Wayland 会话中验证安装、控制面板启动桌宠、Live2D 进入 `ready`、停止流程。XWayland 模式已核对控制面板与桌宠均处于系统的 `IsViewable` 状态，并由用户确认两者同时可见。原生 Wayland 普通窗口完成了模型初始化验证，桌面可见性及交互仍需进一步实测。该机器使用软件渲染完成新版 Electron 验证。未配置提供商的对话、云语音和大型本地模型不算作端到端通过。截图的 portal 路径有自动测试，真实屏幕选择授权及其他合成器/显卡仍需各自桌面环境验证。

```bash
node --test $(find live-2d/js -name '*.test.js')
```

启动时传入 `--start-pet` 可以在控制面板加载后自动启动桌宠，例如 `./scripts/start-linux.sh --software-rendering --start-pet`。

日志位于 `live-2d/runtime.log`。删除 `env/`、`live-2d/node_modules/` 可移除本地依赖；删除 `~/.local/share/applications/io.github.morettt.MyNeuro.desktop` 可移除默认菜单入口（设置了 `XDG_DATA_HOME` 时在对应目录）。
