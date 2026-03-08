// plugins/built-in/memos/index.js
const { Plugin } = require('../../../js/core/plugin-base.js');

class MemosPlugin extends Plugin {

    async onUserInput(event) {
        if (!['voice', 'text'].includes(event.source)) return;

        const voiceChat = global.voiceChat;
        if (!voiceChat) return;

        const cfg = this.context.getPluginFileConfig();
        await voiceChat.injectRelevantMemories(event.text, cfg.inject_top_k || 3);
    }

    async onLLMResponse(response) {
        const voiceChat = global.voiceChat;
        if (!voiceChat?.memosClient) return;

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
