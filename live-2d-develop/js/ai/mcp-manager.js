// MCP 管理器 - 支持与 Function Call 共存的 MCP 系统
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class MCPManager {
    constructor(config = {}) {
        this.config = config.mcp || { enabled: false };
        this.isEnabled = this.config.enabled;
        this.mcpServers = {};
        this.tools = [];
        this.processes = new Map();
        this.isInitialized = false;
        this.startupTimeout = this.config.startup_timeout || 30000;

        console.log(`🔧 MCP管理器配置: 启用=${this.isEnabled}, 超时=${this.startupTimeout}ms`);
        if (typeof logToTerminal === 'function') {
            logToTerminal('info', `🔧 MCP管理器配置: 启用=${this.isEnabled}, 超时=${this.startupTimeout}ms`);
        }
    }

    // 初始化MCP系统
    async initialize() {
        if (!this.isEnabled) {
            console.log('🔧 MCP管理器已禁用，跳过初始化');
            this.isInitialized = true;
            return true;
        }

        try {
            console.log('🚀 开始初始化MCP管理器...');

            // 加载MCP服务器配置
            await this.loadMCPConfig();

            // 启动所有配置的服务器
            if (this.config.auto_start_servers) {
                await this.startAllServers();
            }

            this.isInitialized = true;
            console.log(`✅ MCP管理器初始化完成: ${this.tools.length} 个工具可用`);
            return true;

        } catch (error) {
            console.error('❌ MCP管理器初始化失败:', error.message);
            this.isInitialized = true; // 即使失败也标记为已初始化，避免阻塞
            return false;
        }
    }

    // 加载MCP配置
    async loadMCPConfig() {
        // 优先从外部配置文件读取
        if (this.config.config_path) {
            const configPath = path.resolve(this.config.config_path);

            if (!fs.existsSync(configPath)) {
                console.warn(`⚠️ MCP配置文件不存在: ${configPath}`);
                return;
            }

            try {
                const configContent = fs.readFileSync(configPath, 'utf8');
                this.mcpServers = JSON.parse(configContent);
                console.log(`📋 从外部配置文件加载MCP配置成功，共 ${Object.keys(this.mcpServers).length} 个服务器`);
                console.log('MCP服务器列表:', Object.keys(this.mcpServers));
                return;
            } catch (error) {
                throw new Error(`MCP配置文件解析失败: ${error.message}`);
            }
        }

        // 备选：从配置对象中读取服务器配置
        if (this.config.servers) {
            this.mcpServers = this.config.servers;
            console.log(`📋 从内嵌配置加载MCP配置成功，共 ${Object.keys(this.mcpServers).length} 个服务器`);
            console.log('MCP服务器列表:', Object.keys(this.mcpServers));
            return;
        }

        console.warn('⚠️ 未找到MCP服务器配置');
    }

    // 启动所有服务器
    async startAllServers() {
        const startPromises = [];

        for (const [name, config] of Object.entries(this.mcpServers)) {
            startPromises.push(this.startServer(name, config));
        }

        // 等待所有服务器启动，但不让单个失败阻塞整体
        const results = await Promise.allSettled(startPromises);

        let successCount = 0;
        results.forEach((result, index) => {
            const serverName = Object.keys(this.mcpServers)[index];
            if (result.status === 'fulfilled') {
                successCount++;
                console.log(`✅ MCP服务器 ${serverName} 启动成功`);
            } else {
                console.log(`⚠️ MCP服务器 ${serverName} 启动失败: ${result.reason.message}`);
            }
        });

        console.log(`🔧 MCP服务器启动完成: ${successCount}/${results.length} 个成功`);
    }

    // 启动单个服务器
    async startServer(name, serverConfig) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`服务器 ${name} 启动超时`));
            }, this.startupTimeout);

            try {
                console.log(`🚀 启动MCP服务器: ${name}`);

                // 处理不同类型的传输
                if (serverConfig.type === 'streamable_http') {
                    this.startHttpServerWithSDK(name, serverConfig, timeout, resolve, reject);
                    return;
                }

                // stdio 模式
                const { command, args = [] } = serverConfig;

                // 为MCP本地服务器特殊处理，切换到正确的工作目录
                let cwd = process.cwd();
                if (name === 'local' && args.includes('server.js')) {
                    cwd = path.resolve('./mcp');
                }

                const childProcess = spawn(command, args, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, ...(serverConfig.env || {}) },
                    shell: process.platform === 'win32',
                    cwd: cwd
                });

                // 错误处理
                childProcess.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(new Error(`服务器 ${name} 启动失败: ${error.message}`));
                });

                // 添加错误输出监听
                let stderrOutput = '';
                childProcess.stderr.on('data', (data) => {
                    stderrOutput += data.toString();
                });

                childProcess.on('exit', (code, signal) => {
                    if (code !== 0) {
                        console.error(`❌ MCP服务器 ${name} 异常退出, 代码: ${code}, 信号: ${signal}`);
                        if (stderrOutput) {
                            console.error(`错误输出: ${stderrOutput}`);
                        }
                        clearTimeout(timeout);
                        reject(new Error(`服务器 ${name} 启动失败，退出代码: ${code}`));
                    }
                });

                // 保存进程引用
                this.processes.set(name, childProcess);

                // 发送初始化请求
                const initRequest = {
                    jsonrpc: "2.0",
                    id: `init_${name}_${Date.now()}`,
                    method: "initialize",
                    params: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        clientInfo: { name: "fake-neuro-mcp-client", version: "1.0.0" }
                    }
                };

                childProcess.stdin.write(JSON.stringify(initRequest) + '\n');

                // 处理响应
                let buffer = '';
                let initialized = false;

                const onData = (data) => {
                    buffer += data.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.trim()) {
                            try {
                                const response = JSON.parse(line);

                                // 处理初始化响应
                                if (response.id === initRequest.id) {
                                    // 初始化完成，获取工具列表
                                    const toolsRequest = {
                                        jsonrpc: "2.0",
                                        id: `tools_${name}_${Date.now()}`,
                                        method: "tools/list"
                                    };
                                    childProcess.stdin.write(JSON.stringify(toolsRequest) + '\n');

                                } else if (response.id && response.id.startsWith(`tools_${name}_`) && response.result) {
                                    // 获得工具列表
                                    const serverTools = response.result.tools || [];
                                    serverTools.forEach(tool => {
                                        this.tools.push({
                                            name: tool.name,
                                            description: tool.description,
                                            parameters: tool.inputSchema,
                                            server: name,
                                            type: 'mcp'
                                        });
                                    });

                                    if (!initialized) {
                                        initialized = true;
                                        childProcess.stdout.removeListener('data', onData);
                                        clearTimeout(timeout);
                                        resolve();
                                    }
                                }
                            } catch (e) {
                                console.error(`解析MCP响应失败 (${name}):`, e.message);
                            }
                        }
                    }
                };

                childProcess.stdout.on('data', onData);

            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    // 使用MCP SDK启动HTTP服务器
    async startHttpServerWithSDK(name, serverConfig, timeout, resolve, reject) {
        try {
            console.log(`🌐 使用MCP SDK启动HTTP服务器: ${name} -> ${serverConfig.url}`);

            // 导入MCP SDK
            const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
            const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
            const { ListToolsResultSchema, CallToolResultSchema } = require('@modelcontextprotocol/sdk/types.js');

            // 创建MCP客户端
            const client = new Client({
                name: "fake-neuro-mcp-client",
                version: "1.0.0"
            }, {
                capabilities: {}
            });

            // 创建HTTP传输
            const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url));

            // 连接到服务器
            await client.connect(transport);
            console.log(`✅ HTTP MCP服务器 ${name} 连接成功`);

            // 获取工具列表
            try {
                const toolsResult = await client.request({
                    method: "tools/list",
                    params: {}
                }, ListToolsResultSchema);

                const serverTools = toolsResult.tools || [];
                console.log(`📋 HTTP MCP服务器 ${name} 提供 ${serverTools.length} 个工具`);

                serverTools.forEach(tool => {
                    this.tools.push({
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema,
                        server: name,
                        type: 'mcp_http'
                    });
                    console.log(`  ✅ 注册HTTP MCP工具: ${tool.name}`);
                });

                // 保存客户端和传输
                this.processes.set(name, {
                    type: 'http',
                    url: serverConfig.url,
                    client: client,
                    transport: transport
                });

                clearTimeout(timeout);
                resolve();

            } catch (toolsError) {
                console.log(`⚠️ HTTP MCP服务器 ${name} 获取工具列表失败: ${toolsError.message}`);
                this.processes.set(name, {
                    type: 'http',
                    url: serverConfig.url,
                    client: client,
                    transport: transport
                });
                clearTimeout(timeout);
                resolve();
            }

        } catch (error) {
            console.error(`❌ HTTP MCP服务器 ${name} SDK连接失败: ${error.message}`);
            clearTimeout(timeout);
            resolve();
        }
    }

    // 原有的HTTP服务器方法保留作为备用
    async startHttpServer(name, serverConfig, timeout, resolve, reject) {
        try {
            console.log(`🌐 启动HTTP MCP服务器: ${name} -> ${serverConfig.url}`);
            const axios = require('axios');

            // 1. 尝试MCP协议初始化
            try {
                console.log(`🔧 尝试MCP协议初始化: ${name}`);

                const initResponse = await axios.post(serverConfig.url, {
                    jsonrpc: "2.0",
                    id: `init_${name}_${Date.now()}`,
                    method: "initialize",
                    params: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        clientInfo: { name: "fake-neuro-mcp-client", version: "1.0.0" }
                    }
                }, {
                    timeout: 10000,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream'
                    }
                });

                console.log(`✅ HTTP MCP服务器 ${name} 初始化成功`);

                // 从响应header中获取session ID
                let sessionId = initResponse.headers['mcp-session-id'] ||
                               initResponse.headers['Mcp-Session-Id'] ||
                               initResponse.data.sessionId ||
                               null;

                console.log(`🔧 ${name} 初始化响应headers:`, Object.keys(initResponse.headers));
                console.log(`🔧 ${name} 获取到session ID: ${sessionId}`);

                // 2. 获取工具列表
                try {
                    const toolsHeaders = {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream'
                    };

                    // 总是添加session header（抖音服务器需要）
                    if (sessionId) {
                        toolsHeaders['mcp-session-id'] = sessionId;
                        console.log(`🔧 使用session ID获取工具列表: ${sessionId}`);
                    }

                    const toolsResponse = await axios.post(serverConfig.url, {
                        jsonrpc: "2.0",
                        id: `tools_${name}_${Date.now()}`,
                        method: "tools/list"
                    }, {
                        timeout: 10000,
                        headers: toolsHeaders
                    });

                    if (toolsResponse.data.result && toolsResponse.data.result.tools) {
                        const serverTools = toolsResponse.data.result.tools;
                        console.log(`📋 HTTP MCP服务器 ${name} 提供 ${serverTools.length} 个工具`);

                        serverTools.forEach(tool => {
                            this.tools.push({
                                name: tool.name,
                                description: tool.description,
                                parameters: tool.inputSchema,
                                server: name,
                                type: 'mcp_http'
                            });
                            console.log(`  ✅ 注册HTTP MCP工具: ${tool.name}`);
                        });
                    }

                    this.processes.set(name, {
                        type: 'http',
                        url: serverConfig.url,
                        sessionId: sessionId
                    });
                    clearTimeout(timeout);
                    resolve();

                } catch (toolsError) {
                    console.log(`⚠️ HTTP MCP服务器 ${name} 获取工具列表失败: ${toolsError.message}`);
                    console.log(`📄 tools/list响应详情:`, toolsError.response?.data || toolsError);
                    // 即使工具列表获取失败，也标记服务器为可用状态
                    this.processes.set(name, { type: 'http', url: serverConfig.url });
                    clearTimeout(timeout);
                    resolve();
                }

            } catch (initError) {
                console.log(`⚠️ HTTP MCP服务器 ${name} 初始化失败: ${initError.message}`);
                console.error('HTTP初始化错误详情:', initError);
                console.log(`🔄 回退到简单连通性测试: ${name}`);

                // 3. 回退到简单连通性测试
                try {
                    await axios.get(serverConfig.url, { timeout: 5000 });
                    console.log(`✅ HTTP MCP服务器 ${name} 连接成功（但不支持标准MCP协议）`);

                    this.processes.set(name, { type: 'http', url: serverConfig.url });
                    clearTimeout(timeout);
                    resolve();
                } catch (connectError) {
                    console.log(`❌ HTTP MCP服务器 ${name} 连接失败: ${connectError.message}`);
                    clearTimeout(timeout);
                    resolve(); // 不要让HTTP失败阻塞其他服务器
                }
            }

        } catch (error) {
            console.error(`❌ HTTP MCP服务器 ${name} 启动出错: ${error.message}`);
            clearTimeout(timeout);
            resolve(); // 不要让异常阻塞其他服务器
        }
    }

    // 调用MCP工具
    async callMCPTool(toolName, args) {
        const tool = this.tools.find(t => t.name === toolName && (t.type === 'mcp' || t.type === 'mcp_http'));
        if (!tool) {
            throw new Error(`MCP工具未找到: ${toolName}`);
        }

        // 处理HTTP类型的工具
        if (tool.type === 'mcp_http') {
            return await this.callHttpTool(toolName, args);
        }

        const childProcess = this.processes.get(tool.server);
        if (!childProcess) {
            throw new Error(`MCP服务器未找到: ${tool.server}`);
        }

        const request = {
            jsonrpc: "2.0",
            id: `call_${toolName}_${Date.now()}`,
            method: "tools/call",
            params: {
                name: toolName,
                arguments: args
            }
        };

        childProcess.stdin.write(JSON.stringify(request) + '\n');

        return new Promise((resolve, reject) => {
            let buffer = '';
            const timeout = setTimeout(() => {
                reject(new Error(`MCP工具调用超时: ${toolName}`));
            }, 30000);

            const onData = (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const response = JSON.parse(line);
                            if (response.id === request.id) {
                                childProcess.stdout.removeListener('data', onData);
                                clearTimeout(timeout);

                                if (response.error) {
                                    reject(new Error(response.error.message));
                                } else {
                                    const content = response.result?.content || [];
                                    const textContent = content.find(c => c.type === 'text');
                                    resolve(textContent ? textContent.text : JSON.stringify(response.result));
                                }
                            }
                        } catch (e) {
                            console.error(`解析MCP工具调用响应失败 (${toolName}):`, e.message);
                        }
                    }
                }
            };

            childProcess.stdout.on('data', onData);
        });
    }

    // 获取所有可用工具（MCP格式转换为OpenAI Function Calling格式）
    getToolsForLLM() {
        if (!this.isEnabled || this.tools.length === 0) {
            return [];
        }

        return this.tools.map(tool => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));
    }

    // 调用HTTP类型的MCP工具
    async callHttpTool(toolName, args) {
        const tool = this.tools.find(t => t.name === toolName && t.type === 'mcp_http');
        if (!tool) {
            throw new Error(`HTTP MCP工具未找到: ${toolName}`);
        }

        const serverProcess = this.processes.get(tool.server);
        if (!serverProcess || serverProcess.type !== 'http') {
            throw new Error(`HTTP MCP服务器未找到: ${tool.server}`);
        }

        try {
            console.log(`🔧 调用HTTP MCP工具: ${toolName}，参数:`, args);

            // 导入Schema验证
            const { CallToolResultSchema } = require('@modelcontextprotocol/sdk/types.js');

            // 使用MCP SDK客户端调用工具
            const result = await serverProcess.client.request({
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: args
                }
            }, CallToolResultSchema);

            console.log(`✅ HTTP MCP工具 ${toolName} 调用成功`);

            const content = result.content || [];
            const textContent = content.find(c => c.type === 'text');
            return textContent ? textContent.text : JSON.stringify(result);

        } catch (error) {
            console.error(`❌ HTTP MCP工具 ${toolName} 调用失败:`, error.message);
            throw new Error(`HTTP MCP工具调用失败: ${error.message}`);
        }
    }

    // 执行工具调用（统一接口）
    async executeFunction(toolName, parameters) {
        if (!this.isEnabled) {
            throw new Error('MCP管理器已禁用');
        }

        const tool = this.tools.find(t => t.name === toolName && (t.type === 'mcp' || t.type === 'mcp_http'));
        if (!tool) {
            throw new Error(`MCP工具未找到: ${toolName}`);
        }

        try {
            console.log(`🔧 执行MCP工具: ${toolName}，参数:`, parameters);
            const result = await this.callMCPTool(toolName, parameters);
            console.log(`✅ MCP工具 ${toolName} 执行成功`);
            return result;
        } catch (error) {
            console.error(`❌ MCP工具 ${toolName} 执行失败:`, error.message);
            throw error;
        }
    }

    // 处理LLM返回的工具调用（需要区分是否为MCP工具）
    async handleToolCalls(toolCalls) {
        if (!this.isEnabled || !toolCalls || toolCalls.length === 0) {
            return null;
        }

        const results = [];
        let hasMyTools = false;

        for (const toolCall of toolCalls) {
            const functionName = toolCall.function.name;

            // 检查是否为MCP工具
            const isMCPTool = this.tools.some(t => t.name === functionName && (t.type === 'mcp' || t.type === 'mcp_http'));

            if (isMCPTool) {
                hasMyTools = true;

                // 解析参数
                let parameters;
                try {
                    parameters = typeof toolCall.function.arguments === 'string'
                        ? JSON.parse(toolCall.function.arguments)
                        : toolCall.function.arguments;
                } catch (error) {
                    console.error('解析MCP工具参数错误:', error);
                    parameters = {};
                }

                // 执行MCP工具
                try {
                    const result = await this.executeFunction(functionName, parameters);
                    results.push({
                        tool_call_id: toolCall.id,
                        content: result
                    });
                } catch (error) {
                    console.error(`MCP工具 ${functionName} 执行失败:`, error);
                    results.push({
                        tool_call_id: toolCall.id,
                        content: `工具执行失败: ${error.message}`
                    });
                }
            }
        }

        // 如果没有找到任何MCP工具，返回null让其他管理器处理
        if (!hasMyTools) {
            return null;
        }

        // 如果只有一个结果，返回单个结果（向后兼容）
        if (results.length === 1) {
            return results[0].content;
        }

        // 多个结果返回数组
        return results;
    }

    // 获取统计信息
    getStats() {
        const mcpTools = this.tools.filter(t => t.type === 'mcp' || t.type === 'mcp_http');
        return {
            enabled: this.isEnabled,
            initialized: this.isInitialized,
            servers: Object.keys(this.mcpServers).length,
            tools: mcpTools.length,
            toolNames: mcpTools.map(t => t.name)
        };
    }

    // 等待初始化完成
    async waitForInitialization() {
        if (this.isInitialized) {
            return true;
        }

        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (this.isInitialized) {
                    clearInterval(checkInterval);
                    resolve(true);
                }
            }, 100);

            // 最大等待时间
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve(false);
            }, this.startupTimeout + 5000);
        });
    }

    // 停止所有服务器
    stop() {
        this.processes.forEach((process, name) => {
            try {
                process.kill();
                console.log(`🛑 MCP服务器 ${name} 已停止`);
            } catch (error) {
                console.error(`停止MCP服务器 ${name} 失败:`, error.message);
            }
        });
        this.processes.clear();
        console.log('🔧 MCP管理器已停止');
    }
}

// 导出模块
module.exports = { MCPManager };