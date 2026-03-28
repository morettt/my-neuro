// app-initializer.js - 应用初始化协调模块
const { MCPManager } = require('./ai/mcp-manager.js');
const { LocalToolManager } = require('./ai/local-tool-manager.js');
const { VoiceChatFacade } = require('./ai/conversation/VoiceChatFacade.js');
const { UIController } = require('./ui/ui-controller.js');
const { TTSFactory } = require('./voice/tts-factory.js');
const { ModelSetup } = require('./model/model-setup.js');
const { VRMModelSetup } = require('./model/vrm-model-setup.js');
const { BarrageManager } = require('./live/barrage-manager.js');
// LiveStreamModule → plugins/built-in/bilibili-live
// AutoChatModule   → plugins/built-in/auto-chat
// MoodChatModule   → plugins/built-in/mood-chat
const { IPCHandlers } = require('./ipc-handlers.js');
const { LLMHandler } = require('./ai/llm-handler.js');
const { logToTerminal } = require('./api-utils.js');
const { PluginManager } = require('./core/plugin-manager.js');
const { eventBus } = require('./core/event-bus.js');
const { Events } = require('./core/events.js');

class AppInitializer {
    constructor(config, modelController, onBarrageTTSComplete, enhanceSystemPrompt) {
        this.config = config;
        this.modelController = modelController;
        this.onBarrageTTSComplete = onBarrageTTSComplete;
        this.enhanceSystemPrompt = enhanceSystemPrompt;

        // 模块实例
        this.mcpManager = null;
        this.uiController = null;
        this.voiceChat = null;
        this.ttsProcessor = null;
        this.model = null;
        this.emotionMapper = null;
        this.musicPlayer = null;
        this.localToolManager = null;
        this.barrageManager = null;
        this.liveStreamModule = null;
        this.autoChatModule = null;
        this.moodChatModule = null;
        this.ipcHandlers = null;

        // 插件管理器
        this.pluginManager = null;

        // 配置标志
        this.ttsEnabled = config.tts?.enabled !== false;
        // ASR启用：本地ASR或百度流式ASR任一启用即可
        const localASREnabled = config.asr?.enabled !== false;
        const baiduASREnabled = config.cloud?.baidu_asr?.enabled === true;
        this.asrEnabled = localASREnabled || baiduASREnabled;
        this.INTRO_TEXT = config.ui.intro_text || "你好，我叫fake neuro。";
    }

    // 主初始化流程
    async initialize() {
        try {
            // 第零阶段: 初始化插件系统
            await this.initializePlugins();

            // 第一阶段: 初始化MCP系统
            await this.initializeMCP();

            // 第二阶段: 初始化UI控制器
            this.initializeUI();

            // 第三阶段: 创建语音聊天接口
            this.initializeVoiceChat();

            // 第四阶段: 创建TTS处理器
            this.initializeTTS();

            // 第五阶段: 加载Live2D模型
            await this.initializeModel();

            // 第六阶段: 初始化系统提示
            this.enhanceSystemPrompt();

            // 第七阶段: 初始化工具管理器
            await this.initializeToolManagers();

            // 第八阶段: 初始化弹幕和直播模块
            this.initializeBarrageAndLiveStream();

            // 第九阶段: 播放欢迎语和启动录音
            this.startWelcomeAndRecording();

            // 第十阶段: 初始化聊天界面和IPC
            this.initializeChatAndIPC();

            // 显示状态总结
            this.printStatusSummary();

            // logToTerminal('info', '应用初始化完成');  // 不显示技术日志

            return {
                mcpManager: this.mcpManager,
                voiceChat: this.voiceChat,
                ttsProcessor: this.ttsProcessor,
                model: this.model,
                emotionMapper: this.emotionMapper,
                localToolManager: this.localToolManager,
                barrageManager: this.barrageManager,
                liveStreamModule: this.liveStreamModule,
                autoChatModule: this.autoChatModule,
                moodChatModule: this.moodChatModule,
                pluginManager: this.pluginManager
            };
        } catch (error) {
            console.error("应用初始化错误:", error);
            logToTerminal('error', `应用初始化错误: ${error.message}`);
            if (error.stack) {
                logToTerminal('error', `错误堆栈: ${error.stack}`);
            }
            throw error;
        }
    }

