// MemoryManager.js - 记忆管理模块
const fs = require('fs');
const path = require('path');

class MemoryManager {
    constructor(voiceChatInterface) {
        this.voiceChat = voiceChatInterface;
        this.memoryFilePath = voiceChatInterface.memoryFilePath;

        // 根据配置选择本地或云端模式
        const gatewayConfig = voiceChatInterface.config?.api_gateway || {};
        const bertConfig = voiceChatInterface.config?.bert || {};

        if (gatewayConfig.use_gateway) {
            this.bertUrl = `${gatewayConfig.base_url}/bert/classify`;
            this.bertApiKey = gatewayConfig.api_key || '';
        } else {
            this.bertUrl = bertConfig.url || 'http://127.0.0.1:6007/classify';
            this.bertApiKey = null;
        }
    }

    // 统一调用BERT分类API的方法
    async callBertClassifier(text) {
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

    // 检查消息是否需要记忆（异步处理，不阻塞对话）
    async checkAndSaveMemoryAsync(text) {
        try {
            const result = await this.callBertClassifier(text);
            if (result && result["core memory"] === "是") {
                console.log('记忆检查结果: 需要保存');
                // 异步处理记忆总结和保存，不阻塞主流程
                this.processMemoryAsync(text).catch(error => {
                    console.error('异步记忆处理失败:', error);
                });
            } else {
                console.log('记忆检查结果: 不需要保存');
            }
        } catch (error) {
            console.error('记忆检查错误:', error);
        }
    }

    // 异步处理记忆总结和保存
    async processMemoryAsync(userText) {
        try {
            // 获取最近4轮对话上下文
            const recentContext = this.getRecentContext(4);

            // 构建记忆总结prompt
            const memoryPrompt = `基于以下对话上下文，将用户的最新消息总结为不超过15个字的关键信息：

对话上下文：
${recentContext}

用户最新消息：${userText}

请提取关键信息（限制15字以内）：`;

            // 调用LLM进行总结
            const summary = await this.callLLMForMemorySummary(memoryPrompt);

            if (summary && summary.trim()) {
                await this.saveToMemory(summary.trim());
                console.log('记忆已异步保存:', summary.trim());
            }
        } catch (error) {
            console.error('异步记忆处理失败:', error);
        }
    }

    // 获取最近N轮对话上下文
    getRecentContext(rounds = 4) {
        const contextMessages = this.voiceChat.messages.filter(msg => msg.role === 'user' || msg.role === 'assistant');
        const recentMessages = contextMessages.slice(-rounds * 2); // 每轮包含用户+AI消息

        return recentMessages.map(msg => {
            const role = msg.role === 'user' ? '用户' : 'AI';
            return `${role}: ${msg.content}`;
        }).join('\n');
    }

    // 调用LLM进行记忆总结
    async callLLMForMemorySummary(prompt) {
        try {
            const response = await fetch(`${this.voiceChat.API_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.voiceChat.API_KEY}`
                },
                body: JSON.stringify({
                    model: this.voiceChat.MODEL,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }],
                    stream: false,
                    max_tokens: 300 // 限制token数量
                })
            });

            if (!response.ok) {
                throw new Error(`记忆总结API请求失败: ${response.status}`);
            }

            const data = await response.json();
            const summary = data.choices[0].message.content;

            // 确保不超过15字
            return summary.length > 100 ? summary.substring(0, 100) : summary;
        } catch (error) {
            console.error('LLM记忆总结失败:', error);
            return null;
        }
    }

    // 保存消息到记忆文件
    async saveToMemory(text) {
        try {
            // 确保目录存在
            const memoryDir = path.dirname(path.join(__dirname, '..', '..', this.memoryFilePath));
            if (!fs.existsSync(memoryDir)) {
                fs.mkdirSync(memoryDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const memoryEntry = `[${timestamp}] ${text}\n`;

            fs.appendFileSync(path.join(__dirname, '..', '..', this.memoryFilePath), memoryEntry, 'utf8');
            console.log('已保存到记忆文件:', text);
            return true;
        } catch (error) {
            console.error('保存记忆失败:', error);
            return false;
        }
    }
}

module.exports = { MemoryManager };
