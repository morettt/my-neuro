// app-state.js - 应用状态管理
// 使用事件驱动替代全局变量，提供状态查询接口

const { eventBus } = require('./event-bus.js');
const { Events } = require('./events.js');

class AppState {
    constructor() {
        // 内部状态
        this._state = {
            isPlayingTTS: false,
            isProcessingUserInput: false,
            isProcessingBarrage: false,
            isInterrupted: false  // 新增：全局中断标志
        };

        // 监听事件，自动更新内部状态
        this._setupEventListeners();
    }

    // 设置事件监听器
    _setupEventListeners() {
        // TTS状态
        eventBus.on(Events.TTS_START, () => {
            this._state.isPlayingTTS = true;
        });

        eventBus.on(Events.TTS_END, () => {
            this._state.isPlayingTTS = false;
        });

        eventBus.on(Events.TTS_INTERRUPTED, () => {
            this._state.isPlayingTTS = false;
            this._state.isInterrupted = true;  // TTS打断时设置全局中断标志
        });

        // 用户输入状态
        eventBus.on(Events.USER_INPUT_START, () => {
            this._state.isProcessingUserInput = true;
        });

        eventBus.on(Events.USER_INPUT_END, () => {
            this._state.isProcessingUserInput = false;
        });

        // 弹幕处理状态
        eventBus.on(Events.BARRAGE_START, () => {
            this._state.isProcessingBarrage = true;
        });

        eventBus.on(Events.BARRAGE_END, () => {
            this._state.isProcessingBarrage = false;
        });
    }

    // 查询状态的方法
    isPlayingTTS() {
        return this._state.isPlayingTTS;
    }

    isProcessingUserInput() {
        return this._state.isProcessingUserInput;
    }

    isProcessingBarrage() {
        return this._state.isProcessingBarrage;
    }

    // 获取所有状态（用于调试）
    getAllStates() {
        return { ...this._state };
    }

    // 新增：中断标志管理
    isInterrupted() {
        return this._state.isInterrupted;
    }

    setInterrupted(value) {
        this._state.isInterrupted = value;
    }

    clearInterrupted() {
        this._state.isInterrupted = false;
    }
}

// 导出单例
const appState = new AppState();
module.exports = { appState };
