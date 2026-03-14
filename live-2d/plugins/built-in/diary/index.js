// plugins/built-in/diary/index.js
const { Plugin } = require('../../../js/core/plugin-base.js');

class DiaryPlugin extends Plugin {

    async onStart() {
        const pluginConfig = this.context.getPluginFileConfig();
        const voiceChat = global.voiceChat;
        if (!voiceChat?.diaryManager) {
            this.context.log('warn', 'diaryManager 未就绪，跳过日记插件启动');
            return;
        }

        this._diaryManager = voiceChat.diaryManager;

        // 用 plugin_config.json 里的值覆盖 DiaryManager 的配置
        this._diaryManager.aiDiaryEnabled = true;
        this._diaryManager.aiDiaryIdleTime = pluginConfig.idle_time ?? 20000;
        this._diaryManager.aiDiaryFile     = pluginConfig.diary_file ?? 'AI记录室/AI日记.txt';
        this._diaryManager.aiDiaryPrompt   = pluginConfig.prompt ?? '';

        global.diaryManager = this._diaryManager;
        this._diaryManager.startTimer();
    }

    async onTTSEnd() {
        if (this._diaryManager) {
            this._diaryManager.resetTimer();
        }
    }

    async onStop() {
        if (this._diaryManager?.diaryTimer) {
            clearTimeout(this._diaryManager.diaryTimer);
            this._diaryManager.diaryTimer = null;
        }
        global.diaryManager = null;
    }
}

module.exports = DiaryPlugin;
