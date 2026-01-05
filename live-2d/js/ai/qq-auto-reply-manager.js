const path = require('path');
const fs = require('fs');

class QQAutoReplyManager {
    constructor() {
        this.isEnabled = false;
        this.qqManager = null;
        this.llmConfig = null;
        this.botQQ = '';
        this.maxHistoryPerGroup = 30;
        this.groupHistories = new Map();
        this.ttsProcessor = null;
        this.qqMemoryManager = null;
    }

    initialize(config, llmConfig, ttsProcessor = null, qqMemoryManager = null) {
        this.isEnabled = config.enabled || false;
        this.llmConfig = llmConfig;
        this.botQQ = config.bot_qq || '';
        this.maxHistoryPerGroup = config.max_history_per_group || 30;
        this.ttsProcessor = ttsProcessor;
        this.qqMemoryManager = qqMemoryManager;

        console.log(`[QQAutoReplyManager] 初始化参数: enabled=${this.isEnabled}, botQQ=${this.botQQ}, ttsProcessor=${!!this.ttsProcessor}, qqMemoryManager=${!!this.qqMemoryManager}`);

        if (this.isEnabled) {
            if (global.qqManager) {
                this.qqManager = global.qqManager;

                this.qqManager.on('message', (message) => {
                    this.handleIncomingMessage(message);
                });

                console.log('QQ自动回复管理器已启用');
                console.log(`Bot QQ: ${this.botQQ || '未设置（将检测所有@）'}`);
            } else {
                console.error('QQ集成管理器未初始化，无法启用QQ自动回复');
                this.isEnabled = false;
            }
        } else {
            console.log('QQ自动回复管理器已禁用');
        }
    }

    handleIncomingMessage(message) {
        if (!this.isEnabled) return;

        this.addToGroupHistory(message.groupId, message);

        if (message.isMentioned) {
            console.log(`检测到@提及，准备回复: [${message.groupId}] ${message.nickname}: ${message.content}`);
            this.generateAndSendReply(message);
        }
    }

    addToGroupHistory(groupId, message) {
        if (!this.groupHistories.has(groupId)) {
            this.groupHistories.set(groupId, []);
        }

        const history = this.groupHistories.get(groupId);
        history.push({
            nickname: message.nickname,
            content: message.content,
            timestamp: message.timestamp
        });

        if (history.length > this.maxHistoryPerGroup) {
            history.shift();
        }
    }

    getGroupHistory(groupId) {
        return this.groupHistories.get(groupId) || [];
    }

