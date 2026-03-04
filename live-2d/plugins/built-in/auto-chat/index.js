// plugins/built-in/auto-chat/index.js
// 自动对话插件 - Service Plugin
// 包装现有 AutoChatModule，使其以插件形式运行

const { Plugin } = require('../../../js/core/plugin-base.js');
const { AutoChatModule } = require('../../../js/live/auto-chat.js');

class AutoChatPlugin extends Plugin {
    constructor(metadata, context) {
        super(metadata, context);
        this._module = null;
    }

    async onStart() {
        const pluginConfig = this.context.getPluginFileConfig();
        const mainConfig = this.context.getConfig();
        const ttsProcessor = global.ttsProcessor || null;
        this._module = new AutoChatModule(pluginConfig, mainConfig, ttsProcessor);
        global.autoChatModule = this._module;
        this._module.start();
    }

    async onStop() {
        if (this._module) {
            this._module.stop();
            this._module = null;
        }
    }
}

module.exports = AutoChatPlugin;
