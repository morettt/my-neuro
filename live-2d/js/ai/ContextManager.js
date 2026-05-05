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

    // 保存对话历史 - 改用追加模式（JSONL格式）
    saveConversationHistory() {
        try {
            const recordsDir = path.join(__dirname, '..', '..', '..', 'AI记录室');
            const conversationHistoryPath = path.join(recordsDir, '对话历史.jsonl');

            // 确保AI记录室文件夹存在
            if (!fs.existsSync(recordsDir)) {
                fs.mkdirSync(recordsDir, { recursive: true });
            }

            // ⚠️ 核心修复：不要从 this.messages 中获取，而是直接对比 fullConversationHistory
            // 因为 this.messages 可能被 trimMessages 裁剪过

            // 🔥 修复：获取当前会话对话，包装工具调用信息为文本形式
            // 保存历史时将 assistant+tool_calls 转换为普通文本，兼容严格API
            // 注意：只保存 user 和 assistant 消息，不保存 system 和 tool 消息
            const currentSessionMessages = this.voiceChat.messages
                .map(msg => {
                    // 不保存 system 消息
                    if (msg.role === 'system') {
                        return null;
                    }
                    if (msg.role === 'assistant' && msg.tool_calls) {
                        // 包装工具调用为简洁文本形式
                        const toolDescriptions = msg.tool_calls.map(tc => {
                            const name = tc.function.name;
                            let args = '';
                            try {
                                const argsObj = JSON.parse(tc.function.arguments);
                                args = Object.entries(argsObj)
                                    .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 20 ? v.substring(0, 20) + '...' : v}`)
                                    .join(', ');
                            } catch (e) {
                                args = tc.function.arguments;
                            }
                            return `${name}(${args})`;
                        }).join('、');
                        
                        // 保留原有 content，添加工具调用标记
                        return {
                            role: 'assistant',
                            content: `[已调用工具：${toolDescriptions}]${msg.content ? ' ' + msg.content : ''}`
                        };
                    }
                    if (msg.role === 'tool') {
                        // 不保存 tool 响应消息（避免消息结构不完整）
                        return null;
                    }
                    return msg;
                })
                .filter(msg => msg !== null);

            // 🔧 修复逻辑：对比 fullConversationHistory，找出本次会话新增的消息
            const existingLength = this.voiceChat.fullConversationHistory.length;

            // 🆕 新逻辑：从当前内存消息中找出还没保存到 fullConversationHistory 的消息
            const newMessages = [];
            for (const msg of currentSessionMessages) {
                // 检查这条消息是否已经在 fullConversationHistory 中
                const isInHistory = this.voiceChat.fullConversationHistory.some(historyMsg => {
                    if (historyMsg.role !== msg.role) {
                        return false;
                    }

                    // 如果 content 都是 null，还需要比较 tool_calls
                    if (msg.content === null && historyMsg.content === null) {
                        // 比较 tool_calls 是否相同
                        const msgToolCalls = JSON.stringify(msg.tool_calls || []);
                        const historyToolCalls = JSON.stringify(historyMsg.tool_calls || []);
                        return msgToolCalls === historyToolCalls;
                    }

                    // 否则只比较 content
                    return historyMsg.content === msg.content;
                });

                if (!isInHistory) {
                    newMessages.push(msg);
                }
            }

            // 如果没有新消息，直接返回
            if (newMessages.length === 0) {
                console.log('没有新消息需要保存');
                return;
            }

            // 📝 逐行追加新消息到 JSONL 文件
            for (const msg of newMessages) {
                const line = JSON.stringify(msg) + '\n';
                fs.appendFileSync(conversationHistoryPath, line, 'utf8');
            }

            // 更新完整历史记录供下次使用
            this.voiceChat.fullConversationHistory.push(...newMessages);

            console.log(`对话历史已追加，新增 ${newMessages.length} 条消息，总计 ${this.voiceChat.fullConversationHistory.length} 条`);
        } catch (error) {
            console.error('保存对话历史失败:', error);
        }
    }
}

module.exports = { ContextManager };
