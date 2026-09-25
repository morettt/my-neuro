// Normalize Bilibili commands into the small event model used by my-neuro.
// Event mappings adapted from Cortico (MIT): https://github.com/Pal-AI-Lab/Cortico
const { giftFrameData } = require('./bilibili-gift-frame.js');

function normalizeBilibiliEvent(message, warn = () => {}) {
    const command = String(message.cmd || '').split(':')[0];
    const data = object(message.data);
    if (command === 'DANMU_MSG' || command === 'DANMU_MSG_MIRROR') {
        const info = Array.isArray(message.info) ? message.info : [];
        const sender = Array.isArray(info[2]) ? info[2] : [];
        const text = string(info[1]).trim();
        if (!text) return null;
        return { type: 'danmaku', nickname: string(sender[1]) || '观众', text };
    }
    if (command === 'SUPER_CHAT_MESSAGE') {
        const user = object(data.user_info);
        const nickname = string(user.uname) || '观众';
        return { type: 'superchat', nickname, text: `发送了 ¥${number(data.price)} 的醒目留言：${string(data.message)}`, priority: true };
    }
    if (command === 'GUARD_BUY') {
        const nickname = string(data.username) || '观众';
        const gift = string(data.gift_name) || '大航海';
        return { type: 'guard', nickname, text: `开通了 ${gift}×${number(data.num) || 1}`, priority: true };
    }
    if (command === 'USER_TOAST_MSG' || command === 'USER_TOAST_MSG_V2') {
        const sender = object(data.sender_uinfo);
        const base = object(sender.base);
        const guard = object(data.guard_info);
        const nickname = string(data.username) || string(base.name) || '观众';
        const role = string(data.role_name) || string(guard.role_name) || '大航海';
        const action = string(data.toast_msg).includes('续费') ? '续费了' : '开通了';
        return { type: 'guard', nickname, text: `${action} ${role}`, priority: true };
    }
    if (command === 'SEND_GIFT' || command === 'SEND_GIFT_V2') {
        const gift = giftFrameData(data, warn);
        if (string(gift.coin_type) && string(gift.coin_type) !== 'gold') return null;
        const sender = object(gift.sender_uinfo);
        const base = object(sender.base);
        const nickname = string(gift.uname) || string(base.name) || '观众';
        const giftName = string(gift.giftName) || string(gift.gift_name) || '礼物';
        const count = number(gift.num) || 1;
        const yuan = number(gift.total_coin) / 1000;
        return { type: 'gift', nickname, text: `赠送了 ${giftName}×${count}${yuan > 0 ? `（¥${trim(yuan)}）` : ''}`, priority: yuan >= 1 };
    }
    if (command === 'LIVE') return { type: 'room', nickname: '直播间', text: '直播已经开始', priority: true };
    if (command === 'PREPARING') return { type: 'room', nickname: '直播间', text: '直播已经结束', priority: true };
    return null;
}

function object(value) { return value && typeof value === 'object' ? value : {}; }
function string(value) { return typeof value === 'string' ? value : ''; }
function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function trim(value) { return Number.isInteger(value) ? String(value) : value.toFixed(2); }

module.exports = { normalizeBilibiliEvent };
