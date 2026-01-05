const WebSocket = require('ws');

class QQCommentaryManager {
    constructor() {
        this.isEnabled = false;
        this.qqManager = null;
        this.voiceChat = null;
        this.ttsProcessor = null;
        this.commentQueue = [];
        this.isProcessing = false;
        this.userInteractionPriority = false;
        this.lastProcessedIndex = 0;
    }

    initialize(config, voiceChat, ttsProcessor) {
        this.isEnabled = config.enabled || false;
        this.voiceChat = voiceChat;
        this.ttsProcessor = ttsProcessor;

        if (this.isEnabled) {
            if (global.qqManager) {
                this.qqManager = global.qqManager;

                this.qqManager.on('message', (message) => {
                    this.addToCommentQueue(message);
                });

                console.log('QQ评论管理器已启用');
            } else {
                console.error('QQ集成管理器未初始化，无法启用QQ评论功能');
                this.isEnabled = false;
            }
        } else {
            console.log('QQ评论管理器已禁用');
        }
    }

    addToCommentQueue(message) {
        if (!this.isEnabled) return;

        // 只有被@时才添加到评论队列
        if (!message.isMentioned) {
            console.log(`消息未@bot，跳过评论: [${message.groupId}] ${message.nickname}: ${message.content}`);
            return;
        }

        this.commentQueue.push(message);
        console.log(`新消息加入评论队列: [${message.groupId}] ${message.nickname}: ${message.content}`);

        if (!this.isProcessing && !this.userInteractionPriority) {
            this.processNextComment();
        }
    }

    async processNextComment() {
        if (!this.isEnabled || this.commentQueue.length === 0) {
            this.isProcessing = false;
            return;
        }

        if (this.userInteractionPriority) {
            console.log('用户正在交互，暂停评论处理');
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;

        const message = this.commentQueue.shift();

        try {
            const prompt = `[QQ群消息] 群${message.groupId} - ${message.nickname}: ${message.content}\n\n请对这条消息进行简短评论（不要发送到QQ群，只是口头评论）。`;

            console.log(`正在评论消息: ${message.nickname}: ${message.content}`);

            if (this.voiceChat && this.voiceChat.messages) {
                this.voiceChat.messages.push({
                    role: 'user',
                    content: prompt
                });

                await this.voiceChat.sendToLLM(prompt);
            }

            setTimeout(() => {
                if (!this.userInteractionPriority) {
                    this.processNextComment();
                } else {
                    this.isProcessing = false;
                }
            }, 3000);

        } catch (error) {
            console.error('评论处理失败:', error);
            this.isProcessing = false;

            setTimeout(() => {
                if (!this.userInteractionPriority) {
                    this.processNextComment();
                }
            }, 3000);
        }
    }

    setUserInteractionPriority(isPriority) {
        this.userInteractionPriority = isPriority;

        if (!isPriority && this.commentQueue.length > 0 && !this.isProcessing) {
            console.log('用户交互结束，恢复评论处理');
            setTimeout(() => {
                this.processNextComment();
            }, 2000);
        }
    }

    clearQueue() {
        this.commentQueue = [];
        this.isProcessing = false;
        console.log('评论队列已清空');
    }

    stop() {
        this.isEnabled = false;
        this.clearQueue();
        console.log('QQ评论管理器已停止');
    }

    setEnabled(enabled) {
        const wasEnabled = this.isEnabled;
        this.isEnabled = enabled;

        if (enabled && !wasEnabled) {
            console.log('启用QQ评论管理器');
            if (!this.qqManager && global.qqManager) {
                this.qqManager = global.qqManager;
                this.qqManager.on('message', (message) => {
                    this.addToCommentQueue(message);
                });
            }
        } else if (!enabled && wasEnabled) {
            console.log('禁用QQ评论管理器');
            this.stop();
        }
    }
}

const qqCommentaryManager = new QQCommentaryManager();

module.exports = { qqCommentaryManager };