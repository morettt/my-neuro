// MCP 管理器 - 主协调器
const fs = require('fs');
const path = require('path');
const { MCPToolRegistry } = require('./mcp-tool-registry.js');
const { MCPStdioTransport } = require('./mcp-stdio-transport.js');
const { MCPHttpTransport } = require('./mcp-http-transport.js');
const { logToolAction } = require('../api-utils.js');

class MCPManager {
    constructor(config = {}) {
        this.config = config.mcp || { enabled: false };
        this.isEnabled = this.config.enabled;
        this.mcpServers = {};
        this.transports = new Map();
        this.toolRegistry = new MCPToolRegistry();
        this.isInitialized = false;
        this.startupTimeout = this.config.startup_timeout || 30000;

        // 只有启用时才显示配置信息，未启用时不显示任何日志
        // if (this.isEnabled) {
        //     console.log(`🔧 MCP管理器配置: 启用=${this.isEnabled}, 超时=${this.startupTimeout}ms`);
        //     logToolAction('info', `🔧 MCP管理器配置: 启用=${this.isEnabled}, 超时=${this.startupTimeout}ms`);
        // }
        // 不显示配置日志，只在真正初始化完成后显示结果
    }

    // 初始化MCP系统
    async initialize() {
        if (!this.isEnabled) {
            // console.log('🔧 MCP管理器已禁用，跳过初始化');  // 不显示，用户未启用时不需要提示
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
            console.log(`✅ MCP管理器初始化完成: ${this.toolRegistry.getToolCount()} 个工具可用`);
            return true;

        } catch (error) {
            console.error('❌ MCP管理器初始化失败:', error.message);
            this.isInitialized = true; // 即使失败也标记为已初始化，避免阻塞
            return false;
        }
    }

