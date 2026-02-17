// tts-request-handler.js - TTS请求处理器
// 职责：文本翻译、TTS API调用、文本分段

const { logToTerminal } = require('../api-utils.js');
const WebSocket = require('ws');
const { randomUUID } = require('crypto');

class TTSRequestHandler {
    constructor(config, ttsUrl) {
        this.config = config;
        this.language = config.tts?.language || "zh";

        // 统一网关模式配置
        const gatewayConfig = config.api_gateway || {};
        if (gatewayConfig.use_gateway) {
            this.ttsUrl = `${gatewayConfig.base_url}/tts/synthesize`;
            this.apiKey = gatewayConfig.api_key || "";
            this.useGateway = true;
        } else {
            this.ttsUrl = ttsUrl;
            this.apiKey = null;
            this.useGateway = false;
        }

        // 阿里云TTS配置
        const aliyunTts = config.cloud?.aliyun_tts || {};
        this.aliyunTtsEnabled = aliyunTts.enabled || false;
        this.aliyunApiKey = aliyunTts.api_key || "";
        this.aliyunModel = aliyunTts.model || "cosyvoice-v3-flash";
        this.aliyunVoice = aliyunTts.voice || "";
        this.aliyunSampleRate = aliyunTts.sample_rate || 48000;
        this.aliyunVolume = aliyunTts.volume ?? 50;
        this.aliyunRate = aliyunTts.rate ?? 1;
        this.aliyunPitch = aliyunTts.pitch ?? 1;

        // 云服务商配置（SiliconFlow等，保留兼容）
        this.cloudTtsEnabled = config.cloud?.tts?.enabled || false;
        this.cloudTtsUrl = config.cloud?.tts?.url || "";
        this.cloudApiKey = config.cloud?.api_key || "";
        this.cloudTtsModel = config.cloud?.tts?.model || "";
        this.cloudTtsVoice = config.cloud?.tts?.voice || "";
        this.cloudTtsFormat = config.cloud?.tts?.response_format || "mp3";
        this.cloudTtsSpeed = config.cloud?.tts?.speed || 1.0;

        // 翻译配置
        this.translationEnabled = config.translation?.enabled || false;
        this.translationApiKey = config.translation?.api_key || "";
        this.translationApiUrl = config.translation?.api_url || "";
        this.translationModel = config.translation?.model || "";
        this.translationSystemPrompt = config.translation?.system_prompt || "";

        // 标点符号
        this.punctuations = [',', '。', '，', '？', '!', '！', '；', ';', '：', ':'];
        this.pendingSegment = '';

        // 请求管理
        this.activeRequests = new Set();
        this.requestIdCounter = 0;
    }

    // 翻译文本
    async translateText(text) {
        if (!this.translationEnabled || !text.trim()) return text;

        try {
            const response = await fetch(`${this.translationApiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.translationApiKey}`
                },
                body: JSON.stringify({
                    model: this.translationModel,
                    messages: [
                        { role: 'system', content: this.translationSystemPrompt },
                        { role: 'user', content: text }
                    ],
                    stream: false
                })
            });

            if (!response.ok) throw new Error(`翻译API错误: ${response.status}`);

