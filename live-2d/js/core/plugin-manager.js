// plugin-manager.js - 插件管理器（支持热加载）
const fs = require('fs');
const path = require('path');
const { PluginContext } = require('./plugin-context.js');
const { logToTerminal } = require('../api-utils.js');

class PluginManager {
    constructor(config) {
        this._config = config;
        /** @type {Map<string, {plugin: Plugin, metadata: object, pluginDir: string}>} */
        this._plugins = new Map();
        /** 动态注册的工具（由 context.registerTool 调用）*/
        this._dynamicTools = new Map(); // pluginName -> toolDef[]

        this._pluginsDir = path.join(__dirname, '..', '..', 'plugins');
        this._builtinDir = path.join(__dirname, '..', '..', 'plugins', 'built-in');
        this._communityDir = path.join(__dirname, '..', '..', 'plugins', 'community');

        /** 已启用的插件相对路径集合，null 表示尚未加载 */
        this._enabledPlugins = null;

        /** 文件监听器引用 */
        this._enabledListWatcher = null;
        this._sourceWatchers = [];
        this._syncDebounceTimer = null;
        this._reloadDebounceTimers = new Map();
    }

    // ===== enabled_plugins.json 读取 =====

    /**
     * 从磁盘读取 enabled_plugins.json 并返回 Set
     * @param {boolean} [forceReload=false] - 是否强制从磁盘重新读取
     */
    _loadEnabledList(forceReload = false) {
        if (!forceReload && this._enabledPlugins !== null) return;

        const listPath = path.join(this._pluginsDir, 'enabled_plugins.json');
        if (!fs.existsSync(listPath)) {
            logToTerminal('warn', '⚠️ 未找到 enabled_plugins.json，所有插件将被禁用');
            this._enabledPlugins = new Set();
            return;
        }
        try {
            const data = JSON.parse(fs.readFileSync(listPath, 'utf8'));
            this._enabledPlugins = new Set(
                (data.plugins || []).map(p => p.replace(/\\/g, '/'))
            );
        } catch (e) {
            logToTerminal('warn', `⚠️ enabled_plugins.json 读取失败: ${e.message}`);
            this._enabledPlugins = new Set();
        }
    }

