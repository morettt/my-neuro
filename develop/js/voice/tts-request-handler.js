// tts-request-handler.js - TTS请求处理器
// 职责：文本翻译、TTS API调用、文本分段

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

            // 翻译
            const finalTextForTTS = await this.translateText(textForTTS);

            // 调用TTS API
            if (this.cloudTtsEnabled) {
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

                if (!response.ok) throw new Error('云端TTS请求失败: ' + response.status);
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

                if (!response.ok) throw new Error(`${this.useGateway ? '网关' : '本地'}TTS请求失败: ` + response.status);
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
}

module.exports = { TTSRequestHandler };
