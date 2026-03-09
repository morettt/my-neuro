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
        this.currentAudioResolve = null;

        // 动画和渲染
        this._textAnimInterval = null;
        this._renderFrameId = null;

        // 文本状态
        this.displayedText = '';
        this.currentSegmentText = '';

        // 情绪映射器和表情映射器
        this.emotionMapper = null;
        this.expressionMapper = null; 
    }

    // 设置情绪映射器
    setEmotionMapper(emotionMapper) {
        this.emotionMapper = emotionMapper;
    }

    // 设置表情映射器
    setExpressionMapper(expressionMapper) {
        this.expressionMapper = expressionMapper;
        // console.log('TTS播放引擎已设置表情映射器');
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
            this.currentAudioResolve = resolve;
            
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
            
            // 预处理文本（提取情绪标记和表情标记）
            let processedText = segmentText;
            let emotionMarkers = [];
            let expressionMarkers = [];
            
            if (this.emotionMapper) {
                const info = this.emotionMapper.prepareTextForTTS(segmentText);
                processedText = info.text;
                emotionMarkers = info.emotionMarkers;
            }
            
            
            // ✅ 修复：表情映射器也需要处理文本
            if (this.expressionMapper) {
                // 使用表情映射器的预处理方法
                const exprInfo = this.expressionMapper.prepareTextForTTS(segmentText);
                // 确保使用处理后的文本
                processedText = exprInfo.text; 
                expressionMarkers = exprInfo.emotionMarkers || [];
                
                console.log(`表情映射器找到 ${expressionMarkers.length} 个表情标记`);
            }
            
            const segmentLength = processedText.length;
            let charDisplayIndex = 0;
            // let textAnimInterval = null;
            
            // 🔥 文本动画函数
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
                            
                            
                            // 触发表情
                            if (this.expressionMapper) {
                                // 方法1: 直接通过情绪标签触发表情
                                if (this.expressionMapper.triggerExpressionByEmotion) {
                                    // 检查当前位置是否有情绪标记
                                    for (let i = emotionMarkers.length - 1; i >= 0; i--) {
                                        const marker = emotionMarkers[i];
                                        if (charDisplayIndex >= marker.position && 
                                            charDisplayIndex <= marker.position + 2) {
                                            this.expressionMapper.triggerExpressionByEmotion(marker.emotion);
                                            break;
                                        }
                                    }
                                }
                                
                                // 方法2: 如果有表情标记器，使用表情标记器
                                if (expressionMarkers.length > 0 && 
                                    this.expressionMapper.triggerEmotionByTextPosition) {
                                    this.expressionMapper.triggerEmotionByTextPosition(
                                        charDisplayIndex, segmentLength, expressionMarkers
                                    );
                                }
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
            
            // 提取表情标记
            this.extractExpressionMarkers = (originalText, processedText) => {
                const markers = [];
                const pattern = /<expression:([^>]+)>/g;
                let match;
                let offset = 0;
                
                while ((match = pattern.exec(originalText)) !== null) {
                    const expressionName = match[1];
                    const originalPosition = match.index;
                    
                    // 计算在processedText中的位置
                    const adjustedPosition = originalPosition - offset;
                    offset += match[0].length;
                    
                    markers.push({
                        position: adjustedPosition,
                        expression: expressionName,
                        fullTag: match[0]
                    });
                }
                
                return markers;
            };
            
            // 根据位置触发表情
            this.triggerExpressionByPosition = (position, textLength, expressionMarkers) => {
                if (!expressionMarkers || expressionMarkers.length === 0) return;
                
                // 检查当前位置是否匹配表情标记
                for (let i = expressionMarkers.length - 1; i >= 0; i--) {
                    const marker = expressionMarkers[i];
                    if (position >= marker.position && position <= marker.position + 2) {
                        this.expressionMapper.triggerExpression(marker.expression);
                        expressionMarkers.splice(i, 1);
                        break;
                    }
                }
                
                // 如果到达文本末尾，触发所有剩余的表情标记
                if (position >= textLength - 1 && expressionMarkers.length > 0) {
                    for (const marker of expressionMarkers) {
                        this.expressionMapper.triggerExpression(marker.expression);
                    }
                    expressionMarkers.length = 0;
                }
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
                // 清理定时器
                if (this.currentAudio._fadeOutTimer) {
                    clearTimeout(this.currentAudio._fadeOutTimer);
                }
                
                // 停止嘴形动画
                if (this.onAudioDataCallback) this.onAudioDataCallback(0);
                
                // 停止文本动画
                if (this._textAnimInterval) {
                    cancelAnimationFrame(this._textAnimInterval);
                    this._textAnimInterval = null;
                }
                
                // 停止渲染帧
                if (this._renderFrameId) {
                    cancelAnimationFrame(this._renderFrameId);
                    this._renderFrameId = null;
                }
                
    
                // 触发剩余情绪
                if (this.emotionMapper && emotionMarkers.length > 0) {
                    emotionMarkers.forEach(m => {
                        this.emotionMapper.playConfiguredEmotion(m.emotion);
                        
                        // 同步触发表情
                        if (global.expressionMapper && global.expressionMapper.triggerExpressionByEmotion) {
                            setTimeout(() => {
                                global.expressionMapper.triggerExpressionByEmotion(m.emotion);
                            }, 100);
                        }
                    });
                }
                
                // 更新显示文本
                this.displayedText += processedText;
                if (typeof showSubtitle === 'function') {
                    showSubtitle(`${this.config.subtitle_labels?.ai || 'Fake Neuro'}: ${this.displayedText}`);
                }
                
                this.cleanup();
                this.isPlaying = false;
                if (this.currentAudioResolve) {
                    this.currentAudioResolve({ completed: true });
                    this.currentAudioResolve = null;
                }

                // 触发结束回调
                if (this.onEndCallback) {
                    this.onEndCallback();
                }
                
                eventBus.emit(Events.TTS_END);
                resolve({ completed: true });
            };
            
            this.currentAudio.onerror = (e) => {
                console.error('音频播放错误:', e);
                
                // 错误时也切换默认表情
                if (this.expressionMapper) {
                    // this.expressionMapper.triggerExpression("表情7");
                    const defaultExpr = this.expressionMapper.defaultExpression || "表情1";
                    this.expressionMapper.triggerExpression(defaultExpr);
                }
                
                this.cleanupOnError();
                eventBus.emit(Events.TTS_END);
                if (this.currentAudioResolve) {
                    this.currentAudioResolve({ error: true });
                    this.currentAudioResolve = null;
                }

                if (this.onEndCallback) {
                    this.onEndCallback();
                }
                
                resolve({ error: true });
            };
            
            
            // 开始播放
            this.currentAudio.play().catch(error => {
                console.error('播放失败:', error);
                
                // 播放失败时切换默认表情
                if (this.expressionMapper) {
                    const defaultExpr = this.expressionMapper.defaultExpression || "表情1";
                    this.expressionMapper.triggerExpression(defaultExpr);
                }
                
                this.cleanupOnError();
                eventBus.emit(Events.TTS_END);
                
                if (this.onEndCallback) {
                    this.onEndCallback();
                }
                
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
        if (this.currentAudioResolve) {
            this.currentAudioResolve({ completed: false, stopped: true });
            this.currentAudioResolve = null;
        }
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
