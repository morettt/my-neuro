# 界面与打断

这些开关都在肥牛.exe 里，改完点 **更新配置**。

## 文字输入框和字幕

可以关掉输入框或字幕，也可以把它们拖到副屏。

![文字输入框开关](/images/qt/qt-toggle-input.png)

![字幕开关](/images/qt/qt-toggle-subtitle.png)

## 历史消息条数

觉得上下文太长、花钱太快，在这里限制每次带给模型的历史条数。

![历史消息条数](/images/qt/qt-history-limit.png)

截断之后仍想留住上一轮要点，开上下文压缩插件，见 [在肥牛.exe 里用插件](/qt/plugins/)。

## 温度

角色太死板或太跳，改温度。具体数字可以问群 **756741478**。

![温度](/images/qt/qt-temperature.png)

## 语音打断

角色说个不停时，到 **启动** 页勾上 **开启语音打断**，就可以在她说话时打断。

![开启语音打断](/images/qt/qt-voice-interrupt.png)

## 隐藏皮套、关掉窗口时停服务

左侧栏 **UI设置**：

- **隐藏皮套**：程序继续跑，桌面上不显示角色
- **关闭 UI 时自动关闭所有服务**：关掉肥牛.exe 时，把 ASR、TTS、BERT、记忆这些一并停掉

![隐藏皮套与关闭 UI 时停服务](/images/qt/qt-ui-hide-close.png)
