// tool-executor.js - 统一的工具调用执行器
const { logToTerminal } = require('../api-utils.js');

/**
 * 统一的工具调用执行器
 * 负责协调MCP工具和本地Function Call工具的调用
 * 消除重复的工具调用逻辑
 */
class ToolExecutor {
    constructor() {
        // 工具管理器将通过全局变量访问
        // 这是合理的,因为它们是单例服务
    }

    /**
     * 执行工具调用
     * @param {Array} toolCalls - LLM返回的工具调用列表
     * @returns {Promise<Array|string|null>} 工具执行结果
     */
    async executeToolCalls(toolCalls) {
        if (!toolCalls || toolCalls.length === 0) {
            return null;
        }

        logToTerminal('info', `开始执行工具调用`);

        const results = [];
        let hasToolExecuted = false;

        for (const toolCall of toolCalls) {
            const functionName = toolCall.function.name;
            let toolResult = null;

            // 解析参数
            let parameters;
            try {
                parameters = typeof toolCall.function.arguments === 'string'
                    ? JSON.parse(toolCall.function.arguments)
                    : toolCall.function.arguments;
            } catch (error) {
                console.error('解析工具参数错误:', error);
                parameters = {};
            }

            // 优先尝试MCP工具
            if (global.mcpManager && global.mcpManager.isEnabled) {
                try {
                    const mcpResult = await global.mcpManager.handleToolCalls([toolCall]);
                    if (mcpResult) {
                        toolResult = mcpResult;
                        hasToolExecuted = true;
                        logToTerminal('info', `✅ MCP工具 ${functionName} 执行成功`);
                    }
                } catch (error) {
                    logToTerminal('warn', `MCP工具 ${functionName} 执行失败，尝试本地工具: ${error.message}`);
                }
            }

            // 如果MCP没有处理，尝试本地工具
            if (!toolResult && global.localToolManager && global.localToolManager.isEnabled) {
                try {
                    const localResult = await global.localToolManager.handleToolCalls([toolCall]);
                    if (localResult) {
                        toolResult = localResult;
                        hasToolExecuted = true;
                        logToTerminal('info', `✅ 本地工具 ${functionName} 执行成功`);
                    }
                } catch (error) {
                    logToTerminal('error', `本地工具 ${functionName} 执行失败: ${error.message}`);
                }
            }

            // 如果工具执行成功，添加结果
            if (toolResult) {
                // 处理不同格式的结果
                if (Array.isArray(toolResult)) {
                    results.push(...toolResult);
                } else if (typeof toolResult === 'object' && toolResult.content) {
                    results.push(toolResult);
                } else {
                    results.push({
                        tool_call_id: toolCall.id,
                        content: toolResult
                    });
                }
            } else {
                // 工具未找到或执行失败
                results.push({
                    tool_call_id: toolCall.id,
                    content: `工具 ${functionName} 执行失败或未找到`
                });
                logToTerminal('error', `工具 ${functionName} 未找到或执行失败`);
            }
        }

        if (!hasToolExecuted) {
            logToTerminal('error', '所有工具调用均失败');
            return null;
        }

        logToTerminal('info', `工具调用完成，共执行 ${results.length} 个工具`);

        // 如果只有一个结果，返回单个字符串(向后兼容)
        if (results.length === 1 && typeof results[0] === 'string') {
            return results[0];
        }

        // 如果只有一个结果对象，返回其content(向后兼容)
        if (results.length === 1 && results[0].content) {
            return results[0].content;
        }

        // 返回完整的结果数组
        return results;
    }

    /**
     * 检查是否有可用的工具管理器
     * @returns {boolean}
     */
    hasToolManagers() {
        const hasMCP = global.mcpManager && global.mcpManager.isEnabled;
        const hasLocal = global.localToolManager && global.localToolManager.isEnabled;
        return hasMCP || hasLocal;
    }

    /**
     * 获取工具统计信息
     * @returns {Object}
     */
    getStats() {
        const stats = {
            mcpEnabled: false,
            mcpToolCount: 0,
            localEnabled: false,
            localToolCount: 0,
            totalTools: 0
        };

        if (global.mcpManager && global.mcpManager.isEnabled) {
            stats.mcpEnabled = true;
            const mcpStats = global.mcpManager.getStats();
            stats.mcpToolCount = mcpStats.tools || 0;
        }

        if (global.localToolManager && global.localToolManager.isEnabled) {
            stats.localEnabled = true;
            const localStats = global.localToolManager.getStats();
            stats.localToolCount = localStats.tools || 0;
        }

        stats.totalTools = stats.mcpToolCount + stats.localToolCount;

        return stats;
    }
}

// 导出单例
const toolExecutor = new ToolExecutor();
module.exports = { toolExecutor, ToolExecutor };
