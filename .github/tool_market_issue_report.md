# 工具广场下载问题 - 临时调试日志

**时间**: 2026-03-09  
**版本**: v1.9.2  
**状态**: ⚠️ 未解决 - 已回退修改

---

## 问题现象

| 功能 | 错误提示 |
|------|----------|
| 提示词广场 - 应用 | `POST /api/market/prompts/apply 404 (NOT FOUND)` |
| 工具广场 - 下载 | `POST /api/market/tools/download 404 (NOT FOUND)` |
| FC 广场 - 下载 | `POST /api/market/fc-tools/download 404 (NOT FOUND)` |

---

## 已尝试的解决方案

### 尝试 1: 修复下载 URL 生成逻辑
**修改内容**:
- 使用 `tool.id` 拼接下载 URL
- 传递 `file_name` 参数给后端

**结果**: ❌ 失败 - 404 错误依旧

---

### 尝试 2: 移动广场下载 API 到 app.run() 之前
**修改内容**:
- 将广场下载 API 路由移动到 `app.run()` 之前
- 期望路由被正确注册

**结果**: ❌ 失败
- 第一次修复：文件产生重复函数定义，启动报错
- 第二次修复：WebUI 无法启动
- 用户已回退所有修改

---

## 当前状态

**代码状态**: 已回退到修改前版本

**问题确认**:
1. ✅ 路由定义存在于 `webui_controller.py` 中
2. ❌ 但 Flask 启动后访问返回 404
3. ❌ 移动路由位置导致启动问题

---

## 可能的根本原因

### 假设 1: 路由注册时机问题
Flask 的 `@app.route()` 装饰器在模块加载时执行，但如果路由定义在 `app.run()` 之后，可能不会被注册。

**验证方法**:
```python
# 在 webui_controller.py 启动时打印已注册的路由
for rule in app.url_map.iter_rules():
    if 'market' in str(rule):
        print(f"Registered: {rule}")
```

---

### 假设 2: 多个 Flask app 实例
可能存在多个 Flask app 实例，路由注册到了一个实例，但启动的是另一个。

**验证方法**:
检查代码中是否有多个 `Flask(__name__)` 调用。

---

### 假设 3: 路由被其他代码覆盖
可能存在同名的路由定义，后定义的覆盖了前面的。

**验证方法**:
```bash
grep -n "@app.route('/api/market" webui_controller.py
```

---

## 下一步排查计划

### 方案 A: 添加调试输出
在 `webui_controller.py` 启动时打印所有已注册的市场相关路由：

```python
if __name__ == '__main__':
    print("已注册的市场相关路由:")
    for rule in app.url_map.iter_rules():
        if 'market' in str(rule):
            print(f"  {list(rule.methods)} {rule}")
    run_app()
```

### 方案 B: 检查 Flask app 实例
确认整个文件中只有一个 Flask app 实例：
```bash
grep -n "Flask(" webui_controller.py
```

### 方案 C: 简化测试
创建一个最小的测试文件验证路由注册：
```python
from webui_controller import app
print("市场相关路由:")
for rule in app.url_map.iter_rules():
    if 'market' in str(rule):
        print(f"  {rule}")
```

---

## 需要的用户配合

请执行以下操作帮助排查：

1. **运行路由检查脚本**:
   ```bash
   cd d:\my-neuro-modify
   python -c "from webui_controller import app; print('市场相关路由:'); [print(f'  {r}') for r in app.url_map.iter_rules() if 'market' in str(r)]"
   ```

2. **复制输出结果**

3. **重启 WebUI 并测试广场功能**

---

**更新时间**: 2026-03-09  
**文档版本**: v2.0 (回退修改后)
