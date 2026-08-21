# Live2D 与皮套

## 启动桌宠

优先在 WebUI **启动** 页里点 Live2D **启动**。也可以双击 `live-2d/go.bat`。两条路都会打开桌宠窗口。

启动前把 LLM、听、说保存好。若配置有未保存修改，新版会弹出确认。

![Live2D 设置里的预览工作台（桌宠窗口需点启动后才会出现）](/images/desktop-pet.png)

打开 **Live2D设置** 全页：

![Live2D设置](/images/webui-live2d.png)

## 这一页可以改什么

- 选择当前模型（Live2D / VRM / MMD / PNGTuber，以你安装的资源为准）
- 动作、表情与快捷键
- 编舞相关选项（AI 编舞或传统动作）

改模型或动作后保存，必要时重启桌宠。

![动作绑定](/images/webui-live2d-motion.png)

![表情绑定](/images/webui-live2d-expression.png)

## 常用快捷键（桌宠焦点 / 全局，以上游当前代码为准）

| 按键 | 作用 |
| --- | --- |
| `Ctrl + G` | 打断正在播放的语音 |
| `Ctrl + T` | 窗口置顶 |
| `Ctrl + M` | 开关气泡 |
| `Ctrl + Q` | 退出 |
| `Ctrl + Shift + 1…9` | 触发动作；其中 `6` 随机音乐、`8` 停止音乐并做动作 |
| `Ctrl + Shift + 0` | 停止全部动作 |
| PTT 键（默认常为 `V`） | 按住说话（需在功能配置启用 PTT） |

快捷键会注册为全局热键，可能和其他软件冲突。

## 声音克隆

仅当存在本地 TTS 模型时，侧栏才有 **声音克隆**。按页内说明录制或导入参考音频。云端 TTS 用户改音色要在对应云厂商控制台选 voice，而不是这一页。

![声音克隆 · 训练](/images/webui-voice-clone-train.png)
