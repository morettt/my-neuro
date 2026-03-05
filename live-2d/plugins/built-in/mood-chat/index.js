// plugins/built-in/mood-chat/index.js
const { Plugin } = require('../../../js/core/plugin-base.js');
const { MoodChatModule } = require('../../../js/ai/MoodChatModule.js');

class MoodChatPlugin extends Plugin {
    constructor(metadata, context) {
        super(metadata, context);
        this._module = null;
    }

    async onStart() {
        const pluginConfig = this.context.getPluginFileConfig();
        this._module = new MoodChatModule(pluginConfig);
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
