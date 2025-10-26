// ASRController.js - ASR控制器
const { ASRProcessor } = require('../../voice/asr-processor.js');
const { eventBus } = require('../../core/event-bus.js');
const { Events } = require('../../core/events.js');

class ASRController {
    constructor(vadUrl, asrUrl, config, inputRouter, diaryManager) {
        this.config = config;
        this.inputRouter = inputRouter;
        this.diaryManager = diaryManager;
        this.asrEnabled = config.asr?.enabled !== false;
        this.voiceBargeInEnabled = config.asr?.voice_barge_in || false;

        if (!this.asrEnabled) {
            this.asrProcessor = null;
            return;
        }

        this.asrProcessor = new ASRProcessor(vadUrl, asrUrl, config);
        this.setupASRCallback();
    }

    setupASRCallback() {
        this.asrProcessor.setOnSpeechRecognized(async (text) => {
            // --- 核心修复：使用 uiController 的 addNewLine 方法 ---
            if (this.inputRouter.uiController) {
                this.inputRouter.uiController.addNewLine(`${this.config.subtitle_labels.user}: ${text}`, 3000);
            }

            eventBus.emit(Events.USER_INPUT_START);
            if (this.diaryManager) {
                this.diaryManager.resetTimer();
            }

            try {
                await this.inputRouter.handleVoiceInput(text);
            } finally {
                eventBus.emit(Events.USER_INPUT_END);
                if (this.asrProcessor) {
                    setTimeout(() => {
                        this.asrProcessor.resumeRecording();
                    }, 100);
                }
            }
        });
    }

    // ... (其他方法保持不变)
    
    setTTSProcessor(ttsProcessor) {
        if (this.asrProcessor && this.voiceBargeInEnabled && ttsProcessor) {
            this.asrProcessor.setTTSProcessor(ttsProcessor);
        }
    }
    async startRecording() {
        if (this.asrEnabled && this.asrProcessor) await this.asrProcessor.startRecording();
    }
    stopRecording() {
        if (this.asrEnabled && this.asrProcessor) this.asrProcessor.stopRecording();
    }
    async pauseRecording() {
        if (this.asrEnabled && this.asrProcessor) this.asrProcessor.pauseRecording();
    }
    async resumeRecording() {
        if (this.asrEnabled && this.asrProcessor) this.asrProcessor.resumeRecording();
    }
    getVoiceBargeInStatus() {
        if (!this.asrEnabled || !this.asrProcessor) return { enabled: false };
        return this.asrProcessor.getVoiceBargeInStatus();
    }
    setVoiceBargeIn(enabled, ttsProcessor) {
        this.voiceBargeInEnabled = enabled;
        if (this.asrEnabled && this.asrProcessor) {
            this.asrProcessor.setVoiceBargeIn(enabled);
            if (enabled && ttsProcessor) this.asrProcessor.setTTSProcessor(ttsProcessor);
        }
    }
    isEnabled() {
        return this.asrEnabled;
    }
}

module.exports = { ASRController };