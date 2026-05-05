// ContextManager.js - 上下文管理模块
const fs = require('fs');
const path = require('path');

class ContextManager {
    constructor(voiceChatInterface) {
        this.voiceChat = voiceChatInterface;
        this.enableContextLimit = voiceChatInterface.enableContextLimit;
        this.maxContextMessages = voiceChatInterface.maxContextMessages;
        this.maxRounds = voiceChatInterface.maxRounds || 10;
    }

    // 设置上下文限制
    setContextLimit(enable) {
        this.enableContextLimit = enable;
        this.voiceChat.enableContextLimit = enable;
        if (enable) {
            this.trimMessages();
        }
    }

    // 设置最大上下文消息数（兜底）
    setMaxContextMessages(count) {
        if (count < 1) throw new Error('最大消息数不能小于1');
        this.maxContextMessages = count;
        this.voiceChat.maxContextMessages = count;
        if (this.enableContextLimit) {
            this.trimMessages();
        }
    }

    // 设置最大轮数（优先）
    setMaxRounds(count) {
        if (count < 1) throw new Error('最大轮数不能小于1');
        this.maxRounds = count;
        this.voiceChat.maxRounds = count;
        if (this.enableContextLimit) {
            this.trimMessages();
        }
    }

    /**
     * 按轮分组（方案B：完整工具调用链视为一轮）
     * 一轮 = 从 user 开始，包含完整的工具调用链
     */
    groupIntoRounds(messages) {
        const rounds = [];
        let currentRound = [];
        let pendingToolCalls = new Set();

        for (const msg of messages) {
            // 新一轮开始：user消息 + 当前轮已有内容 + 无待响应工具
            if (msg.role === 'user' && currentRound.length > 0 && pendingToolCalls.size === 0) {
                rounds.push(currentRound);
                currentRound = [];
            }

            currentRound.push(msg);

            // 记录待响应的tool_calls
            if (msg.role === 'assistant' && msg.tool_calls) {
                msg.tool_calls.forEach(tc => pendingToolCalls.add(tc.id));
            }

            // 移除已响应的tool_calls
            if (msg.role === 'tool') {
                pendingToolCalls.delete(msg.tool_call_id);
            }
        }

        // 最后一轮
        if (currentRound.length > 0) {
            rounds.push(currentRound);
        }

        return rounds;
    }

    /**
     * 清理孤立消息（保险）
     * 移除没有对应 assistant+tool_calls 的 tool 消息
     */
    cleanupIsolatedToolMessages(messages) {
        const toolCallIds = new Set();

        // 收集所有 tool_call_ids
        for (const msg of messages) {
            if (msg.role === 'assistant' && msg.tool_calls) {
                msg.tool_calls.forEach(tc => toolCallIds.add(tc.id));
            }
        }

        // 过滤孤立的 tool 消息
        return messages.filter(msg => {
            if (msg.role === 'tool' && !toolCallIds.has(msg.tool_call_id)) {
                console.log(`[保险] 移除孤立tool响应: ${msg.tool_call_id}`);
                return false;
            }
            return true;
        });
    }

    /**
     * 裁剪消息（按轮优先 + 条数兜底）
     * 优先保证轮完整性，再用 max_messages 作为上限保险
     */
    trimMessages() {
        if (!this.enableContextLimit) {
            console.log('上下文限制已禁用，不裁剪消息');
            return;
        }

        const systemMessages = this.voiceChat.messages.filter(msg => msg.role === 'system');
        const nonSystemMessages = this.voiceChat.messages.filter(msg => msg.role !== 'system');

        console.log(`裁剪前: 系统消息 ${systemMessages.length} 条, 非系统消息 ${nonSystemMessages.length} 条`);

        // 🔥 步骤1：按轮分组
        const rounds = this.groupIntoRounds(nonSystemMessages);
        const maxRounds = this.maxRounds || 10;

        // 🔥 步骤2：保留最近 maxRounds 轮
        let recentRounds = rounds.slice(-maxRounds);
        let trimmedMessages = recentRounds.flat();

        // 🔥 步骤3：max_messages 兜底检查
        // 如果轮裁剪后仍超过 max_messages，按条数裁剪（但会尝试保证完整性）
        const maxMessages = this.maxContextMessages || 100;
        if (trimmedMessages.length > maxMessages) {
            console.log(`[兜底] 轮裁剪后 ${trimmedMessages.length} 条 > max_messages ${maxMessages}，执行条数裁剪`);
            
            // 从后向前裁剪，尽量保证完整性
            const safeTrimmed = this.trimByMessageCount(trimmedMessages, maxMessages);
            trimmedMessages = safeTrimmed;
            
            // 更新 recentRounds 计数（用于日志）
            recentRounds = this.groupIntoRounds(trimmedMessages);
        }

        // 🔥 步骤4：清理孤立消息（保险）
        const cleanedMessages = this.cleanupIsolatedToolMessages(trimmedMessages);

        this.voiceChat.messages = [...systemMessages, ...cleanedMessages];

        console.log(`裁剪后: 消息总数 ${this.voiceChat.messages.length} 条, 保留 ${recentRounds.length} 轮`);
    }

