// MCP 工具注册表
// 职责：管理所有 MCP 工具、工具查找、格式转换

class MCPToolRegistry {
    constructor() {
        this.tools = [];
    }

    // 注册工具
    registerTools(serverName, tools, transportType) {
        tools.forEach(tool => {
            this.tools.push({
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
                server: serverName,
                type: transportType
            });
            console.log(`  ✅ 注册 ${transportType} 工具: ${tool.name}`);
        });
    }

    // 查找单个工具
    findTool(toolName) {
        return this.tools.find(t =>
            t.name === toolName &&
            (t.type === 'mcp' || t.type === 'mcp_http')
        );
    }

    // 按服务器查找工具
    getToolsByServer(serverName) {
        return this.tools.filter(t => t.server === serverName);
    }

    // 按类型查找工具
    getToolsByType(transportType) {
        return this.tools.filter(t => t.type === transportType);
    }

    // 获取所有 MCP 工具
    getAllMCPTools() {
        return this.tools.filter(t => t.type === 'mcp' || t.type === 'mcp_http');
    }

    // 获取所有工具
    getAllTools() {
        return this.tools;
    }

    // 转换为 OpenAI Function Calling 格式
    toOpenAIFormat() {
        const mcpTools = this.getAllMCPTools();

        if (mcpTools.length === 0) {
            return [];
        }

        return mcpTools.map(tool => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));
    }

    // 检查工具是否存在
    hasTool(toolName) {
        return this.findTool(toolName) !== undefined;
    }

    // 检查是否为 MCP 工具
    isMCPTool(toolName) {
        return this.tools.some(t =>
            t.name === toolName &&
            (t.type === 'mcp' || t.type === 'mcp_http')
        );
    }

    // 获取工具数量
    getToolCount() {
        return this.getAllMCPTools().length;
    }

    // 获取工具名称列表
    getToolNames() {
        return this.getAllMCPTools().map(t => t.name);
    }

    // 清空所有工具
    clear() {
        this.tools = [];
    }

    // 获取统计信息
    getStats() {
        const mcpTools = this.getAllMCPTools();
        return {
            total: mcpTools.length,
            byType: {
                stdio: this.getToolsByType('mcp').length,
                http: this.getToolsByType('mcp_http').length
            },
            toolNames: mcpTools.map(t => t.name)
        };
    }
}

module.exports = { MCPToolRegistry };
