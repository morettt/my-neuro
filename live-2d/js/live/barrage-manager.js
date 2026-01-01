// barrage-manager.js - 弹幕队列管理模块
const { logToTerminal, getMergedToolsList } = require('../api-utils.js');
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');
const { appState } = require('../core/app-state.js');
const { LLMClient } = require('../ai/llm-client.js');
const { toolExecutor } = require('../ai/tool-executor.js');

class BarrageManager {
    constructor(config) {
        this.config = config;
        this.normalQueue = [];      // 普通弹幕队列
        this.priorityQueue = [];    // 优先队列（保留，暂未使用）
        this.isProcessing = false;
        this.interruptFlag = false; // 打断标志
        this.llmClient = new LLMClient(config);

        // 依赖的外部服务
        this.voiceChat = null;
        this.ttsProcessor = null;
        this.showSubtitle = null;
        this.hideSubtitle = null;

        // 启动队列处理循环
        this.startQueueProcessor();
    }

    // 设置依赖服务
    setDependencies(dependencies) {
        this.voiceChat = dependencies.voiceChat;
        this.ttsProcessor = dependencies.ttsProcessor;
        this.showSubtitle = dependencies.showSubtitle;
        this.hideSubtitle = dependencies.hideSubtitle;
    }

    // 添加弹幕到队列
    addToQueue(nickname, text) {
        this.normalQueue.push({ nickname, text });
        console.log(`弹幕入队: ${nickname}: ${text} (队列长度: ${this.normalQueue.length})`);
        logToTerminal('info', `弹幕入队: ${nickname}: ${text}`);
        // 不再手动调用processNext，由队列处理循环自动处理
    }

    // 清空弹幕队列（用于用户输入打断）
    clearNormalQueue() {
        const cleared = this.normalQueue.length;
        this.normalQueue = [];
        if (cleared > 0) {
            console.log(`清空了${cleared}条未处理的弹幕`);
            logToTerminal('info', `清空了${cleared}条未处理的弹幕`);
        }
    }

    // 设置打断标志
    setInterrupt() {
        this.interruptFlag = true;
        console.log('设置弹幕处理打断标志');
    }

    // 队列处理循环（类似Python的process_queue_thread）
    startQueueProcessor() {
        const processLoop = async () => {
            while (true) {
                // 等待100ms
                await new Promise(resolve => setTimeout(resolve, 100));

                // 如果正在处理，跳过本次循环
                if (this.isProcessing) {
                    continue;
                }

                // 队列为空，跳过本次循环
                if (this.normalQueue.length === 0) {
                    continue;
                }

                // 检查是否被打断
                if (this.interruptFlag) {
                    console.log('弹幕处理被打断');
                    this.interruptFlag = false;
                    this.isProcessing = false;
                    eventBus.emit(Events.BARRAGE_END);
                    continue;
                }

                // 取出队列头部的弹幕
                const barrage = this.normalQueue.shift();
                this.isProcessing = true;

                // 发送弹幕处理开始事件
                eventBus.emit(Events.BARRAGE_START);

                try {
                    console.log(`处理弹幕: ${barrage.nickname}: ${barrage.text}`);
                    logToTerminal('info', `处理弹幕: ${barrage.nickname}: ${barrage.text}`);

                    // 执行弹幕消息处理
                    await this.executeBarrage(barrage.nickname, barrage.text);

                    // 发送交互更新事件
                    eventBus.emit(Events.INTERACTION_UPDATED);

                } catch (error) {
                    console.error('弹幕处理失败:', error.message);
                    logToTerminal('error', `弹幕处理失败: ${error.message}`);

                    // 恢复ASR录音
                    const asrEnabled = this.config.asr?.enabled !== false;
                    if (this.voiceChat?.asrProcessor && asrEnabled) {
                        this.voiceChat.asrProcessor.resumeRecording();
                    }
                }

                this.isProcessing = false;
                eventBus.emit(Events.BARRAGE_END);
            }
        };

        // 启动处理循环
        processLoop();
    }

