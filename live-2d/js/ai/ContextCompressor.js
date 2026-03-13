// ContextCompressor.js - 异步上下文压缩模块
const { logToTerminal } = require('../api-utils.js');
const { llmProviderManager } = require('../core/llm-provider.js');

class ContextCompressor {
    constructor(voiceChatInterface, config) {
        this.voiceChat = voiceChatInterface;
        this.config = config;

        // 压缩配置
        this.compressionConfig = config.context?.compression || {};
        this.enabled = this.compressionConfig.enabled || false;
        this.triggerThreshold = this.compressionConfig.trigger_threshold || 15;
        this.keepRecent = this.compressionConfig.keep_recent || 4;
        this.compressionPrompt = this.compressionConfig.prompt || '请将以下历史对话总结为简洁的要点，保留关键信息和上下文。';

        // 压缩状态
        this.isCompressing = false; // 防止并发压缩

        if (this.enabled) {
            console.log('✅ 上下文压缩已启用');
            logToTerminal('info', `✅ 上下文压缩已启用 - 触发阈值: ${this.triggerThreshold}条消息, 压缩至: ${this.compressTo}条`);
        }
    }

    /**
     * 检查并异步压缩上下文（不阻塞对话）
     * 这个方法在每次对话后调用，但不await它
     */
    async checkAndCompressAsync() {
        // 如果未启用压缩，直接返回
        if (!this.enabled) {
            return;
        }

        // 如果正在压缩中，跳过
        if (this.isCompressing) {
            console.log('⏳ 上下文压缩正在进行中，跳过本次检查');
            return;
        }

        // 获取当前消息数量
        const messageCount = this.voiceChat.messages.length;

        // 检查是否达到触发阈值
        if (messageCount < this.triggerThreshold) {
            console.log(`📊 当前消息数: ${messageCount}, 未达到压缩阈值: ${this.triggerThreshold}`);
            return;
        }

        console.log(`🔔 触发上下文压缩 - 当前消息数: ${messageCount}, 阈值: ${this.triggerThreshold}`);
        logToTerminal('info', `🔔 触发上下文压缩 - 当前 ${messageCount} 条消息`);

        // 异步执行压缩，使用 .catch() 防止未捕获异常
        this.performCompressionAsync().catch(error => {
            console.error('❌ 异步上下文压缩失败:', error);
            logToTerminal('error', `❌ 异步上下文压缩失败: ${error.message}`);
        });
    }

    /**
     * 执行实际的压缩操作（异步，不阻塞）
     */
    async performCompressionAsync() {
        this.isCompressing = true;

        try {
            const startTime = Date.now();
            console.log('🚀 开始异步压缩上下文...');

            // 1. 分离消息：保留 system 消息 + 保留最近的对话 + 压缩旧对话
            const messages = this.voiceChat.messages;
            const totalMessages = messages.length;

            // 🔧 修复：分离 system 消息和非 system 消息
            const systemMessages = messages.filter(msg => msg.role === 'system');
            const nonSystemMessages = messages.filter(msg => msg.role !== 'system');

            console.log(`📦 消息分类 - 总数: ${totalMessages}, system消息: ${systemMessages.length}, 对话消息: ${nonSystemMessages.length}`);

            // 🔧 修复：区分初始 system 和历史总结 system
            // 初始 system: 不包含 "[历史对话总结]" 标记的
            const initialSystemMessages = systemMessages.filter(msg =>
                !msg.content.includes('[历史对话总结]')
            );

            // 历史总结 system: 包含 "[历史对话总结]" 标记的
            const historySummaryMessages = systemMessages.filter(msg =>
                msg.content.includes('[历史对话总结]')
            );

            console.log(`📦 初始system消息: ${initialSystemMessages.length}条, 历史总结: ${historySummaryMessages.length}条`);

            // 保留最近的 keepRecent 轮对话（每轮包含用户+AI）
            const recentCount = this.keepRecent * 2;
            const recentMessages = nonSystemMessages.slice(-recentCount);

            // 需要压缩的旧消息（只包含非 system 消息）
            const oldMessages = nonSystemMessages.slice(0, -recentCount);

            if (oldMessages.length === 0) {
                console.log('⚠️ 没有需要压缩的旧对话');
                return;
            }

            console.log(`📦 对话分离 - 旧对话: ${oldMessages.length}条, 保留最近: ${recentMessages.length}条`);

            // 2. 调用LLM压缩旧消息（如果存在历史总结，一并传入做累积总结）
            const previousSummary = historySummaryMessages.length > 0
                ? historySummaryMessages[0].content.replace('[历史对话总结] ', '')
                : null;

            const compressedSummary = await this.compressMessages(oldMessages, previousSummary);

            if (!compressedSummary || !compressedSummary.trim()) {
                console.log('⚠️ LLM压缩返回空结果，取消压缩');
                return;
            }

            // 3. 构建新的消息数组
            // 🔧 修复：只保留初始 system + 新的压缩总结 system（替换旧总结）
            const newMessages = [
                ...initialSystemMessages,  // 只保留初始 system 消息
                {
                    role: 'system',
                    content: `[历史对话总结] ${compressedSummary.trim()}`
                },
                ...recentMessages
            ];

            // 4. 替换 voiceChat.messages
            this.voiceChat.messages.length = 0; // 清空数组
            this.voiceChat.messages.push(...newMessages);

            const endTime = Date.now();
            const duration = endTime - startTime;

            console.log(`✅ 上下文压缩完成 - 用时: ${duration}ms`);
            console.log(`📊 压缩前: ${totalMessages}条 → 压缩后: ${this.voiceChat.messages.length}条`);
            logToTerminal('info', `✅ 上下文压缩完成 - ${totalMessages}条 → ${this.voiceChat.messages.length}条 (${duration}ms)`);

        } catch (error) {
            console.error('❌ 压缩执行失败:', error);
            logToTerminal('error', `❌ 压缩执行失败: ${error.message}`);
            throw error;
        } finally {
            this.isCompressing = false;
        }
    }

