// plugins/built-in/bilibili-live/index.js
const { Plugin } = require('../../../js/core/plugin-base.js');
const { LiveStreamModule } = require('../../../js/live/LiveStreamModule.js');
const { logToTerminal } = require('../../../js/api-utils.js');

class BilibiliLivePlugin extends Plugin {
    constructor(metadata, context) {
        super(metadata, context);
        this._liveStreamModule = null;
    }

    async onStart() {
        const pluginConfig = this.context.getPluginFileConfig();
        const barrageManager = global.barrageManager;
        if (!barrageManager) {
            this.context.log('warn', 'barrageManager 未就绪，跳过直播模块启动');
            return;
        }

        this._liveStreamModule = new LiveStreamModule({
            roomId: pluginConfig.roomId || 30230160,
            checkInterval: pluginConfig.checkInterval || 5000,
            maxMessages: pluginConfig.maxMessages || 50,
            apiUrl: pluginConfig.apiUrl || 'http://api.live.bilibili.com/ajax/msg',
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
