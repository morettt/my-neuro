// plugins/built-in/diary/index.js
// AI 日记插件 - Service + Hook Plugin
// 接管 VoiceChatFacade 内部的 DiaryManager，管理定时器
// ASRController 通过 global.diaryManager 访问同一实例

const { Plugin } = require('../../../js/core/plugin-base.js');

class DiaryPlugin extends Plugin {

    async onStart() {
        const config = this.context.getConfig();
        if (!config.ai_diary?.enabled) return;

        const voiceChat = global.voiceChat;
        if (!voiceChat?.diaryManager) {
            this.context.log('warn', 'diaryManager 未就绪，跳过日记插件启动');
            return;
        }

        // 接管 VoiceChatFacade 内部已创建的 DiaryManager 实例
        this._diaryManager = voiceChat.diaryManager;

        // 暴露到 global，供 ASRController.setupASRCallback 使用
        global.diaryManager = this._diaryManager;

        // 启动定时器（VoiceChatFacade 因插件存在已跳过自行启动）
        this._diaryManager.startTimer();
    }

    // TTS 播放结束 = 一次对话完成，重置日记计时器
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
