const { Plugin } = require('../../../js/core/plugin-base.js');

class ContextCompressorPlugin extends Plugin {

    async onInit() {
        this._compressing = false;
    }

    async onLLMResponse(response) {
        const config = this.context.getConfig();
        const cfg = config.context?.compression;
        if (!cfg?.enabled) return;
        if (this._compressing) return;

        const voiceChat = global.voiceChat;
        if (!voiceChat?.messages) return;

        const threshold = cfg.trigger_threshold || 15;
        if (voiceChat.messages.length < threshold) return;

        // 异步执行，不阻塞 TTS 播放
        this._compress(voiceChat, cfg).catch(e => {
            this.context.log('warn', `上下文压缩失败: ${e.message}`);
        });
    }

    async _compress(voiceChat, cfg) {
        this._compressing = true;
        try {
            const keepRecent = cfg.keep_recent || 4;
            const prompt = cfg.prompt || '请将以下历史对话总结为简洁的要点，保留关键信息和上下文。';
            const messages = voiceChat.messages;
            const total = messages.length;

            const systemMsgs = messages.filter(m => m.role === 'system');
            const nonSystem = messages.filter(m => m.role !== 'system');

            const initialSystem = systemMsgs.filter(m => !m.content.includes('[历史对话总结]'));
            const prevSummaryMsg = systemMsgs.find(m => m.content.includes('[历史对话总结]'));

            const recent = nonSystem.slice(-keepRecent * 2);
            const old = nonSystem.slice(0, -keepRecent * 2);
            if (old.length === 0) return;

            const convText = old.map(m =>
                m.role === 'user' ? `用户: ${this._text(m.content)}`
                : m.role === 'assistant' ? `AI: ${this._text(m.content)}`
                : ''
            ).filter(Boolean).join('\n');

            const prevSummary = prevSummaryMsg
                ? prevSummaryMsg.content.replace('[历史对话总结] ', '')
                : null;

            const compressPrompt = prevSummary
                ? `${prompt}\n\n【之前的历史总结】：\n${prevSummary}\n\n【本次新增对话】：\n${convText}\n\n请合并生成完整总结：`
                : `${prompt}\n\n对话内容：\n${convText}\n\n总结：`;

            const summary = await this.context.callLLM(compressPrompt, { max_tokens: 500, stream: false });
            if (!summary?.trim()) return;

            voiceChat.messages.length = 0;
            voiceChat.messages.push(
                ...initialSystem,
                { role: 'system', content: `[历史对话总结] ${summary.trim()}` },
                ...recent
            );

            this.context.log('info', `上下文压缩完成: ${total}条 → ${voiceChat.messages.length}条`);
        } finally {
            this._compressing = false;
        }
    }

    _text(content) {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return content.filter(p => p.type === 'text').map(p => p.text).join(' ');
        return '';
    }
}

module.exports = ContextCompressorPlugin;
