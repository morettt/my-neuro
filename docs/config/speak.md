# 怎么说

「说」是把模型回复变成声音。总开关在 **功能配置** 的 **启用 TTS**（界面文案写成「本地语音合成」，实际是总开关）。具体引擎：本地 GPT-SoVITS，或云端配置里的某一种。

## 只开一种 TTS

桌宠按下面顺序选引擎，**排在前面的一旦启用就会抢走后面的**：

1. 字节 TTS（火山引擎，`cloud.volcengine_tts.enabled`）
2. 阿里云 TTS（`cloud.aliyun_tts.enabled`）
3. 云端 TTS（`cloud.tts.enabled`，界面默认常见 SiliconFlow 地址）
4. 本地 TTS（`2.TTS.bat` 提供的 `http://127.0.0.1:5000`），若同时打开了「启动全云端」则走肥牛网关 TTS

多种同时勾选时，你会以为配了本地声音，实际却在打字节或阿里云。**只留你要用的那一个。**

![云端配置页（无本地 TTS 时同样存在）](/images/webui-cloud-only-voice.png)

## 方案 A：本地 GPT-SoVITS

前提：`full-hub/tts-hub` 下有模型目录，「启动」页能看到 **TTS 语音合成**。

1. 功能配置勾选 **启用 TTS**。
2. 云端页：关掉字节、阿里云、云端 TTS、启动全云端。
3. 「启动」页启动 TTS，等绿灯。端口 **5000**。也可双击 `2.TTS.bat`。
4. 需要改音色时打开 **声音克隆** 页（没有本地 TTS 时这一页不出现）。

![本地 TTS 启动卡片](/images/webui-service-tts.png)

![声音克隆](/images/webui-voice-clone.png)

::: warning
「启动」页找不到 TTS、也没有声音克隆页 = 当前没有本地 TTS 模型。去下面的云端方案，不要反复点不存在的按钮。
:::

## 方案 B：阿里云 TTS

1. 云端配置 → **阿里云 TTS**。
2. 勾选启用，填 API Key、业务空间 ID、模型、音色。
3. 保存，并确认字节 TTS、云端 TTS、启动全云端是关的。
4. 不需要 5000 端口。

逐步密钥从 [阿里云百炼](https://bailian.console.aliyun.com/) 控制台复制。**截图时请打码。**

![阿里云 TTS 表单](/images/webui-aliyun-tts.png)

## 方案 C：字节 TTS

1. 云端配置 → **字节 TTS**。
2. 勾选启用，填 AppID、Access Token、音色、Resource ID（界面默认常见 `seed-tts-2.0`）。
3. 保存。因为它优先级最高，开着它时其他 TTS 不会被用到。

![字节 TTS](/images/webui-volcengine-tts.png)

## 方案 D：云端 TTS（SiliconFlow 等）

1. 云端配置 → **云端 TTS**。
2. 勾选启用，填 API Key、接口 URL、模型、音色。
3. 仅当字节和阿里云都关闭时才会走到这里。

![云端 TTS](/images/webui-cloud-tts-silicon.png)

## 方案 E：启动全云端 / 云端肥牛

界面仍有 **启动全云端** 开关和网关地址、网关 Key。在新版面上这个勾选框可以正常点，并不是灰色禁用。

![云端肥牛与启动全云端](/images/webui-cloud-gateway.png)

![勾选启动全云端](/images/webui-cloud-gateway-checked.png)

这不是「一键代替 LLM」。它把部分 ASR/TTS 请求指到肥牛网关。旧静态 HTML 教程曾写「已弃用」——**以你当前安装是否真能连上为准**：保存后看桌宠日志，成功就按这页填；失败就关掉它，改用上面 A–D。

本环境没有可用的肥牛网关 Key，因此只核实了「开关能勾」，没有声称网关现在一定在线。

不要在开启全云端的同时再勾阿里云或字节。

## 推荐混用：本地听 + 云端说

1. 功能配置：启用 ASR、启用 TTS。
2. 「启动」页：启动 ASR；**不要**依赖本地 TTS（没有就启动不了）。
3. 云端配置：只启用阿里云 TTS **或** 字节 TTS **或** 云端 TTS 之一。
4. 启动 Live2D。

![功能配置同时打开听和说](/images/mix-dialog-toggles.png)

![只勾阿里云 TTS](/images/mix-aliyun-only.png)

这不需要第二本教程。