    /**
     * 扫描插件目录，返回 { relPath -> pluginDir } 映射
     */
    _scanAllPluginDirs() {
        const result = new Map();
        for (const baseDir of [this._builtinDir, this._communityDir]) {
            if (!fs.existsSync(baseDir)) continue;
            let entries;
            try { entries = fs.readdirSync(baseDir, { withFileTypes: true }); } catch { continue; }
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const pluginDir = path.join(baseDir, entry.name);
                const metaPath = path.join(pluginDir, 'metadata.json');
                if (!fs.existsSync(metaPath)) continue;
                const relPath = path.relative(this._pluginsDir, pluginDir).replace(/\\/g, '/');
                result.set(relPath, pluginDir);
            }
        }
        return result;
    }

    // ===== 加载 =====

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

        const configKey = name.replace(/-/g, '_');

        this._loadEnabledList();
        const relPath = path.relative(this._pluginsDir, pluginDir).replace(/\\/g, '/');
        if (!this._enabledPlugins.has(relPath)) {
            logToTerminal('info', `⏭️ 插件未启用，跳过: ${name}`);
            return;
        }

        if (this._plugins.has(name)) {
            logToTerminal('info', `⏭️ 插件已加载，跳过: ${name}`);
            return;
        }

        const isPython = lang === 'python';
        const resolvedMain = main !== 'index.js' ? main : (isPython ? 'index.py' : 'index.js');
        const mainPath = path.join(pluginDir, resolvedMain);

        if (!fs.existsSync(mainPath)) {
            throw new Error(`入口文件不存在: ${mainPath}`);
        }

        const context = new PluginContext(configKey, this._config, this, pluginDir);

        let plugin;
        if (isPython) {
            const { PythonPluginBridge } = require('./python-plugin-bridge.js');
            plugin = new PythonPluginBridge(metadata, context, mainPath);
        } else {
            let PluginClass;
            try {
                const mod = require(mainPath);
                PluginClass = mod.default || mod[Object.keys(mod)[0]] || mod;
            } catch (e) {
                throw new Error(`加载插件模块失败: ${e.message}`);
            }
            plugin = new PluginClass(metadata, context);
        }

        await plugin.onInit();

        this._plugins.set(name, { plugin, metadata, pluginDir });
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
     * 热重载插件（兼容 JS 和 Python 插件）
     * @param {string} name
     */
    async reload(name) {
        const entry = this._plugins.get(name);
        if (!entry) throw new Error(`插件不存在: ${name}`);

        const { pluginDir, metadata } = entry;

        await this.unload(name);

        if (metadata.lang !== 'python') {
            const mainPath = path.join(pluginDir, metadata.main || 'index.js');
            try { delete require.cache[require.resolve(mainPath)]; } catch {}
        }

        await this.load(pluginDir);
        const newEntry = this._plugins.get(name);
        if (newEntry) await newEntry.plugin.onStart();

        logToTerminal('info', `🔄 插件已热重载: ${name}`);
    }

    /**
     * 重载所有已加载的插件
     */
    async reloadAll() {
        const names = Array.from(this._plugins.keys());
        for (const name of names) {
            try {
                await this.reload(name);
            } catch (e) {
                logToTerminal('error', `❌ 热重载失败 (${name}): ${e.message}`);
            }
        }
    }

    /**
     * 同步 enabled_plugins.json 的变更：加载新启用的、卸载被禁用的
     */
    async syncEnabledPlugins() {
        logToTerminal('info', '🔄 检测到插件启用列表变更，开始同步...');

        this._loadEnabledList(true);

        const allDirs = this._scanAllPluginDirs();
        const enabledRelPaths = this._enabledPlugins;

        const currentlyLoaded = new Map();
        for (const [name, entry] of this._plugins) {
            const relPath = path.relative(this._pluginsDir, entry.pluginDir).replace(/\\/g, '/');
            currentlyLoaded.set(relPath, name);
        }

        // 卸载被禁用的插件
        for (const [relPath, name] of currentlyLoaded) {
            if (!enabledRelPaths.has(relPath)) {
                try {
                    await this.unload(name);
                    logToTerminal('info', `🔌 插件已因禁用而卸载: ${name}`);
                } catch (e) {
                    logToTerminal('error', `❌ 卸载插件失败 (${name}): ${e.message}`);
                }
            }
        }

        // 加载新启用的插件
        for (const relPath of enabledRelPaths) {
            if (currentlyLoaded.has(relPath)) continue;
            const pluginDir = allDirs.get(relPath);
            if (!pluginDir) continue;
            try {
                await this.load(pluginDir);
                const metaPath = path.join(pluginDir, 'metadata.json');
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                const newEntry = this._plugins.get(meta.name);
                if (newEntry) await newEntry.plugin.onStart();
                logToTerminal('info', `🔌 插件已因启用而加载: ${meta.name}`);
            } catch (e) {
                logToTerminal('error', `❌ 加载新启用插件失败 (${relPath}): ${e.message}`);
            }
        }

        logToTerminal('info', `🔌 插件同步完成，当前共 ${this._plugins.size} 个插件`);
    }

    /**
     * 获取所有插件信息列表（供 API 使用）
     */
    getPluginList() {
        const list = [];
        for (const [name, { metadata, pluginDir }] of this._plugins) {
            list.push({
                name,
                displayName: metadata.displayName || name,
                version: metadata.version || '?',
                lang: metadata.lang || 'js',
                dir: pluginDir,
            });
        }
        return list;
    }

    // ===== 文件监听（热加载）=====

    startWatching() {
        this._watchEnabledList();
        this._watchSourceFiles();
        logToTerminal('info', '👁️ 插件热加载监听已启动');
    }

    stopWatching() {
        if (this._enabledListWatcher) {
            this._enabledListWatcher.close();
            this._enabledListWatcher = null;
        }
        for (const w of this._sourceWatchers) {
            w.close();
        }
        this._sourceWatchers = [];
        clearTimeout(this._syncDebounceTimer);
        for (const t of this._reloadDebounceTimers.values()) clearTimeout(t);
        this._reloadDebounceTimers.clear();
        logToTerminal('info', '👁️ 插件热加载监听已停止');
    }

    /**
     * 监听 enabled_plugins.json，肥牛.exe 修改后自动同步
     */
    _watchEnabledList() {
        const listPath = path.join(this._pluginsDir, 'enabled_plugins.json');
        if (!fs.existsSync(listPath)) return;

        try {
            this._enabledListWatcher = fs.watch(listPath, () => {
                clearTimeout(this._syncDebounceTimer);
                this._syncDebounceTimer = setTimeout(() => {
                    this.syncEnabledPlugins().catch(e => {
                        logToTerminal('error', `❌ 同步插件启用列表失败: ${e.message}`);
                    });
                }, 500);
            });
        } catch (e) {
            logToTerminal('warn', `⚠️ 无法监听 enabled_plugins.json: ${e.message}`);
        }
    }

    /**
     * 监听插件源码文件变更，自动重载对应插件
     */
    _watchSourceFiles() {
        for (const baseDir of [this._builtinDir, this._communityDir]) {
            if (!fs.existsSync(baseDir)) continue;
            try {
                const watcher = fs.watch(baseDir, { recursive: true }, (eventType, filename) => {
                    if (!filename) return;
                    const ext = path.extname(filename).toLowerCase();
                    if (ext !== '.js' && ext !== '.py') return;

                    const parts = filename.replace(/\\/g, '/').split('/');
                    if (parts.length < 1) return;
                    const pluginFolderName = parts[0];

                    let targetName = null;
                    for (const [name, entry] of this._plugins) {
                        const dirBasename = path.basename(entry.pluginDir);
                        if (dirBasename === pluginFolderName) {
                            targetName = name;
                            break;
                        }
                    }
                    if (!targetName) return;

                    clearTimeout(this._reloadDebounceTimers.get(targetName));
                    this._reloadDebounceTimers.set(targetName, setTimeout(() => {
                        this._reloadDebounceTimers.delete(targetName);
                        logToTerminal('info', `👁️ 检测到源码变更: ${filename}，重载插件 ${targetName}`);
                        this.reload(targetName).catch(e => {
                            logToTerminal('error', `❌ 源码变更热重载失败 (${targetName}): ${e.message}`);
                        });
                    }, 500));
                });
                this._sourceWatchers.push(watcher);
            } catch (e) {
                logToTerminal('warn', `⚠️ 无法监听插件源码目录 (${baseDir}): ${e.message}`);
            }
        }
    }

    _findPluginDir(name) {
        const entry = this._plugins.get(name);
        if (entry) return entry.pluginDir;
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
