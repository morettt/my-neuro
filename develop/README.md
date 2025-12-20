## 这里是开发者维护用的（普通用户不用了解）


首先需要配置前端所需要的环境。

确保你机子上面有node.js

接着直接在本路径运行
```bash

npm install

```

进行依赖的安装


#### 关于皮套的获取，点击这个链接，会自动下载zip文件：https://github.com/morettt/my-neuro/releases/download/fake-neuro/default.zip

#### 这是live-2d皮套，下载好后请放到2D文件夹解压


#### 打包exe文件

创建虚拟环境：

```bash
conda create -n pyqt python=3.10 -y
conda activate pyqt

pyinstaller --onefile --windowed --icon=fake_neuro.ico test.py

```

会在生成一个 dist文件夹
里面会有一个test.exe的文件，请把它拖到develop路径下面。顺便重命名为：肥牛.exe

最后双击这个:肥牛.exe 配置api配置即可对话