    // 第零阶段: 初始化插件系统
    async initializePlugins() {
        try {
            this.pluginManager = new PluginManager(this.config);
            global.pluginManager = this.pluginManager;
            await this.pluginManager.loadAll();
        } catch (error) {
            logToTerminal('error', `❌ 插件系统初始化失败: ${error.message}`);
            this.pluginManager = null;
        }
    }

    // 第一阶段: 初始化MCP系统
    async initializeMCP() {
        // console.log('🚀 第一阶段: 初始化MCP系统...');
        // logToTerminal('info', '🚀 第一阶段: 初始化MCP系统...');

        try {
            this.mcpManager = new MCPManager(this.config);
            global.mcpManager = this.mcpManager;
            // logToTerminal('info', `✅ MCPManager创建成功，启用状态: ${this.mcpManager.isEnabled}`);
        } catch (error) {
            logToTerminal('error', `❌ MCPManager创建失败: ${error.message}`);
            console.error('MCPManager创建失败:', error);
            this.mcpManager = null;
        }

        // 等待MCP初始化完成
        // logToTerminal('info', `🔍 检查MCP状态: mcpManager=${!!this.mcpManager}, isEnabled=${this.mcpManager?.isEnabled}`);
        if (this.mcpManager && this.mcpManager.isEnabled) {
            // console.log('⏳ 等待MCP系统初始化完成...');
            // logToTerminal('info', '⏳ 等待MCP系统初始化完成...');
            const mcpStartTime = Date.now();

            try {
                // logToTerminal('info', '🔧 开始MCP initialize...');
                await this.mcpManager.initialize();
                // logToTerminal('info', '🔧 开始MCP waitForInitialization...');
                await this.mcpManager.waitForInitialization();
                const mcpEndTime = Date.now();

                console.log(`✅ MCP系统初始化完成，耗时: ${mcpEndTime - mcpStartTime}ms`);
                logToTerminal('info', `✅ MCP系统初始化完成，耗时: ${mcpEndTime - mcpStartTime}ms`);

                const mcpStats = this.mcpManager.getStats();
                console.log(`🔧 MCP状态: ${mcpStats.servers}个服务器, ${mcpStats.tools}个工具`);
                logToTerminal('info', `🔧 MCP状态: ${mcpStats.servers}个服务器, ${mcpStats.tools}个工具`);
            } catch (error) {
                logToTerminal('error', `❌ MCP初始化失败: ${error.message}`);
                console.error('MCP初始化失败:', error);
            }
        }
        // else 分支不显示任何日志 - 用户未勾选MCP时不需要提示
    }

    // 第二阶段: 初始化UI控制器
    initializeUI() {
        console.log('🚀 第二阶段: 初始化UI控制器...');
        this.uiController = new UIController(this.config);
        this.uiController.initialize();

        // 为EnhancedTextProcessor提供全局字幕函数
        global.showSubtitle = (text, duration) => this.uiController.showSubtitle(text, duration);
        global.hideSubtitle = () => this.uiController.hideSubtitle();

        // 为气泡框提供全局函数
        global.showBubble = () => this.uiController.showBubble();
        global.hideBubble = () => this.uiController.hideBubble();
        global.toggleBubble = () => this.uiController.toggleBubble();
        global.showToolBubble = (toolName, parameters) => this.uiController.showToolBubble(toolName, parameters);

        // 为歌词气泡提供全局函数
        global.showLyricsBubble = (text) => this.uiController.showLyricsBubble(text);
        global.hideLyricsBubble = () => this.uiController.hideLyricsBubble();
    }

    // 第三阶段: 创建语音聊天接口
    initializeVoiceChat() {
        console.log('🚀 第三阶段: 初始化语音系统...');
        this.voiceChat = new VoiceChatFacade(
            this.config.asr.vad_url,
            this.config.asr.asr_url,
            null, // ttsProcessor稍后设置
            (text, duration) => this.uiController.showSubtitle(text, duration),
            () => this.uiController.hideSubtitle(),
            this.config
        );
        global.voiceChat = this.voiceChat;
    }

