// 本地工具管理器 - Function Call工具调用系统
const fs = require('fs');
const path = require('path');

class LocalToolManager {
    constructor(config = {}) {
        this.tools = [];
        this.modules = [];
        this.config = config.tools || { enabled: true, auto_reload: false };
        this.isEnabled = this.config.enabled;

        console.log(`🔧 工具管理器配置: 启用=${this.isEnabled}, 自动重载=${this.config.auto_reload}`);

        if (this.isEnabled) {
            this.loadAllTools();
        } else {
            console.log('🔧 工具管理器已禁用，跳过工具加载');
        }
    }

    // 自动加载server-tools目录下的所有工具模块
    loadAllTools() {
        this.tools = [];
        this.modules = [];

        const toolsDir = path.join(__dirname, '..', '..', 'server-tools');

        // 检查目录是否存在
        if (!fs.existsSync(toolsDir)) {
            console.warn('server-tools目录不存在，跳过工具加载');
            return;
        }

        const files = fs.readdirSync(toolsDir);

        files.forEach(file => {
            // 跳过非JavaScript文件和server.js主文件
            if (!file.endsWith('.js') || file === 'server.js') {
                return;
            }

            try {
                const modulePath = path.join(toolsDir, file);

                // 清除模块缓存，支持热重载
                delete require.cache[require.resolve(modulePath)];

                const module = require(modulePath);

                // 检查模块是否有必要的接口
                if (typeof module.getToolDefinitions === 'function' &&
                    typeof module.executeFunction === 'function') {

                    this.modules.push(module);

                    // 获取并添加工具定义
                    const moduleTools = module.getToolDefinitions();
                    if (Array.isArray(moduleTools) && moduleTools.length > 0) {
                        this.tools.push(...moduleTools);
                        console.log(`✅ 已加载工具模块: ${file} (${moduleTools.length}个工具)`);
                    } else {
                        console.warn(`⚠️ 模块 ${file} 没有返回有效的工具定义`);
                    }
                } else {
                    console.warn(`⚠️ 跳过文件 ${file}: 不是有效的工具模块(缺少必要的接口)`);
                }
            } catch (error) {
                console.error(`❌ 加载模块 ${file} 失败:`, error.message);
            }
        });

        console.log(`🔧 工具管理器初始化完成: ${this.modules.length} 个模块, ${this.tools.length} 个工具`);
    }

    // 重新加载所有工具模块
    reloadTools() {
        console.log('🔄 重新加载工具模块...');
        this.loadAllTools();
    }

    // 获取OpenAI Function Calling格式的工具列表
    getToolsForLLM() {
        if (!this.isEnabled || this.tools.length === 0) {
            return [];
        }

        const validatedTools = [];

        for (const tool of this.tools) {
            try {
                // 验证工具基本结构
                if (!tool.name || typeof tool.name !== 'string') {
                    console.warn(`⚠️ 跳过无效工具: 缺少有效的name字段`);
                    continue;
                }

                if (!tool.description || typeof tool.description !== 'string') {
                    console.warn(`⚠️ 跳过无效工具 ${tool.name}: 缺少有效的description字段`);
                    continue;
                }

                // 验证和修复 parameters 字段（Gemini 严格要求）
                let parameters = tool.parameters;

                // 如果 parameters 不存在或为空，创建默认结构
                if (!parameters || typeof parameters !== 'object') {
                    parameters = {
                        type: "object",
                        properties: {},
                        required: []
                    };
                    console.log(`🔧 工具 ${tool.name}: 补充默认parameters`);
                }

                // 确保 parameters 有必需的字段
                if (!parameters.type) {
                    parameters.type = "object";
                }

                if (!parameters.properties || typeof parameters.properties !== 'object') {
                    parameters.properties = {};
                }

                if (!Array.isArray(parameters.required)) {
                    parameters.required = [];
                }

                // 验证和清理 properties 中的每个属性（Gemini严格模式）
                if (parameters.properties && typeof parameters.properties === 'object') {
                    for (const [propName, propDef] of Object.entries(parameters.properties)) {
                        // 确保每个属性都有type
                        if (!propDef.type) {
                            console.warn(`⚠️ 工具 ${tool.name} 的属性 ${propName} 缺少type字段，设为string`);
                            propDef.type = "string";
                        }
                        
                        // 🔥 关键修复：如果是array类型，必须有items字段
                        if (propDef.type === "array") {
                            if (!propDef.items || typeof propDef.items !== 'object') {
                                console.log(`🔧 工具 ${tool.name}.${propName}: array类型缺少items，自动添加`);
                                propDef.items = {
                                    type: "string",
                                    description: "数组元素"
                                };
                            } else {
                                // 确保items也有type
                                if (!propDef.items.type) {
                                    propDef.items.type = "string";
                                }
                                // 确保items也有description
                                if (!propDef.items.description) {
                                    propDef.items.description = "数组元素";
                                }
                            }
                        }
                        
                        // 确保每个属性都有description
                        if (!propDef.description) {
                            console.warn(`⚠️ 工具 ${tool.name} 的属性 ${propName} 缺少description字段，自动添加`);
                            propDef.description = `${propName}参数`;
                        }
                        
                        // 移除Gemini不支持的字段
                        const unsupportedFields = ['enum', 'default', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format'];
                        unsupportedFields.forEach(field => {
                            if (propDef[field] !== undefined) {
                                console.log(`🔧 工具 ${tool.name}.${propName}: 移除可能不兼容的字段 ${field}`);
                                // 如果有enum，把它添加到description中
                                if (field === 'enum' && Array.isArray(propDef[field])) {
                                    propDef.description += `，可选值：${propDef[field].join('、')}`;
                                }
                                // 如果有default，把它添加到description中
                                if (field === 'default') {
                                    propDef.description += `，默认值：${propDef[field]}`;
                                }
                                delete propDef[field];
                            }
                        });
                        
                        // 只保留Gemini支持的字段
                        const allowedFields = propDef.type === 'array' 
                            ? ['type', 'description', 'items']  // array类型允许items
                            : ['type', 'description'];
                        
                        Object.keys(propDef).forEach(key => {
                            if (!allowedFields.includes(key)) {
                                console.log(`🔧 工具 ${tool.name}.${propName}: 移除未知字段 ${key}`);
                                delete propDef[key];
                            }
                        });
                    }
                }

                // 构建符合标准的工具定义
                const validatedTool = {
                    type: "function",
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: parameters
                    }
                };

                validatedTools.push(validatedTool);

            } catch (error) {
                console.error(`❌ 验证工具 ${tool.name || '未知'} 时出错:`, error.message);
            }
        }

        console.log(`🔧 工具验证完成: ${validatedTools.length}/${this.tools.length} 个工具有效`);
        
        // 🔥 去重：移除重复的工具名称（Gemini不允许重复）
        const uniqueTools = [];
        const seenNames = new Set();
        
        for (const tool of validatedTools) {
            const toolName = tool.function.name;
            if (seenNames.has(toolName)) {
                console.warn(`⚠️ 跳过重复工具: ${toolName}`);
            } else {
                seenNames.add(toolName);
                uniqueTools.push(tool);
            }
        }
        
        if (uniqueTools.length < validatedTools.length) {
            console.log(`🔧 去重完成: ${uniqueTools.length}/${validatedTools.length} 个工具（移除了 ${validatedTools.length - uniqueTools.length} 个重复）`);
        }
        
        return uniqueTools;
    }

