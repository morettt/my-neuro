// message-event.js - 消息事件对象
// 流经 Hook 插件的消息载体

class MessageEvent {
    /**
     * @param {string} text - 消息文本
     * @param {string} source - 'voice' | 'text' | 'barrage' | 'auto' | 'mood'
     * @param {object} metadata - 附加信息
     */
    constructor(text, source, metadata = {}) {
        this.text = text;
        this.source = source;
        this.metadata = metadata;

        this._stopped = false;       // stopPropagation 标志
        this._defaultPrevented = false; // preventDefault 标志
        this._contextAdditions = []; // addContext 积累的文本
    }

    // ===== 控制 =====

    /** 阻止后续插件处理 */
    stopPropagation() {
        this._stopped = true;
    }

    /** 阻止消息发给 LLM（插件自己处理） */
    preventDefault() {
        this._defaultPrevented = true;
    }

    // ===== 修改 =====

    /** 修改消息文本 */
    setText(text) {
        this.text = text;
    }

    /**
     * 为本次 LLM 请求追加额外上下文
     * 这些内容会附加在用户消息之后，发给 LLM 但不存入对话历史
     * @param {string} text
     */
    addContext(text) {
        this._contextAdditions.push(text);
    }

    /** 获取所有追加的上下文（供 InputRouter 使用）*/
    getContextAdditions() {
        return this._contextAdditions;
    }
}

module.exports = { MessageEvent };