    // 执行弹幕处理
    async executeBarrage(nickname, text) {
        if (!this.voiceChat) {
            throw new Error('VoiceChat未初始化');
        }

        // 重置AI日记定时器
        if (this.voiceChat.resetDiaryTimer) {
            this.voiceChat.resetDiaryTimer();
        }

        // 增强系统提示词（只做一次）
        this.enhanceSystemPrompt();

        // 添加用户消息
        this.voiceChat.messages.push({
            role: 'user',
            content: `[接收到了直播间的弹幕] ${nickname}给你发送了一个消息: ${text}`
        });

        // 限制上下文
        if (this.voiceChat.enableContextLimit) {
            this.voiceChat.trimMessages();
        }

        // 获取所有工具（本地 + MCP）
        const allTools = getMergedToolsList();

        // 🔥 调用 LLM 前检查打断标志
        if (this.interruptFlag) {
            console.log('弹幕LLM调用被打断');
            this.interruptFlag = false;
            throw new Error('弹幕处理被打断');
        }

        // 调用 LLM
        const result = await this.llmClient.chatCompletion(this.voiceChat.messages, allTools);

        // 🔥 LLM调用后再次检查打断标志
        if (this.interruptFlag) {
            console.log('弹幕LLM响应被打断');
            this.interruptFlag = false;
            throw new Error('弹幕处理被打断');
        }

        // 处理工具调用
        if (result.tool_calls && result.tool_calls.length > 0) {
            console.log("检测到工具调用:", result.tool_calls);
            logToTerminal('info', `工具调用: ${JSON.stringify(result.tool_calls)}`);

            // 添加助手消息
            this.voiceChat.messages.push({
                role: 'assistant',
                content: null,
                tool_calls: result.tool_calls
            });

            // 执行工具调用
            const toolResult = await toolExecutor.executeToolCalls(result.tool_calls);

            if (toolResult) {
                console.log("工具调用结果:", toolResult);

                // 处理多工具调用结果
                if (Array.isArray(toolResult)) {
                    toolResult.forEach(singleResult => {
                        this.voiceChat.messages.push({
                            role: 'tool',
                            content: singleResult.content,
                            tool_call_id: singleResult.tool_call_id
                        });
                    });
                } else {
                    // 单个工具调用结果（向后兼容）
                    this.voiceChat.messages.push({
                        role: 'tool',
                        content: toolResult,
                        tool_call_id: result.tool_calls[0].id
                    });
                }

                // 🔥 工具调用后检查打断标志
                if (this.interruptFlag) {
                    console.log('弹幕工具调用后被打断');
                    this.interruptFlag = false;
                    throw new Error('弹幕处理被打断');
                }

                // 获取最终回复
                const finalResult = await this.llmClient.chatCompletion(this.voiceChat.messages);

                // 🔥 最终回复后检查打断标志
                if (this.interruptFlag) {
                    console.log('弹幕最终回复被打断');
                    this.interruptFlag = false;
                    throw new Error('弹幕处理被打断');
                }

                if (finalResult.content) {
                    this.voiceChat.messages.push({
                        role: 'assistant',
                        content: finalResult.content
                    });

                    // 🔥 播放 TTS 并等待播放完成
                    this.ttsProcessor.reset();
                    await this.ttsProcessor.processTextToSpeech(finalResult.content);
                }
            } else {
                console.error("工具调用失败");
                throw new Error("工具调用失败");
            }

        } else if (result.content) {
            // 没有工具调用，直接回复
            this.voiceChat.messages.push({
                role: 'assistant',
                content: result.content
            });

            // 🔥 播放 TTS 并等待播放完成
            this.ttsProcessor.reset();
            await this.ttsProcessor.processTextToSpeech(result.content);
        }

        // 限制上下文
        if (this.voiceChat.enableContextLimit) {
            this.voiceChat.trimMessages();
        }
    }

    // 增强系统提示词
    enhanceSystemPrompt() {
        // 只有启用直播功能时才添加提示词
        if (!this.config.bilibili || !this.config.bilibili.enabled) {
            return;
        }

        if (this.voiceChat &&
            this.voiceChat.messages &&
            this.voiceChat.messages.length > 0 &&
            this.voiceChat.messages[0].role === 'system') {

            const originalPrompt = this.voiceChat.messages[0].content;

            if (!originalPrompt.includes('你可能会收到直播弹幕')) {
                const enhancedPrompt = originalPrompt +
                    "\n\n你可能会收到直播弹幕消息，这些消息会被标记为[接收到了直播间的弹幕]，" +
                    "表示这是来自直播间观众的消息，而不是主人直接对你说的话。" +
                    "当你看到[接收到了直播间的弹幕]标记时，你应该知道这是其他人发送的，" +
                    "但你仍然可以回应，就像在直播间与观众互动一样。";

                this.voiceChat.messages[0].content = enhancedPrompt;
                console.log('系统提示已增强，添加了直播弹幕相关说明');
                logToTerminal('info', '系统提示已增强，添加了直播弹幕相关说明');
            }
        }
    }

    // TTS播放完成回调（保留接口兼容性，但不再需要手动触发processNext）
    onBarrageTTSComplete() {
        console.log('TTS播放完成');
        // 队列处理循环会自动继续处理
    }

    // 重置（用于中断）
    reset() {
        this.isProcessing = false;
        console.log('弹幕管理器已重置');
        logToTerminal('info', '弹幕管理器已重置');
    }
}

module.exports = { BarrageManager };
