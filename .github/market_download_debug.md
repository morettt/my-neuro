# 广场下载问题调试日志

## 问题现状 (2026-03-10 11:20)

### 错误信息
```
ModuleNotFoundError: No module named 'requests'
UnboundLocalError: cannot access local variable 'requests' where it is not associated with a value
```

### 根本原因
1. **requests 库未安装**：Python 环境中没有安装 `requests` 库
2. **错误的导入位置**：在函数内部 `import requests`，导致异常处理时 `requests` 未定义

### 解决方案

#### 方案一：安装 requests 库（推荐）
```bash
pip install requests
```

#### 方案二：使用 urllib.request 替代（已内置，无需安装）
回退到使用 Python 内置的 `urllib.request`，但需要正确处理异常。

### 修复步骤

1. [ ] 创建此调试日志
2. [ ] 修改 `webui/marketplace.py`：在文件顶部导入 `requests`
3. [ ] 确保 `requirements.txt` 包含 `requests`
4. [ ] 测试下载功能

---

## 调试记录

### 尝试 1：使用 requests 库
- **时间**：2026-03-10 11:09
- **结果**：失败 - `ModuleNotFoundError: No module named 'requests'`
- **原因**：requests 库未安装，且在函数内部导入导致异常处理崩溃

### 尝试 2：在文件顶部导入 requests（已完成）
- **时间**：2026-03-10 11:23
- **修改内容**：
  1. 在 `webui/marketplace.py` 文件顶部使用 `try/except` 导入 `requests`
  2. 设置 `HAS_REQUESTS` 标志，如果导入失败则回退到 `urllib.request`
  3. 修复 `download_tool()` 和 `download_fc_tool()` 函数，删除内部的 `import requests`
  4. 异常处理改用 `urllib.error.HTTPError` 和 `urllib.error.URLError`
- **结果**：代码已修复，即使 requests 未安装也能正常工作（使用 urllib 回退）

### 最终解决方案

**问题原因**：
1. `import requests` 在函数内部，导入失败时后续代码无法访问 `requests`
2. 异常处理使用 `requests.exceptions.HTTPError`，但 requests 未定义导致 `UnboundLocalError`

**修复方案**：
```python
# 文件顶部
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    logger.warning('requests 库未安装，将使用 urllib.request 进行下载（功能受限）')

# 下载函数中
if HAS_REQUESTS:
    response = requests.get(tool_url, timeout=30)
    response.raise_for_status()
    content = response.content
else:
    # 回退到 urllib
    req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read()
```

**注意**：`requirements.txt` 已包含 `requests`，但用户可能未安装。执行：
```bash
pip install requests
```

---

## 技术要点

### Python 导入最佳实践
❌ **错误**：在函数内部导入
```python
def download_tool():
    import requests  # 如果失败，后续代码无法访问 requests
    response = requests.get(url)
```

✅ **正确**：在文件顶部导入
```python
import requests  # 文件顶部

def download_tool():
    response = requests.get(url)
```

### 异常处理注意事项
当导入失败时，不要在 except 块中使用该模块：
```python
# ❌ 错误
try:
    import requests
except ImportError:
    pass  # requests 未定义

# 后续代码
except requests.exceptions.HTTPError:  # UnboundLocalError!
    pass

# ✅ 正确
import requests  # 顶部导入，如果失败则程序启动时就报错

try:
    response = requests.get(url)
except requests.exceptions.HTTPError:
    pass
```

---

## 远程 API 数据结构

### 工具广场 API 响应
```json
{
  "success": true,
  "tools": [
    {
      "id": 1,
      "tool_name": "工具名称",
      "file_name": "tool_file.js",
      "download_url": "http://mynewbot.com/api/download-tool/1"  // 可能为空
    }
  ]
}
```

### ⚠️ HTTP 422 错误分析（2026-03-10 11:44）

#### 错误现象
```
HTTP 422 Unprocessable Entity
{"detail":[{"type":"int_parsing","loc":["path","tool_id"],"msg":"Input should be a valid integer, unable to parse string as an integer","input":"20251111_185651_beijingTimeServer.js"}]}
```

#### 根本原因
服务器API期望 `tool_id` 参数是一个**整数**，但代码尝试传递**文件名字符串**（如 `20251111_185651_beijingTimeServer.js`）。

#### 错误的代码逻辑（已修复）
```python
# ❌ 错误：使用 filename 构建 URL
if filename:
    tool['download_url'] = f"http://mynewbot.com/api/download-tool/{filename}"
```

#### 正确的代码逻辑
```python
# ✅ 正确：只使用数字 ID 构建 URL
if tool_id and isinstance(tool_id, int) and tool_id > 0:
    tool['download_url'] = f"http://mynewbot.com/api/download-tool/{tool_id}"
```

### 下载 URL 构建规则（更新版）
1. **优先使用 `download_url` 字段**：如果API已提供完整URL
2. **如果为空，只使用数字 `id` 构建**：`http://mynewbot.com/api/download-tool/{id}`
3. **禁止使用 `filename` 构建 URL**：服务器不接受字符串作为 `tool_id`
4. **如果 `id` 不是有效整数，记录警告并跳过**
