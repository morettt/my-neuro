# 提交PR规范（确保有node.js环境）

## 介绍

本项目采用前后端分离方式。其中full-hub 属于后端文件夹，而live-2d 属于前端文件夹

其中核心代码都在live-2d文件夹。后端文件夹负责的只是单纯的将各种服务启动，例如：TTS服务(文本转语音)、ASR(语音转文本) 等。暴露出对应的API端口。让前端代码可以调用。所以主要功能很固定，很少会去修改。

而live-2d文件夹属于真正的核心功能区，下面我会一步一步的指导如何为此项目提交pr，留下印记成为本项目的贡献者


## 具体操作

#### 首先第一步需要fork 这个项目。这里因为我没法自己fork自己的项目，所以找一个别的项目做示范，看下面的图片 点击+Create a new fork

<img width="1893" height="561" alt="image" src="https://github.com/user-attachments/assets/9085d494-3dcd-4ed5-90a0-77997474ee28" />


#### 继续点击：create fork
<img width="1286" height="925" alt="image" src="https://github.com/user-attachments/assets/b424ee28-6043-448a-b363-d3b2c3e3b17a" />

#### 这样你的仓库下面就有了项目仓库了
<img width="1871" height="1074" alt="image" src="https://github.com/user-attachments/assets/06ebb0b9-ea38-4c14-bf9f-0fedaeac68d3" />


### 接下来将你fork的项目克隆到本地

```bash

1.找一个空文件夹打开终端
2.git clone https://github.com/你的github用户名/new-my-neuro.git
3.cd new-my-neuro

```

### 创建分支

```bash
# 具体分支名可以自己取，例如修Bug可以取名：fix/bug  添加新功能可以：feature/add-new-feature 简单易懂就行 下面是示例
git checkout -b 你的分支名字

```

# 部署和修改项目代码

这一步需要部署项目

## 后端部署

首先是后端部署，可以偷懒用云端API 这样就省去了下载各种模型的操作。（因为之前说了，后端代码几乎不用改。所以可以偷懒用我提供的云端API）


<img width="1152" height="803" alt="image" src="https://github.com/user-attachments/assets/a3a9b9be-53b2-46d1-a1c7-b2d986ff27be" />



#### 接着需要部署live-2d 也就是前端的环境

## 前端部署

```bash
# 进入live-2d文件夹
cd live-2d
npm install

#然后去mcp路径运行
cd mcp
npm install
```

## 打包exe文件


#### 双击live-2d文件夹下面的：一键打包QT.bat  （这个一键打包QT.bat用的是new-my-neuro的虚拟环境。所以记得部署好这个虚拟环境，安装下载好pip install -r requirements.txt 再来双击bat）
#### 这一步是打包适合用户操作的UI界面，执行完了会在live-2d文件夹生成一个：肥牛.exe 的文件

上述操作完成后，就可以开始修改代码加功能、修bug等操作了,如果是增加功能，那一次建议只更改一个功能。不要在一次提交中包含多个功能。这是为了防止后续如果出问题，排查困难。


### 上面的做完后，运行这个指令将更改添加到暂存区

```bash
git add .
```

## 然后提交，引号里面简单说一下做了什么
```bash
git commit -m "描述你做了什么"

```

## 最后推送你的修改

```bash
git push origin 你的分支名字
```


### 然后来到你的fork的仓库这里，会发现多了一个黄不拉几的提示 这个就代表你成功把修改操作提交到了你fork的仓库中，直接点击这个compare pull request


<img width="2182" height="1009" alt="image" src="https://github.com/user-attachments/assets/5eb74627-dfbf-4331-a11c-f72ddf8fb2d5" />


## 来到了这里后，在红框里面可以写具体做了什么，写好后点击那个 create pull request 

<img width="1951" height="1072" alt="image" src="https://github.com/user-attachments/assets/e8f20914-e619-4e14-b0d7-636120e07707" />

## 这样成功的提交pr了

<img width="2206" height="1275" alt="image" src="https://github.com/user-attachments/assets/3aab4e54-e071-4c5a-8971-e55ce3f4304c" />


## 恭喜你！接下来就可以等待维护者，也就是我来审查你的提交。如果测试都没有问题就可以合并了。然后就可以成为项目的贡献者了！








































































