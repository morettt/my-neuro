// B 站直播长连接帧协议。
// Based on Cortico's MIT-licensed Bilibili implementation:
// https://github.com/Pal-AI-Lab/Cortico
const { brotliDecompressSync, inflateSync } = require('node:zlib');

const OP = Object.freeze({ HEARTBEAT: 2, HEARTBEAT_REPLY: 3, MESSAGE: 5, AUTH: 7, AUTH_REPLY: 8 });
const HEADER_LEN = 16;

function encodePacket(op, body = '') {
    const payload = Buffer.from(body, 'utf8');
    const packet = Buffer.alloc(HEADER_LEN + payload.length);
    packet.writeUInt32BE(packet.length, 0);
    packet.writeUInt16BE(HEADER_LEN, 4);
    packet.writeUInt16BE(1, 6);
    packet.writeUInt32BE(op, 8);
    packet.writeUInt32BE(1, 12);
    payload.copy(packet, HEADER_LEN);
    return packet;
}

function packets(buffer) {
    const result = [];
    let offset = 0;
    while (offset + HEADER_LEN <= buffer.length) {
        const total = buffer.readUInt32BE(offset);
        const header = buffer.readUInt16BE(offset + 4);
        if (total < header || header < HEADER_LEN || offset + total > buffer.length) break;
        result.push({
            version: buffer.readUInt16BE(offset + 6),
            operation: buffer.readUInt32BE(offset + 8),
            body: buffer.subarray(offset + header, offset + total)
        });
        offset += total;
    }
    return result;
}

function parseFrame(buffer) {
    const output = [];
    collect(Buffer.from(buffer), output);
    return output;
}

function collect(buffer, output) {
    for (const packet of packets(buffer)) {
        if (packet.operation === OP.AUTH_REPLY) {
            const response = readJson(packet.body);
            output.push({ kind: 'auth', code: Number(response?.code || 0) });
            continue;
        }
        if (packet.operation === OP.HEARTBEAT_REPLY) {
            output.push({ kind: 'popularity', value: packet.body.length >= 4 ? packet.body.readUInt32BE(0) : 0 });
            continue;
        }
        if (packet.operation !== OP.MESSAGE) continue;
        if (packet.version === 2 || packet.version === 3) {
            try {
                collect(packet.version === 2 ? inflateSync(packet.body) : brotliDecompressSync(packet.body), output);
            } catch (_) { /* 丢弃损坏的压缩帧 */ }
            continue;
        }
        const message = readJson(packet.body);
        if (message) output.push({ kind: 'command', message });
    }
}

function readJson(buffer) {
    try {
        const value = JSON.parse(buffer.toString('utf8'));
        return value && typeof value === 'object' ? value : null;
    } catch (_) {
        return null;
    }
}

module.exports = { OP, encodePacket, parseFrame };
