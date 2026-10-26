const { Plugin } = require('../../../js/core/plugin-base');
const { parseActions, stripMotionTags, BODY_PROMPT } = require('./protocol');
const { MotionService } = require('./service');
const { BodyMotionPlayer, validateMotion } = require('./retarget');
const { RuntimeHooks } = require('./runtime-hooks');

class BodyActionsPlugin extends Plugin {
    async onInit() {
        this.config = this.context.getPluginConfig();
        this.service = new MotionService(this.config, (level, text) => this.context.log(level, text));
        this.epoch = 0;
        this.cache = new Map();
        this.interrupt = () => this.cancel();
        this.context.on('tts:interrupted', this.interrupt);
        this.context.on('llm:error', this.interrupt);
        this.stopped = false;
        this.runtime = new RuntimeHooks(this);
    }

    async onStart() {
        this.runtime?.refresh();
        this.context.log('info', '身体动作插件已启用：回复请求将追加身体动作提示词');
        // Warm the backend without delaying avatar/app initialization.
        this.warming = this.service.ensureReady().catch(error => {
            if (!this.stopped) this.context.log('warn', `动作服务: ${error.message}`);
        });
    }

    adapter() {
        const facade = global.avatarFacade || global.window?.avatar;
        const model = facade?.getModel?.() || global.currentModel;
        return ['vrm', 'mmd'].includes(model?.modelType) && !model._disposed ? model : null;
    }

    async onUserInput() { this.cancel(); }

    async onLLMRequest(request) {
        this.bodyRequest = !this.stopped;
        this.runtime?.beginRequest(this.bodyRequest);
        if (!this.bodyRequest) return;
        const config = this.context.getPluginConfig?.() || this.config;
        const bodyPrompt = typeof config.body_prompt === 'string' && config.body_prompt.trim()
            ? config.body_prompt.trim() : BODY_PROMPT;
        const prompt = bodyPrompt + `\n每次回复最多 ${this.maxActions()} 个动作标签。`
            + (config.extra_prompt ? `\n${config.extra_prompt}` : '');
        // Request-local injection avoids modifying the user's saved persona prompt.
        request.messages.push({ role: 'system', content: prompt });
    }

    maxActions() { return Math.max(1, Math.min(8, Number(this.config.max_actions) || 4)); }

    async onLLMResponse(response) {
        const handle = this.bodyRequest || Boolean(this.adapter());
        this.bodyRequest = false;
        if (!handle) return;
        const parsed = parseActions(response.text, this.maxActions());
        response.text = stripMotionTags(parsed.text).trim();
        if (parsed.rejected.length) this.context.log('warn', `已忽略 ${parsed.rejected.length} 个组合、无效或超量的身体动作`);
        this.cancel();
        this.runtime?.setReply(response.text);
        if (this.stopped || !parsed.actions.length) return;
        if (!this.adapter()) {
            this.context.log('warn', '已收到身体动作标签，但当前没有可播放的 VRM 或 PMX 模型；请等待 3D 模型加载完成');
            return;
        }
        const epoch = this.epoch;
        this.abort = new AbortController();
        this.work = this.run(parsed.actions, epoch, this.abort.signal).catch(error => {
            if (epoch === this.epoch && !this.stopped) this.context.log('warn', `身体动作失败: ${error.message}`);
        });
    }

    async run(actions, epoch, signal) {
        const model = this.adapter();
        for (const action of actions) {
            if (epoch !== this.epoch || signal.aborted || this.adapter() !== model) return;
            let data = this.cache.get(action.toLowerCase());
            if (!data) {
                this.context.log('info', `生成身体动作: ${action}`);
                data = await this.service.generate(action, signal);
                validateMotion(data);
                if (epoch !== this.epoch || signal.aborted || this.adapter() !== model) return;
                if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value);
                this.cache.set(action.toLowerCase(), data);
            }
            if (!this.player || this.player.adapter !== model) this.player = new BodyMotionPlayer(model, this.config.blend_seconds);
            this.context.log('info', `播放身体动作: ${action}`);
            const result = await this.player.play(data);
            if (result.error) throw new Error(result.error);
            if (result.cancelled) return;
        }
    }

    async onTTSText(text) {
        return !this.stopped ? stripMotionTags(parseActions(text, this.maxActions()).text).trim() : text;
    }

    onDisplayText(text) {
        if (this.stopped) return text;
        const userLabel = this.context.getConfig?.()?.subtitle_labels?.user || 'User';
        // User ASR/input subtitles are ordinary text, not the assistant protocol.
        if (String(text).startsWith(`${userLabel}:`)) return text;
        return stripMotionTags(text);
    }

    cancel() {
        this.epoch++;
        this.abort?.abort();
        this.player?.stop('interrupted');
    }

    async onStop() {
        if (this.stopped) return;
        this.stopped = true;
        this.cancel();
        this.runtime?.dispose();
        this.context.off('tts:interrupted', this.interrupt);
        this.context.off('llm:error', this.interrupt);
        this.service.stop();
        this.cache.clear();
    }

    async onDestroy() { await this.onStop(); }
}

module.exports = BodyActionsPlugin;