    /**
     * 按条数裁剪（兜底逻辑）
     * 从后向前裁剪，尽量保证不切断 tool 调用链
     */
    trimByMessageCount(messages, maxCount) {
        if (messages.length <= maxCount) {
            return messages;
        }

        const result = [];
        let i = messages.length - 1;
        let count = 0;

        while (i >= 0 && count < maxCount) {
            const msg = messages[i];
            result.unshift(msg);
            count++;

            // 如果是 tool 消息，尝试包含完整的调用链
            if (msg.role === 'tool') {
                // 向前查找对应的 assistant+tool_calls
                let j = i - 1;
                while (j >= 0) {
                    const prevMsg = messages[j];
                    if (prevMsg.role === 'assistant' && prevMsg.tool_calls) {
                        // 检查是否包含这个 tool_call_id
                        const hasThisToolCall = prevMsg.tool_calls.some(tc => tc.id === msg.tool_call_id);
                        if (hasThisToolCall) {
                            // 如果还没加入，就加入
                            if (!result.includes(prevMsg)) {
                                result.unshift(prevMsg);
                                count++;
                            }
                            break;
                        }
                    }
                    if (prevMsg.role === 'user') break;
                    j--;
                }
            }

            i--;
        }

        return result;
    }

    // 保存对话历史 - 改用追加模式（JSONL格式）
    saveConversationHistory() {
        try {
            const recordsDir = path.join(__dirname, '..', '..', '..', 'AI记录室');
            const conversationHistoryPath = path.join(recordsDir, '对话历史.jsonl');

            if (!fs.existsSync(recordsDir)) {
                fs.mkdirSync(recordsDir, { recursive: true });
            }

            const currentSessionMessages = this.voiceChat.messages
                .map(msg => {
                    if (msg.role === 'system') {
                        return null;
                    }
                    if (msg.role === 'assistant' && msg.tool_calls) {
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
                        
                        return {
                            role: 'assistant',
                            content: `[已调用工具：${toolDescriptions}]${msg.content ? ' ' + msg.content : ''}`
                        };
                    }
                    if (msg.role === 'tool') {
                        return null;
                    }
                    return msg;
                })
                .filter(msg => msg !== null);

            const newMessages = [];
            for (const msg of currentSessionMessages) {
                const isInHistory = this.voiceChat.fullConversationHistory.some(historyMsg => {
                    if (historyMsg.role !== msg.role) return false;
                    if (msg.content === null && historyMsg.content === null) {
                        const msgToolCalls = JSON.stringify(msg.tool_calls || []);
                        const historyToolCalls = JSON.stringify(historyMsg.tool_calls || []);
                        return msgToolCalls === historyToolCalls;
                    }
                    return historyMsg.content === msg.content;
                });

                if (!isInHistory) {
                    newMessages.push(msg);
                }
            }

            if (newMessages.length === 0) {
                console.log('没有新消息需要保存');
                return;
            }

            for (const msg of newMessages) {
                const line = JSON.stringify(msg) + '\n';
                fs.appendFileSync(conversationHistoryPath, line, 'utf8');
            }

            this.voiceChat.fullConversationHistory.push(...newMessages);
            console.log(`对话历史已追加，新增 ${newMessages.length} 条消息，总计 ${this.voiceChat.fullConversationHistory.length} 条`);
        } catch (error) {
            console.error('保存对话历史失败:', error);
        }
    }
}

module.exports = { ContextManager };