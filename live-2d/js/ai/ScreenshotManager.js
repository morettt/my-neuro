// ScreenshotManager.js - 截图管理模块
const { ipcRenderer } = require('electron');
const { logToTerminal } = require('../api-utils.js');

class ScreenshotManager {
    constructor(voiceChatInterface) {
        this.voiceChat = voiceChatInterface;
        this.screenshotEnabled = voiceChatInterface.screenshotEnabled;
        this.autoScreenshot = voiceChatInterface.autoScreenshot;

        // 根据配置选择本地或云端模式
        const gatewayConfig = voiceChatInterface.config?.api_gateway || {};
        const bertConfig = voiceChatInterface.config?.bert || {};

        const useBaiduASR = voiceChatInterface.config?.cloud?.baidu_asr?.enabled === true;

        if (useBaiduASR) {
            // 百度ASR不走BERT
            this.bertEnabled = false;
            this.bertUrl = null;
            this.bertApiKey = null;
        } else if (gatewayConfig.use_gateway) {
            this.bertUrl = `${gatewayConfig.base_url}/bert/classify`;
            this.bertApiKey = gatewayConfig.api_key || '';
            this.bertEnabled = true;
        } else {
            this.bertUrl = bertConfig.url || 'http://127.0.0.1:6007/classify';
            this.bertApiKey = null;
            this.bertEnabled = true;
        }
    }

    // 判断是否需要截图
    async shouldTakeScreenshot(text) {
        if (!this.screenshotEnabled) return false;

        // 🎯 优先检查自动对话模块的截图标志
        if (this.voiceChat._autoScreenshotFlag) {
            console.log('自动对话模块要求截图');
            return true;
        }

        if (this.autoScreenshot) {
            console.log('自动截图模式已开启，将为本次对话截图');
            return true;
        }

        // 检查文本中是否包含截图标记
        if (text.includes('[需要截图]')) {
            console.log('检测到截图标记，将进行截图');
            return true;
        }

        try {
            const result = await this.callBertClassifier(text);
            if (result) {
                const needVision = result["Vision"] === "是";
                if (needVision) logToTerminal('info', '需要截图');
                return needVision;
            }
            return false;
        } catch (error) {
            console.error('判断截图错误:', error);
            return false;
        }
    }

    // 统一调用BERT分类API的方法
    async callBertClassifier(text) {
        if (!this.bertEnabled) {
            return null;
        }
        try {
            const headers = {
                'Content-Type': 'application/json'
            };

            // 如果是云端模式，添加 API Key
            if (this.bertApiKey) {
                headers['X-API-Key'] = this.bertApiKey;
            }

            const response = await fetch(this.bertUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    text: text
                })
            });

            if (!response.ok) {
                await this.handleBertError(response);
                return null;
            }

            const data = await response.json();
            return data;
        } catch (error) {
            logToTerminal('error', `BERT分类错误: ${error.message}`);
            console.error('BERT分类错误:', error);
            return null;
        }
    }

    // 截图功能
    async takeScreenshotBase64() {
        try {
            const base64Image = await ipcRenderer.invoke('take-screenshot');
            console.log('截图已完成');
            return base64Image;
        } catch (error) {
            console.error('截图错误:', error);
            throw error;
        }
    }

    // 统一的BERT错误处理
    async handleBertError(response) {
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

        const serviceName = this.bertApiKey ? '云端肥牛网关BERT' : '本地BERT';
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
        console.error(errorMessage);
    }
}

module.exports = { ScreenshotManager };
