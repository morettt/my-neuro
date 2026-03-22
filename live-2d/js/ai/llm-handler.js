// llm-handler.js - LLM处理逻辑模块
const { logToTerminal, logToolAction, getMergedToolsList } = require('../api-utils.js');
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');
const { appState } = require('../core/app-state.js');
const { LLMClient } = require('./llm-client.js');
const { toolExecutor } = require('./tool-executor.js');

/**
 * 过滤模型思考内容，与 LLMClient._filterThinkingContent 保持一致
 * 作为 TTS/字幕前的二次安全过滤
 */
function filterThinkingContent(text) {
    if (!text) return text;
    let filtered = text;
    filtered = filtered.replace(/<think>[\s\S]*?<\/think>/gi, '');
    filtered = filtered.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    if (/^思考\s*\n/.test(filtered)) return '';
    if (/^Thinking\s*\n/i.test(filtered)) return '';
    return filtered.trim();
}

class LLMHandler {
    // 创建增强的sendToLLM方法
    static createEnhancedSendToLLM(voiceChat, ttsProcessor, asrEnabled, config) {
        // 创建LLM客户端实例
        const llmClient = new LLMClient(config);

        // 创建视觉模型客户端（如果启用）
        let visionClient = null;
        if (config.vision && config.vision.use_vision_model && config.vision.vision_model) {
            const visionConfig = {
                llm: {
                    api_key: config.vision.vision_model.api_key,
                    api_url: config.vision.vision_model.api_url,
                    model: config.vision.vision_model.model
                }
            };
            visionClient = new LLMClient(visionConfig);
            console.log('✅ 视觉模型已启用:', config.vision.vision_model.model);
            logToTerminal('info', `✅ 视觉模型已启用: ${config.vision.vision_model.model}`);
        }

        // 辅助函数：清理消息中的所有图片内容
        const removeImagesFromMessages = (messages) => {
            return messages.map(msg => {
                if (msg.role === 'user' && Array.isArray(msg.content)) {
                    // 提取所有文本内容
                    const textItems = msg.content.filter(item => item.type === 'text');
                    if (textItems.length > 0) {
                        return {
                            ...msg,
                            content: textItems.map(item => item.text).join(' ')
                        };
                    } else {
                        return {
                            ...msg,
                            content: '(图片内容)'
                        };
                    }
                }
                return msg;
            });
        };

        return async function(prompt) {
            let hasRetriedWithoutImage = false; // 标志：是否已经重试过（避免无限循环）
            let isFirstAttempt = true; // 标志：是否是第一次尝试

            // 🔥 外层重试循环：用于处理视觉不支持错误
            while (true) {
                try {
                    // 发送用户输入开始事件（仅第一次）
                    if (isFirstAttempt) {
                        eventBus.emit(Events.USER_INPUT_START);
                    }

                // 检查是否正在播放TTS，如果是则先中断（仅第一次）
                if (isFirstAttempt && appState.isPlayingTTS()) {
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

                // 只在第一次尝试时添加用户消息
                if (isFirstAttempt) {
                    voiceChat.messages.push({ 'role': 'user', 'content': prompt });

                    if (voiceChat.enableContextLimit) {
                        voiceChat.trimMessages();
                    }
                }

                // 检查是否需要截图（只在第一次尝试且未重试过时）
                // prompt 可能是 string 或多模态数组，取文本部分用于截图判断
                const promptText = Array.isArray(prompt)
                    ? (prompt.find(p => p.type === 'text')?.text ?? '')
                    : prompt;
                let screenshotBase64 = null;
                if (isFirstAttempt && !hasRetriedWithoutImage) {
                    const needScreenshot = await voiceChat.shouldTakeScreenshot(promptText);

                    if (needScreenshot) {
                        try {
                            console.log("需要截图");
                            logToTerminal('info', "需要截图");
                            screenshotBase64 = await voiceChat.takeScreenshotBase64();
                        } catch (error) {
                            console.error("截图处理失败:", error);
                            logToTerminal('error', `截图处理失败: ${error.message}`);
                            throw new Error("截图功能出错，无法处理视觉内容");
                        }
                    }
                }

                // 标记不再是第一次尝试
                isFirstAttempt = false;

                // 合并本地Function Call工具和MCP工具
                const allTools = getMergedToolsList();

                // ===== 🔄 连续工具调用逻辑 =====
                // 支持AI连续多轮调用工具,直到完成完整任务链
                const maxIterations = 30; // 最大工具调用轮数,防止无限循环
                let iteration = 0;
                let finalResponseContent = null;
                let isStreamingToTTS = false; // 标记是否正在流式播放TTS

                // 🔥 清除之前的中断标志，开始新的对话流程
                appState.clearInterrupted();

                // 🔍 判断第一轮是否需要使用视觉模型（用户主动截图）
                const useVisionModelForFirstRound = visionClient && screenshotBase64;

                if (useVisionModelForFirstRound) {
                    console.log('📸 检测到用户截图且启用了独立视觉模型');
                    logToTerminal('info', '📸 使用独立视觉模型处理用户截图');
                }

                while (iteration < maxIterations) {
                    // 🔥 关键检查：在每轮循环开始时检查是否被打断
                    if (appState.isInterrupted()) {
                        console.log('⏸️ 检测到用户打断，立即停止工具调用链');
                        logToolAction('warn', '⏸️ 工具调用链被用户打断');

                        // 清除中断标志，为下次对话做准备
                        appState.clearInterrupted();

                        // 抛出特殊错误，让外层 catch 处理
                        throw new Error('USER_INTERRUPTED');
                    }
                    // 准备发送给API的消息列表
                    let messagesForAPI = JSON.parse(JSON.stringify(voiceChat.messages));

                    // 如果是第一轮且需要截图,添加截图到最后一条用户消息
                    if (iteration === 0 && screenshotBase64) {
                        // 从后往前找最后一条用户消息
                        let lastUserMsgIndex = -1;
                        for (let i = messagesForAPI.length - 1; i >= 0; i--) {
                            if (messagesForAPI[i].role === 'user') {
                                lastUserMsgIndex = i;
                                break;
                            }
                        }

                        if (lastUserMsgIndex !== -1) {
                            console.log(`📸 将截图附加到消息索引 ${lastUserMsgIndex}，内容: ${promptText.substring(0, 50)}...`);
                            // prompt 若已是多模态数组则直接追加图片，否则包装成数组
                            const existingContent = Array.isArray(prompt)
                                ? prompt
                                : [{ 'type': 'text', 'text': prompt }];
                            messagesForAPI[lastUserMsgIndex] = {
                                'role': 'user',
                                'content': [
                                    ...existingContent,
                                    { 'type': 'image_url', 'image_url': { 'url': `data:image/jpeg;base64,${screenshotBase64}` } }
                                ]
                            };
                        } else {
                            console.error('⚠️ 未找到用户消息，无法附加截图');
                        }
                    }

                    // 触发插件 onLLMRequest 钩子（插件可修改 messages）
                    if (global.pluginManager) {
                        await global.pluginManager.runLLMRequestHooks({ messages: messagesForAPI, tools: allTools }).catch(() => {});
                    }

                    // 使用统一的LLM客户端
                    // 🔍 如果是第一轮且有用户截图且启用了视觉模型，使用视觉模型客户端
                    let result;
                    if (iteration === 0 && useVisionModelForFirstRound) {
                        console.log('🎨 使用视觉模型进行图像理解...');
                        logToTerminal('info', '🎨 调用视觉模型API进行图像分析');
                        // 视觉模型不传工具列表，纯粹用于图像理解
                        result = await visionClient.chatCompletion(messagesForAPI, null);
                    } else {
                        // 🔥 如果没有启用独立视觉模型，但有截图，说明主模型需要支持视觉
                        // 只有在没有截图的情况下才清理图片
                        if (!screenshotBase64 || iteration > 0) {
                            // 不是第一轮或没有截图，清理历史消息中的图片（节省token）
                            console.log('🧹 清理messagesForAPI中的历史图片');
                            messagesForAPI.forEach(msg => {
                                if (msg.role === 'user' && Array.isArray(msg.content)) {
                                    const hasImage = msg.content.some(item => item.type === 'image_url');
                                    if (hasImage) {
                                        const textItems = msg.content.filter(item => item.type === 'text');
                                        msg.content = textItems.length > 0 ? textItems.map(item => item.text).join(' ') : '(图片内容)';
                                        console.log('  ✂️ 清理了一条包含图片的消息');
                                    }
                                }
                            });
                        } else {
                            console.log('📸 主模型将处理截图（需要主模型支持视觉）');
                        }

                        // 🔥 正常使用主模型 - 使用流式响应（提升响应速度）
                        result = await llmClient.chatCompletion(messagesForAPI, allTools, true, (text) => {
                            // 流式接收文本，暂不播放TTS（等确认是否有工具调用后再决定）
                        });
                    }

                    // 检查是否有工具调用
                    if (result.tool_calls && result.tool_calls.length > 0) {
                        iteration++;
                        console.log(`\n===== 🔧 第 ${iteration} 轮工具调用 =====`);

                        // 格式化工具调用信息
                        const formatToolCalls = (toolCalls) => {
                            return toolCalls.map(call => {
                                const toolName = call.function.name.split('→')[0].trim(); // 去掉描述部分
                                let args = '';
                                try {
                                    const argsObj = JSON.parse(call.function.arguments);
                                    args = Object.values(argsObj).join(', ');
                                } catch (e) {
                                    args = call.function.arguments;
                                }
                                return `AI调用了：${toolName} 工具 输入参数：${args}`;
                            }).join('\n');
                        };

                        logToolAction('info', formatToolCalls(result.tool_calls));

                        // 🎙️ 如果AI在调用工具前说了话,必须等播放完才继续
                        // 🔥 二次安全过滤：跳过模型思考内容（Gemini 等模型可能在 content 中输出思考过程）
                        const filteredIntermediateContent = filterThinkingContent(result.content);
                        if (filteredIntermediateContent && filteredIntermediateContent.trim()) {
                            console.log(`💬 AI中间过程: ${filteredIntermediateContent}`);
                            logToTerminal('info', `💬 AI中间过程: ${filteredIntermediateContent}`);

                            // 🔥 中间过程播放TTS（工具调用的中间内容）
                            if (iteration === 0) {
                                // 第一轮才reset
                                ttsProcessor.reset();
                            }
                            ttsProcessor.processTextToSpeech(filteredIntermediateContent);

                            // 等待TTS_END或TTS_INTERRUPTED事件触发
                            await new Promise(resolve => {
                                const onTTSEnd = () => {
                                    eventBus.off(Events.TTS_END, onTTSEnd);
                                    eventBus.off(Events.TTS_INTERRUPTED, onTTSInterrupted);
                                    console.log('✅ TTS播放完成,继续执行工具');
                                    setTimeout(resolve, 300);
                                };
                                const onTTSInterrupted = () => {
                                    eventBus.off(Events.TTS_END, onTTSEnd);
                                    eventBus.off(Events.TTS_INTERRUPTED, onTTSInterrupted);
                                    console.log('⏸️ TTS被打断,立即停止');
                                    resolve(); // 立即resolve,让代码继续执行到中断检查点
                                };
                                eventBus.on(Events.TTS_END, onTTSEnd);
                                eventBus.on(Events.TTS_INTERRUPTED, onTTSInterrupted);
                            });
                        }

                        // 🔥 在执行工具前检查是否已被打断
                        if (appState.isInterrupted()) {
                            console.log('⏸️ 检测到打断，跳过工具执行');
                            logToolAction('warn', '⏸️ 工具调用被打断，停止执行');

                            // 🔥 关键修复：不添加带有 tool_calls 的 assistant 消息到历史
                            // 因为工具不会执行，添加了会导致下次 API 调用时缺少 tool 响应
                            console.log('⚠️ 工具调用被打断，不添加到消息历史');

                            appState.clearInterrupted();
                            throw new Error('USER_INTERRUPTED');
                        }

                        // 将AI的工具调用请求添加到消息历史
                        voiceChat.messages.push({
                            'role': 'assistant',
                            'content': result.content || null,
                            'tool_calls': result.tool_calls
                        });

                        // 使用统一的工具执行器
                        const toolResult = await toolExecutor.executeToolCalls(result.tool_calls);

                        // 🔥 工具执行后再次检查是否被打断
                        if (appState.isInterrupted()) {
                            console.log('⏸️ 工具执行完成后检测到打断，停止后续处理');
                            logToolAction('warn', '⏸️ 停止后续工具调用');

                            // 🔥 关键修复：移除刚才添加的 assistant 消息，因为对话被打断了
                            // 保持消息历史的完整性，避免下次 API 调用时出错
                            if (voiceChat.messages.length > 0 &&
                                voiceChat.messages[voiceChat.messages.length - 1].role === 'assistant' &&
                                voiceChat.messages[voiceChat.messages.length - 1].tool_calls) {
                                console.log('🧹 移除被打断的 assistant 工具调用消息');
                                voiceChat.messages.pop();
                            }

                            appState.clearInterrupted();
                            throw new Error('USER_INTERRUPTED');
                        }

                        if (toolResult) {
                            console.log("工具调用结果:", toolResult);

                            // 🔥 特殊处理：检测是否是截图工具返回
                            if (typeof toolResult === 'object' && toolResult._hasScreenshot) {
                                console.log('🎯 检测到截图工具，开始特殊处理流程');
                                logToolAction('info', '📸 AI调用了截图工具，准备图像分析');

                                const { screenshotData, results } = toolResult;

                                // 1. 先添加tool返回消息（需要添加name字段）
                                results.forEach((singleResult, index) => {
                                    // 从原始的tool_calls中找到对应的工具名称
                                    const toolCall = result.tool_calls.find(tc => tc.id === singleResult.tool_call_id);
                                    const toolName = toolCall ? toolCall.function.name : 'take_screenshot';

                                    voiceChat.messages.push({
                                        'role': 'tool',
                                        'name': toolName,  // 🔥 添加name字段
                                        'content': singleResult.content,
                                        'tool_call_id': singleResult.tool_call_id
                                    });
                                });

                                // 🔥 在添加新截图前，清除历史消息中的所有旧截图（节省token）
                                console.log('🧹 清除历史消息中的旧截图');
                                voiceChat.messages.forEach(msg => {
                                    if (msg.role === 'user' && Array.isArray(msg.content)) {
                                        // 检查是否包含图片
                                        const hasImage = msg.content.some(item => item.type === 'image_url');
                                        if (hasImage) {
                                            // 只保留文本部分，移除图片
                                            const textItems = msg.content.filter(item => item.type === 'text');
                                            if (textItems.length > 0) {
                                                // 如果有文本，将content改为纯文本
                                                msg.content = textItems.map(item => item.text).join(' ');
                                            } else {
                                                // 如果没有文本，设置为默认文本
                                                msg.content = '(截图已清除)';
                                            }
                                            console.log('  ✂️ 清除了一条旧截图消息');
                                        }
                                    }
                                });

                                // 2. 再作为user发送图片给AI分析
                                voiceChat.messages.push({
                                    'role': 'user',
                                    'content': [
                                        {
                                            'type': 'text',
                                            'text': '当前电脑屏幕内容:'
                                        },
                                        {
                                            'type': 'image_url',
                                            'image_url': {
                                                'url': `data:image/jpeg;base64,${screenshotData.base64}`
                                            }
                                        }
                                    ]
                                });

                                console.log('📸 截图已添加到消息，立即调用AI分析图片');
                                logToolAction('info', '📸 立即调用AI分析截图内容');

                                // 🔥 关键：立即再次调用LLM API分析图片
                                // 🔍 AI调用截图工具时，判断是否使用独立视觉模型
                                let visionResult;
                                if (visionClient) {
                                    // 如果配置了独立视觉模型，用它来分析AI截的图
                                    console.log('🎨 AI调用截图工具：使用独立视觉模型分析');
                                    logToTerminal('info', '🎨 使用独立视觉模型分析AI截图');
                                    // 🔥 使用视觉模型，仍然传递工具列表！
                                    // 这样AI分析完图片后还能继续调用工具
                                    visionResult = await visionClient.chatCompletion(voiceChat.messages, allTools);
                                } else {
                                    // 没有独立视觉模型，用主模型（主模型必须支持视觉！）
                                    console.log('📸 AI调用截图工具：使用主模型分析（需支持视觉）');
                                    // 使用主模型（必须支持视觉！），传递完整工具列表以支持连续调用
                                    visionResult = await llmClient.chatCompletion(voiceChat.messages, allTools);
                                }

                                console.log('✅ AI图片分析完成:', visionResult.content);
                                logToolAction('info', `✅ AI图片分析结果: ${visionResult.content}`);

                                // 🔥 检查AI是否还想继续调用工具
                                if (visionResult.tool_calls && visionResult.tool_calls.length > 0) {
                                    // AI分析完图片后还想调用工具，继续循环
                                    iteration++;
                                    console.log(`AI分析图片后想继续调用工具，进入第 ${iteration} 轮`);

                                    // 🎙️ 如果AI在调用工具前说了话,必须等播放完才继续
                                    // 🔥 过滤思考内容
                                    const filteredVisionContent = filterThinkingContent(visionResult.content);
                                    if (filteredVisionContent && filteredVisionContent.trim()) {
                                        console.log(`💬 AI图片分析后的中间过程: ${filteredVisionContent}`);
                                        logToTerminal('info', `💬 AI图片分析后的中间过程: ${filteredVisionContent}`);

                                        // 播放TTS并等待真正的播放完成(监听TTS_END事件)
                                        ttsProcessor.reset();
                                        ttsProcessor.processTextToSpeech(filteredVisionContent);

                                        // 等待TTS_END或TTS_INTERRUPTED事件触发
                                        await new Promise(resolve => {
                                            const onTTSEnd = () => {
                                                eventBus.off(Events.TTS_END, onTTSEnd);
                                                eventBus.off(Events.TTS_INTERRUPTED, onTTSInterrupted);
                                                console.log('✅ TTS播放完成,继续执行工具');
                                                setTimeout(resolve, 300);
                                            };
                                            const onTTSInterrupted = () => {
                                                eventBus.off(Events.TTS_END, onTTSEnd);
                                                eventBus.off(Events.TTS_INTERRUPTED, onTTSInterrupted);
                                                console.log('⏸️ TTS被打断,立即停止');
                                                resolve(); // 立即resolve,让代码继续执行到中断检查点
                                            };
                                            eventBus.on(Events.TTS_END, onTTSEnd);
                                            eventBus.on(Events.TTS_INTERRUPTED, onTTSInterrupted);
                                        });
                                    }

                                    // 🔥 在执行工具前检查是否已被打断
                                    if (appState.isInterrupted()) {
                                        console.log('⏸️ 检测到打断，跳过工具执行');
                                        logToolAction('warn', '⏸️ 工具调用被打断，停止执行');
                                        appState.clearInterrupted();
                                        throw new Error('USER_INTERRUPTED');
                                    }

                                    // 🔥 打印工具调用日志（和普通工具调用保持一致）
                                    const formatToolCalls = (toolCalls) => {
                                        return toolCalls.map(call => {
                                            const toolName = call.function.name.split('→')[0].trim();
                                            let args = '';
                                            try {
                                                const argsObj = JSON.parse(call.function.arguments);
                                                args = Object.values(argsObj).join(', ');
                                            } catch (e) {
                                                args = call.function.arguments;
                                            }
                                            return `AI调用了：${toolName} 工具 输入参数：${args}`;
                                        }).join('\n');
                                    };
                                    logToolAction('info', formatToolCalls(visionResult.tool_calls));

                                    // 将工具调用请求添加到历史（只添加一次！）
                                    voiceChat.messages.push({
                                        'role': 'assistant',
                                        'content': visionResult.content,
                                        'tool_calls': visionResult.tool_calls
                                    });

                                    // 🔥 执行新的工具调用 - 注意：这里可能又是截图工具！
                                    const newToolResult = await toolExecutor.executeToolCalls(visionResult.tool_calls);

                                    if (newToolResult) {
                                        // 🔥 检查新工具是否又是截图工具
                                        if (typeof newToolResult === 'object' && newToolResult._hasScreenshot) {
                                            console.log('⚠️ 检测到嵌套截图调用，重复截图处理流程');
                                            const { screenshotData: newScreenshotData, results: newResults } = newToolResult;

                                            // 添加tool消息
                                            newResults.forEach(singleResult => {
                                                const toolCall = visionResult.tool_calls.find(tc => tc.id === singleResult.tool_call_id);
                                                const toolName = toolCall ? toolCall.function.name : 'take_screenshot';

                                                voiceChat.messages.push({
                                                    'role': 'tool',
                                                    'name': toolName,
                                                    'content': singleResult.content,
                                                    'tool_call_id': singleResult.tool_call_id
                                                });
                                            });

                                            // 🔥 在添加新截图前，清除历史消息中的所有旧截图（节省token）
                                            console.log('🧹 清除历史消息中的旧截图（嵌套截图）');
                                            voiceChat.messages.forEach(msg => {
                                                if (msg.role === 'user' && Array.isArray(msg.content)) {
                                                    const hasImage = msg.content.some(item => item.type === 'image_url');
                                                    if (hasImage) {
                                                        const textItems = msg.content.filter(item => item.type === 'text');
                                                        msg.content = textItems.length > 0 ? textItems.map(item => item.text).join(' ') : '(截图已清除)';
                                                        console.log('  ✂️ 清除了一条旧截图消息');
                                                    }
                                                }
                                            });

                                            // 添加user图片消息
                                            voiceChat.messages.push({
                                                'role': 'user',
                                                'content': [
                                                    { 'type': 'text', 'text': '当前电脑屏幕内容:' },
                                                    { 'type': 'image_url', 'image_url': { 'url': `data:image/jpeg;base64,${newScreenshotData.base64}` } }
                                                ]
                                            });

                                            // 🔥 重要：不能直接continue！要像第一次截图那样，立即分析这个新截图
                                            // 但是为了避免代码重复和无限嵌套，这里直接continue
                                            // 让下一轮while循环自动调用API分析
                                            console.log('📸 嵌套截图已添加，下一轮循环将分析');
                                            continue;
                                        }

                                        // 处理普通工具调用结果
                                        if (Array.isArray(newToolResult)) {
                                            newToolResult.forEach(singleResult => {
                                                const toolCall = visionResult.tool_calls.find(tc => tc.id === singleResult.tool_call_id);
                                                const toolName = toolCall ? toolCall.function.name : 'unknown';

                                                voiceChat.messages.push({
                                                    'role': 'tool',
                                                    'name': toolName,
                                                    'content': singleResult.content,
                                                    'tool_call_id': singleResult.tool_call_id
                                                });
                                            });
                                        } else {
                                            voiceChat.messages.push({
                                                'role': 'tool',
                                                'name': visionResult.tool_calls[0].function.name,
                                                'content': newToolResult,
                                                'tool_call_id': visionResult.tool_calls[0].id
                                            });
                                        }
                                    } else {
                                        // 🔥 工具调用失败，必须为每个tool_call添加错误消息，保证数量匹配！
                                        console.error('❌ 图片分析后的工具调用失败');
                                        visionResult.tool_calls.forEach(toolCall => {
                                            voiceChat.messages.push({
                                                'role': 'tool',
                                                'name': toolCall.function.name,
                                                'content': `工具 ${toolCall.function.name} 执行失败`,
                                                'tool_call_id': toolCall.id
                                            });
                                        });
                                    }

                                    // 继续循环
                                    continue;
                                } else {
                                    // AI分析完图片后直接给出最终回复，跳出循环
                                    finalResponseContent = visionResult.content;
                                    break;
                                }
                            }

                            // 普通工具调用结果处理
                            logToolAction('info', `✅ 工具调用结果: ${JSON.stringify(toolResult)}`);

                            // 处理多工具调用结果
                            if (Array.isArray(toolResult)) {
                                // 多个工具调用结果
                                toolResult.forEach(singleResult => {
                                    const toolCall = result.tool_calls.find(tc => tc.id === singleResult.tool_call_id);
                                    const toolName = toolCall ? toolCall.function.name : 'unknown';

                                    voiceChat.messages.push({
                                        'role': 'tool',
                                        'name': toolName,  // 🔥 添加name字段
                                        'content': singleResult.content,
                                        'tool_call_id': singleResult.tool_call_id
                                    });
                                });
                            } else {
                                // 单个工具调用结果（向后兼容）
                                voiceChat.messages.push({
                                    'role': 'tool',
                                    'name': result.tool_calls[0].function.name,  // 🔥 添加name字段
                                    'content': toolResult,
                                    'tool_call_id': result.tool_calls[0].id
                                });
                            }

                            // 继续下一轮循环,AI会根据工具结果决定是否再次调用工具
                            continue;

                        } else {
                            console.error("工具调用失败");
                            logToolAction('error', "❌ 工具调用失败");
                            throw new Error("工具调用失败，无法完成功能扩展");
                        }
                    }

                    // 没有工具调用,说明AI已经完成任务
                    if (result.content) {
                        finalResponseContent = result.content;

                        // 🔥 不在这里播放TTS，统一在最后播放（参考旧版本的设计）
                        console.log('✅ 最终回复已获取');

                        // 只有真正执行了工具调用才输出统计信息
                        if (iteration > 0) {
                        }
                        break;
                    }

                    // 既没有工具调用也没有内容,异常情况
                    logToTerminal('warn', '⚠️ LLM返回了空响应');
                    // 🔥 空响应时设置固定回复
                    finalResponseContent = "Filtered";

                    // 🔥 检查是否因为图片导致的空响应
                    if (screenshotBase64 || useVisionModelForFirstRound) {
                        logToTerminal('warn', '⚠️ 检测到有截图但返回空响应，可能是模型不支持视觉');
                        throw new Error('模型不支持图片：LLM返回了空响应，可能是因为模型不支持 image_url 参数');
                    }

                    break;
                }

                // 检查是否达到最大轮数限制
                if (iteration >= maxIterations) {
                    logToTerminal('warn', `⚠️ 已达到最大工具调用次数限制 (${maxIterations} 轮)`);
                    // 🔥 尝试获取最终回复 - 使用非流式
                    const lastResult = await llmClient.chatCompletion(voiceChat.messages, [], false);

                    if (lastResult.content) {
                        finalResponseContent = lastResult.content;
                    } else {
                        finalResponseContent = "抱歉,任务太复杂了,我已经尽力了~";
                    }
                    // 🔥 不在这里播放TTS，统一在最后播放
                }

                // 输出最终回复
                if (finalResponseContent) {
                    voiceChat.messages.push({ 'role': 'assistant', 'content': finalResponseContent });

                    // ===== 清除注入的记忆 =====
                    if (voiceChat.removeInjectedMemory) {
                        voiceChat.removeInjectedMemory();
                    }

                    // ===== 保存对话历史 =====
                    voiceChat.saveConversationHistory();
                    // MemOS 保存由 memos 插件的 onLLMResponse 钩子处理

                    // 🎙️ 播放最终回复的TTS（统一在这里播放，参考旧版本的设计）
                    console.log('✅ 最终回复已处理完成，开始播放TTS');

                    // 🔥 过滤最终回复中的思考内容
                    const filteredFinalContent = filterThinkingContent(finalResponseContent);

                    // 触发插件 onLLMResponse 钩子（插件可修改 responseObj.text，影响 TTS 内容）
                    const responseObj = { text: filteredFinalContent || finalResponseContent };
                    if (global.pluginManager) {
                        await global.pluginManager.runLLMResponseHooks(responseObj).catch(() => {});
                    }

                    if (iteration === 0) {
                        // 如果没有中间过程,才reset
                        ttsProcessor.reset();
                    }

                    // 触发插件 onTTSStart 钩子
                    if (global.pluginManager) {
                        await global.pluginManager.runTTSStartHooks(responseObj.text).catch(() => {});
                    }

                    ttsProcessor.processTextToSpeech(responseObj.text);
                } else {
                    logToTerminal('error', '❌ 未获取到有效的AI回复');

                    // 🔥 检查是否因为图片导致的空回复
                    if (screenshotBase64 || useVisionModelForFirstRound) {
                        logToTerminal('warn', '⚠️ 检测到有截图但未获取到回复，可能是模型不支持视觉');
                        throw new Error('模型不支持图片：未获取到有效的AI回复，可能是因为模型不支持 image_url 参数');
                    }

                    throw new Error("未获取到有效的AI回复");
                }

                if (voiceChat.enableContextLimit) {
                    voiceChat.trimMessages();
                }
                } catch (error) {
                    // 🔥 特殊处理：用户打断不是错误，静默退出
                    if (error.message === 'USER_INTERRUPTED') {
                        console.log('用户打断处理完成，静默退出');
                        logToTerminal('info', '✅ 已响应用户打断');

                        // 确保ASR恢复
                        if (voiceChat.asrProcessor && asrEnabled) {
                            voiceChat.asrProcessor.resumeRecording();
                        }
                        return; // 直接返回，不显示错误信息
                    }

                    // 🔥 自动重试机制：检测到视觉不支持错误时，清理图片并重试
                    const errorMsg = error.message.toLowerCase();
                    const isImageUnsupportedError = !hasRetriedWithoutImage && (
                        errorMsg.includes("do not support image") ||
                        errorMsg.includes("不支持图片") ||
                        errorMsg.includes("模型不支持图片") ||
                        errorMsg.includes("image param") ||
                        errorMsg.includes("image_url") ||
                        (errorMsg.includes("image") && errorMsg.includes("not support")) ||
                        (errorMsg.includes("image") && errorMsg.includes("unsupported")) ||
                        (errorMsg.includes("image") && errorMsg.includes("invalid"))
                    );

                    if (isImageUnsupportedError) {

                        console.log('⚠️ 检测到模型不支持视觉，自动移除图片并重试');
                        logToTerminal('warn', '⚠️ 模型不支持视觉功能，自动切换为纯文本模式重试');

                        // 标记已经重试过，避免无限循环
                        hasRetriedWithoutImage = true;

                        // 清理 voiceChat.messages 中的所有图片
                        voiceChat.messages = removeImagesFromMessages(voiceChat.messages);
                        console.log('✅ 已清理消息历史中的所有图片，使用纯文本重试');

                        // 🔥 重置标志，准备重试
                        isFirstAttempt = true;

                        // 继续外层循环，重新开始整个流程
                        continue;
                    }

                    logToTerminal('error', `LLM处理错误: ${error.message}`);
                    if (error.stack) {
                        logToTerminal('error', `错误堆栈: ${error.stack}`);
                    }

                    let errorMessage = "抱歉，出现了一个错误";

                    if (error.message.includes("API拒绝生成内容") || error.message.includes("安全过滤器") || error.message.includes("内容政策")) {
                        errorMessage = "⚠️ API触发了安全过滤器，可能最近的对话包含敏感内容。建议重新开始对话或换个话题。";
                    } else if (error.message.includes("API内容过滤")) {
                        errorMessage = "⚠️ 内容被过滤，请避免敏感话题";
                    } else if (error.message.includes("API密钥验证失败")) {
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
                    } else if (error.message.includes("do not support image") || error.message.includes("不支持图片") || error.message.includes("image param")) {
                        errorMessage = "⚠️ 你使用的是不支持视觉的LLM模型，刚刚触发了调用视觉功能，所以报错了！建议换成支持视觉的LLM模型或在config.json中配置独立的视觉模型！";
                        logToTerminal('warn', '💡 提示：请在config.json中设置 vision.use_vision_model: true 并配置支持视觉的模型（如gemini-2.0-flash）');
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

                    voiceChat.showSubtitle(errorMessage, 3000);
                    if (voiceChat.asrProcessor && asrEnabled) {
                        voiceChat.asrProcessor.resumeRecording();
                    }
                    setTimeout(() => voiceChat.hideSubtitle(), 3000);

                    // 🔥 退出外层重试循环
                    break;
                } finally {
                    // global.isProcessingUserInput 已通过事件自动管理，无需手动设置

                    // 发送用户输入结束事件
                    eventBus.emit(Events.USER_INPUT_END);
                }

                // 🔥 退出外层 while(true) 重试循环
                break;
            }
        };
    }
}

module.exports = { LLMHandler };
