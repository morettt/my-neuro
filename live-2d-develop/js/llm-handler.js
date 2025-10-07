// llm-handler.js - LLM处理逻辑模块
const { logToTerminal, handleAPIError, getMergedToolsList } = require('./api-utils.js');

class LLMHandler {
    // 创建增强的sendToLLM方法
    static createEnhancedSendToLLM(voiceChat, ttsProcessor, asrEnabled) {
        return async function(prompt) {
            try {
                // 检查是否正在播放TTS，如果是则先中断
                if (global.isPlayingTTS) {
                    console.log('检测到TTS正在播放，执行打断操作');
                    logToTerminal('info', '检测到TTS正在播放，执行打断操作');

                    // 发送中断信号
                    if (ttsProcessor) {
                        ttsProcessor.interrupt();
                    }

                    // 隐藏字幕
                    if (global.hideSubtitle) {
                        global.hideSubtitle();
                    }

                    // 等待短暂时间确保中断完成
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                global.isProcessingUserInput = true;

                this.messages.push({ 'role': 'user', 'content': prompt });

                if (this.enableContextLimit) {
                    this.trimMessages();
                }

                let messagesForAPI = JSON.parse(JSON.stringify(this.messages));
                const needScreenshot = await this.shouldTakeScreenshot(prompt);

                if (needScreenshot) {
                    try {
                        console.log("需要截图");
                        logToTerminal('info', "需要截图");
                        const base64Image = await voiceChat.takeScreenshotBase64();

                        const lastUserMsgIndex = messagesForAPI.findIndex(
                            msg => msg.role === 'user' && msg.content === prompt
                        );

                        if (lastUserMsgIndex !== -1) {
                            messagesForAPI[lastUserMsgIndex] = {
                                'role': 'user',
                                'content': [
                                    { 'type': 'text', 'text': prompt },
                                    { 'type': 'image_url', 'image_url': { 'url': `data:image/jpeg;base64,${base64Image}` } }
                                ]
                            };
                        }
                    } catch (error) {
                        console.error("截图处理失败:", error);
                        logToTerminal('error', `截图处理失败: ${error.message}`);
                        throw new Error("截图功能出错，无法处理视觉内容");
                    }
                }

                const requestBody = {
                    model: this.MODEL,
                    messages: messagesForAPI,
                    stream: false
                };

                // 合并本地Function Call工具和MCP工具
                const allTools = getMergedToolsList();
                if (allTools.length > 0) {
                    requestBody.tools = allTools;
                    console.log(`🔧 发送工具列表到LLM: ${allTools.length}个工具`);
                }

                logToTerminal('info', `开始发送请求到LLM API: ${this.API_URL}/chat/completions`);
                const response = await fetch(`${this.API_URL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.API_KEY}`
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    await handleAPIError(response);
                }

                const responseData = await response.json();

                // 检查API错误响应
                if (responseData.error) {
                    const errorMsg = responseData.error.message || responseData.error || '未知API错误';
                    logToTerminal('error', `LLM API错误: ${errorMsg}`);
                    throw new Error(`API错误: ${errorMsg}`);
                }

                // 检查响应格式，适应不同的API响应结构
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

                const result = choices[0].message;
                logToTerminal('info', `收到LLM API响应`);

                if (result.tool_calls && result.tool_calls.length > 0) {
                    console.log("检测到工具调用:", result.tool_calls);
                    logToTerminal('info', `检测到工具调用: ${JSON.stringify(result.tool_calls)}`);

                    this.messages.push({
                        'role': 'assistant',
                        'content': null,
                        'tool_calls': result.tool_calls
                    });

                    logToTerminal('info', `开始执行工具调用`);

                    // 尝试不同的工具管理器执行工具调用
                    let toolResult = null;

                    // 首先尝试MCP工具
                    if (global.mcpManager && global.mcpManager.isEnabled) {
                        try {
                            toolResult = await global.mcpManager.handleToolCalls(result.tool_calls);
                        } catch (error) {
                            console.log(`MCP工具调用失败，尝试本地工具: ${error.message}`);
                        }
                    }

                    // 如果MCP没有处理成功，尝试本地Function Call工具
                    if (!toolResult && global.localToolManager && global.localToolManager.isEnabled) {
                        try {
                            toolResult = await global.localToolManager.handleToolCalls(result.tool_calls);
                        } catch (error) {
                            console.error(`本地工具调用也失败: ${error.message}`);
                            throw error;
                        }
                    }

                    if (toolResult) {
                        console.log("工具调用结果:", toolResult);
                        logToTerminal('info', `工具调用结果: ${JSON.stringify(toolResult)}`);

                        // 处理多工具调用结果
                        if (Array.isArray(toolResult)) {
                            // 多个工具调用结果
                            toolResult.forEach(singleResult => {
                                this.messages.push({
                                    'role': 'tool',
                                    'content': singleResult.content,
                                    'tool_call_id': singleResult.tool_call_id
                                });
                            });
                        } else {
                            // 单个工具调用结果（向后兼容）
                            this.messages.push({
                                'role': 'tool',
                                'content': toolResult,
                                'tool_call_id': result.tool_calls[0].id
                            });
                        }

                        logToTerminal('info', `发送工具结果到LLM获取最终回复`);
                        const finalRequestOptions = {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.API_KEY}`
                            },
                            body: JSON.stringify({
                                model: this.MODEL,
                                messages: this.messages,
                                stream: false
                            })
                        };

                        const finalResponse = await fetch(`${this.API_URL}/chat/completions`, finalRequestOptions);

                        if (!finalResponse.ok) {
                            await handleAPIError(finalResponse);
                        }

                        const finalResponseData = await finalResponse.json();

                        // 检查API错误响应 - 只检查明确的错误字段
                        if (finalResponseData.error) {
                            const errorMsg = finalResponseData.error.message || finalResponseData.error || '未知API错误';
                            logToTerminal('error', `LLM API错误: ${errorMsg}`);
                            throw new Error(`API错误: ${errorMsg}`);
                        }

                        // 检查响应格式，适应不同的API响应结构
                        let choices;
                        if (finalResponseData.choices) {
                            choices = finalResponseData.choices;
                        } else if (finalResponseData.data && finalResponseData.data.choices) {
                            choices = finalResponseData.data.choices;
                        } else {
                            logToTerminal('error', `LLM响应格式异常: ${JSON.stringify(finalResponseData)}`);
                            throw new Error('LLM响应格式异常：缺少choices字段或为空');
                        }

                        if (!choices || choices.length === 0) {
                            logToTerminal('error', `LLM响应格式异常: choices为空`);
                            throw new Error('LLM响应格式异常：choices为空');
                        }

                        const finalResult = choices[0].message;
                        logToTerminal('info', `获得最终LLM回复，开始语音输出`);

                        if (finalResult.content) {
                            this.messages.push({ 'role': 'assistant', 'content': finalResult.content });

                            // ===== 保存对话历史 =====
                            this.saveConversationHistory();

                            logToTerminal('info', `获得最终LLM回复，开始语音输出`);
                            this.ttsProcessor.reset();
                            this.ttsProcessor.processTextToSpeech(finalResult.content);
                        }
                    } else {
                        console.error("工具调用失败");
                        logToTerminal('error', "工具调用失败");
                        throw new Error("工具调用失败，无法完成功能扩展");
                    }
                } else if (result.content) {
                    this.messages.push({ 'role': 'assistant', 'content': result.content });

                    // ===== 保存对话历史 =====
                    this.saveConversationHistory();

                    logToTerminal('info', `LLM直接返回回复，开始语音输出`);
                    this.ttsProcessor.reset();
                    this.ttsProcessor.processTextToSpeech(result.content);
                }

                if (this.enableContextLimit) {
                    this.trimMessages();
                }
            } catch (error) {
                logToTerminal('error', `LLM处理错误: ${error.message}`);
                if (error.stack) {
                    logToTerminal('error', `错误堆栈: ${error.stack}`);
                }

                let errorMessage = "抱歉，出现了一个错误";

                if (error.message.includes("API密钥验证失败")) {
                    errorMessage = "API密钥错误，请检查配置";
                } else if (error.message.includes("API访问被禁止")) {
                    errorMessage = "API访问受限，请联系支持";
                } else if (error.message.includes("API接口未找到")) {
                    errorMessage = "无效的API地址，请检查配置";
                } else if (error.message.includes("请求过于频繁")) {
                    errorMessage = "请求频率超限，请稍后再试";
                } else if (error.message.includes("服务器错误")) {
                    errorMessage = "AI服务不可用，请稍后再试";
                } else if (error.message.includes("截图功能出错")) {
                    errorMessage = "截图失败，无法处理视觉内容";
                } else if (error.message.includes("工具调用失败")) {
                    errorMessage = "功能扩展调用失败，请重试";
                } else if (error.name === "TypeError" && error.message.includes("fetch")) {
                    errorMessage = "网络连接失败，请检查网络和API地址";
                } else if (error.name === "SyntaxError") {
                    errorMessage = "解析API响应出错，请重试";
                } else {
                    const shortErrorMsg = error.message.substring(0, 100) +
                        (error.message.length > 100 ? "..." : "");
                    errorMessage = `未知错误: ${shortErrorMsg}`;
                }

                logToTerminal('error', `用户显示错误: ${errorMessage}`);

                this.showSubtitle(errorMessage, 3000);
                if (this.asrProcessor && asrEnabled) {
                    this.asrProcessor.resumeRecording();
                }
                setTimeout(() => this.hideSubtitle(), 3000);
            } finally {
                global.isProcessingUserInput = false;
            }
        };
    }
}

module.exports = { LLMHandler };
