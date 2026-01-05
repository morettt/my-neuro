// qq-memory-manager.js - QQ消息记忆库和动态提示词管理模块
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const axios = require('axios');

class QQMemoryManager extends EventEmitter {
    constructor() {
        super();
        this.isEnabled = false;
        this.qqManager = null;
        this.llmConfig = null;
        this.config = null;
        
        // 记忆库路径
        this.memoryDir = path.join(__dirname, '..', '..', 'AI记录室', 'QQ记忆库');
        this.messagesFile = path.join(this.memoryDir, 'qq_messages.jsonl');
        this.dynamicPromptFile = path.join(this.memoryDir, 'dynamic_prompt.txt');
        this.personalityEvolutionFile = path.join(this.memoryDir, 'personality_evolution.json');
        this.aiJsonFile = path.join(__dirname, '..', '..', 'AI.json');
        
        // RAG服务配置
        this.ragServerUrl = 'http://127.0.0.1:8002';
        
        // 群组消息历史（内存中）
        this.groupMessages = new Map();
        this.maxMessagesPerGroup = 1000;
        
        // 动态提示词
        this.dynamicPrompt = '';
        this.personalityTraits = {
            common_topics: [],
            interaction_style: [],
            vocabulary: [],
            emotional_tendencies: [],
            last_updated: null
        };
        
        // 统计信息
        this.totalMessageCount = 0;
        this.totalUpdates = 0;
        this.lastSearchTime = null;
        
        // 初始化目录
        this.initializeDirectories();
    }

    initializeDirectories() {
        if (!fs.existsSync(this.memoryDir)) {
            fs.mkdirSync(this.memoryDir, { recursive: true });
            console.log('[QQMemoryManager] 创建记忆库目录:', this.memoryDir);
        }
        
        // 初始化文件
        if (!fs.existsSync(this.personalityEvolutionFile)) {
            this.savePersonalityTraits();
        } else {
            this.loadPersonalityTraits();
        }
        
        if (!fs.existsSync(this.dynamicPromptFile)) {
            this.dynamicPrompt = '// 动态提示词将根据QQ群聊内容自动生成和更新';
            this.saveDynamicPrompt();
        } else {
            this.loadDynamicPrompt();
        }
    }

    initialize(config, llmConfig, searchFunction = null) {
        this.config = config;
        this.llmConfig = llmConfig;
        this.searchFunction = searchFunction;
        this.isEnabled = config.enabled || false;

        console.log(`[QQMemoryManager] 初始化: enabled=${this.isEnabled}`);

        if (this.isEnabled) {
            if (global.qqManager) {
                this.qqManager = global.qqManager;
                
                // 监听所有QQ消息
                this.qqManager.on('message', (message) => {
                    this.handleIncomingMessage(message);
                });

                console.log('[QQMemoryManager] QQ记忆库管理器已启用');
            } else {
                console.error('[QQMemoryManager] QQ集成管理器未初始化');
                this.isEnabled = false;
            }
        }
    }

    async handleIncomingMessage(message) {
        if (!this.isEnabled) return;

        try {
            // 1. 保存消息到记忆库
            await this.saveMessageToMemory(message);
            
            // 2. 添加到群组历史
            this.addToGroupHistory(message.groupId, message);
            
            // 3. 保存到RAG知识库（异步，不阻塞）
            this.saveToRAGKnowledgeFile(message).catch(err => {
                console.error('[QQMemoryManager] RAG知识库保存失败:', err);
            });
            
            // 4. 定期更新动态提示词（每20条消息）
            // 使用 totalMessageCount 而不是单个群组的消息数量
            if (this.totalMessageCount > 0 && this.totalMessageCount % 20 === 0) {
                console.log(`[QQMemoryManager] 达到${this.totalMessageCount}条消息，触发动态提示词更新`);
                this.updateDynamicPrompt().catch(err => {
                    console.error('[QQMemoryManager] 动态提示词更新失败:', err);
                });
            }
            
            this.totalMessageCount++;
            
        } catch (error) {
            console.error('[QQMemoryManager] 处理消息失败:', error);
        }
    }

    async saveMessageToMemory(message) {
        try {
            const messageRecord = {
                timestamp: Date.now(),
                date: new Date().toISOString(),
                groupId: message.groupId,
                userId: message.userId,
                nickname: message.nickname,
                content: message.content,
                isMentioned: message.isMentioned
            };
            
            // 追加到JSONL文件
            fs.appendFileSync(
                this.messagesFile,
                JSON.stringify(messageRecord) + '\n',
                'utf8'
            );
            
        } catch (error) {
            console.error('[QQMemoryManager] 保存消息失败:', error);
        }
    }

