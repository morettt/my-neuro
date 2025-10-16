// barrage-manager.js - 弹幕队列管理模块
const { logToTerminal, getMergedToolsList } = require('../api-utils.js');
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');
const { appState } = require('../core/app-state.js');
const { LLMClient } = require('../ai/llm-client.js');
const { toolExecutor } = require('../ai/tool-executor.js');

// 弹幕处理状态机
const BarrageState = {
    IDLE: 'idle',           // 空闲状态
    PROCESSING: 'processing', // 正在处理中
    WAITING_TTS: 'waiting_tts', // 等待TTS完成
    ERROR: 'error'          // 错误状态
};

class BarrageManager {
    constructor(config) {
        this.config = config;
        this.barrageQueue = [];

        // 全局弹幕调度器状态
        this.scheduler = {
            state: BarrageState.IDLE,
            currentBarrage: null,
            schedulerId: null,
            retryCount: 0,
            maxRetries: 3
        };

        // 依赖的外部服务
        this.voiceChat = null;
        this.ttsProcessor = null;
        this.showSubtitle = null;
        this.hideSubtitle = null;

        // 创建LLM客户端
        this.llmClient = new LLMClient(config);
    }

    // 设置依赖服务
    setDependencies(dependencies) {
        this.voiceChat = dependencies.voiceChat;
        this.ttsProcessor = dependencies.ttsProcessor;
        this.showSubtitle = dependencies.showSubtitle;
        this.hideSubtitle = dependencies.hideSubtitle;
    }

    // 原子化状态转换函数 - 防止竞态条件的核心
    atomicStateTransition(fromState, toState, operation = null) {
        // 原子检查和转换
        if (this.scheduler.state !== fromState) {
            console.log(`状态转换失败: 期望${fromState}, 实际${this.scheduler.state}`);
            return false;
        }

        const oldState = this.scheduler.state;
        this.scheduler.state = toState;

        console.log(`弹幕状态: ${oldState} -> ${toState}`);
        logToTerminal('info', `弹幕状态转换: ${oldState} -> ${toState}`);

        // 执行伴随操作
        if (operation) {
            try {
                operation();
            } catch (error) {
                console.error('状态转换操作失败:', error);
                this.scheduler.state = BarrageState.ERROR;
            }
        }

        return true;
    }

    // 单一调度入口 - 解决多重调用问题
    scheduleBarrageProcessing() {
        // 生成唯一调度ID，防止重复调度
        const scheduleId = Date.now() + Math.random();

        // 如果当前不是空闲状态，忽略调度请求
        if (this.scheduler.state !== BarrageState.IDLE) {
            console.log(`调度忽略: 当前状态${this.scheduler.state}`);
            return;
        }

        // 如果队列为空，忽略调度
        if (this.barrageQueue.length === 0) {
            return;
        }

        // 【关键修复】用户语音输入具有最高优先级 - 暂停弹幕处理
        if (appState.isProcessingUserInput()) {
            console.log('用户正在语音输入，暂停弹幕处理，1秒后重试');
            setTimeout(() => this.scheduleBarrageProcessing(), 1000);
            return;
        }

        // 如果TTS正在播放，延迟调度
        if (appState.isPlayingTTS()) {
            console.log('TTS播放中，延迟500ms重新调度');
            setTimeout(() => this.scheduleBarrageProcessing(), 500);
            return;
        }

        // 开始处理
        this.scheduler.schedulerId = scheduleId;
        this.processNextBarrage();
    }

