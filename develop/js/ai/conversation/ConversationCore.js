// ConversationCore.js - 核心对话管理
const { appState } = require('../../core/app-state.js');

/**
 * 负责管理消息数组和系统提示词
 */
class ConversationCore {
    constructor(systemPrompt, conversationHistory, config) {
        this.config = config;

        // 初始化消息数组：系统消息 + AI可见的历史对话
        this.messages = [
            {
                role: 'system',
                content: systemPrompt
            },
            ...conversationHistory
        ];

        // 上下文限制相关
        this.maxContextMessages = config.context.max_messages;
        this.enableContextLimit = config.context.enable_limit;

        // 完整对话历史（用于保存）
        this.fullConversationHistory = [];

        console.log(`对话上下文已初始化，包含 ${this.messages.length} 条消息`);
    }

    /**
     * 添加用户消息
     */
    addUserMessage(content) {
        this.messages.push({ role: 'user', content: content });
    }

    /**
     * 添加助手消息
     */
    addAssistantMessage(content) {
        this.messages.push({ role: 'assistant', content: content });
    }

    /**
     * 添加工具调用消息
     */
    addToolCallMessage(toolCalls) {
        this.messages.push({
            role: 'assistant',
            content: null,
            tool_calls: toolCalls
        });
    }

    /**
     * 添加工具结果消息
     */
    addToolResultMessage(content, toolCallId) {
        this.messages.push({
            role: 'tool',
            content: content,
            tool_call_id: toolCallId
        });
    }

    /**
     * 获取消息数组
     */
    getMessages() {
        return this.messages;
    }

    /**
     * 获取消息数组的副本（用于API调用）
     */
    getMessagesCopy() {
        return JSON.parse(JSON.stringify(this.messages));
    }

    /**
     * 增强系统提示词（用于弹幕功能）
     */
    enhanceSystemPrompt() {
        // 只有启用直播功能时才添加提示词
        if (!this.config || !this.config.bilibili || !this.config.bilibili.enabled) {
            return;
        }

        if (this.messages && this.messages.length > 0 && this.messages[0].role === 'system') {
            const originalPrompt = this.messages[0].content;

            if (!originalPrompt.includes('你可能会收到直播弹幕')) {
                const enhancedPrompt = originalPrompt + "\n\n你可能会收到直播弹幕消息，这些消息会被标记为[弹幕]，表示这是来自直播间观众的消息，而不是主人直接对你说的话。当你看到[弹幕]标记时，你应该知道这是其他人发送的，但你仍然可以回应，就像在直播间与观众互动一样。";
                this.messages[0].content = enhancedPrompt;
                console.log('系统提示已增强，添加了直播弹幕相关说明');
            }
        }
    }

    /**
     * 设置完整对话历史
     */
    setFullConversationHistory(history) {
        this.fullConversationHistory = history;
    }

    /**
     * 获取完整对话历史
     */
    getFullConversationHistory() {
        return this.fullConversationHistory;
    }
}

module.exports = { ConversationCore };
