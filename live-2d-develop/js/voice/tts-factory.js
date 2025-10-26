// tts-factory.js - TTS处理器工厂模块
const { EnhancedTextProcessor } = require('./tts-processor.js');
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');

class TTSFactory {
    static create(config, modelController, voiceChat, uiController, onBarrageTTSComplete) {
        const ttsEnabled = config.tts?.enabled !== false;
        const asrEnabled = config.asr?.enabled !== false;

        if (ttsEnabled) {
            return new EnhancedTextProcessor(
                config.tts.url,
                uiController,
                (value) => modelController.setMouthOpenY(value),
                () => {
                    if (voiceChat && asrEnabled && !config.asr?.voice_barge_in) {
                        voiceChat.pauseRecording();
                    }
                },
                () => {
                    if (voiceChat && asrEnabled && !config.asr?.voice_barge_in) {
                        voiceChat.resumeRecording();
                    }
                    eventBus.emit(Events.INTERACTION_UPDATED);
                    onBarrageTTSComplete();
                },
                config
            );
        } else {
            // --- 核心修复：更新虚拟TTS以使用新的UIController接口 ---
            const virtualTTS = {
                processTextToSpeech: (text) => {
                    uiController.addNewLine(`Fake Neuro: ${text}`, 3000);
                    if (virtualTTS.onEndCallback) virtualTTS.onEndCallback();
                    setTimeout(() => {
                        eventBus.emit(Events.INTERACTION_UPDATED);
                        onBarrageTTSComplete();
                    }, 3000);
                },
                addStreamingText: (text) => {
                    if (!virtualTTS.accumulatedText) {
                        virtualTTS.accumulatedText = '';
                        uiController.startNewSubtitle(`Fake Neuro: `);
                    }
                    virtualTTS.accumulatedText += text;
                    uiController.updateLastLine(`Fake Neuro: ${virtualTTS.accumulatedText}`);
                },
                finalizeStreamingText: () => {
                    if (virtualTTS.accumulatedText) {
                        uiController.addNewLine(`Fake Neuro: ${virtualTTS.accumulatedText}`, 3000);
                        virtualTTS.accumulatedText = '';
                        if (virtualTTS.onEndCallback) virtualTTS.onEndCallback();
                        setTimeout(() => {
                           eventBus.emit(Events.INTERACTION_UPDATED);
                           onBarrageTTSComplete();
                        }, 3000);
                    }
                },
                interrupt: () => {
                    virtualTTS.accumulatedText = '';
                    uiController.clear();
                    if (virtualTTS.onEndCallback) virtualTTS.onEndCallback();
                },
                reset: () => {
                    virtualTTS.accumulatedText = '';
                    uiController.clear();
                },
                setEmotionMapper: (mapper) => { virtualTTS.emotionMapper = mapper; },
                isPlaying: () => false,
                accumulatedText: '',
                onEndCallback: null
            };
            
            virtualTTS.onEndCallback = () => {
                if (voiceChat && asrEnabled) {
                    voiceChat.resumeRecording();
                }
            };

            return virtualTTS;
        }
    }
}

module.exports = { TTSFactory };