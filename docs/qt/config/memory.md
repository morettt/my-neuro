# 记忆

长期记忆让角色还记得你们昨天说过的话。在肥牛.exe 里分两步：先在插件里配 MemOS，再在终端控制室把记忆服务拉起来。

更细的配置项含义见 WebUI 文档里的 [MemOS 长期记忆](/plugins/built-in#memos-长期记忆)（顶栏切到 WebUI 再打开也行）。

## 1. 打开 MemOS 配置

左侧栏 **插件** → 内置插件 → **MEMOS 长期记忆** → **配置**。

![MemOS 插件配置入口](/images/qt/qt-memos-plugin.png)

填一个大语言模型，可以是多模态，也可以是纯文本模型。填完往下滚。

![为记忆填一个 LLM](/images/qt/qt-memos-llm.png)

嵌入模型可以先跳过。

![嵌入模型可跳过](/images/qt/qt-memos-embed.png)

点 **更新配置**。

## 2. 在终端控制室启动记忆

打开 **终端控制室**，点这一页**最后一行**的启动（记忆服务那一行）。

![终端控制室启动记忆](/images/qt/qt-memos-terminal.png)

黑窗口起来得比较快。然后 **启动桌宠**，再聊几句。若表现类似下图，记忆已经在工作。

![记忆在对话里生效](/images/qt/qt-memos-success.png)
