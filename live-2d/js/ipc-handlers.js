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
    }

    // 设置依赖
    setDependencies(deps) {
        this.ttsProcessor = deps.ttsProcessor;
        this.voiceChat = deps.voiceChat;
        this.emotionMapper = deps.emotionMapper;
        this.barrageManager = deps.barrageManager;
        this.config = deps.config;
    }

    // 注册所有IPC监听器
    registerAll() {
        this.registerInterruptHandler();
        this.registerMotionHandlers();
        this.registerMusicHandlers();
        this.registerBubbleHandlers();
    }

    // 中断信号处理
    registerInterruptHandler() {
        ipcRenderer.on('interrupt-tts', () => {
            console.log('接收到中断信号');
            logToTerminal('info', '接收到中断信号');

            if (this.ttsProcessor) {
                this.ttsProcessor.interrupt();
            }

            // 状态管理已通过事件系统自动处理，无需手动设置全局变量

            // 重置弹幕状态机
            if (this.barrageManager) {
                this.barrageManager.reset();
            }

            if (this.voiceChat && this.voiceChat.asrProcessor && this.config.asr.enabled) {
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

    // 气泡框切换处理
    registerBubbleHandlers() {
        ipcRenderer.on('toggle-bubble', () => {
            if (typeof global.toggleBubble === 'function') {
                global.toggleBubble();
            }
        });
    }
}

module.exports = { IPCHandlers };
