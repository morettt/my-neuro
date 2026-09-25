const test = require('node:test');
const assert = require('node:assert/strict');
const { brotliCompressSync } = require('node:zlib');
const { OP, encodePacket, parseFrame } = require('./bilibili-wire.js');
const { normalizeBilibiliEvent } = require('./bilibili-events.js');
const { LiveStreamModule } = require('./LiveStreamModule.js');

test('解析普通弹幕帧', () => {
    const command = { cmd: 'DANMU_MSG', info: [[], '你好肥牛', [123, '测试观众']] };
    const frames = parseFrame(encodePacket(OP.MESSAGE, JSON.stringify(command)));
    assert.equal(frames.length, 1);
    assert.deepEqual(normalizeBilibiliEvent(frames[0].message), {
        type: 'danmaku', nickname: '测试观众', text: '你好肥牛'
    });
});

test('递归解析 Brotli 压缩帧', () => {
    const inner = encodePacket(OP.MESSAGE, JSON.stringify({ cmd: 'LIVE', data: {} }));
    const body = brotliCompressSync(inner);
    const outer = Buffer.alloc(16 + body.length);
    outer.writeUInt32BE(outer.length, 0);
    outer.writeUInt16BE(16, 4);
    outer.writeUInt16BE(3, 6);
    outer.writeUInt32BE(OP.MESSAGE, 8);
    outer.writeUInt32BE(1, 12);
    body.copy(outer, 16);
    assert.equal(parseFrame(outer)[0].message.cmd, 'LIVE');
});

test('解析礼物、醒目留言和上舰事件', () => {
    assert.deepEqual(normalizeBilibiliEvent({ cmd: 'SEND_GIFT', data: {
        uname: '小明', giftName: '辣条', num: 2, coin_type: 'gold', total_coin: 2000
    }}), { type: 'gift', nickname: '小明', text: '赠送了 辣条×2（¥2）', priority: true });

    assert.deepEqual(normalizeBilibiliEvent({ cmd: 'SUPER_CHAT_MESSAGE', data: {
        price: 30, message: '加油', user_info: { uname: '小红' }
    }}), { type: 'superchat', nickname: '小红', text: '发送了 ¥30 的醒目留言：加油', priority: true });

    assert.deepEqual(normalizeBilibiliEvent({ cmd: 'GUARD_BUY', data: {
        username: '舰长甲', gift_name: '舰长', num: 1
    }}), { type: 'guard', nickname: '舰长甲', text: '开通了 舰长×1', priority: true });
});

test('短时间内忽略同一用户的镜像重复弹幕', () => {
    const received = [];
    const live = new LiveStreamModule({ onNewMessage: message => received.push(message) });
    const command = { cmd: 'DANMU_MSG', info: [[], '重复内容', [123, '测试观众']] };
    live.handleCommand(command);
    live.handleCommand({ ...command, cmd: 'DANMU_MSG_MIRROR' });
    assert.equal(received.length, 1);
});