    addToGroupHistory(groupId, message) {
        if (!this.groupMessages.has(groupId)) {
            this.groupMessages.set(groupId, []);
        }
        
        const history = this.groupMessages.get(groupId);
        history.push({
            nickname: message.nickname,
            content: message.content,
            timestamp: message.timestamp || Date.now()
        });
        
        // 限制内存中的消息数量
        if (history.length > this.maxMessagesPerGroup) {
            history.shift();
        }
    }

    async saveToRAGKnowledgeFile(message) {
        try {
            // 将消息保存到RAG知识库文件，供RAG服务器读取
            const ragDataDir = path.join(this.memoryDir, 'rag_data');
            if (!fs.existsSync(ragDataDir)) {
                fs.mkdirSync(ragDataDir, { recursive: true });
            }
            
            const ragKnowledgeFile = path.join(ragDataDir, 'qq_knowledge.jsonl');
            
            const knowledgeEntry = {
                text: `${message.nickname}: ${message.content}`,
                metadata: {
                    groupId: message.groupId,
                    userId: message.userId,
                    nickname: message.nickname,
                    timestamp: Date.now(),
                    date: new Date().toISOString(),
                    isMentioned: message.isMentioned
                }
            };
            
            fs.appendFileSync(
                ragKnowledgeFile,
                JSON.stringify(knowledgeEntry) + '\n',
                'utf8'
            );
            
            console.log('[QQMemoryManager] 已保存到RAG知识库文件');
            
        } catch (error) {
            console.error('[QQMemoryManager] 保存RAG知识库文件失败:', error);
        }
    }

    async processKnowledgeEnhancement(message) {
        // 检测消息中是否包含可能需要搜索的内容
        const needsSearch = await this.detectSearchNeed(message.content);
        
        if (needsSearch.needed) {
            console.log(`[QQMemoryManager] 检测到需要搜索的内容: ${needsSearch.query}`);
            
            // 使用搜索功能获取知识
            if (this.searchFunction) {
                try {
                    const searchResult = await this.searchFunction({ query: needsSearch.query });
                    
                    // 保存到RAG知识库
                    await this.saveToRAGKnowledge({
                        query: needsSearch.query,
                        answer: searchResult,
                        source: 'web_search',
                        context: message.content,
                        timestamp: Date.now()
                    });
                    
                } catch (error) {
                    console.error('[QQMemoryManager] 搜索失败:', error);
                }
            }
        }
    }

    async detectSearchNeed(content) {
        // 简单的启发式检测：包含疑问词或特定关键词
        const questionPatterns = [
            /什么是/,
            /怎么/,
            /如何/,
            /为什么/,
            /哪里/,
            /谁是/,
            /介绍.*吗/,
            /.*是什么/,
            /.*怎么样/
        ];
        
        for (const pattern of questionPatterns) {
            if (pattern.test(content)) {
                // 提取关键词作为搜索查询
                const query = content.replace(/[<>@\[\]]/g, '').trim().substring(0, 100);
                return { needed: true, query };
            }
        }
        
        return { needed: false };
    }

    async saveToRAGKnowledge(knowledgeEntry) {
        try {
            fs.appendFileSync(
                this.ragKnowledgeFile,
                JSON.stringify(knowledgeEntry) + '\n',
                'utf8'
            );
            console.log('[QQMemoryManager] 已保存到RAG知识库');
        } catch (error) {
            console.error('[QQMemoryManager] 保存RAG知识失败:', error);
        }
    }

    async updateDynamicPrompt() {
        try {
            console.log('[QQMemoryManager] 开始更新动态提示词...');
            
            // 收集最近的群聊数据用于分析
            const recentMessages = this.collectRecentMessages(200);
            
            if (recentMessages.length < 10) {
                console.log('[QQMemoryManager] 消息数量不足，跳过更新');
                return;
            }
            
            // 使用LLM分析群聊特征
            const analysis = await this.analyzeGroupCharacteristics(recentMessages);
            
            if (analysis) {
                // 更新人格特征
                this.personalityTraits = {
                    ...this.personalityTraits,
                    ...analysis,
                    last_updated: new Date().toISOString()
                };
                
                this.savePersonalityTraits();
                
                // 生成新的动态提示词
                await this.generateDynamicPrompt();
                
                // 更新AI.json文件
                this.updateAIJson();
                
                console.log('[QQMemoryManager] 动态提示词已更新');
                this.emit('prompt-updated', this.dynamicPrompt);
            }
            
        } catch (error) {
            console.error('[QQMemoryManager] 更新动态提示词失败:', error);
        }
    }

