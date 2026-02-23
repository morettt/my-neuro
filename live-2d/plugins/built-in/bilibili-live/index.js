// plugins/built-in/bilibili-live/index.js
// B站直播弹幕插件 - Service Plugin
// BarrageManager 由 app-initializer 初始化并挂在 global.barrageManager
// 本插件只负责 LiveStreamModule（B站 API 轮询）

const { Plugin } = require('../../../js/core/plugin-base.js');
const { LiveStreamModule } = require('../../../js/live/LiveStreamModule.js');
const { logToTerminal } = require('../../../js/api-utils.js');

class BilibiliLivePlugin extends Plugin {
    constructor(metadata, context) {
        super(metadata, context);
        this._liveStreamModule = null;
    }

    async onStart() {
        const config = this.context.getConfig();

        // 使用 config.bilibili.enabled 作为功能开关
        if (!config.bilibili?.enabled) return;

        const barrageManager = global.barrageManager;
        if (!barrageManager) {
            this.context.log('warn', 'barrageManager 未就绪，跳过直播模块启动');
            return;
        }

        this._liveStreamModule = new LiveStreamModule({
            roomId: config.bilibili.roomId || '30230160',
            checkInterval: config.bilibili.checkInterval || 5000,
            maxMessages: config.bilibili.maxMessages || 50,
            apiUrl: config.bilibili.apiUrl || 'http://api.live.bilibili.com/ajax/msg',
            onNewMessage: (message) => {
                logToTerminal('info', `收到弹幕: ${message.nickname}: ${message.text}`);
                barrageManager.addToQueue(message.nickname, message.text);
            }
        });

        this._liveStreamModule.start();
    }

    async onStop() {
        if (this._liveStreamModule) {
            this._liveStreamModule.stop();
            this._liveStreamModule = null;
        }
    }
}

module.exports = BilibiliLivePlugin;
