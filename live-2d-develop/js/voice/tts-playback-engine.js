// js/voice/tts-playback-engine.js
// tts-playback-engine.js - TTS播放引擎 (更新版)

const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');

class TTSPlaybackEngine {
    constructor(config, uiController, onAudioDataCallback, onStartCallback, onEndCallback) {
        this.config = config;
        this.uiController = uiController; // 存储UI控制器引用
        this.onAudioDataCallback = onAudioDataCallback;
        this.onStartCallback = onStartCallback;
        this.onEndCallback = onEndCallback;

        // ... (音频上下文、状态等属性保持不变)
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.currentAudio = null;
        this.currentAudioUrl = null;
        this.isPlaying = false;
        this.shouldStop = false;
        this._textAnimInterval = null;
        this._renderFrameId = null;
        this._isFirstSegmentOfResponse = true;
        this._fullResponseText = '';
        this.emotionMapper = null;
    }

    setEmotionMapper(emotionMapper) {
        this.emotionMapper = emotionMapper;
    }

    async initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        }
    }

    async playAudio(audioBlob, segmentText) {
        if (!audioBlob || this.shouldStop) return;

        await this.initAudioContext();

        return new Promise((resolve) => {
            if (this.shouldStop) {
                resolve({ completed: false });
                return;
            }

            this.isPlaying = true;
            if (this.onStartCallback) this.onStartCallback();
            eventBus.emit(Events.TTS_START);

            this.currentAudioUrl = URL.createObjectURL(audioBlob);
            this.currentAudio = new Audio(this.currentAudioUrl);
            
            const source = this.audioContext.createMediaElementSource(this.currentAudio);
            source.connect(this.analyser).connect(this.audioContext.destination);

            let processedText = segmentText;
            let emotionMarkers = [];
            if (this.emotionMapper) {
                const info = this.emotionMapper.prepareTextForTTS(segmentText);
                processedText = info.text;
                emotionMarkers = info.emotionMarkers;
            }

            const prefix = `${this.config.subtitle_labels?.ai || 'Fake Neuro'}: `;
            
            // --- 核心修改：调用UIController的新接口 ---
            if (this.uiController && this._isFirstSegmentOfResponse) {
                this.uiController.startNewSubtitle(prefix);
                this._isFirstSegmentOfResponse = false;
            }
            
            const segmentLength = processedText.length;
            let charDisplayIndex = 0;

            const startTextAnimation = () => {
                const audioDuration = this.currentAudio.duration * 1000;
                const charInterval = Math.max(30, Math.min(200, audioDuration / segmentLength));

                this._textAnimInterval = setInterval(() => {
                    if (this.shouldStop) {
                        clearInterval(this._textAnimInterval);
                        return;
                    }
                    if (charDisplayIndex < segmentLength) {
                        charDisplayIndex++;
                        if (this.emotionMapper) {
                            this.emotionMapper.triggerEmotionByTextPosition(charDisplayIndex, segmentLength, emotionMarkers);
                        }
                        
                        const currentAnimatedPart = processedText.substring(0, charDisplayIndex);
                        const currentDisplay = this._fullResponseText + currentAnimatedPart;
                        
                        // --- 核心修改：调用UIController的新接口 ---
                        if (this.uiController) {
                            this.uiController.updateLastLine(prefix + currentDisplay);
                        }
                    }
                }, charInterval);
            };

            const updateMouth = () => {
                if (this.shouldStop || !this.currentAudio) return;
                this.analyser.getByteFrequencyData(this.dataArray);
                const average = this.dataArray.reduce((sum, val) => sum + val, 0) / (this.dataArray.length / 2);
                const mouthOpenValue = Math.pow(average / 256, 0.8) * 1;
                if (this.onAudioDataCallback) this.onAudioDataCallback(mouthOpenValue);
                if (!this.shouldStop) {
                    this._renderFrameId = requestAnimationFrame(updateMouth);
                }
            };
            
            this.currentAudio.oncanplaythrough = startTextAnimation;
            this.currentAudio.onplay = updateMouth;

            this.currentAudio.onended = () => {
                this._fullResponseText += processedText;
                this.cleanup();
                resolve({ completed: true });
            };

            this.currentAudio.onerror = (e) => {
                this.cleanupOnError();
                resolve({ error: true });
            };

            this.currentAudio.play().catch(e => {
                this.cleanupOnError();
                resolve({ error: true });
            });
        });
    }

    cleanup() {
        if (this._textAnimInterval) clearInterval(this._textAnimInterval);
        if (this._renderFrameId) cancelAnimationFrame(this._renderFrameId);
        if (this.currentAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
        this._textAnimInterval = null;
        this._renderFrameId = null;
        this.currentAudioUrl = null;
        this.currentAudio = null;
        this.isPlaying = false;
        if (this.onAudioDataCallback) this.onAudioDataCallback(0);
    }
    
    cleanupOnError() {
        this.cleanup();
        this._fullResponseText = '';
        this._isFirstSegmentOfResponse = true;
    }

    stop() {
        this.shouldStop = true;
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.src = "";
        }
        this.cleanupOnError();
        this.shouldStop = false;
    }

    reset() {
        this.stop();
        this._fullResponseText = '';
        this._isFirstSegmentOfResponse = true;
        if (this.uiController) {
           this.uiController.clear();
        }
    }
}

module.exports = { TTSPlaybackEngine };