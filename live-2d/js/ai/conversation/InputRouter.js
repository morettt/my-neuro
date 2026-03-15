// InputRouter.js - 输入路由
const fs = require('fs');
const path = require('path');
const { eventBus } = require('../../core/event-bus.js');
const { Events } = require('../../core/events.js');
const { MessageEvent } = require('../../core/message-event.js');

/**
 * 负责路由不同来源的输入（语音/文本/弹幕）
 */
class InputRouter {
    constructor(conversationCore, _unused1, contextCompressor, memosClient, config) {
        this.conversationCore = conversationCore;
        this.contextCompressor = contextCompressor;
        this.memosClient = memosClient;  // 🔥 新增：MemOS 客户端
        this.config = config;

        // UI回调（稍后设置）
        this.showSubtitle = null;
        this.hideSubtitle = null;

        // LLM处理器（稍后设置）
        this.llmHandler = null;

        // BarrageManager引用（用于打断）
        this.barrageManager = null;

        // VoiceChatFacade 引用（用于记忆注入）
        this.voiceChatFacade = null;
    }

    /**
     * 设置 VoiceChatFacade 引用
     */
    setVoiceChatFacade(facade) {
        this.voiceChatFacade = facade;
    }

    /**
     * 设置BarrageManager引用
     */
    setBarrageManager(barrageManager) {
        this.barrageManager = barrageManager;
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
     * 运行插件的 onUserInput 钩子，返回处理后的 MessageEvent
     * @param {string} text
     * @param {string} source
     * @returns {Promise<MessageEvent>}
     */
    async _runUserInputHooks(text, source) {
        const event = new MessageEvent(text, source);
        if (global.pluginManager) {
            await global.pluginManager.runUserInputHooks(event);
        }
        return event;
    }

    /**
     * 处理语音输入
     */
    async handleVoiceInput(text) {
        // 🔥 用户语音输入时：打断弹幕处理 + 清空弹幕队列
        if (this.barrageManager) {
            this.barrageManager.setInterrupt();
            this.barrageManager.clearNormalQueue();
        }

        // 运行插件 onUserInput 钩子
        // memos 插件：injectRelevantMemories 均在此处通过钩子触发，无需在下方重复调用
        const event = await this._runUserInputHooks(text, 'voice');
        if (event._defaultPrevented) return; // 插件自行处理，跳过 LLM

        const finalText = event.text;

        // 处理插件追加的上下文
        const contextAdditions = event.getContextAdditions();
        const promptWithContext = contextAdditions.length > 0
            ? finalText + '\n\n' + contextAdditions.join('\n')
            : finalText;

        // 发送到LLM
        await this.llmHandler(promptWithContext);

        // 保存到记忆库
        this.saveToMemoryLog();
    }

    /**
     * 处理文本输入（来自聊天框）
     */
    async handleTextInput(text) {
        // 🔥 用户文本输入时：打断弹幕处理 + 清空弹幕队列
        if (this.barrageManager) {
            this.barrageManager.setInterrupt();
            this.barrageManager.clearNormalQueue();
        }

        // 显示用户消息
        this.addChatMessage('user', text);

        // 运行插件 onUserInput 钩子（memos 插件在此注入记忆）
        const event = await this._runUserInputHooks(text, 'text');
        if (event._defaultPrevented) return;

        const finalText = event.text;

        // 处理插件追加的上下文
        const contextAdditions = event.getContextAdditions();
        const promptWithContext = contextAdditions.length > 0
            ? finalText + '\n\n' + contextAdditions.join('\n')
            : finalText;

        // 发送到LLM
        await this.llmHandler(promptWithContext);

        // 保存到记忆库
        this.saveToMemoryLog();

        // 触发用户消息已接收事件（用于心情系统）
        eventBus.emit(Events.USER_MESSAGE_RECEIVED);
    }

    /**
     * 处理弹幕输入
     */
    async handleBarrageInput(nickname, text) {
        // 弹幕处理逻辑通过BarrageManager完成
        // 这里只是一个占位方法，实际使用中通过handleBarrageMessage调用
    }

    /**
     * 添加聊天消息到界面
     */
    addChatMessage(role, content) {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            const messageElement = document.createElement('div');
            messageElement.innerHTML = `<strong>${role === 'user' ? '你' : 'Fake Neuro'}:</strong> ${content}`;
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
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
