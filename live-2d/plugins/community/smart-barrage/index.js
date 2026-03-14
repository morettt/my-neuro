// plugins/community/smart-barrage/index.js
//
// 工作方式：
//   - 滑动窗口：每 windowSeconds 秒把收集到的弹幕交给 LLM 过滤一次
//   - LLM 从这批弹幕里挑出最多 maxRespond 条值得回复的，合并成一条消息让 AI 回应
//   - 带 prefixChar（默认 #）前缀的弹幕跳过过滤，立即单独响应
//
// 模式（mode）：
//   smart  — 所有弹幕走 LLM 过滤
//   prefix — 只响应带 # 前缀的弹幕
//   both   — # 前缀立即响应，其余走 LLM 过滤（默认）

const { Plugin } = require('../../../js/core/plugin-base.js');
const { LiveStreamModule } = require('../../../js/live/LiveStreamModule.js');

const SYSTEM_PATCH_ID = 'smart-barrage-context';

class SmartBarragePlugin extends Plugin {

    async onInit() {
        const cfg = this.context.getPluginFileConfig();

        this._roomId        = cfg.roomId        ?? 30230160;
        this._mode          = cfg.mode          ?? 'both';
        this._windowMs      = (cfg.windowSeconds ?? 15) * 1000;
        this._maxRespond    = cfg.maxRespond    ?? 3;
        this._maxBuffer     = cfg.maxBufferSize  ?? 30;
        this._prefixChar    = cfg.prefixChar    ?? '#';
        this._checkInterval = cfg.checkInterval  ?? 5000;

        this._buffer      = [];   // 当前窗口内收集的普通弹幕
        this._windowTimer = null;
        this._liveModule  = null;
    }

    async onStart() {
        // 注入系统提示词，让 AI 知道自己在直播
        this.context.addSystemPromptPatch(SYSTEM_PATCH_ID,
            '你现在正在进行B站直播。你可能会收到来自观众的弹幕消息，' +
            '标记为[直播弹幕]。请自然地与观众互动，就像真正的主播一样。' +
            '带有[点名提问]标记的是观众直接点名提问，优先回应。'
        );

        this._liveModule = new LiveStreamModule({
            roomId:        this._roomId,
            checkInterval: this._checkInterval,
            onNewMessage:  (msg) => this._onBarrage(msg)
        });

        this._liveModule.start();
        this.context.log('info', `智能弹幕已启动 | 房间:${this._roomId} | 模式:${this._mode} | 窗口:${this._windowMs / 1000}s`);
    }

    async onStop() {
        this.context.removeSystemPromptPatch(SYSTEM_PATCH_ID);

        if (this._liveModule) {
            this._liveModule.stop();
            this._liveModule = null;
        }
        if (this._windowTimer) {
            clearTimeout(this._windowTimer);
            this._windowTimer = null;
        }
        this._buffer = [];
    }

    // ===== 弹幕入口 =====

    _onBarrage({ nickname, text }) {
        const hasPrefix = text.startsWith(this._prefixChar);

        // # 前缀弹幕：跳过过滤，立即响应
        if (hasPrefix && (this._mode === 'prefix' || this._mode === 'both')) {
            const clean = text.slice(this._prefixChar.length).trim();
            if (!clean) return;
            this.context.log('info', `[点名] ${nickname}: ${clean}`);
            this.context.sendMessage(
                `[直播弹幕-点名提问] ${nickname} 向你提问：${clean}`
            ).catch(e => this.context.log('error', `sendMessage 失败: ${e.message}`));
            return;
        }

        // prefix-only 模式：其余弹幕直接忽略
        if (this._mode === 'prefix') return;

        // smart / both 模式：加入窗口缓冲
        this._buffer.push({ nickname, text });

        // 超出上限时丢最旧的
        if (this._buffer.length > this._maxBuffer) {
            this._buffer.shift();
        }

        // 第一条进来时启动窗口计时器
        if (!this._windowTimer) {
            this._windowTimer = setTimeout(() => this._flushWindow(), this._windowMs);
        }
    }

    // ===== 窗口到期，过滤并回复 =====

    async _flushWindow() {
        this._windowTimer = null;
        if (this._buffer.length === 0) return;

        const batch = this._buffer.slice();
        this._buffer = [];

        this.context.log('info', `开始过滤弹幕批次，共 ${batch.length} 条`);

        try {
            const selected = await this._filterWithLLM(batch);

            if (selected.length === 0) {
                this.context.log('info', '本批弹幕无值得回复的内容，跳过');
                return;
            }

            const prompt = this._buildPrompt(selected);
            this.context.log('info', `选中 ${selected.length} 条弹幕，发起回复`);
            await this.context.sendMessage(prompt);

        } catch (e) {
            this.context.log('error', `弹幕批次处理失败: ${e.message}`);
        }
    }

    // ===== LLM 过滤 =====

    async _filterWithLLM(batch) {
        const numbered = batch.map((m, i) => `${i + 1}. ${m.nickname}：${m.text}`).join('\n');

        const prompt =
            `你是一个直播间AI主播的助手，负责筛选值得主播回复的弹幕。\n` +
            `以下是直播间最近 ${this._windowMs / 1000} 秒内的弹幕，请从中挑选最多 ${this._maxRespond} 条最值得回复的。\n` +
            `优先选：有实质内容的提问、有趣的评论、值得互动的话题。\n` +
            `忽略：刷屏、无意义的"哈哈哈"、纯表情、重复的问题。\n` +
            `如果整批都没有值得回复的，返回空数组。\n` +
            `只返回选中的序号，JSON数组格式，例如 [1,3] 或 []，不要有其他文字。\n\n` +
            `弹幕列表：\n${numbered}`;

        try {
            const raw = await this.context.callLLM(prompt, { temperature: 0.2 });
            const match = raw.match(/\[[\d,\s]*\]/);
            if (!match) return [];

            const indices = JSON.parse(match[0]);
            return indices
                .filter(i => Number.isInteger(i) && i >= 1 && i <= batch.length)
                .slice(0, this._maxRespond)
                .map(i => batch[i - 1]);

        } catch (e) {
            this.context.log('warn', `LLM过滤调用失败: ${e.message}`);
            return [];
        }
    }

    // ===== 构建发给 AI 的消息 =====

    _buildPrompt(selected) {
        if (selected.length === 1) {
            return `[直播弹幕] ${selected[0].nickname} 说：${selected[0].text}`;
        }
        const lines = selected.map(m => `- ${m.nickname}：${m.text}`).join('\n');
        return `[直播弹幕] 观众们说：\n${lines}`;
    }
}

module.exports = SmartBarragePlugin;
