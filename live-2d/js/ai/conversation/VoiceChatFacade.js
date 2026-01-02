// VoiceChatFacade.js - 统一对外接口
const { MessageInitializer } = require('./MessageInitializer.js');
const { ConversationCore } = require('./ConversationCore.js');
const { ASRController } = require('./ASRController.js');
const { InputRouter } = require('./InputRouter.js');
const { MemoryManager } = require('../MemoryManager.js');
const { DiaryManager } = require('../DiaryManager.js');
const { ScreenshotManager } = require('../ScreenshotManager.js');
const { GameIntegration } = require('../GameIntegration.js');
const { ContextManager } = require('../ContextManager.js');
const { ContextCompressor } = require('../ContextCompressor.js');
const { MemosClient } = require('../memos-client.js');  // 🔥 新增：MemOS 客户端

/**
 * VoiceChatFacade - 统一对外接口
 * 保持与原 VoiceChatInterface 完全一致的接口
 */
class VoiceChatFacade {
    constructor(vadUrl, asrUrl, ttsProcessor, showSubtitle, hideSubtitle, config) {
        this.config = config;
        this.ttsProcessor = ttsProcessor;
        this.showSubtitle = showSubtitle;
        this.hideSubtitle = hideSubtitle;

        // LLM配置（暴露给外部使用）
        this.API_KEY = config.llm.api_key;
        this.API_URL = config.llm.api_url;
        this.MODEL = config.llm.model;

        // ASR相关属性（暴露给外部使用）
        this.asrEnabled = config.asr?.enabled !== false;
        this.voiceBargeInEnabled = config.asr?.voice_barge_in || false;

        // 截图相关属性
        this.screenshotEnabled = config.vision.enabled;
        this.screenshotPath = config.vision.screenshot_path;
        this.autoScreenshot = config.vision.auto_screenshot || false;
        this._autoScreenshotFlag = false;

        // 记忆文件路径
        this.memoryFilePath = config.memory.file_path;

        // AI日记功能
        this.aiDiaryEnabled = config.ai_diary?.enabled || false;
        this.aiDiaryIdleTime = config.ai_diary?.idle_time || 600000;
        this.aiDiaryFile = config.ai_diary?.diary_file || "AI日记.txt";
        this.aiDiaryPrompt = config.ai_diary?.prompt || "请以fake neuro（肥牛）的身份，基于今天的对话记录写一篇简短的日记。";
        this.lastInteractionTime = Date.now();
        this.diaryTimer = null;

        // 上下文限制相关属性
        this.maxContextMessages = config.context.max_messages;
        this.enableContextLimit = config.context.enable_limit;

        // 模型引用
        this.model = null;
        this.emotionMapper = null;

        // 同步初始化（异步部分在 initializeAsync 中完成）
        this.initializeSync(vadUrl, asrUrl);
    }

    /**
     * 同步初始化部分
     */
    initializeSync(vadUrl, asrUrl) {
        // 创建临时的conversationCore（等异步初始化完成后替换）
        this.conversationCore = new ConversationCore('', [], this.config);

        // 创建游戏集成
        this.gameIntegration = new GameIntegration(this, this.config);
        this.gameModules = this.gameIntegration.gameModules;
        this.isGameModeActive = this.gameIntegration.isGameModeActive();

        // 创建子模块
        this.memoryManager = new MemoryManager(this);
        this.diaryManager = new DiaryManager(this);
        this.screenshotManager = new ScreenshotManager(this);
        this.contextCompressor = new ContextCompressor(this, this.config);
        this.memosClient = new MemosClient(this.config);  // 🔥 新增：MemOS 客户端

        // 创建输入路由
        this.inputRouter = new InputRouter(
            this.conversationCore,
            this.gameIntegration,
            this.memoryManager,
            this.contextCompressor,
            this.memosClient,  // 🔥 新增：传入 MemOS 客户端
            this.config
        );
        this.inputRouter.setUICallbacks(this.showSubtitle, this.hideSubtitle);
        this.inputRouter.setVoiceChatFacade(this);  // 🔥 新增：设置 Facade 引用

        // 创建ASR控制器
        this.asrController = new ASRController(
            vadUrl,
            asrUrl,
            this.config,
            this.inputRouter,
            this.diaryManager
        );
        this.asrProcessor = this.asrController.asrProcessor;

        // 创建上下文管理器
        this.contextManager = new ContextManager(this);

        // 执行异步初始化
        this.initializeAsync();
    }

