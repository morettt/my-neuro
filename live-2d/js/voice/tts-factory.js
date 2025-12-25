// tts-factory.js - TTS处理器工厂模块
const { EnhancedTextProcessor } = require('./tts-processor.js');
const { logToTerminal } = require('../api-utils.js');
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');

class TTSFactory {
    // 创建TTS处理器
    static create(config, modelController, voiceChat, uiController, onBarrageTTSComplete) {
        const ttsEnabled = config.tts?.enabled !== false;
        const asrEnabled = config.asr?.enabled !== false;

        if (ttsEnabled) {
            return new EnhancedTextProcessor(
                config.tts.url,
                (value) => modelController.setMouthOpenY(value),
                () => {
                    // TTS开始时的回调 - 事件已由tts-processor发出，无需手动管理
                    if (voiceChat && asrEnabled && !config.asr?.voice_barge_in) {
                        voiceChat.pauseRecording();
                    }
                },
                () => {
                    // TTS结束时的回调 - 事件已由tts-processor发出，无需手动管理
                    if (voiceChat && asrEnabled && !config.asr?.voice_barge_in) {
                        voiceChat.resumeRecording();
                    }
                    // 发送交互更新事件
                    eventBus.emit(Events.INTERACTION_UPDATED);
                    // 调用新的TTS完成回调
                    onBarrageTTSComplete();
                },
                config
            );
        } else {
            // 创建虚拟TTS处理器（纯文本模式）
            const virtualTTS = {
                reset: () => {},
                processTextToSpeech: (text) => {
                    // 直接显示文本，不进行语音合成
                    uiController.showSubtitle(`Fake Neuro: ${text}`, 3000);

                    // 添加到聊天记录
                    const chatMessages = document.getElementById('chat-messages');
                    if (chatMessages) {
                        const messageElement = document.createElement('div');
                        messageElement.innerHTML = `<strong>Fake Neuro:</strong> ${text}`;
                        chatMessages.appendChild(messageElement);
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }

                    // 立即调用结束回调，解锁ASR
                    if (virtualTTS.onEndCallback) {
                        virtualTTS.onEndCallback();
                    }

                    // 模拟TTS结束，延迟3秒后触发其他逻辑
                    setTimeout(() => {
                        // 发送交互更新事件
                        eventBus.emit(Events.INTERACTION_UPDATED);
                        onBarrageTTSComplete();
                    }, 3000);
                },
                addStreamingText: (text) => {
                    // 在纯文本模式下，流式文本直接累积显示，带自动消失
                    if (!virtualTTS.accumulatedText) virtualTTS.accumulatedText = '';
                    virtualTTS.accumulatedText += text;
                    uiController.showSubtitle(`Fake Neuro: ${virtualTTS.accumulatedText}`, 3000);
                },
                finalizeStreamingText: () => {
                    if (virtualTTS.accumulatedText) {
                        // 最终确保字幕会在3秒后消失
                        uiController.showSubtitle(`Fake Neuro: ${virtualTTS.accumulatedText}`, 3000);

                        // 添加到聊天记录
                        const chatMessages = document.getElementById('chat-messages');
                        if (chatMessages) {
                            const messageElement = document.createElement('div');
                            messageElement.innerHTML = `<strong>Fake Neuro:</strong> ${virtualTTS.accumulatedText}`;
                            chatMessages.appendChild(messageElement);
                            chatMessages.scrollTop = chatMessages.scrollHeight;
                        }
                        virtualTTS.accumulatedText = '';

                        // 立即调用结束回调，解锁ASR
                        if (virtualTTS.onEndCallback) {
                            virtualTTS.onEndCallback();
                        }

                        // 3秒后模拟TTS结束的其他逻辑
                        setTimeout(() => {
                            // 发送交互更新事件
                            eventBus.emit(Events.INTERACTION_UPDATED);
                            onBarrageTTSComplete();
                        }, 3000);
                    }
                },
                interrupt: () => {
                    virtualTTS.accumulatedText = '';
                    uiController.hideSubtitle();
                    // 立即调用结束回调，确保ASR解锁
                    if (virtualTTS.onEndCallback) {
                        virtualTTS.onEndCallback();
                    }
                },
                setEmotionMapper: (mapper) => {
                    // 在纯文本模式下也支持情绪映射
                    virtualTTS.emotionMapper = mapper;
                },
                isPlaying: () => false,
                accumulatedText: '',
                onEndCallback: null
            };

            console.log('TTS已禁用，使用纯文本模式');
            logToTerminal('info', 'TTS已禁用，使用纯文本模式');

            return virtualTTS;
        }
    }
}

module.exports = { TTSFactory };
