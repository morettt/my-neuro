// 百度流式ASR模块 - 实时语音识别
const { appState } = require('../core/app-state.js');
const { logToTerminal } = require('../api-utils.js');

// 生成唯一标识符（替代uuid）
function generateId() {
    return 'xxxxxxxxxxxx'.replace(/x/g, () => {
        return Math.floor(Math.random() * 16).toString(16);
    });
}

class BaiduStreamingASR {
    constructor(config) {
        this.config = config;

        // 百度ASR配置
        const baiduConfig = config.cloud?.baidu_asr || {};
        this.wsUrl = baiduConfig.url || 'ws://vop.baidu.com/realtime_asr';
        this.appid = baiduConfig.appid;
        this.appkey = baiduConfig.appkey;
        this.devPid = baiduConfig.dev_pid || 15372;

        // 语音打断配置
        this.voiceBargeInEnabled = config.asr?.voice_barge_in || false;

        // 状态标志
        this.isRecording = false;
        this.asrLocked = false;
        this.isConnected = false;
        this.hasInterruptedThisSession = false;

        // 音频参数（与百度要求一致）
        this.SAMPLE_RATE = 16000;
        this.CHANNELS = 1;
        this.CHUNK_MS = 160;
        this.CHUNK_SIZE = Math.floor(this.SAMPLE_RATE * this.CHANNELS * 2 * this.CHUNK_MS / 1000);

        // 音频相关
        this.audioContext = null;
        this.mediaStream = null;
        this.ws = null;
        this.scriptNode = null;

        // 回调
        this.onSpeechRecognized = null;
        this.onInterimResult = null;
        this.ttsProcessor = null;

        // 当前临时结果
        this.currentInterimText = '';

        // 重连相关
        this.retryCount = 0;
        this.MAX_RETRIES = 5;
        this.reconnectTimeout = null;
    }

    setTTSProcessor(ttsProcessor) {
        this.ttsProcessor = ttsProcessor;
    }

    setOnSpeechRecognized(callback) {
        this.onSpeechRecognized = callback;
    }

    setOnInterimResult(callback) {
        this.onInterimResult = callback;
    }

    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }

            const sn = generateId().replace(/-/g, '').substring(0, 16);
            const fullUrl = `${this.wsUrl}?sn=${sn}`;

            this.ws = new WebSocket(fullUrl);

            this.ws.onopen = () => {
                this.isConnected = true;
                this.retryCount = 0;
                this.sendStartFrame();
                resolve();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.ws.onclose = (event) => {
                this.isConnected = false;

                if (this.isRecording && this.retryCount < this.MAX_RETRIES) {
                    this.retryCount++;
                    this.reconnectTimeout = setTimeout(() => {
                        this.connectWebSocket().catch(console.error);
                    }, 1000);
                }
            };

            this.ws.onerror = (error) => {
                logToTerminal('error', `百度流式ASR: WebSocket错误`);
                reject(error);
            };
        });
    }

    sendStartFrame() {
        const startFrame = {
            type: 'START',
            data: {
                appid: this.appid,
                appkey: this.appkey,
                dev_pid: this.devPid,
                cuid: 'live2d_client_' + generateId().substring(0, 8),
                sample: this.SAMPLE_RATE,
                format: 'pcm'
            }
        };

        this.ws.send(JSON.stringify(startFrame));
    }

    sendFinishFrame() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const finishFrame = { type: 'FINISH' };
            this.ws.send(JSON.stringify(finishFrame));
        }
    }

    handleMessage(message) {
        try {
            const result = JSON.parse(message);

            if (result.type === 'MID_TEXT') {
                const interimText = result.result || '';
                this.currentInterimText = interimText;

                if (interimText && this.voiceBargeInEnabled) {
                    this.handleVoiceBargeIn();
                }

                if (this.onInterimResult && interimText) {
                    this.onInterimResult(interimText);
                }

            } else if (result.type === 'FIN_TEXT') {
                const finalText = result.result || '';

                if (finalText && this.onSpeechRecognized) {
                    this.hasInterruptedThisSession = false;
                    this.currentInterimText = '';
                    this.onSpeechRecognized(finalText);
                }

            } else if (result.err_no !== undefined && result.err_no !== 0) {
                const errMsg = result.err_msg || '未知错误';
                logToTerminal('error', `百度流式ASR错误: ${result.err_no} - ${errMsg}`);
            }
        } catch (e) {
            // 忽略非JSON消息
        }
    }

    handleVoiceBargeIn() {
        if (!this.voiceBargeInEnabled) return;

        if ((appState.isPlayingTTS() || appState.isProcessingUserInput()) &&
            this.ttsProcessor &&
            !this.hasInterruptedThisSession) {

            this.ttsProcessor.interrupt();
            this.hasInterruptedThisSession = true;

            if (this.asrLocked) {
                this.asrLocked = false;
            }
        }
    }

    async startRecording() {
        if (this.isRecording) {
            return;
        }

        try {
            await this.connectWebSocket();

            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: this.CHANNELS,
                    sampleRate: this.SAMPLE_RATE,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            this.audioContext = new AudioContext({ sampleRate: this.SAMPLE_RATE });
            const microphone = this.audioContext.createMediaStreamSource(this.mediaStream);

            const bufferSize = 4096;
            this.scriptNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

            microphone.connect(this.scriptNode);
            this.scriptNode.connect(this.audioContext.destination);

            this.scriptNode.onaudioprocess = (e) => {
                if (!this.isRecording || !this.isConnected) return;
                if (this.ws?.readyState !== WebSocket.OPEN) return;

                if (!this.voiceBargeInEnabled && this.asrLocked) return;

                const audioData = e.inputBuffer.getChannelData(0);
                const pcmData = this.float32ToInt16(audioData);
                this.ws.send(pcmData.buffer);
            };

            this.isRecording = true;

        } catch (error) {
            logToTerminal('error', `百度流式ASR启动失败: ${error.message}`);
        }
    }

    float32ToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    }

    stopRecording() {
        this.isRecording = false;

        this.sendFinishFrame();

        if (this.scriptNode) {
            this.scriptNode.disconnect();
            this.scriptNode = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        this.isConnected = false;
    }

    pauseRecording() {
        if (!this.voiceBargeInEnabled) {
            this.asrLocked = true;
        }
    }

    resumeRecording() {
        this.asrLocked = false;
        this.hasInterruptedThisSession = false;
    }

    getVoiceBargeInStatus() {
        return {
            enabled: this.voiceBargeInEnabled,
            isRecording: this.isRecording,
            asrLocked: this.asrLocked,
            isConnected: this.isConnected
        };
    }

    setVoiceBargeIn(enabled) {
        this.voiceBargeInEnabled = enabled;
    }
}

module.exports = { BaiduStreamingASR };
