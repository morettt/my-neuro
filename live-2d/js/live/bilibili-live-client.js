// Read-only Bilibili live WebSocket client.
// Protocol flow adapted from Cortico (MIT): https://github.com/Pal-AI-Lab/Cortico
const { createHash } = require('node:crypto');
const WebSocket = require('ws');
const { OP, encodePacket, parseFrame } = require('./bilibili-wire.js');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36';
const MIXIN_TABLE = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];

class BilibiliLiveClient {
    constructor({ roomId, onCommand, onStatus, onPopularity, log }) {
        this.roomId = Number(roomId);
        this.onCommand = onCommand;
        this.onStatus = onStatus || (() => {});
        this.onPopularity = onPopularity || (() => {});
        this.log = log || console;
        this.socket = null;
        this.heartbeat = null;
        this.retryTimer = null;
        this.retryDelay = 2000;
        this.stopped = true;
        this.realRoomId = null;
        this.phase = 'stopped';
    }

    start() {
        if (!Number.isInteger(this.roomId) || this.roomId <= 0) throw new Error('直播间 ID 必须是正整数');
        if (!this.stopped) return;
        this.stopped = false;
        void this.connect();
    }

    stop() {
        this.stopped = true;
        clearTimeout(this.retryTimer);
        clearInterval(this.heartbeat);
        this.retryTimer = null;
        this.heartbeat = null;
        const socket = this.socket;
        this.socket = null;
        if (socket) {
            try { socket.close(1000, 'plugin stopped'); } catch (_) {}
        }
        this.setStatus('stopped');
    }

    async connect() {
        if (this.stopped) return;
        this.setStatus('connecting');
        try {
            const plan = await this.bootstrap();
            if (this.stopped) return;
            this.openSocket(plan);
        } catch (error) {
            this.scheduleReconnect(error.message || String(error));
        }
    }

    openSocket(plan) {
        const socket = new WebSocket(plan.url, {
            headers: { 'User-Agent': USER_AGENT, Origin: 'https://live.bilibili.com' },
            handshakeTimeout: 15000
        });
        this.socket = socket;
        socket.on('open', () => {
            socket.send(encodePacket(OP.AUTH, JSON.stringify(plan.auth)));
            clearInterval(this.heartbeat);
            this.heartbeat = setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) socket.send(encodePacket(OP.HEARTBEAT));
            }, 30000);
            this.heartbeat.unref?.();
        });
        socket.on('message', raw => this.handleFrame(toBuffer(raw)));
        socket.on('error', error => this.log.warn?.(`B站直播连接错误: ${error.message}`));
        socket.on('close', (code, reason) => {
            if (this.socket !== socket) return;
            this.socket = null;
            clearInterval(this.heartbeat);
            this.heartbeat = null;
            if (!this.stopped) this.scheduleReconnect(`连接断开(${code}) ${reason.toString()}`);
        });
    }

    handleFrame(buffer) {
        for (const frame of parseFrame(buffer)) {
            if (frame.kind === 'auth') {
                if (frame.code === 0) {
                    this.retryDelay = 2000;
                    this.setStatus('connected');
                    this.log.info?.(`B站直播已实时连接，房间 ${this.realRoomId}`);
                } else this.scheduleReconnect(`认证失败 code=${frame.code}`);
            } else if (frame.kind === 'popularity') {
                this.onPopularity(frame.value);
            } else if (frame.kind === 'command') {
                try { this.onCommand(frame.message); }
                catch (error) { this.log.warn?.(`B站事件处理失败: ${error.message}`); }
            }
        }
    }

    scheduleReconnect(reason) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
        const socket = this.socket;
        this.socket = null;
        if (socket) { try { socket.terminate(); } catch (_) {} }
        if (this.stopped) return;
        const delay = this.retryDelay;
        this.setStatus('retrying', reason);
        this.log.warn?.(`B站直播连接中断：${reason}，${Math.round(delay / 1000)} 秒后重连`);
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.connect();
        }, delay);
        this.retryTimer.unref?.();
        this.retryDelay = Math.min(delay * 2, 60000);
    }

    setStatus(phase, error = '') {
        this.phase = phase;
        this.onStatus({ phase, roomId: this.roomId, realRoomId: this.realRoomId, error });
    }

    async bootstrap() {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const spi = await this.getJson('https://api.bilibili.com/x/frontend/finger/spi', controller.signal);
            const buvid = object(spi.data).b_3 || '';
            const cookie = buvid ? `buvid3=${buvid}` : '';
            const nav = await this.getJson('https://api.bilibili.com/x/web-interface/nav', controller.signal, cookie);
            const navData = object(nav.data);
            const wbi = object(navData.wbi_img);
            const mixin = mixinKey(fileKey(wbi.img_url), fileKey(wbi.sub_url));
            const uid = number(navData.mid);
            const roomResponse = await this.getJson(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${this.roomId}`, controller.signal, cookie);
            if (number(roomResponse.code) !== 0) throw new Error(`直播间不存在：${roomResponse.message || roomResponse.code}`);
            const room = object(roomResponse.data);
            this.realRoomId = number(room.room_id);
            const danmu = await this.getJson(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${wbiQuery({ id: this.realRoomId, type: 0 }, mixin)}`, controller.signal, cookie);
            if (number(danmu.code) !== 0) throw new Error(`获取弹幕服务器失败：${danmu.message || danmu.code}`);
            const danmuData = object(danmu.data);
            const host = object(Array.isArray(danmuData.host_list) ? danmuData.host_list[0] : null);
            if (!host.host) throw new Error('弹幕服务器列表为空');
            return {
                url: `wss://${host.host}:${number(host.wss_port) || 443}/sub`,
                auth: { uid, roomid: this.realRoomId, protover: 3, platform: 'web', type: 2, buvid, key: danmuData.token || '' }
            };
        } finally { clearTimeout(timeout); }
    }

    async getJson(url, signal, cookie = '') {
        const response = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT, Referer: 'https://live.bilibili.com/', Origin: 'https://live.bilibili.com', ...(cookie ? { Cookie: cookie } : {}) } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }
}

function fileKey(value) { return typeof value === 'string' ? value.split('/').pop()?.split('.')[0] || '' : ''; }
function mixinKey(image, sub) { const raw = image + sub; return MIXIN_TABLE.map(index => raw[index] || '').join('').slice(0, 32); }
function wbiQuery(params, mixin) {
    const values = { ...params, wts: Math.floor(Date.now() / 1000) };
    const query = Object.keys(values).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(values[key]).replace(/[!'()*]/g, ''))}`).join('&');
    return `${query}&w_rid=${createHash('md5').update(query + mixin).digest('hex')}`;
}
function object(value) { return value && typeof value === 'object' ? value : {}; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function toBuffer(raw) { if (Buffer.isBuffer(raw)) return raw; if (Array.isArray(raw)) return Buffer.concat(raw); return Buffer.from(raw); }

module.exports = { BilibiliLiveClient };