    /**
     * 异步初始化部分
     */
    async initializeAsync() {
        try {
            // 初始化消息
            const initializer = new MessageInitializer(this.config);
            const initData = await initializer.initialize();

            // 重新创建conversationCore（使用正确的初始化数据）
            this.conversationCore = new ConversationCore(
                initData.systemPrompt,
                initData.conversationHistory,
                this.config
            );
            this.conversationCore.setFullConversationHistory(initData.fullConversationHistory);

            // 更新inputRouter的引用
            this.inputRouter.conversationCore = this.conversationCore;

            // 保存交互编号
            this.sessionInteractionNumber = initData.sessionInteractionNumber;

            // 暴露messages数组（向后兼容）
            this.messages = this.conversationCore.getMessages();
            this.fullConversationHistory = this.conversationCore.getFullConversationHistory();

            // 如果可用了上下文限制，立即裁剪过长的历史
            if (this.enableContextLimit && this.messages.length > this.maxContextMessages + 1) {
                this.trimMessages();
            }

            // 启动AI日记定时器
            if (this.aiDiaryEnabled) {
                this.startDiaryTimer();
            }

            console.log('VoiceChatFacade 初始化完成');
        } catch (error) {
            console.error('VoiceChatFacade 初始化失败:', error);
        }
    }

    // ========== 委托给 ConversationCore 的方法 ==========
    enhanceSystemPrompt() {
        return this.conversationCore.enhanceSystemPrompt();
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
        // 同步更新属性
        this.enableContextLimit = enable;
    }

    setMaxContextMessages(count) {
        this.contextManager.setMaxContextMessages(count);
        // 同步更新属性
        this.maxContextMessages = count;
    }

    trimMessages() {
        this.contextManager.trimMessages();
        // 同步messages引用
        this.messages = this.conversationCore.getMessages();
    }

    saveConversationHistory() {
        this.contextManager.saveConversationHistory();
        // 同步fullConversationHistory引用
        this.fullConversationHistory = this.conversationCore.getFullConversationHistory();
    }

    // ========== 委托给 ASRController 的方法 ==========
    async startRecording() {
        return this.asrController.startRecording();
    }

    stopRecording() {
        return this.asrController.stopRecording();
    }

    async pauseRecording() {
        return this.asrController.pauseRecording();
    }

    async resumeRecording() {
        return this.asrController.resumeRecording();
    }

    getVoiceBargeInStatus() {
        return this.asrController.getVoiceBargeInStatus();
    }

    setVoiceBargeIn(enabled) {
        this.voiceBargeInEnabled = enabled;
        return this.asrController.setVoiceBargeIn(enabled, this.ttsProcessor);
    }

    // ========== 委托给 InputRouter 的方法 ==========
    handleTextMessage(text) {
        return this.inputRouter.handleTextInput(text);
    }

    addChatMessage(role, content) {
        return this.inputRouter.addChatMessage(role, content);
    }

    // ========== 🔥 MemOS 记忆注入方法 ==========
    /**
     * 检索相关记忆并注入到对话上下文
     * @param {string} userInput - 用户输入
     */
    async injectRelevantMemories(userInput) {
        if (!this.memosClient || !this.memosClient.enabled || !this.memosClient.autoInject) {
            return;
        }

        try {
            // 1. 调用 MemOS 搜索相关记忆
            const relevantMemories = await this.memosClient.search(userInput);
            
            if (relevantMemories && relevantMemories.length > 0) {
                console.log(`🧠 MemOS 检索到 ${relevantMemories.length} 条相关记忆`);
                
                // 2. 格式化记忆为 prompt 文本
                const memoryContext = this.memosClient.formatMemoriesForPrompt(relevantMemories);
                
                // 3. 创建临时系统消息注入记忆
                const memoryMessage = {
                    role: 'system',
                    content: `【关于这个用户的相关记忆】\n${memoryContext}\n\n请在回复中自然运用这些记忆，如果用户说的话与记忆矛盾，可以适当吐槽。`,
                    _isMemoryInjection: true  // 标记为临时注入的记忆
                };
                
                // 4. 注入到消息历史（在 system prompt 之后）
                this.messages.splice(1, 0, memoryMessage);
                
                console.log('✅ 记忆已注入到对话上下文');
            } else {
                console.log('ℹ️ 未找到相关记忆');
            }
        } catch (error) {
            console.error('MemOS 记忆注入失败:', error.message);
            // 失败不影响正常对话
        }
    }

    /**
     * 移除临时注入的记忆消息
     */
    removeInjectedMemory() {
        const messages = this.conversationCore.getMessages();
        const filtered = messages.filter(msg => !msg._isMemoryInjection);
        // 直接更新内部数组
        messages.length = 0;
        messages.push(...filtered);
    }

    // ========== 设置方法 ==========
    setModel(model) {
        this.model = model;
        console.log('模型已设置到VoiceChat');
    }

    setEmotionMapper(emotionMapper) {
        this.emotionMapper = emotionMapper;
        console.log('情绪动作映射器已设置到VoiceChat');
    }

    // ========== sendToLLM 方法（由LLMHandler重写） ==========
    async sendToLLM(prompt) {
        // 这个方法会在app-initializer中被LLMHandler.createEnhancedSendToLLM重写
        // 这里只是占位实现
        console.warn('sendToLLM 应该被 LLMHandler 重写');
    }

    // ========== handleBarrageMessage 方法（保持向后兼容） ==========
    async handleBarrageMessage(nickname, text) {
        // 这个方法由BarrageManager调用
        // 暂时保留原实现（简化版）
        console.log(`收到弹幕: ${nickname}: ${text}`);
    }
}

module.exports = { VoiceChatFacade };
