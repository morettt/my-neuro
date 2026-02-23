// plugins/built-in/mood-chat/index.js
// 心情对话系统插件 - Service Plugin
// 包装现有 MoodChatModule，使其以插件形式运行

const { Plugin } = require('../../../js/core/plugin-base.js');
const { MoodChatModule } = require('../../../js/ai/MoodChatModule.js');

class MoodChatPlugin extends Plugin {
    constructor(metadata, context) {
        super(metadata, context);
        this._module = null;
    }

    async onStart() {
        const config = this.context.getConfig();
        this._module = new MoodChatModule(config);
        global.moodChatModule = this._module;
        this._module.start();
    }

    async onStop() {
        if (this._module) {
            this._module.stop();
            this._module = null;
        }
    }
}

module.exports = MoodChatPlugin;
