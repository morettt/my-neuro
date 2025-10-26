// app-initializer.js - 应用初始化协调模块
const { MCPManager } = require('./ai/mcp-manager.js');
const { LocalToolManager } = require('./ai/local-tool-manager.js');
const { VoiceChatFacade } = require('./ai/conversation/VoiceChatFacade.js');
const { ChatController } = require('./ui/ChatController.js');
const { UIController } = require('./ui/ui-controller.js');
const { TTSFactory } = require('./voice/tts-factory.js');
const { ModelSetup } = require('./model/model-setup.js');
const { BarrageManager } = require('./live/barrage-manager.js');
const { LiveStreamModule } = require('./live/LiveStreamModule.js');
const { AutoChatModule } = require('./live/auto-chat.js');
const { IPCHandlers } = require('./ipc-handlers.js');
const { LLMHandler } = require('./ai/llm-handler.js');
const { logToTerminal, getMergedToolsList } = require('./api-utils.js');
const { LLMClient } = require('./ai/llm-client.js');
const { toolExecutor } = require('./ai/tool-executor.js');
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
        this.ipcHandlers = null;

        // 配置标志
        this.ttsEnabled = config.tts?.enabled !== false;
        this.asrEnabled = config.asr?.enabled !== false;
        this.INTRO_TEXT = config.ui.intro_text || "你好，我叫fake neuro。";
    }

    // 主初始化流程
    async initialize() {
        try {
            await this.initializeMCP();
            
            this.uiController = new UIController(this.config);
            await this.uiController.initialize();
            
            global.showSubtitle = (text, duration) => this.uiController.addNewLine(text, duration);
            global.hideSubtitle = () => this.uiController.clear();

            this.initializeVoiceChat();
            this.initializeTTS();
            await this.initializeModel();
            this.enhanceSystemPrompt();
            await this.initializeToolManagers();
            this.initializeBarrageAndLiveStream();
            this.startWelcomeAndRecording();
            this.initializeChatAndIPC();
            this.printStatusSummary();

            logToTerminal('info', '应用初始化完成');

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
                uiController: this.uiController
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

    async initializeMCP() {
        this.mcpManager = new MCPManager(this.config);
        global.mcpManager = this.mcpManager;
        if (this.mcpManager && this.mcpManager.isEnabled) {
            await this.mcpManager.initialize();
            await this.mcpManager.waitForInitialization();
        }
    }

    initializeVoiceChat() {
        this.voiceChat = new VoiceChatFacade(
            this.config.asr.vad_url,
            this.config.asr.asr_url,
            null,
            (text, duration) => this.uiController.addNewLine(text, duration),
            () => this.uiController.clear(),
            this.config
        );
        this.voiceChat.inputRouter.uiController = this.uiController;
        global.voiceChat = this.voiceChat;
    }

    initializeTTS() {
        this.ttsProcessor = TTSFactory.create(
            this.config,
            this.modelController,
            this.voiceChat,
            this.uiController,
            this.onBarrageTTSComplete
        );
        this.voiceChat.ttsProcessor = this.ttsProcessor;
        if (this.config.asr?.voice_barge_in && this.voiceChat.asrController && this.ttsProcessor) {
            this.voiceChat.asrController.setTTSProcessor(this.ttsProcessor);
        }
    }

    async initializeModel() {
        const result = await ModelSetup.initialize(
            this.modelController,
            this.config,
            this.ttsEnabled,
            this.asrEnabled,
            this.ttsProcessor,
            this.voiceChat,
            this.uiController
        );

        this.model = result.model;
        this.emotionMapper = result.emotionMapper;
        this.musicPlayer = result.musicPlayer;

        global.currentModel = this.model;
        global.pixiApp = result.app;
    }

    async initializeToolManagers() {
        this.localToolManager = new LocalToolManager(this.config);
        global.localToolManager = this.localToolManager;

        const enhancedSendToLLM = LLMHandler.createEnhancedSendToLLM(
            this.voiceChat,
            this.ttsProcessor,
            this.asrEnabled,
            this.config
        ).bind(this.voiceChat);

        this.voiceChat.inputRouter.setLLMHandler(enhancedSendToLLM);
        this.voiceChat.sendToLLM = enhancedSendToLLM;
    }

    initializeBarrageAndLiveStream() {
        this.barrageManager = new BarrageManager(this.config);
        this.barrageManager.setDependencies({
            voiceChat: this.voiceChat,
            ttsProcessor: this.ttsProcessor,
            showSubtitle: (text, duration) => this.uiController.addNewLine(text, duration),
            hideSubtitle: () => this.uiController.clear()
        });

        if (this.config.bilibili && this.config.bilibili.enabled) {
            this.liveStreamModule = new LiveStreamModule({
                roomId: this.config.bilibili.roomId,
                onNewMessage: (message) => {
                    this.barrageManager.addToQueue(message.nickname, message.text);
                }
            });
            this.liveStreamModule.start();
        }
    }

    startWelcomeAndRecording() {
        if (this.ttsEnabled) {
            setTimeout(() => {
                this.ttsProcessor.processTextToSpeech(this.INTRO_TEXT);
            }, 1000);
        } else {
            setTimeout(() => {
                this.uiController.addNewLine(`Fake Neuro: ${this.INTRO_TEXT}`, 3000);
            }, 1000);
        }

        if (this.asrEnabled) {
            setTimeout(() => {
                this.voiceChat.startRecording();
            }, 3000);
        }

        setTimeout(() => {
            this.autoChatModule = new AutoChatModule(this.config, this.ttsProcessor);
            global.autoChatModule = this.autoChatModule;
            this.autoChatModule.start();
        }, 8000);
    }

    initializeChatAndIPC() {
        const chatController = new ChatController(this.voiceChat);
        chatController.init();
        global.chatController = chatController;

        this.ipcHandlers = new IPCHandlers();
        this.ipcHandlers.setDependencies({
            ttsProcessor: this.ttsProcessor,
            voiceChat: this.voiceChat,
            emotionMapper: this.emotionMapper,
            barrageManager: this.barrageManager,
            config: this.config,
            uiController: this.uiController
        });
        this.ipcHandlers.registerAll();
        logToTerminal('info', 'IPC处理器已初始化');
    }

    printStatusSummary() {
        console.log(`=== 模块状态总结 ===`);
        console.log(`TTS: ${this.ttsEnabled ? '启用' : '禁用'}`);
        console.log(`ASR: ${this.asrEnabled ? '启用' : '禁用'}`);
        // ... (rest of the summary logs)
    }
}

module.exports = { AppInitializer };