    /**
     * 调用LLM压缩多条消息
     * @param {Array} messages - 需要压缩的对话消息
     * @param {String|null} previousSummary - 上一次的历史总结（如果有）
     */
    async compressMessages(messages, previousSummary = null) {
        try {
            // 构建对话文本
            const conversationText = messages.map(msg => {
                if (msg.role === 'user') {
                    return `用户: ${this.extractTextContent(msg.content)}`;
                } else if (msg.role === 'assistant') {
                    return `AI: ${this.extractTextContent(msg.content)}`;
                } else if (msg.role === 'system') {
                    return `系统: ${this.extractTextContent(msg.content)}`;
                }
                return '';
            }).filter(text => text).join('\n');

            // 🔧 修复：如果有历史总结，加入到压缩提示中做累积总结
            let compressPrompt;
            if (previousSummary) {
                compressPrompt = `${this.compressionPrompt}

【之前的历史总结】：
${previousSummary}

【本次新增的对话内容】：
${conversationText}

请将之前的历史总结与本次新对话合并，生成一个完整的累积总结：`;
            } else {
                compressPrompt = `${this.compressionPrompt}

对话内容：
${conversationText}

总结：`;
            }

            console.log('🤖 调用LLM进行上下文压缩...');

            const resolvedProvider = llmProviderManager.resolveProviderOrFallback(
                this.config.llm?.provider_id || null,
                this.config.llm || null,
                this.config.llm?.model_id || this.config.llm?.model || null
            );
            if (!resolvedProvider) {
                throw new Error('No LLM provider available for context compression');
            }

            const response = await fetch(`${resolvedProvider.api_url}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${resolvedProvider.api_key}`
                },
                body: JSON.stringify({
                    model: resolvedProvider.model,
                    messages: [{
                        role: 'user',
                        content: compressPrompt
                    }],
                    stream: false,
                    max_tokens: 500 // 限制总结长度
                })
            });

            if (!response.ok) {
                throw new Error(`LLM API请求失败: ${response.status}`);
            }

            const data = await response.json();
            const summary = data.choices[0].message.content;

            console.log('✅ LLM压缩完成，总结长度:', summary.length);
            return summary;

        } catch (error) {
            console.error('❌ LLM压缩调用失败:', error);
            throw error;
        }
    }

    /**
     * 提取消息的文本内容（处理多模态消息）
     */
    extractTextContent(content) {
        if (typeof content === 'string') {
            return content;
        }

        // 如果是数组（多模态消息，如图片+文本）
        if (Array.isArray(content)) {
            const textParts = content
                .filter(part => part.type === 'text')
                .map(part => part.text);
            return textParts.join(' ');
        }

        return '';
    }

    /**
     * 手动触发压缩（用于测试或特殊情况）
     */
    async manualCompress() {
        console.log('🔧 手动触发上下文压缩');
        logToTerminal('info', '🔧 手动触发上下文压缩');

        await this.performCompressionAsync();
    }

    /**
     * 获取压缩器状态
     */
    getStatus() {
        return {
            enabled: this.enabled,
            isCompressing: this.isCompressing,
            currentMessages: this.voiceChat.messages.length,
            triggerThreshold: this.triggerThreshold
        };
    }
}

module.exports = { ContextCompressor };
