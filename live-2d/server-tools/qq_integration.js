const WebSocket = require('ws');
const EventEmitter = require('events');

class QQIntegrationManager extends EventEmitter {
    constructor() {
        super();
        this.ws = null;
        this.config = {
            enabled: false,
            wsUrl: 'ws://127.0.0.1:8001',
            reconnectInterval: 5000,
            messageQueueMaxSize: 100,
            bot_qq: ''
        };
        this.messageQueue = [];
        this.isProcessing = false;
        this.reconnectTimer = null;
        this.isEnabled = false;
    }

    initialize(config = {}) {
        this.config = { ...this.config, ...config };
        this.isEnabled = this.config.enabled;

        if (this.isEnabled) {
            console.log('QQ集成管理器已启用，准备连接到LLOneBot');
            this.connect();
        } else {
            console.log('QQ集成管理器已禁用');
        }
    }

    connect() {
        if (!this.isEnabled) return;

        try {
            console.log(`正在连接到LLOneBot WebSocket: ${this.config.wsUrl}`);
            this.ws = new WebSocket(this.config.wsUrl);

            this.ws.on('open', () => {
                console.log('成功连接到LLOneBot WebSocket');
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    console.log('收到原始消息:', JSON.stringify(message, null, 2));
                    this.handleMessage(message);
                } catch (error) {
                    console.error('解析QQ消息失败:', error);
                    console.error('原始数据:', data.toString());
                }
            });

            this.ws.on('error', (error) => {
                console.error('LLOneBot WebSocket错误:', error.message);
            });

            this.ws.on('close', () => {
                console.log('LLOneBot WebSocket连接已关闭');
                this.scheduleReconnect();
            });

        } catch (error) {
            console.error('连接LLOneBot失败:', error);
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (!this.isEnabled) return;

        if (this.reconnectTimer) return;

        console.log(`将在${this.config.reconnectInterval}ms后尝试重新连接`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.config.reconnectInterval);
    }

    handleMessage(message) {
        if (message.post_type === 'message' && message.message_type === 'group') {
            const qqMessage = {
                groupId: message.group_id,
                userId: message.user_id,
                nickname: message.sender?.nickname || '未知用户',
                content: message.raw_message || message.message,
                timestamp: message.time || Date.now(),
                messageId: message.message_id,
                isMentioned: this.checkMention(message)
            };

            if (this.messageQueue.length >= this.config.messageQueueMaxSize) {
                this.messageQueue.shift();
            }

            this.messageQueue.push(qqMessage);
            console.log(`收到QQ群消息 [${qqMessage.groupId}] ${qqMessage.nickname}: ${qqMessage.content}`);

            this.emit('message', qqMessage);
        }
    }

    checkMention(message) {
        const rawMessage = message.raw_message || message.message || '';

        // 如果配置了bot_qq，检查是否@了bot的QQ号
        if (this.config.bot_qq) {
            const botQQ = this.config.bot_qq.toString();
            const isMentioned = rawMessage.includes(`[CQ:at,qq=${botQQ}]`) || rawMessage.includes(`[CQ:at,qq=${botQQ},`);
            console.log(`[checkMention] bot_qq=${botQQ}, rawMessage="${rawMessage}", isMentioned=${isMentioned}`);
            return isMentioned;
        }

        // 如果没有配置bot_qq，检查是否包含 "@肥牛" 或 "@ 肥牛"
        const isMentioned = rawMessage.includes('@肥牛') || rawMessage.includes('@ 肥牛') || rawMessage.match(/@\s*肥牛/);
        console.log(`[checkMention] bot_qq未配置, rawMessage="${rawMessage}", isMentioned=${!!isMentioned}`);
        return isMentioned;
    }

    sendGroupMessage(groupId, content) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket未连接，无法发送消息');
            return false;
        }

        const payload = {
            action: 'send_group_msg',
            params: {
                group_id: parseInt(groupId),
                message: content
            },
            echo: Date.now().toString()
        };

        try {
            const payloadStr = JSON.stringify(payload);
            console.log('发送payload:', payloadStr);
            this.ws.send(payloadStr);
            console.log(`已发送消息到群${groupId}: ${content}`);
            return true;
        } catch (error) {
            console.error('发送消息失败:', error);
            return false;
        }
    }

    getMessages(groupId = null, limit = 10) {
        let messages = this.messageQueue;

        if (groupId) {
            messages = messages.filter(m => m.groupId === groupId);
        }

        return messages.slice(-limit);
    }

    getUnprocessedMessages(groupId = null) {
        return this.getMessages(groupId, this.config.messageQueueMaxSize);
    }

    clearQueue() {
        this.messageQueue = [];
        console.log('QQ消息队列已清空');
    }

    stop() {
        this.isEnabled = false;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.messageQueue = [];
        console.log('QQ集成管理器已停止');
    }

    setEnabled(enabled) {
        const wasEnabled = this.isEnabled;
        this.isEnabled = enabled;
        this.config.enabled = enabled;

        if (enabled && !wasEnabled) {
            console.log('启用QQ集成管理器');
            this.connect();
        } else if (!enabled && wasEnabled) {
            console.log('禁用QQ集成管理器');
            this.stop();
        }
    }
}

const qqManager = new QQIntegrationManager();

function getToolDefinitions() {
    return [
        {
            name: "read_qq_messages",
            description: "读取QQ群聊消息。返回最近的群聊消息列表，可以指定群号和消息数量限制。",
            parameters: {
                type: "object",
                properties: {
                    group_id: {
                        type: "string",
                        description: "要读取的QQ群号，如果不指定则返回所有群的消息"
                    },
                    limit: {
                        type: "number",
                        description: "要返回的消息数量，默认10条，最多100条",
                        default: 10
                    }
                }
            }
        }
    ];
}

async function executeFunction(functionName, parameters) {
    if (functionName === "read_qq_messages") {
        if (!qqManager.isEnabled) {
            return "QQ集成功能未启用。请在配置文件中启用qq_integration插件。";
        }

        const groupId = parameters.group_id || null;
        const limit = Math.min(parameters.limit || 10, 100);

        const messages = qqManager.getMessages(groupId, limit);

        if (messages.length === 0) {
            return groupId
                ? `群 ${groupId} 暂无消息记录。`
                : "暂无任何QQ群消息记录。";
        }

        const formattedMessages = messages.map(msg =>
            `[${new Date(msg.timestamp * 1000).toLocaleTimeString()}] 群${msg.groupId} - ${msg.nickname}: ${msg.content}`
        ).join('\n');

        return `最近${messages.length}条QQ群消息:\n${formattedMessages}`;
    }

    throw new Error(`未知的工具: ${functionName}`);
}

module.exports = {
    getToolDefinitions,
    executeFunction,
    qqManager
};