            const data = await response.json();
            return data.choices[0].message.content.trim();
        } catch (error) {
            console.error('翻译失败:', error);
            return text;
        }
    }

    // 将文本转换为语音
    async convertTextToSpeech(text) {
        const requestId = ++this.requestIdCounter;
        const controller = new AbortController();
        const requestInfo = { id: requestId, controller };
        this.activeRequests.add(requestInfo);

        try {
            // 清理文本
            const textForTTS = text
                .replace(/<[^>]+>/g, '')
                .replace(/（.*?）|\(.*?\)/g, '')
                .replace(/\*.*?\*/g, '');

            // 清理后无实际文字内容则跳过（纯标点、空白等）
            const hasContent = textForTTS.replace(/[,，。？?!！；;：:、…—\-\s]/g, '').trim();
            if (!hasContent) return null;

            // 翻译
            const finalTextForTTS = await this.translateText(textForTTS);

            // 调用TTS API
            if (this.aliyunTtsEnabled) {
                // 阿里云TTS（WebSocket模式）
                const audioBuffer = await this.aliyunSynthesize(finalTextForTTS, controller.signal);
                if (!audioBuffer) return null;
                return new Blob([audioBuffer], { type: 'audio/wav' });
            } else if (this.cloudTtsEnabled) {
                // 云服务商模式（SiliconFlow等）
                const response = await fetch(this.cloudTtsUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.cloudApiKey}`
                    },
                    body: JSON.stringify({
                        model: this.cloudTtsModel,
                        voice: this.cloudTtsVoice,
                        input: finalTextForTTS,
                        response_format: this.cloudTtsFormat,
                        speed: this.cloudTtsSpeed
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    await this.handleTTSError(response, '云端TTS');
                }
                return await response.blob();
            } else {
                // 本地模式或统一网关模式
                const headers = { 'Content-Type': 'application/json' };

                // 如果使用统一网关，添加 X-API-Key
                if (this.useGateway && this.apiKey) {
                    headers['X-API-Key'] = this.apiKey;
                }

                const response = await fetch(this.ttsUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        text: finalTextForTTS,
                        text_language: this.language
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    await this.handleTTSError(response, this.useGateway ? '云端肥牛网关TTS' : '本地TTS');
                }
                return await response.blob();
            }
        } catch (error) {
            if (error.name === 'AbortError') return null;
            console.error('TTS转换错误:', error);
            return null;
        } finally {
            this.activeRequests.delete(requestInfo);
        }
    }

    // 流式文本分段
    segmentStreamingText(text, queue) {
        this.pendingSegment += text;

        let processedSegment = '';
        for (let i = 0; i < this.pendingSegment.length; i++) {
            const char = this.pendingSegment[i];
            processedSegment += char;

            if (this.punctuations.includes(char) && processedSegment.trim()) {
                queue.push(processedSegment);
                processedSegment = '';
            }
        }

        this.pendingSegment = processedSegment;
    }

    // 完成流式分段
    finalizeSegmentation(queue) {
        if (this.pendingSegment.trim()) {
            queue.push(this.pendingSegment);
            this.pendingSegment = '';
        }
    }

    // 完整文本分段
    segmentFullText(text, queue) {
        let currentSegment = '';
        for (let char of text) {
            currentSegment += char;
            if (this.punctuations.includes(char) && currentSegment.trim()) {
                queue.push(currentSegment);
                currentSegment = '';
            }
        }

        if (currentSegment.trim()) {
            queue.push(currentSegment);
        }
    }

    // 阿里云TTS WebSocket合成
    aliyunSynthesize(text, abortSignal) {
        return new Promise((resolve, reject) => {
            const taskId = randomUUID();
            const audioChunks = [];
            let settled = false;

            const ws = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference/', {
                headers: { 'Authorization': `bearer ${this.aliyunApiKey}` }
            });

            // 支持 AbortController 取消
            const onAbort = () => {
                if (!settled) {
                    settled = true;
                    ws.close();
                    resolve(null);
                }
            };
            if (abortSignal) {
                if (abortSignal.aborted) { resolve(null); return; }
                abortSignal.addEventListener('abort', onAbort, { once: true });
            }

            const cleanup = () => {
                if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
            };

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
                    payload: {
                        task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer',
                        model: this.aliyunModel,
                        parameters: {
                            text_type: 'PlainText',
                            voice: this.aliyunVoice,
                            format: 'wav',
                            sample_rate: this.aliyunSampleRate,
                            volume: this.aliyunVolume,
                            rate: this.aliyunRate,
                            pitch: this.aliyunPitch
                        },
                        input: {}
                    }
                }));
            });

            ws.on('message', (data, isBinary) => {
                if (settled) return;

                if (isBinary) {
                    audioChunks.push(data);
                    return;
                }

                const msg = JSON.parse(data.toString());
                const event = msg?.header?.event;

                if (event === 'task-started') {
                    ws.send(JSON.stringify({
                        header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
                        payload: { input: { text } }
                    }));
                    ws.send(JSON.stringify({
                        header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
                        payload: { input: {} }
                    }));
                } else if (event === 'task-finished') {
                    settled = true;
                    cleanup();
                    ws.close();
                    resolve(Buffer.concat(audioChunks));
                } else if (event === 'task-failed') {
                    settled = true;
                    cleanup();
                    ws.close();
                    const errMsg = `阿里云TTS失败: ${JSON.stringify(msg)}`;
                    logToTerminal('error', errMsg);
                    reject(new Error(errMsg));
                }
            });

            ws.on('error', (err) => {
                if (!settled) {
                    settled = true;
                    cleanup();
                    logToTerminal('error', `阿里云TTS WebSocket错误: ${err.message}`);
                    reject(err);
                }
            });
        });
    }

    // 中止所有请求
    abortAllRequests() {
        this.activeRequests.forEach(req => req.controller.abort());
        this.activeRequests.clear();
    }

    // 重置状态
    reset() {
        this.pendingSegment = '';
        this.abortAllRequests();
    }

    // 获取待处理片段
    getPendingSegment() {
        return this.pendingSegment;
    }

    // 统一的TTS错误处理
    async handleTTSError(response, serviceName) {
        let errorDetail = "";
        try {
            const errorBody = await response.text();
            try {
                const errorJson = JSON.parse(errorBody);
                errorDetail = JSON.stringify(errorJson, null, 2);
            } catch (e) {
                errorDetail = errorBody;
            }
        } catch (e) {
            errorDetail = "无法读取错误详情";
        }

        let errorMessage = "";
        switch (response.status) {
            case 401:
                errorMessage = `【${serviceName}】API密钥验证失败，请检查你的API密钥是否正确`;
                break;
            case 403:
                errorMessage = `【${serviceName}】API访问被禁止，你的账号可能被限制或额度已用完`;
                break;
            case 429:
                errorMessage = `【${serviceName}】请求过于频繁，超出API限制或额度已用完`;
                break;
            case 500:
            case 502:
            case 503:
            case 504:
                errorMessage = `【${serviceName}】服务器错误，AI服务当前不可用`;
                break;
            default:
                errorMessage = `【${serviceName}】API错误: ${response.status} ${response.statusText}`;
        }

        const fullError = `${errorMessage}\n详细信息: ${errorDetail}`;
        logToTerminal('error', fullError);
        throw new Error(errorMessage);
    }
}

module.exports = { TTSRequestHandler };
