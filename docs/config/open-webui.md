# 打开 WebUI

WebUI 是这套文档的唯一操作面。

## 启动

1. 打开安装目录中的 `live-2d`。
2. 双击 **`启动 WebUI 控制面板.bat`**。
3. 脚本会优先用 `..\env\python.exe` 跑 Flask；没有 `env` 时才 `conda activate my-neuro`。
4. 控制台打印 `访问地址：http://localhost:随机端口`，并尝试自动打开浏览器。

![WebUI 启动后的控制中心首页](/images/webui-home.png)

默认模板是 **新版面**（`index_new.html`）。右上角可以切到「经典版面」。本站截图跟新版面。

![经典版面切换与语言](/images/webui-header-controls.png)

## 怎么确认开对了

你应该看到：

- 标题 **My Neuro - 控制中心**
- 顶栏第一项是 **启动**（中文语言包加载后如此；HTML 原文曾写「服务控制」）
- 不是单独一个桌面窗口里的 `肥牛.exe`

有没有本地 TTS，看 **启动** 页：能看到 ASR / TTS / 记忆 / RAG / BERT 卡片，就是装了本地 TTS 模型包；只剩 Live2D 主服务、也没有「声音克隆」页，就是没有本地 TTS。经典版面才会在标题里写 **（云端）** / **（本地）**。

对照见下面两张图。

![有本地 TTS 时启动页能看到全部服务卡片](/images/webui-services.png)

![没有本地 TTS 时启动页只剩 Live2D](/images/webui-cloud-services-hidden.png)

![没有声音克隆页的顶栏](/images/webui-cloud-no-clone-tab.png)

## 打不开时

- 黑窗口报缺 `flask` / `requests`：bat 会尝试 pip 安装；失败就用 `env\python.exe -m pip install flask requests`
- 浏览器空白：换一个浏览器打开控制台里的地址
- 端口每次不同：这是正常的，脚本会找空闲端口
- 防火墙弹窗：允许 Python 访问局域网即可，本机浏览用 localhost
