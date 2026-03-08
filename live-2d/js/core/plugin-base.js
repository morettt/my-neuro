// plugin-base.js - 插件基类
// 所有插件都应继承此类，并实现需要的生命周期方法

class Plugin {
    /**
     * @param {object} metadata - metadata.json 中的内容
     * @param {PluginContext} context - 插件上下文实例
     */
    constructor(metadata, context) {
        this.metadata = metadata;
        this.context = context;
    }

    // ===== 生命周期（全部可选）=====

    /** 插件加载后，context 已可用 */
    async onInit() {}

    /** 应用就绪后 */
    async onStart() {}

    /** 应用关闭前 */
    async onStop() {}

    /** 插件被卸载 */
    async onDestroy() {}

    // ===== 消息流钩子（Hook Plugin）=====

    /**
     * 用户消息到达，发给 LLM 之前
     * @param {MessageEvent} event
     */
    async onUserInput(event) {}

    /**
     * 即将调用 LLM，可修改 request
     * @param {object} request - { messages, tools }
     */
    async onLLMRequest(request) {}

    /**
     * LLM 回复后，TTS 之前
     * @param {object} response - { text }
     */
    async onLLMResponse(response) {}

    /**
     * TTS 文本处理阶段，可修改最终送入 TTS 的文本（字幕不受影响）
     * @param {string} text - 当前文本段
     * @returns {Promise<string>} 返回修改后的文本
     */
    async onTTSText(text) { return text; }

    /**
     * TTS 开始播放
     * @param {string} text
     */
    async onTTSStart(text) {}

    /** TTS 播放结束 */
    async onTTSEnd() {}

    // ===== 工具注册（Tool Plugin）=====

    /**
     * 返回本插件提供的工具列表（OpenAI function calling 格式）
     * @returns {Array}
     */
    getTools() {
        return [];
    }

    /**
     * 执行工具调用
     * @param {string} name - 工具名
     * @param {object} params - 工具参数
     * @returns {Promise<string>} 工具执行结果
     */
    async executeTool(name, params) {}
}

module.exports = { Plugin };