    // 第四阶段: 创建TTS处理器
    initializeTTS() {
        // 创建TTS处理器（在voiceChat之后）
        this.ttsProcessor = TTSFactory.create(
            this.config,
            this.modelController,
            this.voiceChat,
            this.uiController,
            this.onBarrageTTSComplete
        );

        // 更新voiceChat的ttsProcessor引用
        this.voiceChat.ttsProcessor = this.ttsProcessor;
        global.ttsProcessor = this.ttsProcessor;

        // 配置语音打断功能
        if (this.config.asr?.voice_barge_in && this.voiceChat.asrProcessor && this.ttsProcessor) {
            this.voiceChat.asrProcessor.setTTSProcessor(this.ttsProcessor);
            console.log('语音打断功能已配置完成');
        }

        // 如果ASR被禁用，跳过ASR相关的初始化
        if (!this.asrEnabled) {
            console.log('ASR已禁用，跳过语音识别初始化');
            logToTerminal('info', 'ASR已禁用，跳过语音识别初始化');

            // VoiceChatFacade已经在内部处理ASR禁用的情况，无需额外修改
        }
    }

    // 第五阶段: 加载模型（Live2D或VRM）
    async initializeModel() {
        const modelType = this.config.ui?.model_type || 'live2d';
        console.log(`模型类型: ${modelType}`);

        let result;
        if (modelType === 'vrm') {
            // 使用VRM模型
            logToTerminal('info', '正在加载VRM 3D模型...');
            result = await VRMModelSetup.initialize(
                this.modelController,
                this.config,
                this.ttsEnabled,
                this.asrEnabled,
                this.ttsProcessor,
                this.voiceChat
            );
        } else {
            // 默认使用Live2D模型
            result = await ModelSetup.initialize(
                this.modelController,
                this.config,
                this.ttsEnabled,
                this.asrEnabled,
                this.ttsProcessor,
                this.voiceChat
            );
        }

        this.model = result.model;
        this.emotionMapper = result.emotionMapper;
        this.musicPlayer = result.musicPlayer;

        // VRM模式：替换modelController并更新TTS唇形回调
        if (result.vrmController) {
            this.modelController = result.vrmController;
            if (this.ttsProcessor?.playbackEngine) {
                this.ttsProcessor.playbackEngine.onAudioDataCallback =
                    (value) => result.vrmController.setMouthOpenY(value);
            }
        }

        global.currentModel = this.model;
        global.pixiApp = result.app;
    }

    // 第七阶段: 初始化工具管理器
    async initializeToolManagers() {
        // 本地工具管理器初始化
        try {
            this.localToolManager = new LocalToolManager(this.config);
            global.localToolManager = this.localToolManager;

            const stats = this.localToolManager.getStats();
            console.log('本地工具管理器初始化成功');
            logToTerminal('info', `本地工具管理器初始化成功: ${stats.modules}个模块, ${stats.tools}个工具`);

            // 修改VoiceChat的sendToLLM方法，支持工具调用
            const enhancedSendToLLM = LLMHandler.createEnhancedSendToLLM(
                this.voiceChat,
                this.ttsProcessor,
                this.asrEnabled,
                this.config
            );
            this.voiceChat.sendToLLM = enhancedSendToLLM;

            // 同时设置到inputRouter（新架构）
            if (this.voiceChat.inputRouter) {
                this.voiceChat.inputRouter.setLLMHandler(enhancedSendToLLM);
            }
        } catch (error) {
            console.error('本地工具管理器初始化失败:', error);
            logToTerminal('error', `本地工具管理器初始化失败: ${error.message}`);
        }
    }

    // 第八阶段: 初始化弹幕和直播模块
    initializeBarrageAndLiveStream() {
        // 初始化弹幕管理器
        this.barrageManager = new BarrageManager(this.config);
        this.barrageManager.setDependencies({
            voiceChat: this.voiceChat,
            ttsProcessor: this.ttsProcessor,
            showSubtitle: (text, duration) => this.uiController.showSubtitle(text, duration),
            hideSubtitle: () => this.uiController.hideSubtitle()
        });

        // 🔥 将BarrageManager注入到InputRouter，用于打断机制
        if (this.voiceChat.inputRouter) {
            this.voiceChat.inputRouter.setBarrageManager(this.barrageManager);
        }

        // LiveStreamModule 已迁移至插件 plugins/built-in/bilibili-live
        global.barrageManager = this.barrageManager;
    }