    // 🔥 自动同步 tools 文件夹到配置文件 (参考 js_mcp/client.js 的实现)
    autoSyncToolsFolder(configPath) {
        // 计算 tools 文件夹路径
        const configDir = path.dirname(configPath);
        const toolsDir = path.join(configDir, 'tools');

        // 如果 tools 文件夹不存在，跳过
        if (!fs.existsSync(toolsDir)) {
            console.log('📁 tools 文件夹不存在，跳过自动同步');
            return;
        }

        try {
            // 读取现有配置
            let config = {};
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf8');
                config = JSON.parse(configContent);
            }

            // 保存非 tools/ 路径的配置 (如 tavily 等外部服务)
            const externalConfigs = {};
            Object.keys(config).forEach(key => {
                const cfg = config[key];
                // 如果不是指向 tools/ 的配置，保留它
                if (!cfg.args || !Array.isArray(cfg.args) || !cfg.args[0]?.includes('tools/')) {
                    externalConfigs[key] = cfg;
                }
            });

            // 扫描 tools 文件夹中的所有文件
            const items = fs.readdirSync(toolsDir);
            const currentToolConfigs = [];

            items.forEach(item => {
                const itemPath = path.join(toolsDir, item);
                const stat = fs.statSync(itemPath);

                if (stat.isFile()) {
                    let toolName, command, args;

                    if (item.endsWith('.js')) {
                        // JavaScript 文件 - 使用项目自带的 node
                        toolName = item.replace('.js', '');
                        // 基于配置文件路径计算 node.exe 的绝对路径
                        const projectRoot = path.dirname(path.dirname(configPath));
                        const builtinNode = path.join(projectRoot, 'node', 'node.exe');
                        command = fs.existsSync(builtinNode) ? builtinNode : 'node';
                        args = [`./mcp/tools/${item}`];
                    } else if (item.endsWith('.py')) {
                        // Python 文件
                        toolName = item.replace('.py', '');
                        command = 'python';
                        args = [`./mcp/tools/${item}`];
                    } else {
                        return; // 跳过其他类型文件
                    }

                    currentToolConfigs.push({ name: toolName, command, args });
                }
            });

            // 清理不存在的工具 (关键逻辑!)
            Object.keys(config).forEach(key => {
                const cfg = config[key];
                if (cfg.args && Array.isArray(cfg.args) && cfg.args[0]?.startsWith('./mcp/tools/')) {
                    const exists = currentToolConfigs.some(t => t.name === key);
                    if (!exists) {
                        console.log(`🗑️  删除不存在的工具: ${key}`);
                        delete config[key];
                    }
                }
            });

            // 生成新工具配置
            const toolConfigs = {};
            currentToolConfigs.forEach(toolCfg => {
                toolConfigs[toolCfg.name] = {
                    command: toolCfg.command,
                    args: toolCfg.args
                };

                // 如果是新工具,打印日志
                if (!config[toolCfg.name]) {
                    console.log(`📦 自动添加工具: ${toolCfg.name} (${toolCfg.command})`);
                }
            });

            // 合并配置: 先放外部服务，再放工具
            const finalConfig = {
                ...externalConfigs,
                ...toolConfigs
            };

            // 写回配置文件
            fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2), 'utf8');

            console.log(`✅ 配置自动同步完成: 外部服务 ${Object.keys(externalConfigs).length} 个, 本地工具 ${currentToolConfigs.length} 个`);

        } catch (error) {
            console.warn(`⚠️ 自动同步 tools 文件夹失败: ${error.message}`);
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
                // 🔥 自动同步 tools 文件夹到配置文件
                this.autoSyncToolsFolder(configPath);

                const configContent = fs.readFileSync(configPath, 'utf8');
                const allServers = JSON.parse(configContent);

                // 过滤掉禁用的服务器(以 _disabled 结尾的)
                this.mcpServers = {};
                Object.keys(allServers).forEach(serverName => {
                    if (!serverName.endsWith('_disabled')) {
                        this.mcpServers[serverName] = allServers[serverName];
                    }
                });

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
        const jsServers = {};
        const pyServers = {};

        // 分离 JS 和 Python 工具
        for (const [name, config] of Object.entries(this.mcpServers)) {
            if (config.command === 'python' || config.command.includes('python')) {
                pyServers[name] = config;
            } else {
                jsServers[name] = config;
            }
        }

        console.log(`🚀 优先启动 ${Object.keys(jsServers).length} 个JS工具...`);

        // 先启动 JS 工具(快)
        const jsPromises = Object.entries(jsServers).map(([name, config]) =>
            this.startServer(name, config)
        );
        await Promise.allSettled(jsPromises);

        // Python 工具后台启动,不阻塞
        if (Object.keys(pyServers).length > 0) {
            console.log(`🐍 后台启动 ${Object.keys(pyServers).length} 个Python工具...`);
            Object.entries(pyServers).forEach(([name, config]) => {
                this.startServer(name, config).catch(err => {
                    console.log(`⚠️ Python工具 ${name} 启动失败: ${err.message}`);
                });
            });
        }
    }

    // 启动单个服务器
    async startServer(name, serverConfig) {
        try {
            let transport;

            // 根据配置类型选择传输方式
            if (serverConfig.type === 'streamable_http') {
                transport = new MCPHttpTransport(serverConfig, this.toolRegistry, this.startupTimeout);
            } else {
                transport = new MCPStdioTransport(serverConfig, this.toolRegistry, this.startupTimeout);
            }

            // 启动传输
            await transport.start(name);

            // 保存传输实例
            this.transports.set(name, transport);

        } catch (error) {
            throw new Error(`服务器 ${name} 启动失败: ${error.message}`);
        }
    }

    // 调用MCP工具（内部方法）
    async callMCPTool(toolName, args) {
        const tool = this.toolRegistry.findTool(toolName);
        if (!tool) {
            throw new Error(`MCP工具未找到: ${toolName}`);
        }

        const transport = this.transports.get(tool.server);
        if (!transport) {
            throw new Error(`MCP服务器未找到: ${tool.server}`);
        }

        return await transport.callTool(toolName, args);
    }

    // 获取所有可用工具（MCP格式转换为OpenAI Function Calling格式）
    getToolsForLLM() {
        if (!this.isEnabled || this.toolRegistry.getToolCount() === 0) {
            return [];
        }

        return this.toolRegistry.toOpenAIFormat();
    }

    // 执行工具调用（统一接口，向外提供）
    async executeFunction(toolName, parameters) {
        if (!this.isEnabled) {
            throw new Error('MCP管理器已禁用');
        }

        console.log(`🔧 执行MCP工具: ${toolName}，参数:`, parameters);
        const result = await this.callMCPTool(toolName, parameters);
        return result;
    }

    // 处理LLM返回的工具调用（需要区分是否为MCP工具）
    async handleToolCalls(toolCalls) {
        if (!this.isEnabled || !toolCalls || toolCalls.length === 0) {
            return null;
        }

        const results = [];

        for (const toolCall of toolCalls) {
            const functionName = toolCall.function.name;

            // 检查是否为MCP工具
            if (!this.toolRegistry.isMCPTool(functionName)) continue;

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

        // 如果没有找到任何MCP工具，返回null让其他管理器处理
        if (results.length === 0) {
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
        const stats = this.toolRegistry.getStats();
        return {
            enabled: this.isEnabled,
            initialized: this.isInitialized,
            servers: Object.keys(this.mcpServers).length,
            tools: stats.total,
            toolNames: stats.toolNames
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
        this.transports.forEach((transport, name) => {
            transport.stop();
        });
        this.transports.clear();
        this.toolRegistry.clear();
        console.log('🔧 MCP管理器已停止');
    }
}

// 导出模块
module.exports = { MCPManager };
