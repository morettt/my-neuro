// plugin-manager.js - 插件管理器
const fs = require('fs');
const path = require('path');
const { PluginContext } = require('./plugin-context.js');
const { logToTerminal } = require('../api-utils.js');

class PluginManager {
    constructor(config) {
        this._config = config;
        /** @type {Map<string, {plugin: Plugin, metadata: object}>} */
        this._plugins = new Map();
        /** 动态注册的工具（由 context.registerTool 调用）*/
        this._dynamicTools = new Map(); // pluginName -> toolDef[]

        // 内置插件目录和社区插件目录
        this._builtinDir = path.join(__dirname, '..', '..', 'plugins', 'built-in');
        this._communityDir = path.join(__dirname, '..', '..', 'plugins', 'community');
    }

    // ===== 加载 =====

    /**
     * 扫描并加载所有插件（内置 + 社区）
     */
    async loadAll() {
        logToTerminal('info', '🔌 开始加载插件...');

        await this._loadFromDir(this._builtinDir, 'built-in');
        await this._loadFromDir(this._communityDir, 'community');

        logToTerminal('info', `🔌 插件加载完成，共 ${this._plugins.size} 个插件`);
    }

    async _loadFromDir(dir, type) {
        if (!fs.existsSync(dir)) return;

        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            logToTerminal('warn', `⚠️ 读取插件目录失败 (${dir}): ${e.message}`);
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const pluginDir = path.join(dir, entry.name);
            await this.load(pluginDir).catch(err => {
                logToTerminal('error', `❌ 加载插件失败 (${entry.name}): ${err.message}`);
            });
        }
    }

    /**
     * 加载单个插件目录
     * @param {string} pluginDir - 插件目录绝对路径
     */
    async load(pluginDir) {
        const metaPath = path.join(pluginDir, 'metadata.json');
        if (!fs.existsSync(metaPath)) return;

        let metadata;
        try {
            metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch (e) {
            throw new Error(`metadata.json 解析失败: ${e.message}`);
        }

        const { name, main = 'index.js', lang } = metadata;

        // config key 由 name 自动转换：连字符换下划线（auto-chat → auto_chat）
        const configKey = name.replace(/-/g, '_');

        // 检查是否启用（config.plugins.<configKey>.enabled 或默认启用）
        const pluginCfg = this._config.plugins && this._config.plugins[configKey];
        if (pluginCfg && pluginCfg.enabled === false) {
            logToTerminal('info', `⏭️ 插件已禁用，跳过: ${name}`);
            return;
        }

        // 根据 lang 决定入口文件
        const isPython = lang === 'python';
        const resolvedMain = main !== 'index.js' ? main : (isPython ? 'index.py' : 'index.js');
        const mainPath = path.join(pluginDir, resolvedMain);

        if (!fs.existsSync(mainPath)) {
            throw new Error(`入口文件不存在: ${mainPath}`);
        }

        // 创建插件上下文
        const context = new PluginContext(configKey, this._config, this);

        // 加载插件
        let plugin;
        if (isPython) {
            const { PythonPluginBridge } = require('./python-plugin-bridge.js');
            plugin = new PythonPluginBridge(metadata, context, mainPath);
        } else {
            let PluginClass;
            try {
                const mod = require(mainPath);
                // 支持 module.exports = class 或 module.exports = { default: class }
                PluginClass = mod.default || mod[Object.keys(mod)[0]] || mod;
            } catch (e) {
                throw new Error(`加载插件模块失败: ${e.message}`);
            }
            plugin = new PluginClass(metadata, context);
        }

        // onInit
        await plugin.onInit();

        this._plugins.set(name, { plugin, metadata });
        logToTerminal('info', `✅ 插件已加载: ${name} v${metadata.version || '?'}${isPython ? ' [Python]' : ''}`);
    }

    /**
     * 卸载插件
     * @param {string} name
     */
    async unload(name) {
        const entry = this._plugins.get(name);
        if (!entry) return;

        await entry.plugin.onStop().catch(() => {});
        await entry.plugin.onDestroy().catch(() => {});
        this._plugins.delete(name);
        this._dynamicTools.delete(name);
        logToTerminal('info', `🔌 插件已卸载: ${name}`);
    }

    /**
     * 热重载插件
     * @param {string} name
     */
    async reload(name) {
        const entry = this._plugins.get(name);
        if (!entry) throw new Error(`插件不存在: ${name}`);

        // 找到插件目录
        const pluginDir = this._findPluginDir(name);
        if (!pluginDir) throw new Error(`找不到插件目录: ${name}`);

        await this.unload(name);

        // 清除 require 缓存
        const mainPath = path.join(pluginDir, entry.metadata.main || 'index.js');
        delete require.cache[require.resolve(mainPath)];

        await this.load(pluginDir);
        const newEntry = this._plugins.get(name);
        if (newEntry) await newEntry.plugin.onStart();

        logToTerminal('info', `🔄 插件已热重载: ${name}`);
    }

    _findPluginDir(name) {
        for (const baseDir of [this._builtinDir, this._communityDir]) {
            const dir = path.join(baseDir, name);
            if (fs.existsSync(dir)) return dir;
        }
        return null;
    }

    // ===== 查询 =====

    getPlugin(name) {
        return this._plugins.get(name)?.plugin || null;
    }

    getAllPlugins() {
        return Array.from(this._plugins.values()).map(e => e.plugin);
    }

    // ===== 启动 / 停止所有插件 =====

    async startAll() {
        for (const [name, { plugin }] of this._plugins) {
            try {
                await plugin.onStart();
            } catch (e) {
                logToTerminal('error', `❌ 插件 onStart 失败 (${name}): ${e.message}`);
            }
        }
    }

    async stopAll() {
        for (const [name, { plugin }] of this._plugins) {
            try {
                await plugin.onStop();
            } catch (e) {
                logToTerminal('error', `❌ 插件 onStop 失败 (${name}): ${e.message}`);
            }
        }
    }

    // ===== 流水线 Hook 执行 =====

    /**
     * 执行所有插件的 onUserInput 钩子
     * @param {MessageEvent} event
     */
    async runUserInputHooks(event) {
        for (const [name, { plugin }] of this._plugins) {
            if (event._stopped) break;
            try {
                await plugin.onUserInput(event);
            } catch (e) {
                logToTerminal('error', `❌ onUserInput 插件错误 (${name}): ${e.message}`);
            }
        }
    }

    /**
     * 执行所有插件的 onLLMRequest 钩子
     * @param {object} request - { messages, tools }
     */
    async runLLMRequestHooks(request) {
        for (const [name, { plugin }] of this._plugins) {
            try {
                await plugin.onLLMRequest(request);
            } catch (e) {
                logToTerminal('error', `❌ onLLMRequest 插件错误 (${name}): ${e.message}`);
            }
        }
    }

    /**
     * 执行所有插件的 onLLMResponse 钩子
     * @param {object} response - { text }
     */
    async runLLMResponseHooks(response) {
        for (const [name, { plugin }] of this._plugins) {
            try {
                await plugin.onLLMResponse(response);
            } catch (e) {
                logToTerminal('error', `❌ onLLMResponse 插件错误 (${name}): ${e.message}`);
            }
        }
    }

    /**
     * 执行所有插件的 onTTSText 钩子，允许插件修改送入 TTS 的文本
     * @param {string} text
     * @returns {Promise<string>} 最终文本
     */
    async runTTSTextHooks(text) {
        let result = text;
        for (const [name, { plugin }] of this._plugins) {
            try {
                const modified = await plugin.onTTSText(result);
                if (typeof modified === 'string') result = modified;
            } catch (e) {
                logToTerminal('error', `❌ onTTSText 插件错误 (${name}): ${e.message}`);
            }
        }
        return result;
    }

    /**
     * 执行所有插件的 onTTSStart 钩子
     * @param {string} text
     */
    async runTTSStartHooks(text) {
        for (const [name, { plugin }] of this._plugins) {
            try {
                await plugin.onTTSStart(text);
            } catch (e) {
                logToTerminal('error', `❌ onTTSStart 插件错误 (${name}): ${e.message}`);
            }
        }
    }

    /** 执行所有插件的 onTTSEnd 钩子 */
    async runTTSEndHooks() {
        for (const [name, { plugin }] of this._plugins) {
            try {
                await plugin.onTTSEnd();
            } catch (e) {
                logToTerminal('error', `❌ onTTSEnd 插件错误 (${name}): ${e.message}`);
            }
        }
    }

    // ===== 工具聚合 =====

    /**
     * 合并所有插件提供的工具列表
     * @returns {Array}
     */
    getAllTools() {
        const tools = [];
        for (const [, { plugin }] of this._plugins) {
            try {
                const pluginTools = plugin.getTools();
                if (Array.isArray(pluginTools)) {
                    tools.push(...pluginTools);
                }
            } catch (e) {
                // 忽略单个插件错误
            }
        }
        // 追加动态注册的工具
        for (const toolList of this._dynamicTools.values()) {
            tools.push(...toolList);
        }
        return tools;
    }

    /**
     * 路由工具调用到对应插件
     * @param {string} name - 工具名
     * @param {object} params
     * @returns {Promise<string>}
     */
    async executeTool(name, params) {
        for (const [, { plugin }] of this._plugins) {
            const tools = plugin.getTools ? plugin.getTools() : [];
            // 兼容两种格式：{ name } 和 { function: { name } }
            if (tools.some(t => t.name === name || t.function?.name === name)) {
                return await plugin.executeTool(name, params);
            }
        }
        throw new Error(`找不到提供工具的插件: ${name}`);
    }

    /**
     * 动态注册工具（由 PluginContext 调用）
     * @param {string} pluginName
     * @param {object} toolDef
     */
    registerDynamicTool(pluginName, toolDef) {
        if (!this._dynamicTools.has(pluginName)) {
            this._dynamicTools.set(pluginName, []);
        }
        const list = this._dynamicTools.get(pluginName);
        // 去重
        if (!list.some(t => t.name === toolDef.name)) {
            list.push(toolDef);
        }
    }
}

module.exports = { PluginManager };
