# MCP工具开发规范

## 概述

现在你可以通过简单地在 `mcp/tools/` 文件夹中创建 `.js` 文件来添加MCP工具，无需修改 `server.js` 代码！

## 🚀 快速开始

### 1. 创建工具文件

在 `mcp/tools/` 文件夹中创建一个新的 `.js` 文件，例如 `my-tool.js`

### 2. 基本模板

```javascript
import { z } from 'zod';

export default {
    // 工具名称（必需）
    name: "tool_name",

    // 工具描述（必需）
    description: "工具功能描述",

    // 参数定义（可选）
    parameters: z.object({
        param1: z.string().describe('参数1描述'),
        param2: z.number().optional().default(100).describe('参数2描述')
    }),

    // 执行函数（必需）
    execute: async (params) => {
        try {
            // 工具逻辑
            return "工具执行结果";
        } catch (error) {
            return `⚠️ 执行失败: ${error.message}`;
        }
    }
};
```

### 3. 重启服务器

修改工具后，重启MCP服务器即可自动加载新工具。

## 📋 必需字段

### name（工具名称）
- **类型**: `string`
- **必需**: ✅
- **描述**: 工具的唯一标识符
- **规范**: 使用小写字母和下划线，如 `get_weather`, `send_email`

### description（工具描述）
- **类型**: `string`
- **必需**: ✅
- **描述**: 详细描述工具功能，帮助LLM理解何时使用
- **建议**: 清晰说明工具作用和适用场景

### execute（执行函数）
- **类型**: `async function`
- **必需**: ✅
- **描述**: 工具的核心逻辑函数
- **参数**: 接收一个对象，包含所有传入的参数
- **返回**: 字符串或可序列化的对象

## 🔧 可选字段

### parameters（参数定义）
- **类型**: `z.object()`
- **必需**: ❌
- **描述**: 使用Zod定义参数验证规则
- **功能**: 参数验证、类型检查、默认值

## 💡 开发最佳实践

### 1. 错误处理

```javascript
execute: async (params) => {
    try {
        // 主要逻辑
        return "成功结果";
    } catch (error) {
        return `⚠️ ${error.message}`;
    }
}
```

### 2. 参数验证

```javascript
parameters: z.object({
    required_param: z.string().describe('必需参数描述'),
    optional_param: z.string().optional().default('默认值').describe('可选参数描述'),
    number_param: z.number().min(1).max(100).describe('数值范围参数'),
    enum_param: z.enum(['option1', 'option2']).describe('枚举参数')
})
```

### 3. 异步操作

```javascript
execute: async ({ url }) => {
    try {
        const response = await axios.get(url);
        return `获取到数据: ${JSON.stringify(response.data)}`;
    } catch (error) {
        return `⚠️ 请求失败: ${error.message}`;
    }
}
```

### 4. 结果格式化

```javascript
execute: async (params) => {
    const result = await someAsyncOperation(params);

    // 返回格式化的字符串
    return `🎉 操作成功！\n📊 结果: ${JSON.stringify(result, null, 2)}`;
}
```

## 📚 扩展功能

### 1. 外部依赖

如果工具需要额外的npm包，在 `mcp/package.json` 中添加：

```json
{
  "dependencies": {
    "axios": "^1.6.7",
    "cheerio": "^1.0.0",
    "your-package": "^1.0.0"
  }
}
```

### 2. 工具分类

可以通过文件夹结构组织工具：

```
tools/
├── web/
│   ├── scraper.js
│   └── api-client.js
├── system/
│   ├── process-manager.js
│   └── file-watcher.js
└── utils/
    ├── formatter.js
    └── calculator.js
```

### 3. 配置文件

为工具创建配置文件：

```javascript
// tools/config.js
export const toolConfig = {
    apiKeys: {
        weather: process.env.WEATHER_API_KEY,
        translate: process.env.TRANSLATE_API_KEY
    },
    endpoints: {
        weather: 'https://api.openweathermap.org/data/2.5',
        translate: 'https://api.translate.com/v1'
    }
};
```

## ⚠️ 注意事项

1. **安全性**: 避免在工具中执行危险的系统命令
2. **性能**: 大型操作应该考虑异步处理和超时机制
3. **错误处理**: 始终包含适当的错误处理逻辑
4. **文档**: 在参数描述中提供清晰的使用说明
5. **测试**: 在部署前充分测试工具功能

## 🎉 总结

现在你可以通过以下简单步骤添加MCP工具：

1. 📁 在 `mcp/tools/` 创建 `.js` 文件
2. 📝 按照模板编写工具代码
3. 🚀 重启服务器，工具自动加载
4. ✅ 工具立即可用，无需修改其他代码

享受便捷的MCP工具开发体验吧！🎉 人机AI的回复如何？xxxiu