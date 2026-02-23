const { Plugin } = require('../../../js/core/plugin-base.js');

// 时间段定义：[开始小时, 结束小时, slot名, 触发给AI的提示词]
const TIME_SLOTS = [
    [0,  3,  'midnight', '[系统：现在是深夜，你注意到用户还没睡，用你的方式说一句话。不要说早安晚安之类的废话。]'],
    [3,  5,  'late',     '[系统：现在是凌晨三四点，你觉得用户完全不正常，用你的方式表达一下。]'],
    [6,  8,  'morning',  '[系统：早上了，你刚"醒来"，懒洋洋地跟用户打个招呼。]'],
    [13, 15, 'afternoon','[系统：下午了，你有点犯困，随便说句话。]'],
    [22, 24, 'night',    '[系统：快到深夜了，你注意到时间，随便说句话。]'],
];

class TimeAwarenessPlugin extends Plugin {

    async onStart() {
        // 用日期+slot记录今天已触发的时间段，避免重复
        this._triggered = new Set();

        this._timer = setInterval(() => this._check(), 5 * 60 * 1000);
    }

    async _check() {
        const now = new Date();
        const hour = now.getHours();
        const today = now.toDateString();

        for (const [start, end, slot, prompt] of TIME_SLOTS) {
            const key = `${today}-${slot}`;
            if (hour >= start && hour < end && !this._triggered.has(key)) {
                this._triggered.add(key);
                this.context.log('info', `时间触发: ${slot}`);
                await this.context.sendMessage(prompt).catch(() => {});
                break; // 一次只触发一个
            }
        }
    }

    async onStop() {
        clearInterval(this._timer);
    }
}

module.exports = TimeAwarenessPlugin;
