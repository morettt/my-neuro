const { Plugin } = require('../../../js/core/plugin-base.js');

class DynamicPersonaPlugin extends Plugin {

    async onInit() {
        this.persona = '';
        this.msgCount = 0;
        const cfg = this.context.getPluginConfig();
        this.updateFreq = cfg.update_frequency ?? 3; // 每N条消息更新一次
    }

    async onLLMRequest(request) {
        this.msgCount++;

        // 按频率更新人格
        if (this.msgCount % this.updateFreq !== 0 && this.persona) return;

        // 找最后一条用户消息
        const userMsg = [...request.messages].reverse().find(m => m.role === 'user');
        const userText = typeof userMsg?.content === 'string'
            ? userMsg.content
            : userMsg?.content?.[0]?.text || '';

        const hour = new Date().getHours();
        const timeStr = hour < 6 ? '深夜' : hour < 12 ? '上午' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜';

        try {
            this.persona = await this.context.callLLM(
                `现在是${timeStr}，用户说："${userText}"。\n` +
                `请用10字以内描述肥牛此刻的状态/心情，影响她这次回复的语气。` +
                `只输出状态本身，不要解释，例如："有点犯困但还在撑" 或 "突然对这个话题来了兴趣"`,
                { temperature: 1.2 }
            );
            this.context.log('info', `动态人格更新: ${this.persona}`);
        } catch (e) {
            return;
        }

        // 注入到系统消息
        const sysMsg = request.messages.find(m => m.role === 'system');
        if (sysMsg && this.persona) {
            sysMsg.content += `\n\n（你现在的状态：${this.persona}）`;
        }
    }
}

module.exports = DynamicPersonaPlugin;
