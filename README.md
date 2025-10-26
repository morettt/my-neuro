debug相关

1 修改了asr-api.py中的模型加载路径，使得路径与按照Readme下载后的默认路径一致

2 修改了test.py，添加一个更新配置前检测模型是否启动的判断，从而修复了在未启动模型时更新配置导致卡顿的bug。

3 修改了start.py，直接npm启动，更简单（AI说启动 Flask 没用，如果有用的话改回原来的版本）

4.添加了npm库jschardet用于解析文件编码，更新了node.js和npm库，electron框架版本

5.修改saveModelPosition()函数，添加边界检查。防止意外拖动模型到屏幕外导致模型消失而需要到config.json手动改回来

功能相关（.js核心文件基本上改完了，ui-controller.js和model-interaction.js基本被翻新了一遍）

2 重构对话框，在live-2d-develop\js\ui下添加了ChatController.js专门用来处理对话框。添加layout.json记录对话框位置

界面更美观，启用快捷键Alt+~可以快速开关对话框输入文本，对话框在改变窗口焦点后会自动隐藏。

由于对话框目前逻辑不需要设置是否展示，设置已经无效，修改了test.py删去了设置文本对话框是否显示的按钮与相关逻辑。

3 增加文件拖拽功能，可以把多个图片或者文本类型文件拖到live2d模型上解析，此时会缓存这些文件，在下一次输入文本或者通过ASR输入语音作为说明后打包在一起发给大模型。
同时修改了自动截图逻辑，拖拽文件缓存后不会触发自动截图，防止意外触发自动截图。

4 重构字幕组件，现在字幕可以直接拖动调整位置和显示范围。

可通过config.json和layout.json的相关设置调整字体大小，颜色，和字幕多长时间自动消失。

使用Gemini2.5pro+shot-gun的方式进行AI编程
效果：https://www.bilibili.com/video/BV1yaszzcEx6/