    // 处理下一条弹幕 - 状态机驱动
    async processNextBarrage() {
        // 原子状态转换：IDLE -> PROCESSING
        if (!this.atomicStateTransition(BarrageState.IDLE, BarrageState.PROCESSING)) {
            return; // 状态转换失败，可能已有其他处理在进行
        }

        // 发送弹幕处理开始事件
        eventBus.emit(Events.BARRAGE_START);

        try {
            // 【关键修复】在开始处理前再次检查用户输入优先级
            if (appState.isProcessingUserInput()) {
                console.log('用户正在语音输入，中止弹幕处理');
                this.atomicStateTransition(BarrageState.PROCESSING, BarrageState.IDLE);
                eventBus.emit(Events.BARRAGE_END);
                setTimeout(() => this.scheduleBarrageProcessing(), 1000);
                return;
            }

            // 检查队列
            if (this.barrageQueue.length === 0) {
                this.atomicStateTransition(BarrageState.PROCESSING, BarrageState.IDLE);
                eventBus.emit(Events.BARRAGE_END);
                return;
            }

            // 获取弹幕
            const barrage = this.barrageQueue.shift();
            this.scheduler.currentBarrage = barrage;
            this.scheduler.retryCount = 0;

            console.log(`开始处理弹幕: ${barrage.nickname}: ${barrage.text}`);
            logToTerminal('info', `开始处理弹幕: ${barrage.nickname}: ${barrage.text}`);

            // 处理弹幕
            await this.executeBarrageMessage(barrage.nickname, barrage.text);

            // 成功处理完成
            this.scheduler.currentBarrage = null;

            // 发送交互更新事件
            eventBus.emit(Events.INTERACTION_UPDATED);

            // 原子状态转换：PROCESSING -> WAITING_TTS (等待TTS完成)
            this.atomicStateTransition(BarrageState.PROCESSING, BarrageState.WAITING_TTS);

            // TTS完成后会调用 onBarrageTTSComplete()

        } catch (error) {
            console.error('处理弹幕出错:', error);
            logToTerminal('error', `处理弹幕出错: ${error.message}`);

            // 错误恢复
            this.scheduler.retryCount++;
            if (this.scheduler.retryCount < this.scheduler.maxRetries) {
                console.log(`弹幕处理重试 ${this.scheduler.retryCount}/${this.scheduler.maxRetries}`);
                // 重新加入队列头部
                if (this.scheduler.currentBarrage) {
                    this.barrageQueue.unshift(this.scheduler.currentBarrage);
                }

                // 延迟重试
                this.atomicStateTransition(BarrageState.PROCESSING, BarrageState.IDLE);
                setTimeout(() => this.scheduleBarrageProcessing(), 1000);
            } else {
                console.error('弹幕处理失败，超过最大重试次数');
                this.scheduler.currentBarrage = null;
                this.atomicStateTransition(BarrageState.PROCESSING, BarrageState.IDLE);
                // 继续处理下一条
                setTimeout(() => this.scheduleBarrageProcessing(), 500);
            }
        }
    }

    // TTS完成回调 - 状态机驱动的继续处理
    onBarrageTTSComplete() {
        if (this.scheduler.state === BarrageState.WAITING_TTS) {
            console.log('TTS播放完成，准备处理下一条弹幕');
            this.atomicStateTransition(BarrageState.WAITING_TTS, BarrageState.IDLE);

            // 发送弹幕处理结束事件
            eventBus.emit(Events.BARRAGE_END);

            // 500ms后继续处理队列
            setTimeout(() => this.scheduleBarrageProcessing(), 500);
        }
    }

