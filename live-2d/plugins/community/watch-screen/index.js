const { Plugin } = require('../../../js/core/plugin-base.js');

const PATCH_ID_PASSIVE = 'watch-screen-passive';
const PATCH_ID_ACTIVE  = 'watch-screen-active';

class WatchScreenPlugin extends Plugin {

    async onInit() {
        const cfg = this.context.getPluginFileConfig();

        this._captureInterval = cfg.captureInterval ?? 2000;
        this._maxFrames       = cfg.maxFrames   ?? 5;
        this._passiveMode     = cfg.passiveMode ?? true;
        this._activeMode      = cfg.activeMode  ?? true;

        this._frames       = [];
        this._captureTimer = null;
        this._isReacting   = false;
        this._ipc          = null;
    }

    async onStart() {
        try {
            this._ipc = require('electron').ipcRenderer;
        } catch (e) {
            this.context.log('error', '无法加载 ipcRenderer');
            return;
        }

        if (this._passiveMode) {
            this.context.addSystemPromptPatch(PATCH_ID_PASSIVE,
                '用户和你说话时，消息里会附带他当前屏幕的截图，你可以结合画面内容来回应，就像你一直在旁边看着一样。'
            );
        }

        if (this._activeMode) {
            this.context.addSystemPromptPatch(PATCH_ID_ACTIVE,
                '有时你会收到一组连续的屏幕截图，那是你在主动观察用户的屏幕。根据画面内容自然地做出反应，就像你真的在旁边一起看一样。如果画面很无聊或者是桌面就不用说话。'
            );
        }

        await this._captureAndCheck().catch(() => {});
        this._captureTimer = setInterval(
            () => this._captureAndCheck().catch(() => {}),
            this._captureInterval
        );

        this.context.log('info', `看视频插件已启动 | 截图间隔:${this._captureInterval}ms`);
    }

    async onStop() {
        this.context.removeSystemPromptPatch(PATCH_ID_PASSIVE);
        this.context.removeSystemPromptPatch(PATCH_ID_ACTIVE);
        if (this._captureTimer) { clearInterval(this._captureTimer); this._captureTimer = null; }
        this._frames = [];
    }

    async _captureAndCheck() {
        const base64 = await this._ipc.invoke('take-screenshot');
        this._frames.push({ base64, ts: Date.now() });

        if (this._frames.length < this._maxFrames) return;

        if (!this._activeMode || this._isReacting) {
            this._frames = [];
            return;
        }

        try {
            const { appState } = require('../../../js/core/app-state.js');
            if (appState.isPlayingTTS()) {
                this._frames = [];
                return;
            }
        } catch (_) {}

        const pictures = this._frames.slice();
        this._frames = [];

        // 清理上一轮消息里的图片，只保留文本
        const messages = this.context.getMessages();
        for (const msg of messages) {
            if (msg.role === 'user' && Array.isArray(msg.content)) {
                msg.content = msg.content.filter(p => p.type !== 'image_url');
            }
        }

        this._tryReact(pictures).catch(() => {});
    }

    async _tryReact(pictures) {
        this._isReacting = true;
        try {
            this.context.log('info', `主动观察屏幕，发送 ${pictures.length} 张图片给 AI`);
            await this.context.sendMessage([
                { type: 'text', text: '（屏幕截图）' },
                ...pictures.map(f => ({
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${f.base64}`, detail: 'low' }
                }))
            ]);
        } finally {
            this._isReacting = false;
        }
    }

    async onLLMRequest(request) {
        if (!this._passiveMode || this._frames.length === 0) return;

        const messages = request.messages;

        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role !== 'user') continue;
            if (Array.isArray(messages[i].content)) return;

            const text = messages[i].content ?? '';
            messages[i] = {
                ...messages[i],
                content: [
                    { type: 'text', text: String(text) },
                    ...this._frames.map(f => ({
                        type: 'image_url',
                        image_url: { url: `data:image/jpeg;base64,${f.base64}`, detail: 'low' }
                    }))
                ]
            };
            return;
        }
    }
}

module.exports = WatchScreenPlugin;
