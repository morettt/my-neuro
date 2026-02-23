// plugins/built-in/memos/index.js
// MemOS 长期记忆插件 - Hook Plugin
// onUserInput：检索相关记忆并注入系统提示词
// onLLMResponse：将本轮对话批量保存到 MemOS

const { Plugin } = require('../../../js/core/plugin-base.js');

class MemosPlugin extends Plugin {

    async onStart() {
        const config = this.context.getConfig();
        if (!config.memos?.enabled) return;
    }

    async onUserInput(event) {
        // 只处理用户主动输入（语音/文字），不处理自动/弹幕
        if (!['voice', 'text'].includes(event.source)) return;

        const voiceChat = global.voiceChat;
        if (!voiceChat?.config?.memos?.enabled) return;

        await voiceChat.injectRelevantMemories(event.text);
    }

    async onLLMResponse(response) {
        const voiceChat = global.voiceChat;
        if (!voiceChat?.memosClient || !voiceChat.config?.memos?.enabled) return;

        // 从对话历史中取最后一条用户消息（与 AI 回复配对保存）
        const messages = voiceChat.messages || [];
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUser) return;

        const toSave = [
            { role: 'user', content: lastUser.content },
            { role: 'assistant', content: response.text }
        ];

        voiceChat.memosClient.addWithBuffer(toSave).catch(err => {
            console.error('MemOS 保存对话失败:', err);
        });
    }
}

module.exports = MemosPlugin;
