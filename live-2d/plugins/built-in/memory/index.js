// plugins/built-in/memory/index.js
// 记忆系统插件 - Hook Plugin
// 仅在用户语音输入时触发，通过 BERT 判断是否需要保存记忆

const { Plugin } = require('../../../js/core/plugin-base.js');

class MemoryPlugin extends Plugin {

    async onStart() {
        const config = this.context.getConfig();
        if (config.memory?.enabled === false) return;
    }

    async onUserInput(event) {
        // 只处理语音输入（与原来行为一致）
        if (event.source !== 'voice') return;

        const config = this.context.getConfig();
        if (config.memory?.enabled === false) return;

        const voiceChat = global.voiceChat;
        if (!voiceChat?.memoryManager) return;

        // 异步执行，不阻塞对话流程（与原来行为一致）
        voiceChat.memoryManager.checkAndSaveMemoryAsync(event.text);
    }
}

module.exports = MemoryPlugin;
