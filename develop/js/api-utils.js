// api-utils.js - API相关工具函数模块
const fs = require('fs');
const path = require('path');

// 终端日志记录函数 - 普通日志
function logToTerminal(level, message) {
    const formattedMsg = `[${level.toUpperCase()}] ${message}`;

    // 输出到Electron DevTools控制台（调试用）
    if (level === 'error') {
        console.error(message);
    } else if (level === 'warn') {
        console.warn(message);
    } else {
        console.log(message);
    }

    // 写入文件供UI读取（Electron应用的日志无法通过stdout传递给父进程）
    try {
        fs.appendFileSync(path.join(__dirname, '..', 'runtime.log'), formattedMsg + '\n', 'utf8');
    } catch (e) {
        // 忽略文件写入错误
    }
}

// 工具日志记录函数 - 专用于工具调用相关日志
function logToolAction(level, message) {
    // 添加 [TOOL] 标记，方便UI区分
    const formattedMsg = `[${level.toUpperCase()}][TOOL] ${message}`;

    // 输出到Electron DevTools控制台（调试用）
    if (level === 'error') {
        console.error(`[TOOL] ${message}`);
    } else if (level === 'warn') {
        console.warn(`[TOOL] ${message}`);
    } else {
        console.log(`[TOOL] ${message}`);
    }

    // 写入到 runtime.log（和普通日志一起，通过[TOOL]标记区分）
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
    logToolAction,
    handleAPIError,
    getMergedToolsList
};
