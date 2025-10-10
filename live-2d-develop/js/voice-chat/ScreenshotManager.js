// ScreenshotManager.js - 截图管理模块
const { ipcRenderer } = require('electron');

class ScreenshotManager {
    constructor(voiceChatInterface) {
        this.voiceChat = voiceChatInterface;
        this.screenshotEnabled = voiceChatInterface.screenshotEnabled;
        this.autoScreenshot = voiceChatInterface.autoScreenshot;
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
                console.log(`截图判断结果: ${needVision ? "是" : "否"}`);
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
        try {
            const response = await fetch('http://127.0.0.1:6007/classify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text
                })
            });

            if (!response.ok) {
                throw new Error('BERT分类API请求失败');
            }

            const data = await response.json();
            console.log('BERT分类结果:', data);
            return data;
        } catch (error) {
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
}

module.exports = { ScreenshotManager };
