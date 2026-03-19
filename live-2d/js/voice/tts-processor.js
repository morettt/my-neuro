// tts-processor.js - TTS处理器（主协调器）
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');
const { TTSPlaybackEngine } = require('./tts-playback-engine.js');
const { TTSRequestHandler } = require('./tts-request-handler.js');

class EnhancedTextProcessor {
    constructor(ttsUrl, onAudioDataCallback, onStartCallback, onEndCallback, config = null) {
        this.config = config || {};

        // 初始化两个大模块
        this.playbackEngine = new TTSPlaybackEngine(config, onAudioDataCallback, onStartCallback, onEndCallback);
        this.requestHandler = new TTSRequestHandler(config, ttsUrl);

        // 队列
        this.textSegmentQueue = [];
        this.audioDataQueue = [];

        // 状态
        this.isProcessing = false;
        this.shouldStop = false;
        this.llmFullResponse = '';

        // TTS不可用标记：第一次失败后跳过后续所有TTS请求
        this.ttsUnavailable = false;

        // 中止代数：每次interrupt时递增，用于丢弃过期请求结果
        this.abortGeneration = 0;

        // 回退字幕状态
        this.fallbackDisplayText = '';
        this._fallbackTimer = null;

        // 🔥 TTS完成Promise（用于等待播放完成）
        this.completionPromise = null;
        this.completionResolve = null;

        // 启动处理线程
        this.startProcessingThread();
        this.startPlaybackThread();
    }

    // 设置情绪映射器
    setEmotionMapper(emotionMapper) {
        this.playbackEngine.setEmotionMapper(emotionMapper);
    }

        // 表情映射器
    setExpressionMapper(expressionMapper) {
        this.playbackEngine.setExpressionMapper(expressionMapper);
    }


    // 处理线程 - 将文本转换为音频
    startProcessingThread() {
        const processNext = async () => {
            if (this.shouldStop) return;

            if (this.textSegmentQueue.length > 0 && !this.isProcessing) {
                this.isProcessing = true;
                const segment = this.textSegmentQueue.shift();

                // TTS已标记不可用，直接走回退显示，不再浪费时间请求
                if (this.ttsUnavailable) {
                    this.appendFallbackText(segment);
                    this.isProcessing = false;
                    setTimeout(processNext, 50);
                    return;
                }

                // 清理后无实际文字内容的片段（纯情绪标签、纯标点等），直接跳过
                const cleanedSegment = segment
                    .replace(/<[^>]+>/g, '')
                    .replace(/（.*?）|\(.*?\)/g, '')
                    .replace(/\*.*?\*/g, '')
                    .replace(/[,，。？?!！；;：:、…—\-\s]/g, '')
                    .trim();
                if (!cleanedSegment) {
                    this.isProcessing = false;
                    setTimeout(processNext, 50);
                    return;
                }

                const genSnapshot = this.abortGeneration;
                try {
                    const audioData = await this.requestHandler.convertTextToSpeech(segment);

                    // 如果中止代数已变化，说明请求属于旧一轮，直接丢弃结果
                    if (genSnapshot !== this.abortGeneration) {
                        this.isProcessing = false;
                        setTimeout(processNext, 50);
                        return;
                    }

                    if (audioData) {
                        this.audioDataQueue.push({ audio: audioData, text: segment });
                    }else if (this.shouldStop) {
                        // 被主动打断（abort），不标记为不可用
                        return;
                    } else {
                        // 首次TTS失败，标记不可用，后续全部跳过
                        this.ttsUnavailable = true;
                        console.log('TTS服务不可用，切换为字幕回退模式');
                        this.appendFallbackText(segment);
                    }
                } catch (error) {
                    if (genSnapshot !== this.abortGeneration) {
                        this.isProcessing = false;
                        setTimeout(processNext, 50);
                        return;
                    }
                    console.error('TTS处理错误:', error);
                    // 单个片段失败不标记整体不可用，只回退当前片段
                    this.appendFallbackText(segment);
                }

                this.isProcessing = false;
            }

            setTimeout(processNext, 50);
        };

        processNext();
    }

    // 播放线程 - 顺序播放音频
    startPlaybackThread() {
        const playNext = async () => {
            if (this.shouldStop) return;

            if (this.audioDataQueue.length > 0 && !this.playbackEngine.getPlayingState()) {
                const audioPackage = this.audioDataQueue.shift();
                const result = await this.playbackEngine.playAudio(audioPackage.audio, audioPackage.text);

                // 检查是否全部完成
                if (result.completed && this.isAllComplete()) {
                    this.handleAllComplete();
                }
            }
            else {
                // 当"没音频（可能是TTS全失败了，或者还在处理中）"且"还有一个未完成的Promise"时，手动触发结束
                // this.completionPromise 不为空说明当前正处于一个"未完结"的对话任务中
                if (this.isAllComplete() && this.completionPromise) {
                    // 如果有回退文本还在打字中，等打字机跑完再结束
                    if (this._fallbackTimer) {
                        // 还在打字，不要急着结束
                    } else {
                        console.log('检测到队列为空但任务未结束（可能是TTS失败），强制结束');
                        this.handleAllComplete();
                    }
                }
            }

            setTimeout(playNext, 50);
        };

        playNext();
    }

    // 检查是否全部完成
    isAllComplete() {
        return this.audioDataQueue.length === 0 &&
               this.textSegmentQueue.length === 0 &&
               !this.isProcessing &&
               this.requestHandler.getPendingSegment().trim() === '';
    }

