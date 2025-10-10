// ContextManager.js - 上下文管理模块
const fs = require('fs');
const path = require('path');

class ContextManager {
    constructor(voiceChatInterface) {
        this.voiceChat = voiceChatInterface;
        this.enableContextLimit = voiceChatInterface.enableContextLimit;
        this.maxContextMessages = voiceChatInterface.maxContextMessages;
    }

    // 设置上下文限制
    setContextLimit(enable) {
        this.enableContextLimit = enable;
        this.voiceChat.enableContextLimit = enable;
        if (enable) {
            this.trimMessages();
        }
    }

    // 设置最大上下文消息数
    setMaxContextMessages(count) {
        if (count < 1) throw new Error('最大消息数不能小于1');
        this.maxContextMessages = count;
        this.voiceChat.maxContextMessages = count;
        if (this.enableContextLimit) {
            this.trimMessages();
        }
    }

    // 裁剪消息
    trimMessages() {
        if (!this.enableContextLimit) {
            console.log('上下文限制已禁用，不裁剪消息');
            return;
        }

        const systemMessages = this.voiceChat.messages.filter(msg => msg.role === 'system');
        const nonSystemMessages = this.voiceChat.messages.filter(msg => msg.role !== 'system');

        console.log(`裁剪前: 系统消息 ${systemMessages.length} 条, 非系统消息 ${nonSystemMessages.length} 条`);

        const recentMessages = nonSystemMessages.slice(-this.maxContextMessages);
        this.voiceChat.messages = [...systemMessages, ...recentMessages];

        console.log(`裁剪后: 消息总数 ${this.voiceChat.messages.length} 条, 非系统消息 ${recentMessages.length} 条`);
    }

    // 保存对话历史
    saveConversationHistory() {
        try {
            const recordsDir = path.join(__dirname, '..', '..', 'AI记录室');
            const conversationHistoryPath = path.join(recordsDir, '对话历史.json');

            // 确保AI记录室文件夹存在
            if (!fs.existsSync(recordsDir)) {
                fs.mkdirSync(recordsDir, { recursive: true });
            }

            // 获取当前会话的所有对话（不包括系统消息）
            const currentSessionMessages = this.voiceChat.messages.filter(msg =>
                msg.role === 'user' || msg.role === 'assistant'
            );

            // 修复：无论persistent_history设置如何，都要保存完整历史
            // 先合并之前保存的历史和当前新增的消息
            let completeHistory = [...this.voiceChat.fullConversationHistory];

            // 找出真正新增的消息（不在fullConversationHistory中的）
            const existingLength = this.voiceChat.fullConversationHistory.length;
            const newMessages = currentSessionMessages.slice(existingLength);

            // 将新消息添加到完整历史中
            completeHistory = [...completeHistory, ...newMessages];

            // 更新完整历史记录供下次使用
            this.voiceChat.fullConversationHistory = completeHistory;

            fs.writeFileSync(
                conversationHistoryPath,
                JSON.stringify(completeHistory, null, 2),
                'utf8'
            );

            console.log(`对话历史已保存，共 ${completeHistory.length} 条消息`);
        } catch (error) {
            console.error('保存对话历史失败:', error);
        }
    }
}

module.exports = { ContextManager };
