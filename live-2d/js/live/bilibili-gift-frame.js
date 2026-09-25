// SEND_GIFT_V2 protobuf compatibility layer.
// Adapted from Cortico (MIT): https://github.com/Pal-AI-Lab/Cortico
const pb = require('./bilibili-protobuf.js');

function giftFrameData(data, warn = () => {}) {
    if (string(data.giftName) || string(data.gift_name)) return data;
    const top = pb.fromBase64(data.pb);
    const gift = pb.sub(top, 10);
    const giftName = pb.text(gift, 2);
    if (!gift || !giftName) {
        if (data.pb !== undefined) warn('SEND_GIFT_V2 无法解析礼物信息');
        return data;
    }
    const sender = pb.sub(top, 15);
    const senderBase = pb.sub(sender, 2);
    const uid = pb.integer(top, 1) ?? pb.integer(sender, 1);
    const uname = pb.text(top, 2) || pb.text(senderBase, 1);
    const face = pb.text(top, 3) || pb.text(senderBase, 2);
    const number = pb.integer(gift, 3);
    const coinType = pb.text(gift, 8);
    const slots = [5, 6, 7].map(field => pb.integer(gift, field)).filter(value => value > 0);
    const totalCoin = slots.length ? Math.max(...slots) : undefined;
    return {
        ...data,
        ...(uid !== undefined ? { uid } : {}),
        ...(uname ? { uname } : {}),
        giftName,
        ...(number !== undefined ? { num: number } : {}),
        ...(coinType ? { coin_type: coinType } : {}),
        ...(totalCoin !== undefined ? { total_coin: totalCoin } : {}),
        sender_uinfo: { ...(uid !== undefined ? { uid } : {}), base: { ...(uname ? { name: uname } : {}), ...(face ? { face } : {}) } }
    };
}

function string(value) { return typeof value === 'string' ? value : ''; }

module.exports = { giftFrameData };
