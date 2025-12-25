// ASR（自动语音识别）功能模块 - 支持语音打断
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');
const { appState } = require('../core/app-state.js');

class ASRProcessor {
    constructor(vadUrl, asrUrl, config = null) {
        this.config = config || {};

        // 根据网关配置选择 VAD WebSocket URL
        const gatewayConfig = this.config.api_gateway || {};
        if (gatewayConfig.use_gateway) {
            // 使用网关模式：通过查询参数传递 API Key
            const wsBaseUrl = gatewayConfig.base_url.replace('http://', 'ws://').replace('https://', 'wss://');
            const apiKey = gatewayConfig.api_key || '';
            this.vadUrl = `${wsBaseUrl}/asr/vad/ws?X-API-Key=${encodeURIComponent(apiKey)}`;
        } else {
            // 使用本地模式
            this.vadUrl = vadUrl;
        }

        // ASR 上传 URL 会在 processRecording 中根据网关配置动态选择
        this.asrUrl = asrUrl;

        // 语音打断配置
        this.voiceBargeInEnabled = this.config.asr?.voice_barge_in || false;
        console.log(`语音打断功能: ${this.voiceBargeInEnabled ? '已启用' : '已禁用'}`);

        this.isProcessingAudio = false;
        this.asrLocked = false;

        // 音频相关参数
        this.audioContext = null;
        this.mediaStream = null;
        this.ws = null;
        this.SAMPLE_RATE = 16000;
        this.WINDOW_SIZE = 512;
        this.retryCount = 0;
        this.MAX_RETRIES = 5;

        // 缓冲区设置
        this.audioBuffer = [];
        this.BUFFER_DURATION = 1000;
        this.BUFFER_SIZE = Math.floor(this.SAMPLE_RATE * (this.BUFFER_DURATION / 1000));

        // 录音相关
        this.isRecording = false;
        this.continuousBuffer = [];
        this.recordingStartIndex = 0;
        this.PRE_RECORD_TIME = 1;
        this.PRE_RECORD_SAMPLES = this.SAMPLE_RATE * this.PRE_RECORD_TIME;

        // 静音检测
        this.lastSpeechTime = 0;
        this.SILENCE_THRESHOLD = 500;
        this.silenceTimeout = null;

        // 新增：TTS处理器引用，用于语音打断
        this.ttsProcessor = null;

        // 新增：防止重复触发中断的标志
        this.hasInterruptedThisSession = false;

        // 初始化
        this.setupAudioSystem();
    }

    // 设置TTS处理器引用（用于语音打断）
    setTTSProcessor(ttsProcessor) {
        this.ttsProcessor = ttsProcessor;
        console.log('TTS处理器已设置到ASR，语音打断功能可用');
    }

    async setupAudioSystem() {
        try {
            await this.setupWebSocket();
        } catch (error) {
            console.error('音频系统设置错误:', error);
        }
    }

