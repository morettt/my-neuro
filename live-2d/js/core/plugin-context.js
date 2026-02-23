// plugin-context.js - 插件上下文
// 每个插件通过此对象访问核心能力，实现安全隔离

const { eventBus } = require('./event-bus.js');

class PluginStorage {
    constructor(pluginName) {
        this._data = {};
        this._name = pluginName;
    }

    get(key) {
        return this._data[key];
    }

    set(key, value) {
        this._data[key] = value;
    }

    delete(key) {
        delete this._data[key];
    }

    getAll() {
        return { ...this._data };
    }
}

class PluginContext {
    /**
     * @param {string} pluginName - 插件名称
     * @param {object} config - 全局 config.json
     * @param {object} pluginManager - PluginManager 实例（用于插件间通信）
     */
    constructor(pluginName, config, pluginManager) {
        this._pluginName = pluginName;
        this._config = config;
        this._pluginManager = pluginManager;
        this._systemPromptPatches = new Map();

        /** 每插件独立的持久化存储（内存版，可扩展为文件）*/
        this.storage = new PluginStorage(pluginName);
    }

    // ===== 对话 =====

    /** 获取当前对话历史 */
    getMessages() {
        const voiceChat = global.voiceChat;
        if (!voiceChat) return [];
        return voiceChat.messages || [];
    }

    /**
     * 注入系统提示词片段（幂等，可多次调用）
     * @param {string} id - 唯一标识，用于后续移除
     * @param {string} text - 要注入的文本
     */
    addSystemPromptPatch(id, text) {
        this._systemPromptPatches.set(id, text);
        this._applySystemPromptPatches();
    }

    /**
     * 移除已注入的系统提示词片段
     * @param {string} id
     */
    removeSystemPromptPatch(id) {
        this._systemPromptPatches.delete(id);
        this._applySystemPromptPatches();
    }

    _applySystemPromptPatches() {
        const voiceChat = global.voiceChat;
        if (!voiceChat || !voiceChat.messages) return;

        // 找到系统消息并追加 patch 标记
        // 使用一个约定的标记区间来识别插件注入内容
        const patches = Array.from(this._systemPromptPatches.values());
        const patchText = patches.length > 0
            ? '\n\n--- Plugin Injections ---\n' + patches.join('\n') + '\n--- End Plugin Injections ---'
            : '';

        const sys = voiceChat.messages.find(m => m.role === 'system');
        if (sys) {
            // 移除旧的注入，追加新的
            const base = (sys._baseContent !== undefined) ? sys._baseContent : sys.content;
            sys._baseContent = base;
            sys.content = base + patchText;
        }
    }

    // ===== LLM =====

    /**
     * 插件自己调用 LLM（独立请求，不进入对话历史）
     * @param {string} prompt
     * @param {object} options - { model, temperature, ... }
     * @returns {Promise<string>}
     */
    async callLLM(prompt, options = {}) {
        const voiceChat = global.voiceChat;
        if (!voiceChat) throw new Error('LLM not available');

        const response = await fetch(`${voiceChat.API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${voiceChat.API_KEY}`
            },
            body: JSON.stringify({
                model: options.model || voiceChat.MODEL,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                temperature: options.temperature || 1.0,
                ...options
            })
        });

        if (!response.ok) throw new Error(`LLM API error: ${response.status}`);
        const data = await response.json();
        return data.choices[0].message.content;
    }

    // ===== 事件 =====

    on(event, handler) {
        eventBus.on(event, handler);
    }

    off(event, handler) {
        eventBus.off(event, handler);
    }

    emit(event, data) {
        eventBus.emit(event, data);
    }

    // ===== UI =====

    /**
     * 显示字幕
     * @param {string} text
     * @param {number} duration - 毫秒
     */
    showSubtitle(text, duration) {
        if (global.showSubtitle) global.showSubtitle(text, duration);
    }

    /**
     * 触发 Live2D 情绪动作
     * @param {string} emotion
     */
    triggerEmotion(emotion) {
        if (global.currentModel && global.currentModel.triggerEmotion) {
            global.currentModel.triggerEmotion(emotion);
        }
    }

    /**
     * 让 AI 主动说一句话（走完整 TTS 流程）
     * @param {string} text
     */
    async sendMessage(text) {
        const voiceChat = global.voiceChat;
        if (!voiceChat) return;
        await voiceChat.sendToLLM(text);
    }

    // ===== 配置 =====

    /** 获取整个 config.json */
    getConfig() {
        return this._config;
    }

    /** 获取本插件在 config.plugins.<name> 下的配置块 */
    getPluginConfig() {
        return (this._config.plugins && this._config.plugins[this._pluginName]) || {};
    }

    // ===== 插件间通信 =====

    /**
     * 获取另一个插件的实例（公开 API）
     * @param {string} name
     * @returns {Plugin|null}
     */
    getPlugin(name) {
        return this._pluginManager ? this._pluginManager.getPlugin(name) : null;
    }

    /**
     * 动态注册工具（适合运行时确定工具列表的插件）
     * @param {object} toolDef - OpenAI function calling 格式
     */
    registerTool(toolDef) {
        if (this._pluginManager) {
            this._pluginManager.registerDynamicTool(this._pluginName, toolDef);
        }
    }

    // ===== 日志 =====

    log(level, message) {
        const { logToTerminal } = require('../api-utils.js');
        logToTerminal(level, `[Plugin:${this._pluginName}] ${message}`);
    }
}

module.exports = { PluginContext };
