// llm-handler.js - LLM处理逻辑模块
const { logToTerminal, getMergedToolsList } = require('../api-utils.js');
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');
const { appState } = require('../core/app-state.js');
const { LLMClient } = require('./llm-client.js');
const { toolExecutor } = require('./tool-executor.js');

class LLMHandler {
    // 创建增强的sendToLLM方法
    static createEnhancedSendToLLM(voiceChat, ttsProcessor, asrEnabled, config) {
        // 创建LLM客户端实例
        const llmClient = new LLMClient(config);

        return async function(prompt) {
            try {
                // 发送用户输入开始事件
                eventBus.emit(Events.USER_INPUT_START);

                // 检查是否正在播放TTS，如果是则先中断
                if (appState.isPlayingTTS()) {
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

                // global.isProcessingUserInput 已通过事件自动管理，无需手动设置

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

                        // 🔧 修复：直接找最后一条用户消息，而不是用findIndex
                        // findIndex会找到第一个匹配的，导致重复prompt时找错消息
                        // 因为我们刚刚push了这条消息，所以直接从后往前找第一条用户消息
                        let lastUserMsgIndex = -1;
                        for (let i = messagesForAPI.length - 1; i >= 0; i--) {
                            if (messagesForAPI[i].role === 'user') {
                                lastUserMsgIndex = i;
                                break;
                            }
                        }

                        if (lastUserMsgIndex !== -1) {
                            console.log(`📸 将截图附加到消息索引 ${lastUserMsgIndex}，内容: ${prompt.substring(0, 50)}...`);
                            messagesForAPI[lastUserMsgIndex] = {
                                'role': 'user',
                                'content': [
                                    { 'type': 'text', 'text': prompt },
                                    { 'type': 'image_url', 'image_url': { 'url': `data:image/jpeg;base64,${base64Image}` } }
                                ]
                            };
                        } else {
                            console.error('⚠️ 未找到用户消息，无法附加截图');
                        }
                    } catch (error) {
                        console.error("截图处理失败:", error);
                        logToTerminal('error', `截图处理失败: ${error.message}`);
                        throw new Error("截图功能出错，无法处理视觉内容");
                    }
                }

                // 合并本地Function Call工具和MCP工具
                const allTools = getMergedToolsList();

                // 使用统一的LLM客户端
                const result = await llmClient.chatCompletion(messagesForAPI, allTools);

                if (result.tool_calls && result.tool_calls.length > 0) {
                    console.log("检测到工具调用:", result.tool_calls);
                    logToTerminal('info', `检测到工具调用: ${JSON.stringify(result.tool_calls)}`);

                    this.messages.push({
                        'role': 'assistant',
                        'content': null,
                        'tool_calls': result.tool_calls
                    });

                    // 使用统一的工具执行器
                    const toolResult = await toolExecutor.executeToolCalls(result.tool_calls);

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

                        // 使用统一的LLM客户端
                        const finalResult = await llmClient.chatCompletion(this.messages);

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
                // global.isProcessingUserInput 已通过事件自动管理，无需手动设置

                // 发送用户输入结束事件
                eventBus.emit(Events.USER_INPUT_END);
            }
        };
    }
}

module.exports = { LLMHandler };