    // 回退模式：累积文本并启动打字机动画
    appendFallbackText(segmentText) {
        // 把新文本追加到待显示队列
        if (!this._fallbackQueue) this._fallbackQueue = [];
        this._fallbackQueue.push(...[...segmentText]);

        // 如果打字机已经在跑，新字符会自动被消费
        if (!this._fallbackTimer) {
            this.startFallbackTypewriter();
        }
    }

    // 打字机动画：从队列中逐字消费
    startFallbackTypewriter() {
        const label = this.config.subtitle_labels?.ai || 'Fake Neuro';
        const charInterval = 180; // 180ms一个字

        const typeNext = () => {
            if (this.shouldStop) {
                this._fallbackTimer = null;
                return;
            }

            if (this._fallbackQueue && this._fallbackQueue.length > 0) {
                this.fallbackDisplayText += this._fallbackQueue.shift();
                if (typeof showSubtitle === 'function') {
                    showSubtitle(`${label}: ${this.fallbackDisplayText}`);
                }
                this._fallbackTimer = setTimeout(typeNext, charInterval);
            } else {
                // 队列空了，停下来等新字符进来
                this._fallbackTimer = null;
            }
        };

        this._fallbackTimer = setTimeout(typeNext, charInterval);
    }

    // 全部完成的处理
    handleAllComplete() {
        // 如果有回退字幕，停留3秒让用户看完
        const hideDelay = this.fallbackDisplayText ? 3000 : 1000;
        setTimeout(() => {
            if (typeof hideSubtitle === 'function') hideSubtitle();
            // 🔥 通过 playbackEngine 调用表情映射器
            if (this.playbackEngine.expressionMapper) {
                // this.playbackEngine.expressionMapper.triggerExpression("表情7");
                const defaultExpr = this.playbackEngine.expressionMapper.defaultExpression || "表情1";
                this.playbackEngine.expressionMapper.triggerExpression(defaultExpr);
            }
        }, 1000);

        if (this.playbackEngine.onEndCallback) {
            this.playbackEngine.onEndCallback();
        }

        eventBus.emit(Events.TTS_END);

        // 🔥 解决完成Promise
        if (this.completionResolve) {
            this.completionResolve();
            this.completionResolve = null;
            this.completionPromise = null;
        }
    }

    // 添加流式文本
    addStreamingText(text) {
        if (this.shouldStop) return;
        this.llmFullResponse += text;
        this.requestHandler.segmentStreamingText(text, this.textSegmentQueue);
    }

    // 完成流式文本
    finalizeStreamingText() {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            const messageElement = document.createElement('div');
            messageElement.innerHTML = `<strong>Fake Neuro:</strong> ${this.llmFullResponse}`;
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        this.requestHandler.finalizeSegmentation(this.textSegmentQueue);
    }

    // 处理完整文本
    async processTextToSpeech(text) {
        if (!text.trim()) return;

        this.reset();
        this.llmFullResponse = text;
        this.requestHandler.segmentFullText(text, this.textSegmentQueue);

        // 🔥 创建完成Promise，返回给调用者等待
        this.completionPromise = new Promise(resolve => {
            this.completionResolve = resolve;
        });

        return this.completionPromise;
    }

    // 重置
    reset() {
        this.llmFullResponse = '';
        this.fallbackDisplayText = '';
        this._fallbackQueue = [];
        if (this._fallbackTimer) {
            clearTimeout(this._fallbackTimer);
            this._fallbackTimer = null;
        }
        this.textSegmentQueue = [];
        this.audioDataQueue = [];
        this.isProcessing = false;
        this.shouldStop = false;
        this.ttsUnavailable = false;
        // 递增中止代数，确保 reset 后还在飞行的旧请求返回时被正确丢弃
        // 防止 abortAllRequests() abort 的请求因代数未变而错误设置 ttsUnavailable
        this.abortGeneration++;

        // 🔥 取消之前的完成Promise
        if (this.completionResolve) {
            this.completionResolve();
            this.completionResolve = null;
            this.completionPromise = null;
        }

        this.playbackEngine.reset();
        this.requestHandler.reset();
    }

    // 打断
    interrupt() {
        console.log('打断TTS播放...');

        // 🔥 关键修改：发射中断事件（这会自动触发 appState 的中断标志）
        eventBus.emit(Events.TTS_INTERRUPTED);

        this.shouldStop = true;
        this.ttsUnavailable = false;
        this.abortGeneration++;
        this.requestHandler.abortAllRequests();
        this.playbackEngine.stop();

        this.textSegmentQueue = [];
        this.audioDataQueue = [];
        this._fallbackQueue = [];
        if (this._fallbackTimer) {
            clearTimeout(this._fallbackTimer);
            this._fallbackTimer = null;
        }
        this.llmFullResponse = '';
        this.isProcessing = false;

        if (typeof hideSubtitle === 'function') hideSubtitle();
        if (this.playbackEngine.onEndCallback) this.playbackEngine.onEndCallback();
        if (this.playbackEngine.expressionMapper) {
            const defaultExpr = this.playbackEngine.expressionMapper.defaultExpression || "表情1";
            this.playbackEngine.expressionMapper.triggerExpression(defaultExpr);
        }

        setTimeout(() => {
            this.shouldStop = false;
            this.startProcessingThread();
            this.startPlaybackThread();
        }, 300);
    }

    // 停止
    stop() {
        this.shouldStop = true;
        this.reset();
        if (typeof hideSubtitle === 'function') hideSubtitle();
        if (this.playbackEngine.onEndCallback) this.playbackEngine.onEndCallback();
    }

    // 判断是否正在播放
    isPlaying() {
        return this.playbackEngine.getPlayingState() ||
               this.isProcessing ||
               this.textSegmentQueue.length > 0 ||
               this.audioDataQueue.length > 0;
    }
}

module.exports = { EnhancedTextProcessor };
