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
        this.queue = [];
        this.isProcessing = false;
        this.llmClient = new LLMClient(config);

        // 依赖的外部服务
        this.voiceChat = null;
        this.ttsProcessor = null;
        this.showSubtitle = null;
        this.hideSubtitle = null;
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
        this.queue.push({ nickname, text });
        console.log(`弹幕入队: ${nickname}: ${text} (队列长度: ${this.queue.length})`);
        logToTerminal('info', `弹幕入队: ${nickname}: ${text}`);

        // 尝试处理队列
        this.processNext();
    }

    // 处理下一条弹幕
    async processNext() {
        // 如果正在处理，直接返回
        if (this.isProcessing) {
            return;
        }

        // 队列为空，直接返回
        if (this.queue.length === 0) {
            return;
        }

        // 用户语音输入或TTS播放优先，延迟处理
        if (appState.isProcessingUserInput() || appState.isPlayingTTS()) {
            console.log('用户正在交互，延迟1秒处理弹幕');
            setTimeout(() => this.processNext(), 1000);
            return;
        }

        this.isProcessing = true;
        const barrage = this.queue.shift();

        // 发送弹幕处理开始事件
        eventBus.emit(Events.BARRAGE_START);

        try {
            console.log(`处理弹幕: ${barrage.nickname}: ${barrage.text}`);
            logToTerminal('info', `处理弹幕: ${barrage.nickname}: ${barrage.text}`);

            // 执行弹幕消息处理
            await this.executeBarrage(barrage.nickname, barrage.text);

            // 发送交互更新事件
            eventBus.emit(Events.INTERACTION_UPDATED);

            // 注意：TTS播放是异步的，会在播放完成后调用 onBarrageTTSComplete()
            // 所以这里不需要立即处理下一条，等TTS播放完成后会自动处理

        } catch (error) {
            console.error('弹幕处理失败:', error.message);
            logToTerminal('error', `弹幕处理失败: ${error.message}`);

            // 恢复ASR录音
            const asrEnabled = this.config.asr?.enabled !== false;
            if (this.voiceChat?.asrProcessor && asrEnabled) {
                this.voiceChat.asrProcessor.resumeRecording();
            }

            // 出错时立即处理下一条
            this.isProcessing = false;
            eventBus.emit(Events.BARRAGE_END);
            setTimeout(() => this.processNext(), 500);
            return;
        }

        this.isProcessing = false;

        // 发送弹幕处理结束事件
        eventBus.emit(Events.BARRAGE_END);

        // TTS播放完成后会调用 onBarrageTTSComplete() 来处理下一条
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

        // 调用 LLM
        const result = await this.llmClient.chatCompletion(this.voiceChat.messages, allTools);

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

                // 获取最终回复
                const finalResult = await this.llmClient.chatCompletion(this.voiceChat.messages);

                if (finalResult.content) {
                    this.voiceChat.messages.push({
                        role: 'assistant',
                        content: finalResult.content
                    });

                    // 播放 TTS
                    this.ttsProcessor.reset();
                    this.ttsProcessor.processTextToSpeech(finalResult.content);
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

            // 播放 TTS
            this.ttsProcessor.reset();
            this.ttsProcessor.processTextToSpeech(result.content);
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

    // TTS播放完成回调
    onBarrageTTSComplete() {
        // TTS播放完成后，尝试处理下一条弹幕
        if (this.queue.length > 0) {
            console.log('TTS播放完成，继续处理弹幕队列');
            setTimeout(() => this.processNext(), 500);
        }
    }

    // 重置（用于中断）
    reset() {
        this.isProcessing = false;
        console.log('弹幕管理器已重置');
        logToTerminal('info', '弹幕管理器已重置');
    }
}

module.exports = { BarrageManager };