    // 执行弹幕消息处理
    async executeBarrageMessage(nickname, text) {
        try {
            if (!this.voiceChat) {
                throw new Error('VoiceChat未初始化');
            }

            // 重置AI日记定时器
            if (this.voiceChat.resetDiaryTimer) {
                this.voiceChat.resetDiaryTimer();
            }

            // 增强系统提示词
            this.enhanceSystemPrompt();

            this.voiceChat.messages.push({
                'role': 'user',
                'content': `[接收到了直播间的弹幕] ${nickname}给你发送了一个消息: ${text}`
            });

            if (this.voiceChat.enableContextLimit) {
                this.voiceChat.trimMessages();
            }

            // 合并本地Function Call工具和MCP工具（弹幕处理）
            const allTools = getMergedToolsList();

            // 【关键修复】在发送AI请求前再次检查用户输入优先级
            if (appState.isProcessingUserInput()) {
                console.log('用户正在语音输入，中止弹幕AI请求');
                throw new Error('用户语音输入优先，中止弹幕处理');
            }

            // 使用统一的LLM客户端
            const result = await this.llmClient.chatCompletion(this.voiceChat.messages, allTools);

            // 工具调用处理（弹幕）
            if (result.tool_calls && result.tool_calls.length > 0) {
                console.log("检测到工具调用:", result.tool_calls);
                logToTerminal('info', `检测到工具调用: ${JSON.stringify(result.tool_calls)}`);

                this.voiceChat.messages.push({
                    'role': 'assistant',
                    'content': null,
                    'tool_calls': result.tool_calls
                });

                // 使用统一的工具执行器
                const toolResult = await toolExecutor.executeToolCalls(result.tool_calls);

                if (toolResult) {
                    console.log("工具调用结果:", toolResult);
                    logToTerminal('info', `工具调用结果: ${JSON.stringify(toolResult)}`);

                    // 处理多工具调用结果
                    if (Array.isArray(toolResult)) {
                        // 多个工具调用结果
                        toolResult.forEach(singleResult => {
                            this.voiceChat.messages.push({
                                'role': 'tool',
                                'content': singleResult.content,
                                'tool_call_id': singleResult.tool_call_id
                            });
                        });
                    } else {
                        // 单个工具调用结果（向后兼容）
                        this.voiceChat.messages.push({
                            'role': 'tool',
                            'content': toolResult,
                            'tool_call_id': result.tool_calls[0].id
                        });
                    }

                    // 使用统一的LLM客户端获取最终回复
                    const finalResult = await this.llmClient.chatCompletion(this.voiceChat.messages);

                    if (finalResult.content) {
                        this.voiceChat.messages.push({ 'role': 'assistant', 'content': finalResult.content });

                        // 【关键修复】在TTS播放前检查用户输入优先级
                        if (appState.isProcessingUserInput()) {
                            console.log('用户正在语音输入，跳过弹幕TTS播放');
                            throw new Error('用户语音输入优先，跳过TTS播放');
                        }

                        this.ttsProcessor.reset();
                        this.ttsProcessor.processTextToSpeech(finalResult.content);
                    }
                } else {
                    console.error("工具调用失败");
                    logToTerminal('error', "工具调用失败");
                    throw new Error("工具调用失败，无法完成功能扩展");
                }
            } else if (result.content) {
                this.voiceChat.messages.push({ 'role': 'assistant', 'content': result.content });

                // 【关键修复】在TTS播放前检查用户输入优先级
                if (appState.isProcessingUserInput()) {
                    console.log('用户正在语音输入，跳过弹幕TTS播放');
                    throw new Error('用户语音输入优先，跳过TTS播放');
                }

                this.ttsProcessor.reset();
                this.ttsProcessor.processTextToSpeech(result.content);
            }

            if (this.voiceChat.enableContextLimit) {
                this.voiceChat.trimMessages();
            }
        } catch (error) {
            logToTerminal('error', `处理弹幕消息出错: ${error.message}`);
            if (error.stack) {
                logToTerminal('error', `错误堆栈: ${error.stack}`);
            }

            let errorMessage = "抱歉，处理弹幕出错";

            if (error.message.includes("API密钥验证失败")) {
                errorMessage = "API密钥错误，请检查配置";
            } else if (error.message.includes("API访问被禁止")) {
                errorMessage = "API访问受限，请联系支持";
            } else if (error.message.includes("API接口未找到")) {
                errorMessage = "无效的API地址，请检查配置";
            } else if (error.message.includes("请求过于频繁")) {
                errorMessage = "请求频率超限，请稍后再试";
            } else if (error.message.includes("服务器错误")) {
                errorMessage = "AI服务不可用，请稍后再试";
            } else if (error.message.includes("工具调用失败")) {
                errorMessage = "功能扩展调用失败，请重试";
            } else if (error.name === "TypeError" && error.message.includes("fetch")) {
                errorMessage = "网络连接失败，请检查网络";
            } else if (error.name === "SyntaxError") {
                errorMessage = "解析API响应出错，请重试";
            } else {
                errorMessage = `弹幕处理错误: ${error.message}`;
            }

            logToTerminal('error', `用户显示错误: ${errorMessage}`);

            if (this.showSubtitle) {
                this.showSubtitle(errorMessage, 3000);
            }

            const asrEnabled = this.config.asr?.enabled !== false;
            if (this.voiceChat.asrProcessor && asrEnabled) {
                this.voiceChat.asrProcessor.resumeRecording();
            }

            if (this.hideSubtitle) {
                setTimeout(() => this.hideSubtitle(), 3000);
            }
        }
    }

    // 增强系统提示词
    enhanceSystemPrompt() {
        // 只有启用直播功能时才添加提示词
        if (!this.config.bilibili || !this.config.bilibili.enabled) {
            return;
        }

        if (this.voiceChat && this.voiceChat.messages && this.voiceChat.messages.length > 0 && this.voiceChat.messages[0].role === 'system') {
            const originalPrompt = this.voiceChat.messages[0].content;

            if (!originalPrompt.includes('你可能会收到直播弹幕')) {
                const enhancedPrompt = originalPrompt + "\n\n你可能会收到直播弹幕消息，这些消息会被标记为[接收到了直播间的弹幕]，表示这是来自直播间观众的消息，而不是主人直接对你说的话。当你看到[接收到了直播间的弹幕]标记时，你应该知道这是其他人发送的，但你仍然可以回应，就像在直播间与观众互动一样。";
                this.voiceChat.messages[0].content = enhancedPrompt;
                console.log('系统提示已增强，添加了直播弹幕相关说明');
                logToTerminal('info', '系统提示已增强，添加了直播弹幕相关说明');
            }
        }
    }

    // 添加弹幕到队列
    addToQueue(nickname, text) {
        this.barrageQueue.push({ nickname, text });
        console.log(`弹幕已加入队列: ${nickname}: ${text} (队列长度: ${this.barrageQueue.length})`);
        logToTerminal('info', `弹幕已加入队列: ${nickname}: ${text} (队列长度: ${this.barrageQueue.length})`);

        // 触发调度 - 单一入口，避免重复调用
        this.scheduleBarrageProcessing();
    }

    // 重置状态（用于中断）
    reset() {
        this.scheduler.state = BarrageState.IDLE;
        this.scheduler.currentBarrage = null;
        this.scheduler.retryCount = 0;
        console.log('弹幕状态机已重置');
        logToTerminal('info', '弹幕状态机已重置');
    }
}

module.exports = { BarrageManager, BarrageState };
