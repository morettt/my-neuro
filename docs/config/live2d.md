# Live2D 与皮套

皮套是角色形象，也就是 Live2D / VRM / MMD / PNGTuber 这类模型；桌宠是启动后出现在桌面上的那个窗口。

## 启动桌宠

在 **启动** 页点 Live2D 主服务的「启动」，或双击 `live-2d/go.bat`，两条路都会打开桌宠窗口。

启动前先把 LLM、听、说保存好。有未保存的修改时，新版会弹出确认。

![Live2D 设置里的预览工作台](/images/desktop-pet.png)

## Live2D设置这一页能改什么

![Live2D设置](/images/webui-live2d.png)

- 选择当前模型（Live2D / VRM / MMD / PNGTuber，以你安装的资源为准）
- 动作、表情与快捷键绑定
- 编舞相关选项（AI 编舞或传统动作）

改完模型或动作要保存，必要时重启桌宠。

![动作绑定](/images/webui-live2d-motion.png)

![表情绑定](/images/webui-live2d-expression.png)

## 常用快捷键

以上游当前代码为准，都是全局热键，可能和其他软件冲突。

| 按键 | 作用 |
| --- | --- |
| `Ctrl + G` | 打断正在播放的语音 |
| `Ctrl + T` | 窗口置顶 |
| `Ctrl + M` | 开关气泡 |
| `Ctrl + Q` | 退出 |
| `Ctrl + Shift + 1…9` | 触发动作；其中 `6` 随机音乐、`8` 停止音乐并做动作 |
| `Ctrl + Shift + 0` | 停止全部动作 |
| PTT 键（默认 `V`） | 按住说话（需在功能配置启用 PTT） |

## 换声音

顶栏的 **声音克隆** 只在装了本地 TTS 模型时出现，用法见 [怎么说](/config/speak)。用云端发音时，音色在对应云厂商的控制台里选，不在这一页。
