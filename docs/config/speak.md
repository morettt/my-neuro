# 怎么说

「说」是把模型回复变成声音。总开关在 **功能配置** 的 **启用 TTS**，具体用哪个引擎另外选：本地 GPT-SoVITS，或云端配置里的某一种。

界面上这一项写的是「启用 TTS（本地语音合成）」，但它是总开关——用云端发音时也要打开它。

## 只开一种 TTS

桌宠按下面的顺序挑引擎，**排在前面的一旦启用，后面的就轮不到**：

1. 字节 TTS（火山引擎）
2. 阿里云 TTS
3. 云端 TTS（界面默认填的是 SiliconFlow 地址）
4. 本地 TTS（`2.TTS.bat` 提供的 `http://127.0.0.1:5000`）

另外，开了「启动全云端」时，本地那一档会改走肥牛网关。

所以多种同时勾选的后果是：你以为配了本地声音，实际在打字节或阿里云。**只留你要用的那一个。**

![云端配置页](/images/webui-cloud-only-voice.png)

## 方案 A：本地 GPT-SoVITS

前提：`full-hub/tts-hub` 下有模型目录，启动页上能看到 **TTS 语音合成**。

1. 功能配置勾选 **启用 TTS**。
2. 云端页：关掉字节 TTS、阿里云 TTS、云端 TTS、启动全云端。
3. 到启动页点 TTS 的「启动」，等绿灯。端口 **5000**。也可双击 `2.TTS.bat`。
4. 想换音色就打开 **声音克隆** 页。

![本地 TTS 启动卡片](/images/webui-service-tts.png)

![声音克隆](/images/webui-voice-clone.png)

![声音克隆 · 一键训练](/images/webui-voice-clone-train.png)

::: warning 启动页上没有 TTS 卡片、顶栏也没有声音克隆？
说明这份安装没有本地 TTS 模型，用下面的云端方案。对照见 [介绍](/guide/introduction)。
:::

## 方案 B：阿里云 TTS

1. 云端配置 → **阿里云 TTS**。
2. 勾选启用，填 API Key、业务空间 ID、模型、音色。
3. 点 **保存配置**，并确认字节 TTS、云端 TTS、启动全云端都是关的。
4. 不需要 5000 端口。

密钥在 [阿里云百炼](https://bailian.console.aliyun.com/) 控制台创建。发截图到群里求助前，记得把 Key 遮掉。

![阿里云 TTS 表单](/images/webui-aliyun-tts.png)

## 方案 C：字节 TTS

1. 云端配置 → **字节 TTS**。
2. 勾选启用，填 AppID、Access Token、音色、Resource ID（界面默认是 `seed-tts-2.0`）。
3. 点 **保存配置**。它优先级最高，开着它时其他 TTS 都轮不到。

![字节 TTS](/images/webui-volcengine-tts.png)

## 方案 D：云端 TTS（SiliconFlow 等）

1. 云端配置 → **云端 TTS**。
2. 勾选启用，填 API Key、接口 URL、模型、音色。
3. 只有字节和阿里云都关闭时，才会走到这一档。

![云端 TTS](/images/webui-cloud-tts-silicon.png)

## 方案 E：启动全云端 / 云端肥牛

云端配置的第一个子页有 **启动全云端** 开关，以及网关地址和网关 Key。新版面上这个勾选框可以正常点。

![云端肥牛与启动全云端](/images/webui-cloud-gateway.png)

![勾选启动全云端](/images/webui-cloud-gateway-checked.png)

它不是「一键代替 LLM」，作用是把部分 ASR / TTS 请求指到肥牛网关，聊天模型仍然走 [LLM 配置](/config/llm)。

要用它就得有官网发放的网关地址和 Key。保存后看桌宠日志：能连上就按这页填；连不上就关掉它，改用上面 A–D。它和阿里云、字节同时只能开一个。

## 推荐混用：本地听 + 云端说

没有本地 TTS 模型、但想用麦克风说话时，这是最顺的搭法：

1. 功能配置：启用 ASR、启用 TTS。
2. 启动页：启动 ASR。TTS 那一侧不用管，本地没模型也启动不了。
3. 云端配置：只启用阿里云 TTS、字节 TTS、云端 TTS 之中的一种。
4. 启动 Live2D。

![功能配置同时打开听和说](/images/mix-dialog-toggles.png)

![只勾阿里云 TTS](/images/mix-aliyun-only.png)
