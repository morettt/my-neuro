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
            logToTerminal('info', `🔧 发送工具列表到LLM: ${tools.length}个工具`);
        }

        logToTerminal('info', `开始发送请求到LLM API: ${this.apiUrl}/chat/completions`);

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

            // --- 修改：在这里统一处理和验证响应格式 ---
            this._normalizeResponse(responseData);

            logToTerminal('info', `收到LLM API响应`);

            return responseData.choices[0].message;

        } catch (error) {
            logToTerminal('error', `LLM API调用失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * --- 核心修改：验证并“归一化”API响应格式 ---
     * 无论是Gemini原生格式还是OpenAI格式，都统一转换为OpenAI格式
     * @private
     */
    _normalizeResponse(responseData) {
        // 检查Gemini原生API格式 ("candidates")
        if (responseData.candidates && responseData.candidates.length > 0) {
            const candidate = responseData.candidates[0];
            const content = candidate.content;

            if (content && content.parts && content.parts.length > 0) {
                const part = content.parts[0];
                const message = { role: 'assistant', content: null, tool_calls: null };

                if (part.text) {
                    message.content = part.text;
                }

                if (part.functionCall) {
                    // 将Gemini的functionCall格式转换为OpenAI的tool_calls格式
                    message.tool_calls = [{
                        id: part.functionCall.name, // Gemini不提供唯一ID，暂时用名称代替
                        type: 'function',
                        function: {
                            name: part.functionCall.name,
                            arguments: JSON.stringify(part.functionCall.args || {})
                        }
                    }];
                }
                
                // 将响应数据结构重写为OpenAI格式
                responseData.choices = [{ message: message }];
                return; // 归一化完成
            }
        }

        // 如果不是Gemini格式，则按原有的OpenAI格式进行验证
        if (responseData.error) {
            const errorMsg = responseData.error.message || responseData.error || '未知API错误';
            logToTerminal('error', `LLM API错误: ${errorMsg}`);
            throw new Error(`API错误: ${errorMsg}`);
        }

        let choices;
        if (responseData.choices) {
            choices = responseData.choices;
        } else if (responseData.data && responseData.data.choices) {
            choices = responseData.data.choices;
        } else {
            logToTerminal('error', `LLM响应格式异常: ${JSON.stringify(responseData)}`);
            throw new Error('LLM响应格式异常：缺少choices字段或为空');
        }

        if (!choices || choices.length === 0) {
            logToTerminal('error', `LLM响应格式异常: choices为空`);
            throw new Error('LLM响应格式异常：choices为空');
        }

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