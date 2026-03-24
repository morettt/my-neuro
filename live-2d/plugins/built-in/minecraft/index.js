const { Plugin } = require('../../../js/core/plugin-base.js');
const fs = require('fs');
const path = require('path');

class MinecraftPlugin extends Plugin {
    constructor(metadata, context) {
        super(metadata, context);
        this.socket = null;
        this.agentName = 'fake-neuro';
    }

    async onStart() {
        const cfg = this.context.getPluginFileConfig();
        const serverUrl = cfg.server_url || 'http://localhost:8080';
        this.agentName = cfg.agent_name || 'fake-neuro';

        // 将插件配置写入 andy.json / keys.json
        this._syncConfigFiles(cfg);

        try {
            const io = require('socket.io-client');
            this.socket = io(serverUrl);

            this.socket.on('connect', () => {
                this.context.log('info', `已连接到 Mindcraft 服务器: ${serverUrl}`);
                this.socket.emit('listen-to-agents');
            });

            this.socket.on('connect_error', (error) => {
                this.context.log('error', `Mindcraft 连接失败: ${error.message}`);
            });

            this.socket.on('bot-output', (agentName, message) => {
                this.context.log('info', `[MC机器人] ${agentName}: ${message}`);
            });

        } catch (error) {
            this.context.log('error', `Minecraft 插件启动失败: ${error.message}`);
        }
    }

    _syncConfigFiles(cfg) {
        try {
            const gameDir = path.join(__dirname, '..', '..', '..', '..', 'plugins-dlc', 'minecraft', 'Minecraft');
            const andyPath = path.join(gameDir, 'andy.json');
            const keysPath = path.join(gameDir, 'keys.json');

            // 更新 andy.json
            if (fs.existsSync(andyPath)) {
                const andy = JSON.parse(fs.readFileSync(andyPath, 'utf8'));
                andy.name = cfg.agent_name || andy.name;
                if (cfg.model_name) andy.model.model = cfg.model_name;
                if (cfg.model_url) andy.model.url = cfg.model_url;
                if (cfg.conversing) andy.conversing = cfg.conversing;
                fs.writeFileSync(andyPath, JSON.stringify(andy, null, 4), 'utf8');
                this.context.log('info', '已同步配置到 andy.json');
            }

            // 更新 keys.json
            if (cfg.api_key) {
                let keys = {};
                if (fs.existsSync(keysPath)) {
                    keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
                }
                keys.OPENAI_API_KEY = cfg.api_key;
                fs.writeFileSync(keysPath, JSON.stringify(keys, null, 4), 'utf8');
                this.context.log('info', '已同步 API KEY 到 keys.json');
            }
        } catch (error) {
            this.context.log('error', `同步配置文件失败: ${error.message}`);
        }
    }

    async onUserInput(event) {
        if (!this.socket?.connected) return;

        this.socket.emit('send-message', this.agentName, {
            from: 'VOICE_INPUT',
            message: event.text
        });
        this.context.log('info', `语音输入已发送到 Minecraft: ${event.text}`);
        event.preventDefault();
    }

    async onStop() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
}

module.exports = MinecraftPlugin;