    collectRecentMessages(limit = 200) {
        const allMessages = [];
        
        for (const [groupId, messages] of this.groupMessages.entries()) {
            allMessages.push(...messages.slice(-50)); // 每个群取最近50条
        }
        
        // 按时间排序并限制数量
        return allMessages
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    async analyzeGroupCharacteristics(messages) {
        try {
            // 过滤和清理消息内容
            const cleanMessages = messages
                .slice(0, 100)
                .map(m => ({
                    nickname: m.nickname,
                    // 移除CQ码（QQ特殊消息格式）、图片、表情等
                    content: m.content
                        .replace(/\[CQ:[^\]]+\]/g, '')  // 移除所有CQ码
                        .replace(/https?:\/\/[^\s]+/g, '[链接]')  // 替换链接
                        .trim()
                }))
                .filter(m => m.content.length > 0 && m.content.length < 200)  // 只保留有效消息
                .slice(0, 50);  // 最多取50条
            
            if (cleanMessages.length < 10) {
                console.log('[QQMemoryManager] 清理后的有效消息不足10条，跳过分析');
                return null;
            }
            
            const messagesSample = cleanMessages
                .map(m => `${m.nickname}: ${m.content}`)
                .join('\n');
            
            console.log('[QQMemoryManager] 准备分析的消息样本长度:', messagesSample.length);
            console.log('[QQMemoryManager] 消息数量:', cleanMessages.length);
            
            // 简化prompt，避免触发内容过滤
            const prompt = `分析这些对话记录，提取关键特征。

对话样本：
${messagesSample}

返回JSON格式：
{
  "common_topics": ["话题1", "话题2"],
  "interaction_style": ["风格描述"],
  "vocabulary": ["常用词1", "常用词2"],
  "emotional_tendencies": ["情绪特点"]
}`;

            console.log('[QQMemoryManager] 正在调用LLM分析群聊特征...');
            console.log('[QQMemoryManager] API URL:', this.llmConfig.api_url);
            console.log('[QQMemoryManager] Prompt长度:', prompt.length);
            
            // 使用 axios 而不是 fetch，因为在 Node.js 中更稳定
            // 增加max_tokens避免截断,降低temperature提高稳定性
            const response = await axios.post(
                `${this.llmConfig.api_url}/chat/completions`,
                {
                    model: this.llmConfig.model,
                    messages: [
                        {
                            role: 'system',
                            content: '你是一个数据分析助手,擅长从对话中提取特征。请严格按JSON格式输出,不要添加其他解释。'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 20000000,
                    response_format: { type: "json_object" }  // 强制JSON输出(如果API支持)
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.llmConfig.api_key}`
                    },
                    timeout: 30000 // 30秒超时
                }
            );

            const data = response.data;
            console.log('[QQMemoryManager] LLM响应状态:', response.status);
            console.log('[QQMemoryManager] 完整响应数据:', JSON.stringify(data, null, 2));
            
            // 检查响应是否有效
            if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                console.error('[QQMemoryManager] LLM响应格式无效');
                console.error('[QQMemoryManager] 响应结构:', Object.keys(data));
                if (data.choices) {
                    console.error('[QQMemoryManager] choices结构:', data.choices);
                }
                return null;
            }
            
            const content = data.choices[0].message.content;
            
            // 检查content是否存在
            if (!content || content.trim() === '') {
                console.error('[QQMemoryManager] LLM返回的content为空');
                console.error('[QQMemoryManager] message对象:', JSON.stringify(data.choices[0].message, null, 2));
                console.error('[QQMemoryManager] 可能原因: 内容过滤、tokens不足或API异常');
                
                // 尝试使用finish_reason判断原因
                const finishReason = data.choices[0].finish_reason;
                console.error('[QQMemoryManager] finish_reason:', finishReason);
                
                if (finishReason === 'length') {
                    console.error('[QQMemoryManager] 错误原因: max_tokens设置过小,内容被截断');
                } else if (finishReason === 'content_filter') {
                    console.error('[QQMemoryManager] 错误原因: 内容被过滤,群聊内容可能包含敏感信息');
                }
                
                return null;
            }
            
            console.log('[QQMemoryManager] 成功获取content，长度:', content.length);
            
            // 提取JSON，移除可能的markdown代码块标记
            let jsonText = content.trim();
            jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            
            // 尝试提取JSON对象
            const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    // 移除JSON中的尾随逗号
                    let cleanJson = jsonMatch[0]
                        .replace(/,(\s*[}\]])/g, '$1')  // 移除对象/数组结尾的逗号
                        .replace(/,(\s*,)/g, ',');       // 移除连续逗号
                    
                    const parsed = JSON.parse(cleanJson);
                    console.log('[QQMemoryManager] 成功解析群聊特征:', parsed);
                    return parsed;
                } catch (parseError) {
                    console.error('[QQMemoryManager] JSON解析失败:', parseError.message);
                    console.log('[QQMemoryManager] 原始内容:', jsonMatch[0].substring(0, 200));
                    return null;
                }
            }
            
            console.log('[QQMemoryManager] 未找到有效的JSON格式');
            console.log('[QQMemoryManager] 原始响应内容:', content.substring(0, 300));
            
            // 返回默认值而不是null,确保系统继续运行
            console.log('[QQMemoryManager] 使用默认特征值');
            return {
                common_topics: ['日常聊天'],
                interaction_style: ['轻松友好'],
                vocabulary: ['常规对话'],
                emotional_tendencies: ['中性']
            };
            
        } catch (error) {
            console.error('[QQMemoryManager] 分析群聊特征失败:', error);
            
            // 如果是axios错误,打印更多细节
            if (error.response) {
                console.error('[QQMemoryManager] API响应错误:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data
                });
            } else if (error.request) {
                console.error('[QQMemoryManager] 请求未收到响应');
            } else {
                console.error('[QQMemoryManager] 错误信息:', error.message);
            }
            
            // 返回默认值确保系统继续运行
            return {
                common_topics: ['日常聊天'],
                interaction_style: ['轻松友好'],
                vocabulary: ['常规对话'],
                emotional_tendencies: ['中性']
            };
        }
    }

    async generateDynamicPrompt() {
        const traits = this.personalityTraits;
        
        let prompt = `\n\n=== 动态人格特征（基于QQ群聊学习）===\n`;
        prompt += `最后更新时间: ${traits.last_updated}\n\n`;
        
        if (traits.common_topics && traits.common_topics.length > 0) {
            prompt += `群友常讨论的话题: ${traits.common_topics.join('、')}\n`;
        }
        
        if (traits.interaction_style && traits.interaction_style.length > 0) {
            prompt += `群聊互动风格: ${traits.interaction_style.join('；')}\n`;
        }
        
        if (traits.vocabulary && traits.vocabulary.length > 0) {
            prompt += `群友常用词汇/梗: ${traits.vocabulary.join('、')}\n`;
        }
        
        if (traits.emotional_tendencies && traits.emotional_tendencies.length > 0) {
            prompt += `群聊情绪倾向: ${traits.emotional_tendencies.join('、')}\n`;
        }
        
        prompt += `\n根据以上特征，你应该适当调整回复风格，更贴近这个群的文化氛围。\n`;
        
        this.dynamicPrompt = prompt;
        this.saveDynamicPrompt();
        this.totalUpdates++;
    }

    getDynamicPrompt() {
        return this.dynamicPrompt;
    }

    async getRAGKnowledge(query, limit = 3) {
        try {
            // 从RAG服务器查询相关知识
            const response = await axios.post(`${this.ragServerUrl}/ask`, {
                question: query,
                top_k: limit
            });
            
            return response.data.relevant_passages || [];
            
        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                console.log('[QQMemoryManager] RAG服务器未启动');
            } else {
                console.error('[QQMemoryManager] RAG查询失败:', error.message);
            }
            return [];
        }
    }

    saveDynamicPrompt() {
        try {
            fs.writeFileSync(this.dynamicPromptFile, this.dynamicPrompt, 'utf8');
        } catch (error) {
            console.error('[QQMemoryManager] 保存动态提示词失败:', error);
        }
    }

    loadDynamicPrompt() {
        try {
            if (fs.existsSync(this.dynamicPromptFile)) {
                this.dynamicPrompt = fs.readFileSync(this.dynamicPromptFile, 'utf8');
            }
        } catch (error) {
            console.error('[QQMemoryManager] 加载动态提示词失败:', error);
        }
    }

    savePersonalityTraits() {
        try {
            fs.writeFileSync(
                this.personalityEvolutionFile,
                JSON.stringify(this.personalityTraits, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('[QQMemoryManager] 保存人格特征失败:', error);
        }
    }

    loadPersonalityTraits() {
        try {
            if (fs.existsSync(this.personalityEvolutionFile)) {
                const data = fs.readFileSync(this.personalityEvolutionFile, 'utf8');
                
                // 尝试解析JSON
                try {
                    this.personalityTraits = JSON.parse(data);
                    console.log('[QQMemoryManager] 成功加载人格特征');
                } catch (parseError) {
                    console.log('[QQMemoryManager] JSON格式错误，重置为默认人格特征');
                    console.log(`[QQMemoryManager] 错误详情: ${parseError.message}`);
                    
                    // 备份损坏的文件
                    const backupFile = this.personalityEvolutionFile + '.backup';
                    try {
                        fs.writeFileSync(backupFile, data, 'utf8');
                        console.log(`[QQMemoryManager] 已备份损坏的文件到: ${backupFile}`);
                    } catch (e) {}
                    
                    // 重置为默认值
                    this.personalityTraits = {
                        common_topics: [],
                        interaction_style: [],
                        vocabulary: [],
                        emotional_tendencies: [],
                        last_updated: null
                    };
                    this.savePersonalityTraits();
                }
            }
        } catch (error) {
            console.error('[QQMemoryManager] 读取人格特征文件失败:', error.message);
            // 确保有默认值
            this.personalityTraits = {
                common_topics: [],
                interaction_style: [],
                vocabulary: [],
                emotional_tendencies: [],
                last_updated: null
            };
        }
    }

    updateAIJson() {
        try {
            // 读取当前AI.json
            let aiData = {};
            if (fs.existsSync(this.aiJsonFile)) {
                const content = fs.readFileSync(this.aiJsonFile, 'utf8');
                aiData = JSON.parse(content);
            }
            
            // 更新数据
            aiData.dynamic_prompt_system = {
                ...aiData.dynamic_prompt_system,
                enabled: this.isEnabled,
                last_updated: new Date().toISOString()
            };
            
            aiData.current_dynamic_prompt = {
                raw_text: this.dynamicPrompt,
                generated_at: this.personalityTraits.last_updated,
                message_count_trigger: 20,
                analysis_sample_size: 200
            };
            
            aiData.learned_characteristics = {
                common_topics: this.personalityTraits.common_topics || [],
                interaction_style: this.personalityTraits.interaction_style || [],
                vocabulary: this.personalityTraits.vocabulary || [],
                emotional_tendencies: this.personalityTraits.emotional_tendencies || [],
                last_analysis: this.personalityTraits.last_updated,
                total_updates: this.totalUpdates
            };
            
            aiData.rag_integration = {
                server_url: this.ragServerUrl,
                last_sync: this.lastSearchTime,
                status: 'integrated_with_external_rag'
            };
            
            aiData.statistics = {
                total_messages_recorded: this.totalMessageCount,
                total_prompt_updates: this.totalUpdates,
                last_updated: new Date().toISOString()
            };
            
            // 保存AI.json
            fs.writeFileSync(this.aiJsonFile, JSON.stringify(aiData, null, 2), 'utf8');
            console.log('[QQMemoryManager] AI.json已更新');
            
        } catch (error) {
            console.error('[QQMemoryManager] 更新AI.json失败:', error);
        }
    }

    stop() {
        this.isEnabled = false;
        console.log('[QQMemoryManager] QQ记忆库管理器已停止');
    }

    setEnabled(enabled) {
        const wasEnabled = this.isEnabled;
        this.isEnabled = enabled;

        if (enabled && !wasEnabled) {
            console.log('[QQMemoryManager] 启用QQ记忆库管理器');
            if (!this.qqManager && global.qqManager) {
                this.qqManager = global.qqManager;
                this.qqManager.on('message', (message) => {
                    this.handleIncomingMessage(message);
                });
            }
        } else if (!enabled && wasEnabled) {
            console.log('[QQMemoryManager] 禁用QQ记忆库管理器');
            this.stop();
        }
    }
}

const qqMemoryManager = new QQMemoryManager();

module.exports = { qqMemoryManager, QQMemoryManager };