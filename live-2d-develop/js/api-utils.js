// api-utils.js - API相关工具函数模块
const fs = require('fs');
const path = require('path');

// 终端日志记录函数
function logToTerminal(level, message) {
    const timestamp = new Date().toISOString();
    const formattedMsg = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    if (level === 'error') {
        process.stderr.write(formattedMsg + '\n');
    } else {
        process.stdout.write(formattedMsg + '\n');
    }

    if (level === 'error') {
        console.error(message);
    } else if (level === 'warn') {
        console.warn(message);
    } else {
        console.log(message);
    }

    try {
        fs.appendFileSync(path.join(__dirname, '..', 'runtime.log'), formattedMsg + '\n', 'utf8');
    } catch (e) {
        // 忽略文件写入错误
    }
}

// 统一的API错误处理工具函数
async function handleAPIError(response) {
    let errorDetail = "";
    try {
        const errorBody = await response.text();
        try {
            const errorJson = JSON.parse(errorBody);
            errorDetail = JSON.stringify(errorJson, null, 2);
        } catch (e) {
            errorDetail = errorBody;
        }
    } catch (e) {
        errorDetail = "无法读取错误详情";
    }

    logToTerminal('error', `API错误 (${response.status} ${response.statusText}):\n${errorDetail}`);

    let errorMessage = "";
    switch (response.status) {
        case 401:
            errorMessage = "API密钥验证失败，请检查你的API密钥";
            break;
        case 403:
            errorMessage = "API访问被禁止，你的账号可能被限制";
            break;
        case 404:
            errorMessage = "API接口未找到，请检查API地址";
            break;
        case 429:
            errorMessage = "请求过于频繁，超出API限制";
            break;
        case 500:
        case 502:
        case 503:
        case 504:
            errorMessage = "服务器错误，AI服务当前不可用";
            break;
        default:
            errorMessage = `API错误: ${response.status} ${response.statusText}`;
    }

    throw new Error(`${errorMessage}\n详细信息: ${errorDetail}`);
}

// 统一的工具列表合并函数
function getMergedToolsList() {
    let allTools = [];

    // 添加本地Function Call工具
    if (global.localToolManager && global.localToolManager.isEnabled) {
        const localTools = global.localToolManager.getToolsForLLM();
        if (localTools && localTools.length > 0) {
            allTools.push(...localTools);
        }
    }

    // 添加MCP工具
    if (global.mcpManager && global.mcpManager.isEnabled) {
        const mcpTools = global.mcpManager.getToolsForLLM();
        if (mcpTools && mcpTools.length > 0) {
            allTools.push(...mcpTools);
        }
    }

    return allTools;
}

module.exports = {
    logToTerminal,
    handleAPIError,
    getMergedToolsList
};
