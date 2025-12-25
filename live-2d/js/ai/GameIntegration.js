// GameIntegration.js - 游戏集成管理模块
class GameIntegration {
    constructor(voiceChatInterface, config) {
        this.voiceChat = voiceChatInterface;
        this.config = config;
        this.gameModules = {};
        this.initGameModules(config);
    }

    // 游戏模块初始化
    initGameModules(config) {
        if (config.game?.Minecraft?.enabled) {
            this.initMinecraftModule(config.game.Minecraft);
        }
    }

    // 初始化Minecraft模块
    initMinecraftModule(minecraftConfig) {
        const io = require('socket.io-client');
        const socket = io(minecraftConfig.server_url || 'http://localhost:8080');

        socket.on('connect', () => {
            console.log('已连接到Mindcraft服务器');
            socket.emit('listen-to-agents');
        });

        socket.on('connect_error', (error) => {
            console.log('Mindcraft连接失败:', error.message);
        });

        this.gameModules.minecraft = {
            socket: socket,
            agentName: minecraftConfig.agent_name || 'fake-neuro',
            enabled: true
        };
    }

    // 检查游戏模式是否激活
    isGameModeActive() {
        return Object.values(this.gameModules).some(module => module.enabled);
    }

    // 游戏输入处理方法
    async handleGameInput(text) {
        if (this.gameModules.minecraft?.enabled) {
            const socket = this.gameModules.minecraft.socket;
            const agentName = this.gameModules.minecraft.agentName;

            if (socket.connected) {
                socket.emit('send-message', agentName, {
                    from: 'VOICE_INPUT',
                    message: text
                });
                console.log(`语音输入已发送到Minecraft: ${text}`);
                this.voiceChat.showSubtitle(`已发送到Minecraft: ${text}`, 2000);
            } else {
                console.log('Mindcraft连接未建立，无法发送消息');
                this.voiceChat.showSubtitle('Mindcraft连接未建立', 2000);
            }
        }
    }
}

module.exports = { GameIntegration };
