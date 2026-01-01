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

    // 处理线程 - 将文本转换为音频
    startProcessingThread() {
        const processNext = async () => {
            if (this.shouldStop) return;

            if (this.textSegmentQueue.length > 0 && !this.isProcessing) {
                this.isProcessing = true;
                const segment = this.textSegmentQueue.shift();

                try {
                    const audioData = await this.requestHandler.convertTextToSpeech(segment);
                    if (audioData) {
                        this.audioDataQueue.push({ audio: audioData, text: segment });
                    }
                } catch (error) {
                    console.error('TTS处理错误:', error);
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

    // 全部完成的处理
    handleAllComplete() {
        setTimeout(() => {
            if (typeof hideSubtitle === 'function') hideSubtitle();
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
        this.textSegmentQueue = [];
        this.audioDataQueue = [];
        this.isProcessing = false;
        this.shouldStop = false;

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
        this.requestHandler.abortAllRequests();
        this.playbackEngine.stop();

        this.textSegmentQueue = [];
        this.audioDataQueue = [];
        this.llmFullResponse = '';
        this.isProcessing = false;

        if (typeof hideSubtitle === 'function') hideSubtitle();
        if (this.playbackEngine.onEndCallback) this.playbackEngine.onEndCallback();

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
