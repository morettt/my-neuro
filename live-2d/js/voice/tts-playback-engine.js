// tts-playback-engine.js - TTS播放引擎
// 职责：音频播放、文本动画、字幕显示、嘴形控制、情绪同步的完整实现

const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');

class TTSPlaybackEngine {
    constructor(config, onAudioDataCallback, onStartCallback, onEndCallback) {
        this.config = config;
        this.onAudioDataCallback = onAudioDataCallback;
        this.onStartCallback = onStartCallback;
        this.onEndCallback = onEndCallback;

        // 音频上下文
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;

        // 当前状态
        this.currentAudio = null;
        this.currentAudioUrl = null;
        this.isPlaying = false;
        this.shouldStop = false;

        // 动画和渲染
        this._textAnimInterval = null;
        this._renderFrameId = null;

        // 文本状态
        this.displayedText = '';
        this.currentSegmentText = '';

        // 情绪映射器
        this.emotionMapper = null;
    }

    // 设置情绪映射器
    setEmotionMapper(emotionMapper) {
        this.emotionMapper = emotionMapper;
    }

    // 初始化音频上下文
    async initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        }
    }

    // 播放音频并同步文本
    async playAudio(audioBlob, segmentText) {
        if (!audioBlob) return;

        await this.initAudioContext();
        this.currentSegmentText = segmentText;

        return new Promise((resolve) => {
            if (this.shouldStop) {
                resolve();
                return;
            }

            this.isPlaying = true;

            // 触发开始回调
            if (this.onStartCallback) this.onStartCallback();
            eventBus.emit(Events.TTS_START);

            // 创建音频
            this.currentAudioUrl = URL.createObjectURL(audioBlob);
            this.currentAudio = new Audio(this.currentAudioUrl);

            // 创建音频链路
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 1.0;
            const source = this.audioContext.createMediaElementSource(this.currentAudio);
            source.connect(gainNode);
            gainNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);

            // 预处理文本（提取情绪标记）
            let processedText = segmentText;
            let emotionMarkers = [];
            if (this.emotionMapper) {
                const info = this.emotionMapper.prepareTextForTTS(segmentText);
                processedText = info.text;
                emotionMarkers = info.emotionMarkers;
            }

            const segmentLength = processedText.length;
            let charDisplayIndex = 0;
            let textAnimInterval = null;

            // 🔥 文本动画函数（使用requestAnimationFrame优化）
            const startTextAnimation = () => {
                const audioDuration = this.currentAudio.duration * 1000;
                const charInterval = Math.max(30, Math.min(200, audioDuration / segmentLength));
                let lastUpdateTime = performance.now();

                const animateText = (currentTime) => {
                    // 检查是否应该停止
                    if (this.shouldStop || !this.currentAudio) {
                        return;
                    }

                    // 检查是否到了更新字符的时间
                    if (currentTime - lastUpdateTime >= charInterval) {
                        if (charDisplayIndex < segmentLength) {
                            charDisplayIndex++;

                            // 触发情绪动作
                            if (this.emotionMapper && emotionMarkers.length > 0) {
                                this.emotionMapper.triggerEmotionByTextPosition(
                                    charDisplayIndex, segmentLength, emotionMarkers
                                );
                            }

                            // 显示字幕
                            const currentDisplay = this.displayedText + processedText.substring(0, charDisplayIndex);
                            if (typeof showSubtitle === 'function') {
                                showSubtitle(`${this.config.subtitle_labels?.ai || 'Fake Neuro'}: ${currentDisplay}`);
                                const container = document.getElementById('subtitle-container');
                                if (container) container.scrollTop = container.scrollHeight;
                            }

                            lastUpdateTime = currentTime;
                        }
                    }

                    // 如果还没播放完，继续动画
                    if (charDisplayIndex < segmentLength && !this.shouldStop) {
                        this._textAnimInterval = requestAnimationFrame(animateText);
                    }
                };

                // 启动动画
                this._textAnimInterval = requestAnimationFrame(animateText);
            };

            // 嘴形动画函数
            const updateMouth = () => {
                if (this.shouldStop || !this.currentAudio) return;

                this.analyser.getByteFrequencyData(this.dataArray);
                const sampleCount = this.dataArray.length / 2;
                let sum = 0;
                for (let i = 0; i < sampleCount; i++) sum += this.dataArray[i];
                const average = sum / sampleCount;
                const mouthOpenValue = Math.pow((average / 256), 0.8) * 1;

                if (this.onAudioDataCallback) this.onAudioDataCallback(mouthOpenValue);

                if (this.currentAudio && !this.shouldStop) {
                    this._renderFrameId = requestAnimationFrame(updateMouth);
                }
            };

            // 设置音频事件
            this.currentAudio.oncanplaythrough = () => startTextAnimation();

            this.currentAudio.onplay = () => {
                updateMouth();

                // 设置淡出
                const fadeOutDuration = 0.15;
                const audioDuration = this.currentAudio.duration;
                if (audioDuration > fadeOutDuration) {
                    const fadeOutTimer = setTimeout(() => {
                        if (!this.shouldStop && gainNode) {
                            const currentTime = this.audioContext.currentTime;
                            gainNode.gain.setValueAtTime(1.0, currentTime);
                            gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + fadeOutDuration);
                        }
                    }, (audioDuration - fadeOutDuration) * 1000);
                    this.currentAudio._fadeOutTimer = fadeOutTimer;
                }
            };

            this.currentAudio.onended = () => {
                // 清理
                if (this.currentAudio._fadeOutTimer) {
                    clearTimeout(this.currentAudio._fadeOutTimer);
                }
                if (this.onAudioDataCallback) this.onAudioDataCallback(0);
                if (this._textAnimInterval) {
                    cancelAnimationFrame(this._textAnimInterval);
                    this._textAnimInterval = null;
                }
                if (this._renderFrameId) {
                    cancelAnimationFrame(this._renderFrameId);
                    this._renderFrameId = null;
                }

                // 触发剩余情绪
                if (this.emotionMapper && emotionMarkers.length > 0) {
                    emotionMarkers.forEach(m => this.emotionMapper.playConfiguredEmotion(m.emotion));
                }

                // 更新显示文本
                this.displayedText += processedText;
                if (typeof showSubtitle === 'function') {
                    showSubtitle(`${this.config.subtitle_labels?.ai || 'Fake Neuro'}: ${this.displayedText}`);
                }

                this.cleanup();
                this.isPlaying = false;
                resolve({ completed: true });
            };

            this.currentAudio.onerror = (e) => {
                console.error('音频播放错误:', e);
                this.cleanupOnError();
                eventBus.emit(Events.TTS_END);
                resolve({ error: true });
            };

            // 开始播放
            this.currentAudio.play().catch(error => {
                console.error('播放失败:', error);
                this.cleanupOnError();
                eventBus.emit(Events.TTS_END);
                resolve({ error: true });
            });
        });
    }

    // 清理资源
    cleanup() {
        if (this.currentAudioUrl) {
            URL.revokeObjectURL(this.currentAudioUrl);
            this.currentAudioUrl = null;
        }
        this.currentAudio = null;
    }

    // 错误时清理
    cleanupOnError() {
        if (this.onAudioDataCallback) this.onAudioDataCallback(0);
        if (this._textAnimInterval) {
            cancelAnimationFrame(this._textAnimInterval);
            this._textAnimInterval = null;
        }
        if (this._renderFrameId) {
            cancelAnimationFrame(this._renderFrameId);
            this._renderFrameId = null;
        }
        this.cleanup();
        this.isPlaying = false;
    }

    // 停止播放
    stop() {
        this.shouldStop = true;

        if (this._textAnimInterval) {
            cancelAnimationFrame(this._textAnimInterval);
            this._textAnimInterval = null;
        }
        if (this._renderFrameId) {
            cancelAnimationFrame(this._renderFrameId);
            this._renderFrameId = null;
        }

        if (this.currentAudio) {
            this.currentAudio.onended = null;
            this.currentAudio.onplay = null;
            this.currentAudio.oncanplaythrough = null;
            this.currentAudio.onerror = null;
            this.currentAudio.pause();
            this.currentAudio.src = "";
        }

        this.cleanup();
        if (this.onAudioDataCallback) this.onAudioDataCallback(0);
        this.isPlaying = false;
    }

    // 重置状态
    reset() {
        this.stop();
        this.shouldStop = false;
        this.displayedText = '';
        this.currentSegmentText = '';
    }

    // 获取状态
    getPlayingState() {
        return this.isPlaying;
    }
}

module.exports = { TTSPlaybackEngine };