    async setupWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }

        this.ws = new WebSocket(this.vadUrl);

        this.ws.onopen = async () => {
            console.log('VAD WebSocket已连接');
            this.retryCount = 0;
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const isSpeaking = data.is_speech;

            // 修改：根据语音打断配置决定是否在TTS播放时处理VAD
            if (!this.voiceBargeInEnabled) {
                // 传统模式：TTS播放时完全忽略VAD
                if (this.isProcessingAudio || this.asrLocked) return;
            }
            // 语音打断模式：不在这里检查asrLocked，让handleSpeech自己决定

            if (isSpeaking) {
                this.handleSpeech();
            } else {
                this.handleSilence();
            }
        };

        this.ws.onclose = () => {
            console.log('VAD WebSocket已断开');
            if (this.retryCount < this.MAX_RETRIES) {
                this.retryCount++;
                console.log(`尝试重新连接... (${this.retryCount}/${this.MAX_RETRIES})`);
                setTimeout(() => this.setupWebSocket(), 1000);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
        };
    }

    handleSpeech() {
        // 修改：根据语音打断配置处理人声检测
        if (!this.voiceBargeInEnabled) {
            // 传统模式：TTS播放时不处理
            if (this.isProcessingAudio || this.asrLocked) return;
        } else {
            // 语音打断模式：优先检查语音打断逻辑
            // 只要在处理用户输入期间（包括工具调用），就允许打断
            // 🔥 关键修复：只在第一次检测到语音时触发中断，避免重复触发
            if ((appState.isPlayingTTS() || appState.isProcessingUserInput()) &&
                this.ttsProcessor &&
                !this.hasInterruptedThisSession) {
                console.log('🎤 检测到用户语音，执行语音打断');
                this.ttsProcessor.interrupt();
                this.hasInterruptedThisSession = true; // 标记已触发中断

                // 🔥 关键修复：打断时重置 ASR 锁定状态，允许新的录音开始
                // 这样用户可以在工具调用期间打断并立即开始新的输入
                if (this.asrLocked) {
                    console.log('🔓 打断时解锁 ASR，允许新的语音输入');
                    this.asrLocked = false;
                }
            }

            // 语音打断后，如果ASR被锁定（正在处理之前的识别），则不开始新的录音
            if (this.asrLocked) return;
        }

        // 用户输入开始事件将由后续的ASR识别完成后发出，这里不需要提前发送

        this.lastSpeechTime = Date.now();

        if (this.silenceTimeout) {
            clearTimeout(this.silenceTimeout);
            this.silenceTimeout = null;
        }

        if (!this.isRecording) {
            this.isRecording = true;
            this.recordingStartIndex = this.continuousBuffer.length;

            if (this.voiceBargeInEnabled && appState.isPlayingTTS()) {
                console.log('语音打断：开始录音');
            } else {
                console.log('正常模式：开始录音');
            }
        }
    }

    handleSilence() {
        // 修改：根据语音打断配置处理静音
        if (!this.voiceBargeInEnabled) {
            // 传统模式：TTS播放时不处理
            if (this.isProcessingAudio || this.asrLocked) return;
        } else {
            // 语音打断模式：只在用户输入处理中时不处理
            if (this.asrLocked) return;
        }

        if (this.isRecording) {
            const currentTime = Date.now();
            const silenceDuration = currentTime - this.lastSpeechTime;

            if (!this.silenceTimeout) {
                this.silenceTimeout = setTimeout(() => {
                    this.finishRecording();
                    this.silenceTimeout = null;
                }, this.SILENCE_THRESHOLD);
            }
        }
        // 注意：状态管理已通过事件系统自动处理，无需手动设置
    }

    async startRecording() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: this.SAMPLE_RATE,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            this.audioContext = new AudioContext({ sampleRate: this.SAMPLE_RATE });
            const microphone = this.audioContext.createMediaStreamSource(this.mediaStream);
            const scriptNode = this.audioContext.createScriptProcessor(this.WINDOW_SIZE, 1, 1);

            microphone.connect(scriptNode);
            scriptNode.connect(this.audioContext.destination);

            let lastSendTime = 0;
            const MIN_SEND_INTERVAL = 1;

            scriptNode.onaudioprocess = (e) => {
                // 修改：根据语音打断配置决定音频处理逻辑
                if (!this.voiceBargeInEnabled) {
                    // 传统模式：TTS播放时跳过音频处理
                    if (this.isProcessingAudio || this.asrLocked) return;
                }
                // 语音打断模式：不检查asrLocked,始终处理音频发送到VAD
                // asrLocked只用于防止新的录音识别,不影响VAD检测

                const currentTime = Date.now();
                const audioData = e.inputBuffer.getChannelData(0);

                this.continuousBuffer.push(...Array.from(audioData));

                if (this.continuousBuffer.length > this.SAMPLE_RATE * 30) {
                    const excessSamples = this.continuousBuffer.length - this.SAMPLE_RATE * 30;
                    this.continuousBuffer = this.continuousBuffer.slice(excessSamples);
                    if (this.isRecording) {
                        this.recordingStartIndex = Math.max(0, this.recordingStartIndex - excessSamples);
                    }
                }

                if (this.ws && this.ws.readyState === WebSocket.OPEN &&
                    currentTime - lastSendTime >= MIN_SEND_INTERVAL) {
                    this.ws.send(audioData);
                    lastSendTime = currentTime;
                }
            };

            console.log('音频处理已启动');
        } catch (err) {
            console.error('启动音频错误:', err);
        }
    }

    stopRecording() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (this.ws) {
            this.ws.close();
        }
        if (this.silenceTimeout) {
            clearTimeout(this.silenceTimeout);
        }
    }

    async finishRecording() {
        // 检查ASR是否锁定，如果锁定则不处理录音
        if (!this.isRecording || this.asrLocked) return;
        this.isRecording = false;

        // 在开始处理录音时立即锁定ASR，防止二次接收
        this.asrLocked = true;
        console.log('ASR锁定：开始处理录音');

        // 🔥 重置中断标志，允许下次语音检测时再次触发中断
        this.hasInterruptedThisSession = false;

        const recordingEndIndex = this.continuousBuffer.length;
        const actualStartIndex = Math.max(0, this.recordingStartIndex - this.PRE_RECORD_SAMPLES);
        const recordedSamples = this.continuousBuffer.slice(actualStartIndex, recordingEndIndex);

        if (recordedSamples.length > this.SAMPLE_RATE * 0.5) {
            const wavBlob = this.float32ToWav(new Float32Array(recordedSamples));

            // 语音打断模式下的特殊提示
            if (this.voiceBargeInEnabled && !appState.isPlayingTTS()) {
                console.log('语音打断：录音完成，正在识别...');
            }

            await this.processRecording(wavBlob);
        } else {
            console.log("录音太短，丢弃");
            // 即使丢弃录音也解锁ASR
            this.asrLocked = false;
            // 状态管理已通过事件系统自动处理
        }

        this.continuousBuffer = this.continuousBuffer.slice(-this.PRE_RECORD_SAMPLES);
    }

    float32ToWav(samples) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        this.writeString(view, 8, 'WAVE');
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, this.SAMPLE_RATE, true);
        view.setUint32(28, this.SAMPLE_RATE * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        this.writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        this.floatTo16BitPCM(view, 44, samples);

        return new Blob([buffer], { type: 'audio/wav' });
    }

    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    floatTo16BitPCM(view, offset, input) {
        for (let i = 0; i < input.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, input[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
    }

    async processRecording(audioBlob) {
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.wav');

        // 判断使用哪种模式
        const gatewayConfig = this.config.api_gateway || {};
        const useGateway = gatewayConfig.use_gateway === true;
        const useCloudASR = this.config.cloud?.asr?.enabled === true;
        let asrUrl;
        let mode = '本地';

        if (useGateway) {
            // 统一网关模式
            asrUrl = `${gatewayConfig.base_url}/asr/upload_audio`;
            mode = '网关';
        } else if (useCloudASR) {
            // 云服务商模式（SiliconFlow等）
            asrUrl = this.config.cloud.asr.url;
            if (this.config.cloud.asr.model) {
                formData.append('model', this.config.cloud.asr.model);
            }
            mode = `云端 (${this.config.cloud?.provider || '未知'})`;
        } else {
            // 本地ASR
            asrUrl = this.asrUrl;
        }

        try {
            const headers = {};

            // 统一网关模式：添加 X-API-Key
            if (useGateway && gatewayConfig.api_key) {
                headers['X-API-Key'] = gatewayConfig.api_key;
            }
            // 云服务商模式：添加 Authorization
            else if (useCloudASR && this.config.cloud?.api_key) {
                headers['Authorization'] = `Bearer ${this.config.cloud.api_key}`;
            }

            console.log(`使用${mode}ASR: ${asrUrl}`);

            const response = await fetch(asrUrl, {
                method: 'POST',
                headers: headers,
                body: formData
            });

            const result = await response.json();

            // 兼容云端和本地API响应格式
            // SiliconFlow: {text: "识别结果"}
            // 本地: {status: "success", text: "识别结果"}
            const recognizedText = result.text || (result.status === 'success' && result.text);

            if (recognizedText) {
                console.log("用户说:", recognizedText);

                // 语音打断模式下的特殊提示
                if (this.voiceBargeInEnabled) {
                    console.log('语音打断：识别完成，发送给AI处理');
                }

                // 回调函数，由外部实现
                if (this.onSpeechRecognized) {
                    this.onSpeechRecognized(recognizedText);
                }

                return recognizedText;
            } else {
                console.error('ASR失败:', result.message || result.error || '未知错误');
                // 如果ASR失败，也要解锁ASR以便用户重试
                this.asrLocked = false;
                // 状态管理已通过事件系统自动处理
                return null;
            }
        } catch (error) {
            console.error('处理录音失败:', error);
            // 如果处理失败，也要解锁ASR以便用户重试
            this.asrLocked = false;
            // 状态管理已通过事件系统自动处理
            return null;
        }
    }

    // 修改：暂停录音方法，根据语音打断配置调整行为
    pauseRecording() {
        if (!this.voiceBargeInEnabled) {
            // 传统模式：完全暂停音频处理
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.enabled = false);
            }
            this.isProcessingAudio = true;
            console.log('传统模式：Recording paused');
        } else {
            // 语音打断模式：不暂停音频处理，保持VAD监听
            console.log('语音打断模式：保持VAD监听，不暂停录音');
        }
    }

    // 修改：恢复录音方法
    resumeRecording() {
        if (!this.voiceBargeInEnabled) {
            // 传统模式：恢复音频处理
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.enabled = true);
            }
            this.isProcessingAudio = false;
            console.log('传统模式：Recording resumed');
        } else {
            // 语音打断模式：VAD一直在监听，只需要解锁ASR
            console.log('语音打断模式：ASR解锁，可以接收新的语音输入');
        }

        // 共同逻辑：解锁ASR，只有当整个对话流程完成后才解锁
        this.asrLocked = false;
        console.log('ASR已解锁');
    }

    // 设置语音识别完成的回调函数
    setOnSpeechRecognized(callback) {
        this.onSpeechRecognized = callback;
    }

    // 新增：获取语音打断状态
    getVoiceBargeInStatus() {
        return {
            enabled: this.voiceBargeInEnabled,
            isRecording: this.isRecording,
            asrLocked: this.asrLocked,
            isProcessingAudio: this.isProcessingAudio
        };
    }

    // 新增：动态切换语音打断功能
    setVoiceBargeIn(enabled) {
        this.voiceBargeInEnabled = enabled;
        console.log(`语音打断功能已${enabled ? '启用' : '禁用'}`);

        if (!enabled && this.isProcessingAudio) {
            // 如果禁用语音打断且当前在TTS播放中，恢复传统的暂停逻辑
            this.pauseRecording();
        } else if (enabled && this.isProcessingAudio) {
            // 如果启用语音打断，恢复VAD监听
            this.resumeRecording();
        }
    }
}

module.exports = { ASRProcessor };