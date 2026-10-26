const { Plugin } = require('../../../js/core/plugin-base');
const { parseActions, isSingleAction, stripMotionTags, BODY_PROMPT } = require('./protocol');
const { MotionService } = require('./service');
const { BodyMotionPlayer, validateMotion } = require('./retarget');
const { RuntimeHooks } = require('./runtime-hooks');
const THREE = require('three');

class BodyActionsPlugin extends Plugin {
    async onInit() {
        this.config = this.context.getPluginConfig();
        this.service = new MotionService(this.config, (level, text) => this.context.log(level, text));
        this.epoch = 0;
        this.cache = new Map();
        this.timeline = [];
        this.motionQueue = [];
        this.motionPlaying = false;
        this.onSpeechProgress = ({ position } = {}) => this.advanceSpeech(position);
        this.context.on('tts:text:progress', this.onSpeechProgress);
        this.interrupt = () => this.cancel();
        this.context.on('tts:interrupted', this.interrupt);
        this.context.on('llm:error', this.interrupt);
        this.stopped = false;
        this.runtime = new RuntimeHooks(this);
        this.idleStates = new WeakMap();
        this.idleTime = 0;
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

    updateIdle(model, delta) {
        const vrm = model?.vrm;
        const humanoid = vrm?.humanoid;
        if (!humanoid || model._disposed) return;
        const names = ['hips', 'spine', 'chest', 'leftUpperArm', 'rightUpperArm'];
        const bones = Object.fromEntries(names.map(name => [name, humanoid.getNormalizedBoneNode(name)]).filter(([, bone]) => bone));
        if (!bones.hips) return;
        let state = this.idleStates.get(model);
        if (!state) {
            state = { bones: {}, time: 0 };
            for (const [name, bone] of Object.entries(bones)) state.bones[name] = { position: bone.position.clone(), quaternion: bone.quaternion.clone() };
            this.idleStates.set(model, state);
        }
        state.time += Math.min(Math.max(Number(delta) || 0, 0), 0.1);
        const t = state.time;
        const breath = Math.sin(t * 1.25) * 0.006;
        const sway = Math.sin(t * 0.7) * 0.035;
        const shoulder = Math.sin(t * 1.1 + 0.8) * 0.025;
        const apply = (name, axis, angle) => {
            const bone = bones[name], base = state.bones[name];
            if (!bone || !base) return;
            bone.quaternion.copy(base.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
        };
        bones.hips.position.copy(state.bones.hips.position).setY(state.bones.hips.position.y + breath);
        apply('spine', new THREE.Vector3(0, 0, 1), sway);
        apply('chest', new THREE.Vector3(0, 0, 1), sway * 0.55);
        apply('leftUpperArm', new THREE.Vector3(0, 0, 1), shoulder);
        apply('rightUpperArm', new THREE.Vector3(0, 0, 1), shoulder);
    }

    async onLLMResponse(response) {
        const handle = this.bodyRequest || Boolean(this.adapter());
        this.bodyRequest = false;
        if (!handle) return;
        const originalText = String(response.text || '');
        const parsed = parseActions(originalText, this.maxActions());
        this.cancel();
        this.timeline = [];
        let offset = 0;
        for (const match of originalText.matchAll(/\[([^\[\]]*)\]/g)) {
            const action = match[1].trim();
            if (isSingleAction(action) && this.timeline.length < this.maxActions()) {
                this.timeline.push({ action: action.replace(/[.!]$/, ''), position: stripMotionTags(originalText.slice(0, match.index)).length, started: false });
            }
            offset = match.index + match[0].length;
        }
        response.text = stripMotionTags(parsed.text).trim();
        if (parsed.rejected.length) this.context.log('warn', `已忽略 ${parsed.rejected.length} 个组合、无效或超量的身体动作`);
        this.runtime?.setReply(response.text);
        if (this.stopped || !parsed.actions.length) return;
        if (!this.adapter()) {
            this.context.log('warn', '已收到身体动作标签，但当前没有可播放的 VRM 或 PMX 模型；请等待 3D 模型加载完成');
            return;
        }
        this.abort = new AbortController();
        for (const item of this.timeline) item.promise = this.generate(item.action, this.abort.signal);
        this.work = Promise.all(this.timeline.map(item => item.promise)).catch(() => []);
    }

    async generate(action, signal) {
        const key = action.toLowerCase();
        if (this.cache.has(key)) return this.cache.get(key);
        this.context.log('info', `生成身体动作: ${action}`);
        const data = await this.service.generate(action, signal);
        if (signal?.aborted) throw new Error('动作请求已取消');
        validateMotion(data);
        if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, data);
        return data;
    }

    advanceSpeech(position = 0) {
        if (this.stopped || !Number.isFinite(position)) return;
        for (const item of this.timeline) {
            if (!item.started && position >= item.position) {
                item.started = true;
                this.motionQueue.push(item);
            }
        }
        this.drainMotionQueue();
    }

    async drainMotionQueue() {
        if (this.motionPlaying || this.stopped) return;
        const item = this.motionQueue.shift();
        const model = this.adapter();
        if (!item || !model) return;
        this.motionPlaying = true;
        try {
            const data = await item.promise;
            if (this.stopped || this.adapter() !== model) return;
            if (!this.player || this.player.adapter !== model) this.player = new BodyMotionPlayer(model, this.config.blend_seconds);
            await this.player.play(data);
        } catch (error) {
            if (!this.stopped) this.context.log('warn', `身体动作失败: ${error.message}`);
        } finally {
            this.motionPlaying = false;
            this.drainMotionQueue();
        }
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
        this.timeline = [];
        this.motionQueue = [];
        this.motionPlaying = false;
    }

    async onStop() {
        if (this.stopped) return;
        this.stopped = true;
        this.cancel();
        this.runtime?.dispose();
        this.context.off('tts:interrupted', this.interrupt);
        this.context.off('llm:error', this.interrupt);
        this.context.off('tts:text:progress', this.onSpeechProgress);
        this.service.stop();
        this.cache.clear();
    }

    async onDestroy() { await this.onStop(); }
}

module.exports = BodyActionsPlugin;
