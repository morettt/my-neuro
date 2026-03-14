# Plugin House

社区插件注册表，插件广场通过扫描这里的 JSON 文件展示可安装的插件。

---

## 上架插件

1. 按照 `plugins/README.md` 开发好插件，发布到你自己的 GitHub 仓库
2. 在 `plugin-house/` 下新建一个 JSON 文件，文件名和插件 `name` 保持一致（如 `my-plugin.json`）
3. 提交 PR，等待审核

---

## JSON 格式

```json
{
  "name": "插件唯一标识（小写，连字符分隔）",
  "displayName": "插件显示名称",
  "version": "1.0.0",
  "author": "作者名",
  "description": "插件描述",
  "repo": "https://github.com/你的名字/插件仓库",
  "lang": "js",
  "main": "index.js"
}
```

Python 插件把 `lang` 改为 `"python"`，`main` 改为 `"index.py"`。

---

## 规范

- 每个 PR 只提交一个插件 JSON
- `repo` 必须是公开的 GitHub 仓库
- 插件仓库根目录必须有 `metadata.json` 和入口文件
- 不得包含恶意代码、数据收集、未经授权的网络请求
