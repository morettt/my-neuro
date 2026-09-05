# 打开 WebUI

WebUI 是这套文档的唯一操作面。

## 启动

1. 打开安装目录中的 `live-2d`。
2. 双击 **`启动 WebUI 控制面板.bat`**。
3. 脚本会优先用 `..\env\python.exe` 跑 Flask；没有 `env` 时才 `conda activate my-neuro`。
4. 控制台打印 `访问地址：http://localhost:随机端口`，并尝试自动打开浏览器。

![WebUI 启动后的控制中心首页](/images/webui-home.png)

默认模板是 **新版面**。右上角可以切到「经典版面」。本站截图都跟新版面。

![经典版面切换与语言](/images/webui-header-controls.png)

## 怎么确认开对了

你应该看到：

- 标题 **My Neuro - 控制中心**
- 顶栏第一项是 **启动**
- 不是单独一个桌面窗口里的 `肥牛.exe`

## 这份安装有没有本地语音

看 **启动** 页上有几张服务卡片就知道，这也决定了后面「怎么听 / 怎么说」该走哪条路。

装了本地 TTS 模型时，能看到 ASR、TTS、记忆系统、RAG、BERT：

![装了本地 TTS 时启动页能看到全部服务卡片](/images/webui-services.png)

没装时只剩「Live2D 主服务」一张：

![没装本地 TTS 时启动页只剩 Live2D](/images/webui-cloud-services-hidden.png)

顶栏也会跟着少一个「声音克隆」：

![没有声音克隆页的顶栏](/images/webui-cloud-no-clone-tab.png)

判断依据是 `full-hub/tts-hub` 里有没有模型目录，说明见 [介绍](/guide/introduction)。两种情况都能正常聊天，区别只是发音走本地还是云端。

## 打不开时

- **黑窗口报缺 `flask` / `requests`**：bat 会尝试自动 pip 安装；失败就手动跑 `env\python.exe -m pip install flask requests`
- **浏览器空白**：换一个浏览器打开控制台里的地址
- **端口每次不同**：正常现象，脚本会自己找空闲端口
- **防火墙弹窗**：允许 Python 访问局域网即可，本机浏览用 localhost