    // 查找工具对应的模块
    findModuleForTool(toolName) {
        return this.modules.find(module =>
            module.getToolDefinitions().some(tool => tool.name === toolName)
        );
    }

    // 执行工具调用
    async executeFunction(toolName, parameters) {
        if (!this.isEnabled) {
            throw new Error('工具管理器已禁用');
        }

        const module = this.findModuleForTool(toolName);
        if (!module) {
            throw new Error(`未找到工具: ${toolName}`);
        }

        try {
            console.log(`🔧 执行工具: ${toolName}，参数:`, parameters);
            const result = await module.executeFunction(toolName, parameters);
            return result;
        } catch (error) {
            console.error(`❌ 工具 ${toolName} 执行失败:`, error.message);
            throw error;
        }
    }

    // 处理LLM返回的工具调用
    async handleToolCalls(toolCalls) {
        if (!this.isEnabled || !toolCalls || toolCalls.length === 0) {
            return null;
        }

        const results = [];
        let hasMyTools = false;

        for (const toolCall of toolCalls) {
            const functionName = toolCall.function.name;

            // 检查是否为本地工具
            const module = this.findModuleForTool(functionName);

            if (module) {
                hasMyTools = true;

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

                // 执行工具
                try {
                    const result = await this.executeFunction(functionName, parameters);
                    results.push({
                        tool_call_id: toolCall.id,
                        content: result
                    });
                } catch (error) {
                    console.error(`本地工具 ${functionName} 执行失败:`, error);
                    results.push({
                        tool_call_id: toolCall.id,
                        content: `工具执行失败: ${error.message}`
                    });
                }
            }
        }

        // 如果没有找到任何本地工具，返回null让其他管理器处理
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

    // 获取工具统计信息
    getStats() {
        return {
            enabled: this.isEnabled,
            modules: this.modules.length,
            tools: this.tools.length,
            toolNames: this.tools.map(t => t.name)
        };
    }

    // 启用/禁用工具管理器
    setEnabled(enabled) {
        this.isEnabled = enabled;
        this.config.enabled = enabled;

        if (enabled && this.tools.length === 0) {
            // 如果启用且没有工具，则重新加载
            this.loadAllTools();
        }

        console.log(`🔧 工具管理器已${enabled ? '启用' : '禁用'}`);
    }

    // 更新配置
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.isEnabled = this.config.enabled;

        console.log(`🔧 工具管理器配置已更新:`, this.config);

        if (this.isEnabled && this.tools.length === 0) {
            this.loadAllTools();
        }
    }

    // 停止工具管理器
    stop() {
        this.setEnabled(false);
        console.log('🔧 工具管理器已停止');
    }
}

// 导出模块
module.exports = { LocalToolManager };