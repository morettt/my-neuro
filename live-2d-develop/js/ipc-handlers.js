// ipc-handlers.js - IPC通信处理模块
const { ipcRenderer } = require('electron');
const { logToTerminal } = require('./api-utils.js');
const { eventBus } = require('./core/event-bus.js');
const { Events } = require('./core/events.js');

class IPCHandlers {
    constructor() {
        this.ttsProcessor = null;
        this.voiceChat = null;
        this.emotionMapper = null;
        this.barrageManager = null;
        this.config = null;
        this.uiController = null; // 新增属性
    }

    // 设置依赖
    setDependencies(deps) {
        this.ttsProcessor = deps.ttsProcessor;
        this.voiceChat = deps.voiceChat;
        this.emotionMapper = deps.emotionMapper;
        this.barrageManager = deps.barrageManager;
        this.config = deps.config;
        this.uiController = deps.uiController; // 接收uiController
    }

    // 注册所有IPC监听器
    registerAll() {
        this.registerInterruptHandler();
        this.registerMotionHandlers();
        this.registerMusicHandlers();
        this.registerChatFocusHandler();
        this.registerSubtitleToggleHandler(); // 注册新处理器
    }

    // 中断信号处理
    registerInterruptHandler() {
        ipcRenderer.on('interrupt-tts', () => {
            console.log('接收到中断信号');
            logToTerminal('info', '接收到中断信号');

            if (this.ttsProcessor) {
                this.ttsProcessor.interrupt();
            }

            if (this.barrageManager) {
                this.barrageManager.reset();
            }

            if (this.voiceChat && this.voiceChat.asrController && this.config.asr.enabled) {
                setTimeout(() => {
                    this.voiceChat.resumeRecording();
                    console.log('ASR录音已恢复');
                    logToTerminal('info', 'ASR录音已恢复');
                }, 200);
            }

            console.log('系统已复位，可以继续对话');
            logToTerminal('info', '系统已复位，可以继续对话');
        });
    }

    // 动作触发处理
    registerMotionHandlers() {
        ipcRenderer.on('trigger-motion-hotkey', (event, motionIndex) => {
            if (this.emotionMapper) {
                this.emotionMapper.playMotion(motionIndex);
            }
        });

        ipcRenderer.on('stop-all-motions', () => {
            if (global.currentModel && global.currentModel.internalModel && global.currentModel.internalModel.motionManager) {
                global.currentModel.internalModel.motionManager.stopAllMotions();
                if (this.emotionMapper) {
                    this.emotionMapper.playDefaultMotion();
                }
            }
        });
    }

    // 音乐控制处理
    registerMusicHandlers() {
        ipcRenderer.on('trigger-music-play', () => {
            if (this.emotionMapper && global.musicPlayer) {
                this.emotionMapper.playMotion(8);
                console.log('触发麦克风动作并开始随机播放音乐');
                global.musicPlayer.playRandomMusic();
            }
        });

        ipcRenderer.on('trigger-music-stop-with-motion', () => {
            if (this.emotionMapper && global.musicPlayer) {
                global.musicPlayer.stop();
                console.log('音乐已停止');
                this.emotionMapper.playMotion(7);
                console.log('触发赌气动作，音乐播放结束');
            }
        });
    }

    // 聊天框焦点处理
    registerChatFocusHandler() {
        ipcRenderer.on('toggle-chat-focus', () => {
            try {
                if (global.chatController) {
                    global.chatController.toggleVisibility();
                }
            } catch (error) {
                logToTerminal('error', `设置聊天框焦点失败: ${error.message}`);
            }
        });
    }
    
    // 新增：字幕显示切换处理器
    registerSubtitleToggleHandler() {
        ipcRenderer.on('toggle-subtitle-visibility', () => {
            if (this.uiController) {
                this.uiController.forceShow();
            }
        });
    }
}

module.exports = { IPCHandlers };