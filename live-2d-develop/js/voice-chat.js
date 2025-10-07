const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 导入子模块
const { MemoryManager } = require('./voice-chat/MemoryManager.js');
const { DiaryManager } = require('./voice-chat/DiaryManager.js');
const { ScreenshotManager } = require('./voice-chat/ScreenshotManager.js');
const { GameIntegration } = require('./voice-chat/GameIntegration.js');
const { ContextManager } = require('./voice-chat/ContextManager.js');

class VoiceChatInterface {
    constructor(vadUrl, asrUrl, ttsProcessor, showSubtitle, hideSubtitle, config) {
        // 直接使用传入的配置
        this.config = config;

        // 检查ASR是否可用
        this.asrEnabled = this.config.asr?.enabled !== false;

        // 新增：语音打断功能检查
        this.voiceBargeInEnabled = this.config.asr?.voice_barge_in || false;
        console.log(`语音打断功能: ${this.voiceBargeInEnabled ? '已可用' : '已禁用'}`);

        // LLM配置
        this.API_KEY = this.config.llm.api_key;
        this.API_URL = this.config.llm.api_url;
        this.MODEL = this.config.llm.model;

        this.ttsProcessor = ttsProcessor;
        this.showSubtitle = showSubtitle;
        this.hideSubtitle = hideSubtitle;

        // 只在ASR可用时初始化ASR处理器
        if (this.asrEnabled) {
            const { ASRProcessor } = require('./asr-processor.js');
            this.asrProcessor = new ASRProcessor(vadUrl, asrUrl, config); // 传递完整配置

            // 新增：如果可用了语音打断，设置TTS处理器引用
            if (this.voiceBargeInEnabled && this.ttsProcessor) {
                this.asrProcessor.setTTSProcessor(this.ttsProcessor);
                console.log('TTS处理器已设置到ASR，支持语音打断');
            }

            // 设置ASR回调
            this.asrProcessor.setOnSpeechRecognized(async (text) => {
                this.showSubtitle(`${this.config.subtitle_labels.user}: ${text}`, 3000);
                global.isProcessingUserInput = true;

                // 重置AI日记定时器
                this.resetDiaryTimer();

                try {
                    // 新增：检查游戏模式
                    if (this.isGameModeActive) {
                        await this.handleGameInput(text);
                    } else {
                        // 异步处理记忆检查，不阻塞对话流程
                        this.checkAndSaveMemoryAsync(text);

                        await this.sendToLLM(text);
                    }
                } finally {
                    // 在finally中确保解锁ASR（特别重要）
                    global.isProcessingUserInput = false;

                    // 确保ASR在对话结束后能继续工作
                    if (this.asrProcessor) {
                        setTimeout(() => {
                            this.asrProcessor.resumeRecording();
                            console.log('ASR已在对话结束后解锁');
                        }, 100);
                    }

                    const lastUserMsg = this.messages.filter(m => m.role === 'user').pop();
                    const lastAIMsg = this.messages.filter(m => m.role === 'assistant').pop();

                    if (lastUserMsg && lastAIMsg) {
                        const newContent = `【用户】: ${lastUserMsg.content}\n【Fake Neuro】: ${lastAIMsg.content}\n`;

                        try {
                            fs.appendFileSync(
                                path.join(__dirname, '..', 'AI记录室', '记忆库.txt'),
                                newContent,
                                'utf8'
                            );
                        } catch (error) {
                            console.error('保存记忆库失败:', error);
                        }
                    }
                }
            });
        } else {
            console.log('ASR已禁用，跳过ASR处理器初始化');
            this.asrProcessor = null;
        }

        // 上下文限制相关属性
        this.maxContextMessages = this.config.context.max_messages;
        this.enableContextLimit = this.config.context.enable_limit;

        // 截图相关属性
        this.screenshotEnabled = this.config.vision.enabled;
        this.screenshotPath = this.config.vision.screenshot_path;
        this.autoScreenshot = this.config.vision.auto_screenshot || false;

        // 记忆文件路径
        this.memoryFilePath = this.config.memory.file_path;

        // 交互计数器（会话级别）
        this.sessionInteractionNumber = this.getNextInteractionNumber();

        // AI日记功能
        this.aiDiaryEnabled = this.config.ai_diary?.enabled || false;
        this.aiDiaryIdleTime = this.config.ai_diary?.idle_time || 600000; // 10分钟
        this.aiDiaryFile = this.config.ai_diary?.diary_file || "AI日记.txt";
        this.lastInteractionTime = Date.now();
        this.diaryTimer = null;

        // 模型引用
        this.model = null;
        this.emotionMapper = null;

        // ========== 初始化子模块 ==========
        this.memoryManager = new MemoryManager(this);
        this.diaryManager = new DiaryManager(this);
        this.screenshotManager = new ScreenshotManager(this);
        this.gameIntegration = new GameIntegration(this, config);
        this.contextManager = new ContextManager(this);

        // 游戏模式相关（委托给GameIntegration）
        this.gameModules = this.gameIntegration.gameModules;
        this.isGameModeActive = this.gameIntegration.isGameModeActive();

        // 启动AI日记定时器
        if (this.aiDiaryEnabled) {
            this.startDiaryTimer();
        }

        // 确保AI记录室文件夹和记忆库文件存在
        const recordsDir = path.join(__dirname, '..', 'AI记录室');
        const dialogLogPath = path.join(recordsDir, '记忆库.txt');
        try {
            // 确保AI记录室文件夹存在
            if (!fs.existsSync(recordsDir)) {
                fs.mkdirSync(recordsDir, { recursive: true });
                console.log('已创建AI记录室文件夹');
            }
            // 确保记忆库文件存在
            if (!fs.existsSync(dialogLogPath)) {
                fs.writeFileSync(dialogLogPath, '', 'utf8');
                console.log('已创建记忆库文件');
            }

            const now = new Date();
            const currentDate = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`;

            // 检查文件最后是否已经有今天的日期
            const existingContent = fs.readFileSync(dialogLogPath, 'utf8');
            const todayPattern = `[${currentDate}]`;

            let sessionStart;
            if (existingContent.includes(todayPattern)) {
                // 今天已经有记录，只添加交互编号
                sessionStart = `\n交互${this.sessionInteractionNumber}：\n`;
            } else {
                // 今天还没有记录，添加完整的日期分割线
                sessionStart = `------------------------------------\n[${currentDate}]\n\n交互${this.sessionInteractionNumber}：\n`;
            }

            fs.appendFileSync(dialogLogPath, sessionStart, 'utf8');
            console.log('记忆库文件已准备好');
        } catch (error) {
            console.error('准备记忆库文件失败:', error);
        }

        // 读取记忆库文件内容
        let memoryContent = "";
        try {
            const fullMemoryPath = path.join(__dirname, '..', this.memoryFilePath);
            memoryContent = fs.readFileSync(fullMemoryPath, 'utf8');
            console.log('成功读取记忆库内容');
        } catch (error) {
            console.error('读取记忆库文件失败:', error);
            memoryContent = "无法读取记忆库内容";
        }

        // 获取系统提示词并添加记忆库内容
        const baseSystemPrompt = this.config.llm.system_prompt;
        const systemPrompt = `${baseSystemPrompt}这些数据里面是有关用户的各种信息。你可以观测，在必要的时候参考这些内容，正常普通的对话不要提起：
${memoryContent}`;

        // ===== 新增：加载持久化对话历史 =====
        const conversationHistoryPath = path.join(__dirname, '..', 'AI记录室', '对话历史.json');
        let conversationHistory = [];

        // 总是尝试读取历史文件（用于保存时的完整性）
        try {
            if (fs.existsSync(conversationHistoryPath)) {
                const historyData = fs.readFileSync(conversationHistoryPath, 'utf8');
                conversationHistory = JSON.parse(historyData);
                console.log(`读取到完整对话历史，共 ${conversationHistory.length} 条消息`);
            } else {
                console.log('对话历史文件不存在，将创建新的对话历史');
            }
        } catch (error) {
            console.error('加载对话历史失败:', error);
            conversationHistory = [];
        }

        // 保存完整历史供保存时使用
        this.fullConversationHistory = conversationHistory;

        // 根据配置决定AI是否能看到历史
        const historyForAI = this.config.context.persistent_history ? conversationHistory : [];

        if (this.config.context.persistent_history) {
            console.log(`AI将记住之前的 ${historyForAI.length} 条对话`);
        } else {
            console.log('AI不会记住之前的对话（但历史仍会保存）');
        }

        // 初始化消息数组：系统消息 + AI可见的历史对话
        this.messages = [
            {
                'role': 'system',
                'content': systemPrompt
            },
            ...historyForAI
        ];

        // 如果可用了上下文限制，立即裁剪过长的历史
        if (this.enableContextLimit && this.messages.length > this.maxContextMessages + 1) {
            this.trimMessages();
        }

        console.log(`对话上下文已初始化，包含 ${this.messages.length} 条消息`);
    }

    // ========== 委托给 MemoryManager 的方法 ==========
    async checkAndSaveMemoryAsync(text) {
        return this.memoryManager.checkAndSaveMemoryAsync(text);
    }

    // ========== 委托给 DiaryManager 的方法 ==========
    startDiaryTimer() {
        this.diaryManager.startTimer();
    }

    resetDiaryTimer() {
        this.diaryManager.resetTimer();
    }

    async checkAndWriteDiary() {
        return this.diaryManager.checkAndWriteDiary();
    }

    // ========== 委托给 ScreenshotManager 的方法 ==========
    async shouldTakeScreenshot(text) {
        return this.screenshotManager.shouldTakeScreenshot(text);
    }

    async takeScreenshotBase64() {
        return this.screenshotManager.takeScreenshotBase64();
    }

    // ========== 委托给 GameIntegration 的方法 ==========
    async handleGameInput(text) {
        return this.gameIntegration.handleGameInput(text);
    }

    // ========== 委托给 ContextManager 的方法 ==========
    setContextLimit(enable) {
        this.contextManager.setContextLimit(enable);
    }

    setMaxContextMessages(count) {
        this.contextManager.setMaxContextMessages(count);
    }

    trimMessages() {
        this.contextManager.trimMessages();
    }

    saveConversationHistory() {
        this.contextManager.saveConversationHistory();
    }

    // ========== 以下是保留的原有方法（未拆分的部分） ==========

    // 设置模型
    setModel(model) {
        this.model = model;
        console.log('模型已设置到VoiceChat');
    }

    // 设置情绪动作映射器
    setEmotionMapper(emotionMapper) {
        this.emotionMapper = emotionMapper;
        console.log('情绪动作映射器已设置到VoiceChat');
    }

    // 修改：暂停录音 - 根据语音打断配置调整行为
    async pauseRecording() {
        if (this.asrEnabled && this.asrProcessor) {
            this.asrProcessor.pauseRecording();
            if (this.voiceBargeInEnabled) {
                console.log('语音打断模式：保持VAD监听');
            } else {
                console.log('传统模式：Recording paused due to TTS playback');
            }
        }
    }

    // 修改：恢复录音 - 根据语音打断配置调整行为
    async resumeRecording() {
        if (this.asrEnabled && this.asrProcessor) {
            this.asrProcessor.resumeRecording();
            if (this.voiceBargeInEnabled) {
                console.log('语音打断模式：ASR已解锁');
            } else {
                console.log('传统模式：Recording resumed after TTS playback, ASR unlocked');
            }
        }
    }

    // 获取下一个交互编号
    getNextInteractionNumber() {
        try {
            const dialogLogPath = path.join(__dirname, '..', 'AI记录室', '记忆库.txt');
            if (!fs.existsSync(dialogLogPath)) {
                return 1;
            }

            const content = fs.readFileSync(dialogLogPath, 'utf8');
            const matches = content.match(/交互(\d+)：/g);
            if (!matches) {
                return 1;
            }

            const numbers = matches.map(match => parseInt(match.match(/\d+/)[0]));
            return Math.max(...numbers) + 1;
        } catch (error) {
            console.error('获取交互编号失败:', error);
            return 1;
        }
    }

    // 开始录音 - 只在ASR可用时有效
    async startRecording() {
        if (this.asrEnabled && this.asrProcessor) {
            await this.asrProcessor.startRecording();
            console.log('ASR录音已启动');
        } else {
            console.log('ASR已禁用，无法开始录音');
        }
    }

    // 停止录音 - 只在ASR可用时有效
    stopRecording() {
        if (this.asrEnabled && this.asrProcessor) {
            this.asrProcessor.stopRecording();
            console.log('ASR录音已停止');
        } else {
            console.log('ASR已禁用，无需停止录音');
        }
    }

    // 发送消息到LLM - 这个方法会在app.js中被重写以支持工具调用
    async sendToLLM(prompt) {
        try {
            this.ttsProcessor.reset();

            let fullResponse = "";
            let messagesForAPI = JSON.parse(JSON.stringify(this.messages));

            const needScreenshot = await this.shouldTakeScreenshot(prompt);

            this.messages.push({'role': 'user', 'content': prompt});

            if (this.enableContextLimit) {
                this.trimMessages();
                messagesForAPI = JSON.parse(JSON.stringify(this.messages));
            }

            if (needScreenshot) {
                try {
                    console.log("需要截图");
                    const base64Image = await this.takeScreenshotBase64();

                    const lastUserMsgIndex = messagesForAPI.findIndex(
                        msg => msg.role === 'user' && msg.content === prompt
                    );

                    if (lastUserMsgIndex !== -1) {
                        messagesForAPI[lastUserMsgIndex] = {
                            'role': 'user',
                            'content': [
                                {'type': 'text', 'text': prompt},
                                {'type': 'image_url', 'image_url': {'url': `data:image/jpeg;base64,${base64Image}`}}
                            ]
                        };
                    }
                } catch (error) {
                    console.error("截图处理失败:", error);
                }
            }

            console.log(`发送给LLM的消息数: ${messagesForAPI.length}`);

            const response = await fetch(`${this.API_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.API_KEY}`
                },
                body: JSON.stringify({
                    model: this.MODEL,
                    messages: messagesForAPI,
                    stream: true
                })
            });

            if (!response.ok) {
                let errorMessage = "";
                switch(response.status) {
                    case 401:
                        errorMessage = "API密钥验证失败，请检查你的API密钥";
                        break;
                    case 403:
                        errorMessage = "API访问被禁止，你的账号可能被限制";
                        break;
                    case 404:
                        errorMessage = "API接口未找到，请检查API地址";
                        break;
                    case 429:
                        errorMessage = "请求过于频繁，超出API限制";
                        break;
                    case 500:
                    case 502:
                    case 503:
                    case 504:
                        errorMessage = "服务器错误，AI服务当前不可用";
                        break;
                    default:
                        errorMessage = `API错误: ${response.status} ${response.statusText}`;
                }
                throw new Error(errorMessage);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");

            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    this.ttsProcessor.finalizeStreamingText();
                    break;
                }

                const text = decoder.decode(value);
                const lines = text.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        if (line.includes('[DONE]')) continue;

                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices[0].delta.content) {
                                const newContent = data.choices[0].delta.content;
                                fullResponse += newContent;
                                this.ttsProcessor.addStreamingText(newContent);
                            }
                        } catch (e) {
                            console.error('解析响应错误:', e);
                        }
                    }
                }
            }

            if (fullResponse) {
                this.messages.push({'role': 'assistant', 'content': fullResponse});

                // ===== 保存对话历史 =====
                this.saveConversationHistory();

                if (this.enableContextLimit) {
                    this.trimMessages();
                }
            }
        } catch (error) {
            console.error("LLM处理错误:", error);

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
            } else if (error.name === "TypeError" && error.message.includes("fetch")) {
                errorMessage = "网络错误，请检查网络连接";
            } else if (error.name === "SyntaxError") {
                errorMessage = "解析API响应出错，请重试";
            }

            this.showSubtitle(errorMessage, 3000);
            if (this.asrEnabled && this.asrProcessor) {
                this.asrProcessor.resumeRecording();
            }
            setTimeout(() => this.hideSubtitle(), 3000);
        } finally {
            global.isProcessingUserInput = false;
        }
    }

    // 处理文本消息（来自聊天框输入）
    handleTextMessage(text) {
        // 显示用户消息
        this.addChatMessage('user', text);

        // 设置处理标志
        global.isProcessingUserInput = true;

        // 处理文本消息
        this.sendToLLM(text);
    }

    // 添加聊天消息到界面
    addChatMessage(role, content) {
        const chatMessages = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        messageElement.innerHTML = `<strong>${role === 'user' ? '你' : 'Fake Neuro'}:</strong> ${content}`;
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // 处理弹幕消息
    async handleBarrageMessage(nickname, text) {
        try {
            if (!this) return;

            if (global.isPlayingTTS) {
                console.log('TTS正在播放，弹幕处理已延迟');
                return;
            }

            // 确保系统提示已增强
            this.enhanceSystemPrompt();

            this.messages.push({
                'role': 'user',
                'content': `[弹幕] ${nickname}: ${text}`
            });

            if (this.enableContextLimit) {
                this.trimMessages();
            }

            this.ttsProcessor.reset();

            const response = await fetch(`${this.API_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.API_KEY}`
                },
                body: JSON.stringify({
                    model: this.MODEL,
                    messages: this.messages,
                    stream: true
                })
            });

            if (!response.ok) {
                let errorMessage = "";
                switch(response.status) {
                    case 401:
                        errorMessage = "API密钥验证失败，请检查你的API密钥";
                        break;
                    case 403:
                        errorMessage = "API访问被禁止，你的账号可能被限制";
                        break;
                    case 404:
                        errorMessage = "API接口未找到，请检查API地址";
                        break;
                    case 429:
                        errorMessage = "请求过于频繁，超出API限制";
                        break;
                    case 500:
                    case 502:
                    case 503:
                    case 504:
                        errorMessage = "服务器错误，AI服务当前不可用";
                        break;
                    default:
                        errorMessage = `API错误: ${response.status} ${response.statusText}`;
                }
                throw new Error(errorMessage);
            }

            let fullResponse = "";
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");

            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    this.ttsProcessor.finalizeStreamingText();
                    break;
                }

                const text = decoder.decode(value);
                const lines = text.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        if (line.includes('[DONE]')) continue;

                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices[0].delta.content) {
                                const newContent = data.choices[0].delta.content;
                                fullResponse += newContent;
                                this.ttsProcessor.addStreamingText(newContent);
                            }
                        } catch (e) {
                            console.error('解析响应错误:', e);
                        }
                    }
                }
            }

            if (fullResponse) {
                this.messages.push({'role': 'assistant', 'content': fullResponse});

                // ===== 保存对话历史 =====
                this.saveConversationHistory();

                if (this.enableContextLimit) {
                    this.trimMessages();
                }

                const newContent = `【弹幕】[${nickname}]: ${text}\n【Fake Neuro】: ${fullResponse}\n`;

                try {
                    fs.appendFileSync(
                        path.join(__dirname, '..', 'AI记录室', '记忆库.txt'),
                        newContent,
                        'utf8'
                    );
                } catch (error) {
                    console.error('保存弹幕记忆库失败:', error);
                }
            }
        } catch (error) {
            console.error('处理弹幕消息出错:', error);

            let errorMessage = "抱歉，处理弹幕出错";

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
            } else if (error.name === "TypeError" && error.message.includes("fetch")) {
                errorMessage = "网络错误，请检查网络连接";
            } else if (error.name === "SyntaxError") {
                errorMessage = "解析API响应出错，请重试";
            }

            this.showSubtitle(errorMessage, 3000);
            if (this.asrEnabled && this.asrProcessor) {
                this.asrProcessor.resumeRecording();
            }
        }
    }

    // 增强系统提示词
    enhanceSystemPrompt() {
        // 只有启用直播功能时才添加提示词
        if (!this.config || !this.config.bilibili || !this.config.bilibili.enabled) {
            return;
        }

        if (this.messages && this.messages.length > 0 && this.messages[0].role === 'system') {
            const originalPrompt = this.messages[0].content;

            if (!originalPrompt.includes('你可能会收到直播弹幕')) {
                const enhancedPrompt = originalPrompt + "\n\n你可能会收到直播弹幕消息，这些消息会被标记为[弹幕]，表示这是来自直播间观众的消息，而不是主人直接对你说的话。当你看到[弹幕]标记时，你应该知道这是其他人发送的，但你仍然可以回应，就像在直播间与观众互动一样。";
                this.messages[0].content = enhancedPrompt;
                console.log('系统提示已增强，添加了直播弹幕相关说明');
            }
        }
    }

    // 新增：获取语音打断状态
    getVoiceBargeInStatus() {
        if (!this.asrEnabled || !this.asrProcessor) {
            return { enabled: false, reason: 'ASR未可用' };
        }
        return this.asrProcessor.getVoiceBargeInStatus();
    }

    // 新增：动态切换语音打断功能
    setVoiceBargeIn(enabled) {
        this.voiceBargeInEnabled = enabled;
        if (this.asrEnabled && this.asrProcessor) {
            this.asrProcessor.setVoiceBargeIn(enabled);

            // 如果可用语音打断，确保TTS处理器引用设置正确
            if (enabled && this.ttsProcessor) {
                this.asrProcessor.setTTSProcessor(this.ttsProcessor);
                console.log('语音打断已可用，TTS处理器引用已设置');
            }
        } else {
            console.log('ASR未可用，无法切换语音打断功能');
        }
    }
}

module.exports = { VoiceChatInterface };
