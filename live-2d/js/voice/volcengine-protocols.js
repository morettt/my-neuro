// volcengine-protocols.js
// 字节跳动 TTS 双向流式协议实现（从官方 TypeScript SDK 移植）

'use strict';

const { randomUUID } = require('crypto');

// ── 枚举常量 ──────────────────────────────────────────────

const EventType = {
    None: 0,
    StartConnection: 1,
    FinishConnection: 2,
    ConnectionStarted: 50,
    ConnectionFailed: 51,
    ConnectionFinished: 52,
    StartSession: 100,
    CancelSession: 101,
    FinishSession: 102,
    SessionStarted: 150,
    SessionCanceled: 151,
    SessionFinished: 152,
    SessionFailed: 153,
    TaskRequest: 200,
    AudioMuted: 250,
};

const MsgType = {
    Invalid: 0,
    FullClientRequest: 0b0001,
    AudioOnlyClient: 0b0010,
    FullServerResponse: 0b1001,
    AudioOnlyServer: 0b1011,
    FrontEndResultServer: 0b1100,
    Error: 0b1111,
};

const MsgTypeFlagBits = {
    NoSeq: 0,
    PositiveSeq: 0b001,
    LastNoSeq: 0b010,
    NegativeSeq: 0b011,
    WithEvent: 0b100,
};

const VersionBits = { Version1: 1 };
const HeaderSizeBits = { HeaderSize4: 1 };
const SerializationBits = { JSON: 0b0001 };
const CompressionBits = { None: 0 };

// ── 消息序列化 ─────────────────────────────────────────────

function marshalMessage(msg) {
    const parts = [];

    // 4 字节固定头
    const header = Buffer.alloc(4);
    header[0] = ((msg.version || VersionBits.Version1) << 4) | (msg.headerSize || HeaderSizeBits.HeaderSize4);
    header[1] = (msg.type << 4) | msg.flag;
    header[2] = ((msg.serialization || SerializationBits.JSON) << 4) | (msg.compression || CompressionBits.None);
    header[3] = 0;
    parts.push(header);

    // WithEvent：event(4) + sessionId
    if (msg.flag === MsgTypeFlagBits.WithEvent) {
        const evBuf = Buffer.alloc(4);
        evBuf.writeInt32BE(msg.event || 0, 0);
        parts.push(evBuf);

        // 连接级事件不带 sessionId
        const noSession = [
            EventType.StartConnection, EventType.FinishConnection,
            EventType.ConnectionStarted, EventType.ConnectionFailed,
        ];
        if (!noSession.includes(msg.event)) {
            const sid = Buffer.from(msg.sessionId || '', 'utf8');
            const sizeBuf = Buffer.alloc(4);
            sizeBuf.writeUInt32BE(sid.length, 0);
            parts.push(sizeBuf);
            if (sid.length > 0) parts.push(sid);
        }
    }

    // sequence（仅 PositiveSeq / NegativeSeq）
    if (msg.flag === MsgTypeFlagBits.PositiveSeq || msg.flag === MsgTypeFlagBits.NegativeSeq) {
        const seqBuf = Buffer.alloc(4);
        seqBuf.writeInt32BE(msg.sequence || 0, 0);
        parts.push(seqBuf);
    }

    // payload
    const payload = msg.payload || Buffer.alloc(0);
    const pSizeBuf = Buffer.alloc(4);
    pSizeBuf.writeUInt32BE(payload.length, 0);
    parts.push(pSizeBuf);
    if (payload.length > 0) parts.push(payload);

    return Buffer.concat(parts);
}

// ── 消息反序列化 ───────────────────────────────────────────

