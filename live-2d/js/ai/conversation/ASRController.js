// ASRController.js - ASR控制器
const { ASRProcessor } = require('../../voice/asr-processor.js');
const { BaiduStreamingASR } = require('../../voice/baidu-streaming-asr.js');
const { eventBus } = require('../../core/event-bus.js');
const { Events } = require('../../core/events.js');

/**
 * 负责ASR处理器的创建、录音控制、语音输入回调
 */
class ASRController {
    constructor(vadUrl, asrUrl, config, inputRouter, diaryManager) {
        this.config = config;
        this.inputRouter = inputRouter;
        this.diaryManager = diaryManager;

        // 检查是否使用百度流式ASR
        this.useBaiduStreamingASR = config.cloud?.baidu_asr?.enabled === true;

        // 检查ASR是否可用（本地ASR或百度流式ASR任一启用即可）
        const localASREnabled = config.asr?.enabled !== false;
        this.asrEnabled = localASREnabled || this.useBaiduStreamingASR;
        this.voiceBargeInEnabled = config.asr?.voice_barge_in || false;

        console.log(`语音打断功能: ${this.voiceBargeInEnabled ? '已可用' : '已禁用'}`);
        console.log(`百度流式ASR: ${this.useBaiduStreamingASR ? '已启用' : '已禁用'}`);

        if (!this.asrEnabled) {
            console.log('ASR已禁用，跳过ASR处理器初始化');
            this.asrProcessor = null;
            return;
        }

        // 根据配置选择ASR处理器
        if (this.useBaiduStreamingASR) {
            // 使用百度流式ASR
            console.log('使用百度流式ASR');
            this.asrProcessor = new BaiduStreamingASR(config);
            // 设置实时字幕回调
            this.setupInterimResultCallback();
        } else {
            // 使用原有的ASR处理器
            this.asrProcessor = new ASRProcessor(vadUrl, asrUrl, config);
        }

        // 设置ASR回调
        this.setupASRCallback();
    }

    /**
     * 设置实时字幕回调（百度流式ASR专用）
     */
    setupInterimResultCallback() {
        if (this.asrProcessor.setOnInterimResult) {
            this.asrProcessor.setOnInterimResult((interimText) => {
                const showSubtitle = this.inputRouter.showSubtitle;
                // 显示临时字幕，不设置自动隐藏（会被下一次更新覆盖）
                showSubtitle(`${this.config.subtitle_labels.user}: ${interimText}`, 0);
            });
        }
    }

    /**
     * 设置ASR语音识别回调
     */
    setupASRCallback() {
        // 文本合并窗口状态
        this._pendingText = '';
        this._mergeTimer = null;
        this._MERGE_WINDOW = this.config.asr?.merge_window_ms ?? 2000;

        const flush = async (showSubtitle) => {
            // 如果用户还在说话或 ASR 还在处理，推迟 200ms 再检查
            if (this.asrProcessor?.isRecording || this.asrProcessor?.asrLocked) {
                this._mergeTimer = setTimeout(() => flush(showSubtitle), 200);
                return;
            }

            const finalText = this._pendingText;
            this._pendingText = '';
            this._mergeTimer = null;

            console.log(`语音合并完成，提交文本: "${finalText}"`);
            showSubtitle(`${this.config.subtitle_labels.user}: ${finalText}`, 3000);

            const dm = this.diaryManager || global.diaryManager;
            if (dm) dm.resetTimer();

            try {
                await this.inputRouter.handleVoiceInput(finalText);
                eventBus.emit(Events.USER_MESSAGE_RECEIVED);
            } finally {
                if (this.asrProcessor) {
                    setTimeout(() => {
                        this.asrProcessor.resumeRecording();
                        console.log('ASR已在对话结束后解锁');
                    }, 100);
                }
            }
        };

        this.asrProcessor.setOnSpeechRecognized(async (text) => {
            const showSubtitle = this.inputRouter.showSubtitle;

            // 拼接到待发送文本（卡壳续说场景）
            this._pendingText = this._pendingText
                ? this._pendingText + '，' + text
                : text;

            // 实时显示已累积的文本
            showSubtitle(`${this.config.subtitle_labels.user}: ${this._pendingText}`, 0);

            // 清掉上一个 timer，重新计时
            if (this._mergeTimer) {
                clearTimeout(this._mergeTimer);
            }

            // 解锁 ASR，让下一段能继续录入
            if (this.asrProcessor) {
                this.asrProcessor.resumeRecording();
            }

            // 等 merge window 后再 flush，期间若 asrLocked 会自动推迟
            this._mergeTimer = setTimeout(() => flush(showSubtitle), this._MERGE_WINDOW);
        });
    }

    /**
     * 设置TTS处理器（用于语音打断）
     */
    setTTSProcessor(ttsProcessor) {
        if (this.asrProcessor && this.voiceBargeInEnabled && ttsProcessor) {
            this.asrProcessor.setTTSProcessor(ttsProcessor);
            console.log('TTS处理器已设置到ASR，支持语音打断');
        }
    }

    /**
     * 开始录音
     */
    async startRecording() {
        if (this.asrEnabled && this.asrProcessor) {
            await this.asrProcessor.startRecording();
            console.log('ASR录音已启动');
        } else {
            console.log('ASR已禁用，无法开始录音');
        }
    }

    /**
     * 停止录音
     */
    stopRecording() {
        if (this.asrEnabled && this.asrProcessor) {
            this.asrProcessor.stopRecording();
            console.log('ASR录音已停止');
        } else {
            console.log('ASR已禁用，无需停止录音');
        }
    }

    /**
     * 暂停录音
     */
    async pauseRecording() {
        if (this.asrEnabled && this.asrProcessor) {
            this.asrProcessor.pauseRecording();
            if (this.voiceBargeInEnabled) {
                console.log('语音打断模式：保持VAD监听');
            } else {
                console.log('传统模式：Recording paused due to TTS playback');
            }
        }
    }

    /**
     * 恢复录音
     */
    async resumeRecording() {
        if (this.asrEnabled && this.asrProcessor) {
            this.asrProcessor.resumeRecording();
            if (this.voiceBargeInEnabled) {
                console.log('语音打断模式：ASR已解锁');
            } else {
                console.log('传统模式：Recording resumed after TTS playback, ASR unlocked');
            }
        }
    }

    /**
     * 获取语音打断状态
     */
    getVoiceBargeInStatus() {
        if (!this.asrEnabled || !this.asrProcessor) {
            return { enabled: false, reason: 'ASR未可用' };
        }
        return this.asrProcessor.getVoiceBargeInStatus();
    }

    /**
     * 动态切换语音打断功能
     */
    setVoiceBargeIn(enabled, ttsProcessor) {
        this.voiceBargeInEnabled = enabled;
        if (this.asrEnabled && this.asrProcessor) {
            this.asrProcessor.setVoiceBargeIn(enabled);

            // 如果可用语音打断，确保TTS处理器引用设置正确
            if (enabled && ttsProcessor) {
                this.asrProcessor.setTTSProcessor(ttsProcessor);
                console.log('语音打断已可用，TTS处理器引用已设置');
            }
        } else {
            console.log('ASR未可用，无法切换语音打断功能');
        }
    }

    /**
     * 检查ASR是否可用
     */
    isEnabled() {
        return this.asrEnabled;
    }
}

module.exports = { ASRController };