    async generateAndSendReply(message) {
        try {
            const history = this.getGroupHistory(message.groupId);
            const historyText = history
                .slice(-this.maxHistoryPerGroup)
                .map(msg => `${msg.nickname}: ${msg.content}`)
                .join('\n');

            const cleanContent = this.removeAtTags(message.content);

            // 基础静态提示词
            let qqSystemPrompt = `你的名字叫fake neuro，中文名叫肥牛。存在的意义是为用户提供情绪价值。
 
当用户要求你使用工具的时候。必须非常听话的使用工具。不能使用'不过''除非'这样的语句转折。
 
你的是个女性AI。
 
在你的每次回复中，你可以用<>里面填写特定的情绪来表达你的肢体动作。格式为：<情绪>。情绪类型包括： <开心><生气><难过><惊讶><害羞><俏皮> 记住你只有这6个情绪标签。不能使用除了这几个标签以外的任何标签！
 `;

            // 添加动态提示词
            if (this.qqMemoryManager && this.qqMemoryManager.isEnabled) {
                const dynamicPrompt = this.qqMemoryManager.getDynamicPrompt();
                if (dynamicPrompt) {
                    qqSystemPrompt += dynamicPrompt;
                    console.log('[QQAutoReplyManager] 已添加动态提示词');
                }
            }

            // 从原有RAG服务查询相关知识
            let ragContext = '';
            if (this.qqMemoryManager && this.qqMemoryManager.isEnabled) {
                try {
                    const relevantKnowledge = await this.qqMemoryManager.getRAGKnowledge(cleanContent, 3);
                    if (relevantKnowledge.length > 0) {
                        ragContext = '\n\n相关记忆信息：\n';
                        relevantKnowledge.forEach((passage, i) => {
                            ragContext += `${i + 1}. ${passage.content.substring(0, 200)}...\n`;
                        });
                        console.log('[QQAutoReplyManager] 已从RAG服务获取相关记忆');
                    }
                } catch (error) {
                    console.log('[QQAutoReplyManager] RAG查询失败，继续正常回复');
                }
            }

            const prompt = `你正在QQ群聊中，有人@你并说：${cleanContent}

最近的群聊记录：
${historyText}${ragContext}

请简短回复（不超过100字），要符合你的性格特点。`;

            // 根据模型名称判断是否需要思考模式
            const modelLower = this.llmConfig.model.toLowerCase();
            const needsThinking = modelLower.includes('gemini-2.5') ||
                                  modelLower.includes('deepseek-reasoner') ||
                                  modelLower.includes('thinking');
            
            const requestBody = {
                model: this.llmConfig.model,
                messages: [
                    { role: 'system', content: qqSystemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 4096  // 设置为4096，给思考和回复留足够空间
            };

            // 只有非思考模式的模型才添加 thinking 配置
            if (!needsThinking) {
                requestBody.thinking = {
                    type: "disabled",
                    budget_tokens: 0
                };
            }

            const response = await fetch(`${this.llmConfig.api_url}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.llmConfig.api_key}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                console.error('LLM请求失败:', response.status);
                const errorText = await response.text();
                console.error('错误响应:', errorText);
                return;
            }

            const data = await response.json();
            console.log('LLM原始响应:', JSON.stringify(data, null, 2));

            // 检查响应格式
            if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                console.error('LLM响应格式不正确:', data);
                return;
            }

            // 处理思考模式的响应
            const messageData = data.choices[0].message;
            let replyContent = messageData.content;
            
            // 如果content为空，检查是否有thinking字段
            if (!replyContent && messageData.thinking) {
                console.log('检测到思考模式响应，但没有实际回复文本');
                console.log('思考内容:', messageData.thinking.substring(0, 200) + '...');
                console.error('模型只生成了思考内容，没有生成回复。尝试重新请求...');
                
                // 使用更明确的提示重新请求
                const retryPrompt = `${prompt}\n\n重要：请直接给出简短的回复文字，不要只思考不回复。`;
                const retryBody = {
                    ...requestBody,
                    messages: [
                        { role: 'system', content: qqSystemPrompt },
                        { role: 'user', content: retryPrompt }
                    ]
                };
                
                const retryResponse = await fetch(`${this.llmConfig.api_url}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.llmConfig.api_key}`
                    },
                    body: JSON.stringify(retryBody)
                });
                
                if (retryResponse.ok) {
                    const retryData = await retryResponse.json();
                    replyContent = retryData.choices[0]?.message?.content;
                }
            }
            
            console.log('提取的回复内容:', replyContent);

            // 检查回复内容是否有效
            if (!replyContent) {
                console.error('LLM返回的内容为空或undefined，无法生成回复');
                return;
            }

            // 为QQ消息转换情绪标签为QQ表情CQ码
            const replyContentForQQ = this.cleanReply(replyContent);
            console.log('转换QQ表情后的回复内容:', replyContentForQQ);

            // 为TTS移除情绪标签（保持原文，只是移除标签）
            const replyContentForTTS = replyContent.replace(/<开心>|<生气>|<难过>|<惊讶>|<害羞>|<俏皮>/g, '').trim();

            // 如果回复内容为空，不发送
            if (!replyContentForQQ || replyContentForQQ.trim() === '') {
                console.error('生成的回复内容为空，不发送');
                return;
            }

            const success = this.qqManager.sendGroupMessage(message.groupId, replyContentForQQ);

            if (success) {
                console.log(`已回复到群${message.groupId}: ${replyContentForQQ}`);

                // 如果配置了TTS处理器，也通过语音播放回复内容（使用移除了情绪标签的文本）
                if (this.ttsProcessor) {
                    try {
                        console.log('开始TTS播放QQ回复内容');
                        this.ttsProcessor.reset();
                        this.ttsProcessor.processTextToSpeech(replyContentForTTS);
                    } catch (ttsError) {
                        console.error('TTS播放失败:', ttsError);
                    }
                }

                this.addToGroupHistory(message.groupId, {
                    nickname: 'Fake Neuro',
                    content: replyContentForQQ,
                    timestamp: Date.now()
                });

                this.saveReplyLog(message.groupId, message.nickname, cleanContent, replyContentForQQ);
            }

        } catch (error) {
            console.error('生成或发送回复失败:', error);
        }
    }

    removeAtTags(content) {
        return content
            .replace(/\[CQ:at,qq=\d+\]/g, '')
            .replace(/@\S+\s*/g, '')
            .trim();
    }

    cleanReply(reply) {
        if (!reply) {
            return '';
        }
        // 将情绪标签转换为QQ表情CQ码
        // QQ表情对照表（常用）：
        // id=0: 惊讶  id=1: 撇嘴  id=2: 色  id=3: 发呆  id=4: 得意
        // id=5: 流泪  id=6: 害羞  id=7: 闭嘴  id=8: 睡  id=9: 大哭
        // id=10: 尴尬  id=11: 发怒  id=12: 调皮  id=13: 呲牙  id=14: 微笑
        // id=74: 太开心  id=106: 生气  id=109: 害羞  id=182: 机智
        return reply
            .replace(/<开心>/g, '[CQ:face,id=74]')    // 太开心 表情
            .replace(/<生气>/g, '[CQ:face,id=106]')   // 生气 表情
            .replace(/<难过>/g, '[CQ:face,id=9]')     // 大哭 表情
            .replace(/<惊讶>/g, '[CQ:face,id=0]')     // 惊讶 表情
            .replace(/<害羞>/g, '[CQ:face,id=109]')   // 害羞 表情
            .replace(/<俏皮>/g, '[CQ:face,id=182]')   // 机智 表情
            .trim();
    }

    saveReplyLog(groupId, nickname, question, reply) {
        try {
            const logDir = path.join(__dirname, '..', 'AI记录室');
            const logFile = path.join(logDir, 'QQ自动回复日志.txt');

            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const timestamp = new Date().toLocaleString('zh-CN');
            const logEntry = `[${timestamp}] 群${groupId} - ${nickname}: ${question}\n回复: ${reply}\n\n`;

            fs.appendFileSync(logFile, logEntry, 'utf8');
        } catch (error) {
            console.error('保存回复日志失败:', error);
        }
    }

    clearGroupHistory(groupId = null) {
        if (groupId) {
            this.groupHistories.delete(groupId);
            console.log(`已清空群${groupId}的历史记录`);
        } else {
            this.groupHistories.clear();
            console.log('已清空所有群的历史记录');
        }
    }

    stop() {
        this.isEnabled = false;
        this.groupHistories.clear();
        console.log('QQ自动回复管理器已停止');
    }

    setEnabled(enabled) {
        const wasEnabled = this.isEnabled;
        this.isEnabled = enabled;

        if (enabled && !wasEnabled) {
            console.log('启用QQ自动回复管理器');
            if (!this.qqManager && global.qqManager) {
                this.qqManager = global.qqManager;
                this.qqManager.on('message', (message) => {
                    this.handleIncomingMessage(message);
                });
            }
        } else if (!enabled && wasEnabled) {
            console.log('禁用QQ自动回复管理器');
            this.stop();
        }
    }
}

const qqAutoReplyManager = new QQAutoReplyManager();

module.exports = { qqAutoReplyManager };