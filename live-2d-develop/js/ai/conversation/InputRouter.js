// InputRouter.js - 输入路由
const fs = require('fs');
const path = require('path');

/**
 * 负责路由不同来源的输入（语音/文本/弹幕）
 */
class InputRouter {
    constructor(conversationCore, gameIntegration, memoryManager, config) {
        this.conversationCore = conversationCore;
        this.gameIntegration = gameIntegration;
        this.memoryManager = memoryManager;
        this.config = config;

        // UI回调（稍后设置）
        this.showSubtitle = null;
        this.hideSubtitle = null;

        // LLM处理器（稍后设置）
        this.llmHandler = null;
    }

    /**
     * 设置UI回调
     */
    setUICallbacks(showSubtitle, hideSubtitle) {
        this.showSubtitle = showSubtitle;
        this.hideSubtitle = hideSubtitle;
    }

    /**
     * 设置LLM处理器
     */
    setLLMHandler(handler) {
        this.llmHandler = handler;
    }

    /**
     * 处理语音输入
     */
    async handleVoiceInput(text) {
        // 检查游戏模式
        if (this.gameIntegration.isGameModeActive()) {
            await this.gameIntegration.handleGameInput(text);
        } else {
            // 异步记忆检查，不阻塞对话流程
            this.memoryManager.checkAndSaveMemoryAsync(text);

            // 发送到LLM
            await this.llmHandler(text);
        }

        // 保存到记忆库
        this.saveToMemoryLog();
    }

    /**
     * 处理文本输入（来自聊天框）
     */
    async handleTextInput(text) {
        // 注意：显示用户消息的逻辑已移至 ChatController
        // 发送到LLM
        await this.llmHandler(text);
    }

    /**
     * 保存到记忆库
     */
    saveToMemoryLog() {
        const messages = this.conversationCore.getMessages();
        const lastUserMsg = messages.filter(m => m.role === 'user').pop();
        const lastAIMsg = messages.filter(m => m.role === 'assistant').pop();

        if (lastUserMsg && lastAIMsg) {
            const newContent = `【用户】: ${lastUserMsg.content}\n【Fake Neuro】: ${lastAIMsg.content}\n`;

            try {
                fs.appendFileSync(
                    path.join(__dirname, '..', '..', '..', 'AI记录室', '记忆库.txt'),
                    newContent,
                    'utf8'
                );
            } catch (error) {
                console.error('保存记忆库失败:', error);
            }
        }
    }
}

module.exports = { InputRouter };