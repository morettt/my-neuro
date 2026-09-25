const { BilibiliLiveClient } = require('./bilibili-live-client.js');
const { normalizeBilibiliEvent } = require('./bilibili-events.js');

/** B站实时直播模块。保留旧版 onNewMessage，并通过 onEvent 输出付费和房间事件。 */
class LiveStreamModule {
    constructor(config = {}) {
        this.roomId = Number(config.roomId || 30230160);
        this.onNewMessage = config.onNewMessage || null;
        this.onEvent = config.onEvent || null;
        this.onStatus = config.onStatus || null;
        this.client = null;
        this.messageCache = [];
        this.maxMessages = Number(config.maxMessages || 50);
        this.recentDanmaku = new Map();
    }

    start() {
        if (this.client) return false;
        this.client = new BilibiliLiveClient({
            roomId: this.roomId,
            onCommand: command => this.handleCommand(command),
            onStatus: status => this.onStatus?.(status),
            log: { info: message => console.log(message), warn: message => console.warn(message) }
        });
        try {
            this.client.start();
            console.log(`B站实时直播模块启动，监听房间: ${this.roomId}`);
            return true;
        } catch (error) {
            this.client = null;
            throw error;
        }
    }

    stop() {
        if (!this.client) return false;
        this.client.stop();
        this.client = null;
        console.log('B站实时直播模块已停止');
        return true;
    }

    handleCommand(command) {
        const event = normalizeBilibiliEvent(command, message => console.warn(message));
        if (!event) return;
        if (event.type === 'danmaku') {
            const key = `${event.nickname}\u0000${event.text}`;
            const now = Date.now();
            const lastSeen = this.recentDanmaku.get(key) || 0;
            if (now - lastSeen < 2000) return;
            this.recentDanmaku.set(key, now);
            if (this.recentDanmaku.size > 200) {
                for (const [recentKey, seenAt] of this.recentDanmaku) {
                    if (now - seenAt >= 2000) this.recentDanmaku.delete(recentKey);
                }
            }
            const message = { nickname: event.nickname, text: event.text };
            this.messageCache.push(message);
            if (this.messageCache.length > this.maxMessages) this.messageCache.splice(0, this.messageCache.length - this.maxMessages);
            this.onNewMessage?.(message);
        }
        this.onEvent?.(event);
    }

    getMessages() { return [...this.messageCache]; }
    clearMessages() { this.messageCache = []; this.recentDanmaku.clear(); }
    setRoomId(roomId) {
        const next = Number(roomId);
        if (!Number.isInteger(next) || next <= 0) return false;
        const running = Boolean(this.client);
        if (running) this.stop();
        this.roomId = next;
        if (running) this.start();
        return true;
    }
    getStatus() {
        return {
            isRunning: Boolean(this.client && this.client.phase !== 'stopped'),
            phase: this.client?.phase || 'stopped',
            roomId: this.roomId,
            realRoomId: this.client?.realRoomId || null,
            messageCount: this.messageCache.length
        };
    }
}

module.exports = { LiveStreamModule };
