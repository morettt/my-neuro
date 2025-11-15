// llm-client.js - 统一的LLM API客户端
const { logToTerminal, handleAPIError } = require('../api-utils.js');

/**
 * 统一的LLM客户端
 * 封装所有LLM API调用逻辑,消除重复代码
 */
class LLMClient {
    constructor(config) {
        this.apiKey = config.llm.api_key;
        this.apiUrl = config.llm.api_url;
        this.model = config.llm.model;
    }

    /**
     * 发送聊天完成请求
     * @param {Array} messages - 消息数组
     * @param {Array} tools - 可选的工具列表
     * @param {boolean} stream - 是否使用流式响应
     * @returns {Promise<Object>} API响应的消息对象
     */
    async chatCompletion(messages, tools = null, stream = false) {
        const requestBody = {
            model: this.model,
            messages: messages,
            stream: stream
        };

        // 添加工具列表(如果提供)
        if (tools && tools.length > 0) {
            requestBody.tools = tools;
            // 工具列表日志已注释，UI启动时已显示工具信息
            // logToTerminal('info', `🔧 发送工具列表到LLM: ${tools.length}个工具`);
        }

        // 🔥 调试：检查消息格式和打印请求体
        const messageCount = messages.length;
        const lastMessage = messages[messageCount - 1];
        console.log(`📤 发送请求: ${messageCount}条消息, 最后一条消息角色: ${lastMessage.role}`);

        // 🔥 打印最后5条消息的详细信息（排除图片内容）
        console.log('📋 最后5条消息:');
        messages.slice(-5).forEach((msg, index) => {
            const msgCopy = { ...msg };
            // 如果有图片内容，只显示类型不显示base64
            if (Array.isArray(msgCopy.content)) {
                msgCopy.content = msgCopy.content.map(item => {
                    if (item.type === 'image_url') {
                        return { type: 'image_url', image_url: '[BASE64_IMAGE]' };
                    }
                    return item;
                });
            }
            console.log(`  ${index + 1}. ${msgCopy.role}:`, JSON.stringify(msgCopy).substring(0, 200));
        });

        logToTerminal('info', `已将内容发送给AI..`);

        try {
            const response = await fetch(`${this.apiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                await handleAPIError(response);
            }

            const responseData = await response.json();

            // 验证响应格式
            this._validateResponse(responseData);

            logToTerminal('info', `AI回复中`);

            return responseData.choices[0].message;

        } catch (error) {
            logToTerminal('error', `LLM API调用失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 验证API响应格式
     * @private
     */
    _validateResponse(responseData) {
        // 检查API错误响应
        if (responseData.error) {
            const errorMsg = responseData.error.message || responseData.error || '未知API错误';
            logToTerminal('error', `LLM API错误: ${errorMsg}`);
            throw new Error(`API错误: ${errorMsg}`);
        }

        // 检查响应格式,适应不同的API响应结构
        let choices;
        if (responseData.choices) {
            choices = responseData.choices;
        } else if (responseData.data && responseData.data.choices) {
            choices = responseData.data.choices;
        } else {
            // 🔥 详细打印响应数据以便调试
            const debugInfo = JSON.stringify(responseData).substring(0, 500);
            logToTerminal('error', `LLM响应格式异常，缺少choices字段。响应数据: ${debugInfo}`);
            console.error('完整响应数据:', responseData);
            throw new Error('LLM响应格式异常：缺少choices字段或为空');
        }

        if (!choices || choices.length === 0) {
            // 🔥 打印完整响应数据
            const debugInfo = JSON.stringify(responseData).substring(0, 500);
            logToTerminal('error', `LLM响应choices为空。响应数据: ${debugInfo}`);
            console.error('完整响应数据:', responseData);

            // 🔥 检查是否是内容过滤（多种可能的字段）
            if (responseData.promptFilterResults ||
                responseData.finishReason === 'content_filter' ||
                responseData.finish_reason === 'content_filter') {
                throw new Error('API内容过滤：请求被API的内容过滤器拦截，可能包含敏感内容');
            }

            // 🔥 检查usage，如果有prompt_tokens但completion_tokens为0，很可能是内容过滤
            if (responseData.usage &&
                responseData.usage.prompt_tokens > 0 &&
                responseData.usage.completion_tokens === 0) {
                logToTerminal('warn', '⚠️ API处理了请求但拒绝生成内容，可能触发了安全过滤器');
                throw new Error('API拒绝生成内容：可能触发了安全过滤器或内容政策限制。请检查最近的对话内容。');
            }

            throw new Error('LLM响应格式异常：choices为空');
        }

        // 将标准化的choices写回
        responseData.choices = choices;
    }

    /**
     * 更新API配置
     * @param {Object} newConfig - 新的配置对象
     */
    updateConfig(newConfig) {
        if (newConfig.llm) {
            this.apiKey = newConfig.llm.api_key || this.apiKey;
            this.apiUrl = newConfig.llm.api_url || this.apiUrl;
            this.model = newConfig.llm.model || this.model;
            logToTerminal('info', 'LLM客户端配置已更新');
        }
    }

    /**
     * 获取当前配置
     * @returns {Object}
     */
    getConfig() {
        return {
            apiUrl: this.apiUrl,
            model: this.model
        };
    }
}

module.exports = { LLMClient };
