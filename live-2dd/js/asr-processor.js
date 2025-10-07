// ASR（自动语音识别）功能模块 - 支持语音打断
class ASRProcessor {
    constructor(vadUrl, asrUrl, config = null) {
        this.vadUrl = vadUrl;
        this.asrUrl = asrUrl;
        this.config = config || {};

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
            // 修改：根据语音打断配置决定是否在TTS播放时处理VAD
            if (!this.voiceBargeInEnabled) {
                // 传统模式：TTS播放时完全忽略VAD
                if (this.isProcessingAudio || this.asrLocked) return;
            } else {
                // 语音打断模式：只在ASR被锁定时忽略（用户输入处理中）
                if (this.asrLocked) return;
            }

            const data = JSON.parse(event.data);
            const isSpeaking = data.is_speech;

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
            // 语音打断模式：只在用户输入处理中时不处理
            if (this.asrLocked) return;

            // 语音打断逻辑：如果TTS正在播放且检测到人声，立即打断
            if (global.isPlayingTTS && this.ttsProcessor) {
                console.log('检测到用户语音，执行语音打断');
                this.ttsProcessor.interrupt();
                // 设置全局状态，防止其他模块干扰
                global.isPlayingTTS = false;
                global.isProcessingUserInput = true;
            }
        }

        // 立即设置全局状态为正在处理用户输入，防止自动对话触发
        global.isProcessingUserInput = true;

        this.lastSpeechTime = Date.now();

        if (this.silenceTimeout) {
            clearTimeout(this.silenceTimeout);
            this.silenceTimeout = null;
        }

        if (!this.isRecording) {
            this.isRecording = true;
            this.recordingStartIndex = this.continuousBuffer.length;

            if (this.voiceBargeInEnabled && global.isPlayingTTS) {
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
        } else {
            // 如果不是在录音状态，重置用户输入处理标志
            global.isProcessingUserInput = false;
        }
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
                } else {
                    // 语音打断模式：只在ASR锁定时跳过音频处理
                    if (this.asrLocked) return;
                }

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

        const recordingEndIndex = this.continuousBuffer.length;
        const actualStartIndex = Math.max(0, this.recordingStartIndex - this.PRE_RECORD_SAMPLES);
        const recordedSamples = this.continuousBuffer.slice(actualStartIndex, recordingEndIndex);

        if (recordedSamples.length > this.SAMPLE_RATE * 0.5) {
            const wavBlob = this.float32ToWav(new Float32Array(recordedSamples));

            // 语音打断模式下的特殊提示
            if (this.voiceBargeInEnabled && !global.isPlayingTTS) {
                console.log('语音打断：录音完成，正在识别...');
            }

            await this.processRecording(wavBlob);
        } else {
            console.log("录音太短，丢弃");
            // 即使丢弃录音也保持锁定，直到交互完成
            this.asrLocked = false;
            // 重置全局处理状态
            global.isProcessingUserInput = false;
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

        // 判断是否使用SiliconFlow云端ASR
        const useSiliconFlow = this.config.asr?.siliconflow?.enabled === true;
        let asrUrl;

        if (useSiliconFlow) {
            // 使用SiliconFlow云端
            asrUrl = this.config.asr.siliconflow.url;
            if (this.config.asr.siliconflow.model) {
                formData.append('model', this.config.asr.siliconflow.model);
            }
        } else {
            // 使用本地ASR
            asrUrl = this.asrUrl;
        }

        try {
            const headers = {};

            // 如果使用SiliconFlow且配置了API Key，添加到请求头
            if (useSiliconFlow && this.config.asr.siliconflow.api_key) {
                headers['Authorization'] = `Bearer ${this.config.asr.siliconflow.api_key}`;
            }

            console.log(`使用${useSiliconFlow ? 'SiliconFlow（云端）' : '本地'}ASR: ${asrUrl}`);

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
                // 重置全局处理状态
                global.isProcessingUserInput = false;
                return null;
            }
        } catch (error) {
            console.error('处理录音失败:', error);
            // 如果处理失败，也要解锁ASR以便用户重试
            this.asrLocked = false;
            // 重置全局处理状态
            global.isProcessingUserInput = false;
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