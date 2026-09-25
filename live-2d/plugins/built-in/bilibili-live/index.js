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
            onNewMessage: (message) => {
                barrageManager.addToQueue(message.nickname, message.text);
            },
            onEvent: (event) => {
                if (event.type === 'danmaku') return;
                logToTerminal('info', `收到直播事件[${event.type}]: ${event.nickname}: ${event.text}`);
                barrageManager.addToQueue(event.nickname, `[${event.type}] ${event.text}`);
            },
            onStatus: (status) => {
                const detail = status.realRoomId ? `，真实房间 ${status.realRoomId}` : '';
                if (status.phase === 'connected') logToTerminal('info', `B站直播实时连接成功${detail}`);
                else if (status.phase === 'retrying') logToTerminal('warning', `B站直播连接中断，正在重连：${status.error}`);
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