function unmarshalMessage(data) {
    if (data.length < 4) throw new Error(`data too short: ${data.length}`);

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const msg = {
        version: buf[0] >> 4,
        headerSize: buf[0] & 0x0f,
        type: buf[1] >> 4,
        flag: buf[1] & 0x0f,
        serialization: buf[2] >> 4,
        compression: buf[2] & 0x0f,
        payload: Buffer.alloc(0),
    };

    let offset = 4 * msg.headerSize; // 跳过整个头部（含填充）

    // PositiveSeq / NegativeSeq：先读 sequence
    if (msg.flag === MsgTypeFlagBits.PositiveSeq || msg.flag === MsgTypeFlagBits.NegativeSeq) {
        msg.sequence = buf.readInt32BE(offset);
        offset += 4;
    }

    // WithEvent：event → sessionId → connectId
    if (msg.flag === MsgTypeFlagBits.WithEvent) {
        msg.event = buf.readInt32BE(offset);
        offset += 4;

        // 连接级事件不带 sessionId
        const noSession = [
            EventType.StartConnection, EventType.FinishConnection,
            EventType.ConnectionStarted, EventType.ConnectionFailed,
            EventType.ConnectionFinished,
        ];
        if (!noSession.includes(msg.event)) {
            const sidLen = buf.readUInt32BE(offset);
            offset += 4;
            if (sidLen > 0) {
                msg.sessionId = buf.slice(offset, offset + sidLen).toString('utf8');
                offset += sidLen;
            }
        }

        // ConnectionStarted / ConnectionFailed / ConnectionFinished 带 connectId
        const withConnect = [
            EventType.ConnectionStarted, EventType.ConnectionFailed, EventType.ConnectionFinished,
        ];
        if (withConnect.includes(msg.event)) {
            const cidLen = buf.readUInt32BE(offset);
            offset += 4;
            if (cidLen > 0) {
                msg.connectId = buf.slice(offset, offset + cidLen).toString('utf8');
                offset += cidLen;
            }
        }
    }

    // payload
    if (offset + 4 <= buf.length) {
        const payloadLen = buf.readUInt32BE(offset);
        offset += 4;
        if (payloadLen > 0) {
            msg.payload = buf.slice(offset, offset + payloadLen);
        }
    }

    return msg;
}

// ── 收消息（Promise 封装）─────────────────────────────────

const _queues = new WeakMap();
const _callbacks = new WeakMap();

function _setupHandler(ws) {
    if (_queues.has(ws)) return;
    _queues.set(ws, []);
    _callbacks.set(ws, []);

    ws.on('message', (data) => {
        const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const msg = unmarshalMessage(raw);
        const cbs = _callbacks.get(ws);
        const q = _queues.get(ws);
        if (cbs && cbs.length > 0) {
            cbs.shift()(msg);
        } else if (q) {
            q.push(msg);
        }
    });

    ws.on('close', () => {
        _queues.delete(ws);
        _callbacks.delete(ws);
    });
}

function receiveMessage(ws) {
    _setupHandler(ws);
    return new Promise((resolve, reject) => {
        const q = _queues.get(ws);
        const cbs = _callbacks.get(ws);
        if (q && q.length > 0) return resolve(q.shift());
        const onError = (err) => {
            const i = cbs.indexOf(resolver);
            if (i !== -1) cbs.splice(i, 1);
            reject(err);
        };
        const resolver = (msg) => {
            ws.removeListener('error', onError);
            resolve(msg);
        };
        cbs.push(resolver);
        ws.once('error', onError);
    });
}

async function waitForEvent(ws, msgType, eventType) {
    const msg = await receiveMessage(ws);
    if (msg.type !== msgType || msg.event !== eventType) {
        throw new Error(`Unexpected message: type=${msg.type}, event=${msg.event}`);
    }
    return msg;
}

// ── 发送帮助函数 ───────────────────────────────────────────

function _send(ws, msg) {
    const data = marshalMessage(msg);
    return new Promise((resolve, reject) => {
        ws.send(data, (err) => err ? reject(err) : resolve());
    });
}

function startConnection(ws) {
    return _send(ws, {
        type: MsgType.FullClientRequest,
        flag: MsgTypeFlagBits.WithEvent,
        event: EventType.StartConnection,
        payload: Buffer.from('{}'),
    });
}

function finishConnection(ws) {
    return _send(ws, {
        type: MsgType.FullClientRequest,
        flag: MsgTypeFlagBits.WithEvent,
        event: EventType.FinishConnection,
        payload: Buffer.from('{}'),
    });
}

function startSession(ws, payload, sessionId) {
    return _send(ws, {
        type: MsgType.FullClientRequest,
        flag: MsgTypeFlagBits.WithEvent,
        event: EventType.StartSession,
        sessionId,
        payload: Buffer.isBuffer(payload) ? payload : Buffer.from(payload),
    });
}

function finishSession(ws, sessionId) {
    return _send(ws, {
        type: MsgType.FullClientRequest,
        flag: MsgTypeFlagBits.WithEvent,
        event: EventType.FinishSession,
        sessionId,
        payload: Buffer.from('{}'),
    });
}

function taskRequest(ws, payload, sessionId) {
    return _send(ws, {
        type: MsgType.FullClientRequest,
        flag: MsgTypeFlagBits.WithEvent,
        event: EventType.TaskRequest,
        sessionId,
        payload: Buffer.isBuffer(payload) ? payload : Buffer.from(payload),
    });
}

module.exports = {
    EventType,
    MsgType,
    MsgTypeFlagBits,
    receiveMessage,
    waitForEvent,
    startConnection,
    finishConnection,
    startSession,
    finishSession,
    taskRequest,
};