    // 第九阶段: 播放欢迎语和启动录音
    startWelcomeAndRecording() {
        // 播放欢迎语（如果TTS启用）
        if (this.ttsEnabled) {
            setTimeout(() => {
                this.ttsProcessor.processTextToSpeech(this.INTRO_TEXT);
            }, 1000);
        } else {
            // 如果TTS禁用，显示欢迎语3秒后自动消失
            setTimeout(() => {
                this.uiController.showSubtitle(`Fake Neuro: ${this.INTRO_TEXT}`, 3000);
            }, 1000);
        }

        // 开始录音（如果ASR启用）
        if (this.asrEnabled) {
            setTimeout(() => {
                this.voiceChat.startRecording();
            }, 3000);
        }

        // AutoChatModule 和 MoodChatModule 已迁移至插件
        // plugins/built-in/auto-chat 和 plugins/built-in/mood-chat

        // 插件系统 onStart（应用完全就绪后启动所有插件）
        setTimeout(() => {
            if (this.pluginManager) {
                this.pluginManager.startAll().catch(err => {
                    logToTerminal('error', `❌ 插件 startAll 失败: ${err.message}`);
                });

                // 启动热加载文件监听
                this.pluginManager.startWatching();

                // 监听 TTS_END 事件，触发插件 onTTSEnd 钩子
                eventBus.on(Events.TTS_END, () => {
                    if (this.pluginManager) {
                        this.pluginManager.runTTSEndHooks().catch(() => {});
                    }
                });
            }
        }, 2000);
    }

    // 第十阶段: 初始化聊天界面和IPC
    initializeChatAndIPC() {
        // 聊天界面设置
        const shouldShowChatBox = this.uiController.setupChatBoxVisibility(this.ttsEnabled, this.asrEnabled);
        this.uiController.setupChatInput(this.voiceChat);

        // 初始化IPC处理器
        this.ipcHandlers = new IPCHandlers();
        this.ipcHandlers.setDependencies({
            ttsProcessor: this.ttsProcessor,
            voiceChat: this.voiceChat,
            emotionMapper: this.emotionMapper,
            barrageManager: this.barrageManager,
            config: this.config
        });
        this.ipcHandlers.registerAll();
        // console.log('IPC处理器已初始化');  // 不显示技术日志
        // logToTerminal('info', 'IPC处理器已初始化');

        // 保存shouldShowChatBox用于状态总结
        this.shouldShowChatBox = shouldShowChatBox;
    }

    // 显示状态总结
    printStatusSummary() {
        console.log(`=== 模块状态总结 ===`);
        console.log(`TTS: ${this.ttsEnabled ? '启用' : '禁用'}`);
        console.log(`ASR: ${this.asrEnabled ? '启用' : '禁用'}`);
        console.log(`语音打断: ${this.config.asr?.voice_barge_in ? '启用' : '禁用'}`);
        console.log(`聊天框: ${this.shouldShowChatBox ? '显示' : '隐藏'}`);
        console.log(`直播模块: ${this.config.bilibili?.enabled ? '启用' : '禁用'}`);
        let _autoChatEnabled = false;
        try { _autoChatEnabled = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'plugins', 'built-in', 'auto-chat', 'plugin_config.json'), 'utf8')).enabled; } catch(e) {}
        console.log(`自动对话: ${_autoChatEnabled ? '启用' : '禁用'}`);
        console.log(`Function Call工具: ${this.config.tools?.enabled ? '启用' : '禁用'}`);
        console.log(`MCP工具: ${this.config.mcp?.enabled ? '启用' : '禁用'}`);

        // 显示工具统计信息
        if (this.localToolManager) {
            const localStats = this.localToolManager.getStats();
            console.log(`Function Call: ${localStats.tools}个工具`);
        }
        if (this.mcpManager) {
            const mcpStats = this.mcpManager.getStats();
            console.log(`MCP: ${mcpStats.tools}个工具`);
        }

        console.log(`==================`);
    }
}

module.exports = { AppInitializer };
