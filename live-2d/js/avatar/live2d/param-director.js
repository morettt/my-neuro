// param-director.js - Live2D 参数导演（待机微动 + 说话摇摆 + 关键帧编舞）
const fs = require('fs');
const path = require('path');
const { eventBus } = require('../../core/event-bus.js');
const { Events } = require('../../core/events.js');
const { logToTerminal } = require('../../api-utils.js');
const { getAvatarMotionMode, shouldUseParamDirector } = require('../motion-mode.js');
const { vadState } = require('./vad-state.js');
const { FaceMicroMotion } = require('./face-micro-motion.js');
const { resolveMotionStyle } = require('./motion-style-presets.js');
const { IdleActionScheduler } = require('./idle-action-scheduler.js');
const { normalizeDuration } = require('./duration-utils.js');

const APP_ROOT = path.join(__dirname, '..', '..', '..');
const TWO_PI = Math.PI * 2;
const RELEASE_MS = 600;
const CANCEL_RELEASE_MS = 500;
const NO_PROGRESS_FALLBACK_MS = 1500;
const ESTIMATED_CHAR_MS = 210;
// 'idle' 通道为「仅 AI 编舞」档的离散待机动作专用（idle-action-scheduler），blend/legacy 不产生该通道帧
const VALID_TIMELINE_CHANNELS = new Set(['body', 'face', 'default', 'idle']);

const PARAM_WHITELIST = /^(ParamAngle[XYZ]|Param[345]|ParamBodyAngle[XYZ]\d*|ParamEye[LR]Open|ParamEye[LR]Smile|Eye[LR]_Squint|ParamEyeBall[XY]|ParamBrow[LR](Y|X|Angle|Form)|Param(74|100)|ParamCheek|ParamCheeckPuff|ParamMouth(Form|Funnel|PressLipOpen|Shrug|X|PuckerWiden)|ParamJawOpen)$/;
const ANGLE_PARAMS = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ'];
const EYE_CONTROL_PARAMS = new Set(['ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeLSmile', 'ParamEyeRSmile', 'EyeL_Squint', 'EyeR_Squint']);

const NORMAL_IDLE = {
    ParamAngleX: 4,
    ParamAngleY: 3,
    ParamAngleZ: 3,
    ParamBodyAngleX: 2,
    ParamBodyAngleY: 0,
    ParamBodyAngleZ: 1.5
};

const NORMAL_SWAY = {
    ParamAngleX: 6,
    ParamAngleY: 1,
    ParamAngleZ: 9,
    ParamBodyAngleX: 4.2,
    ParamBodyAngleY: 1.2,
    ParamBodyAngleZ: 5.8
};

const INTENSITY_SCALE = {
    subtle: 0.5,
    normal: 1,
    dramatic: 1.6
};

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function easeInOutCubic(t) {
    const x = clamp(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function readParamValue(coreModel, info) {
    try {
        return coreModel.getParameterValueByIndex(info.index);
    } catch (_) {
        return info.default;
    }
}

function writeParamValue(coreModel, info, value) {
    try {
        coreModel.setParameterValueByIndex(info.index, clamp(value, info.min, info.max));
    } catch (_) {}
}

class ParamDirector {
    constructor(config) {
        this.model = null;
        this.coreModel = null;
        this.config = {};
        this.bodyConfig = {};
        this._motionMode = 'blend';

        this._catalog = [];
        this._catalogById = new Map();
        this._visibleCatalog = [];
        this._angleInfos = [];
        this._phase = new Map();

        this._speaking = false;
        this._pendingSpeech = false;
        this._totalChars = 0;
        this._lastProgressChars = 0;
        this._lastProgressAt = 0;
        this._speechStartAt = 0;
        this._timelines = new Map();
        this._energy = 0;
        this._lastVadRuntime = vadState.getState();
        this._faceMicro = new FaceMicroMotion();
        this._faceMicroConfig = { enabled: true, intensity: 1 };
        this._style = null;                    // 仅 director 档：解析后的风格预设
        this._idleScheduler = new IdleActionScheduler();
        this._idleActionsEnabled = false;      // 仅 director 档为 true
        this._vadEnergyAccumMs = 0;

        this._active = new Map();
        this._lastApplied = new Map();

        this._boundTtsStart = () => this._onTtsStart();
        this._boundTtsEnd = () => this.endSpeech();
        this._boundTtsInterrupted = () => this.cancel();
        this._eventsAttached = false;

        this.updateConfig(config);
        this._attachEvents();
    }

    attach(model, coreModel) {
        this.detach(false);
        this.model = model;
        this.coreModel = coreModel;

        if (!coreModel || typeof coreModel.getParameterCount !== 'function') {
            logToTerminal('warn', '[ParamDirector] coreModel 不可用，跳过参数导演');
            return false;
        }

        this._buildCatalog(model, coreModel);
        this._cacheAngleParams();
        if (this._catalog.length === 0 || this._angleInfos.length === 0) {
            logToTerminal('warn', '[ParamDirector] 未找到可驱动的角度参数，跳过参数导演');
            return false;
        }

        this._resetRuntimeState();
        logToTerminal('info', `[ParamDirector] 已启用，参数=${this._catalog.length}，可编舞=${this._visibleCatalog.length}`);
        return true;
    }

    detach(removeEvents = true) {
        if (removeEvents) this._detachEvents();
        this.model = null;
        this.coreModel = null;
        this._catalog = [];
        this._catalogById.clear();
        this._visibleCatalog = [];
        this._angleInfos = [];
        this._phase.clear();
        this._resetRuntimeState();
    }

    updateConfig(config) {
        this.config = config || {};
        this._motionMode = getAvatarMotionMode(this.config);
        if (this._motionMode === 'legacy') {
            this._resetRuntimeState();
        }
        const body = this.config?.ui?.body_motion || {};
        const motion = this.config?.motion_director || {};
        const vadCfg = motion.vad || {};
        const faceMicroCfg = motion.face_micro || {};
        try {
            vadState.configure({
                baseline: vadCfg.baseline || { valence: 0.1, arousal: 0, dominance: 0.05 },
                reactivity: vadCfg.reactivity,
                decay_rate: vadCfg.decay_rate,
                hold_seconds: vadCfg.hold_seconds,
                ambient_drift_strength: vadCfg.ambient_drift_strength
            });
        } catch (_) {}
        this._faceMicroConfig = {
            enabled: faceMicroCfg.enabled !== false,
            intensity: this._positiveNumber(faceMicroCfg.intensity, 1)
        };
        const intensity = INTENSITY_SCALE[body.intensity] ? body.intensity : 'normal';
        const enabled = shouldUseParamDirector(this.config);
        const directorMode = this._motionMode === 'director';
        const audioSwayEnabled = directorMode
            ? body.director_audio_sway_enabled === true
            : body.sway_enabled !== false;
        this.bodyConfig = {
            intensity,
            idle_enabled: enabled && body.idle_enabled !== false,
            director_idle_during_speech: directorMode && body.director_idle_during_speech === true,
            sway_enabled: enabled && audioSwayEnabled,
            idle_amplitude: this._positiveNumber(body.idle_amplitude, 1),
            sway_amplitude: this._positiveNumber(body.sway_amplitude, 1),
            sway_frequency: clamp(Number(body.sway_frequency) || 0.28, 0.12, 0.8),
            sway_modulation: clamp(Number(vadCfg.sway_modulation ?? 0.35), 0, 1)
        };
        this._applyDirectorStyle(directorMode, motion, vadCfg, faceMicroCfg);
    }

    // 仅 director 档：应用风格预设（natural/lively/calm/shy）并装配离散待机动作调度器。
    // blend / legacy 档：_style=null、调度器禁用，上面的旧配置路径原样生效。
    _applyDirectorStyle(directorMode, motion = {}, vadCfg = {}, faceMicroCfg = {}) {
        this._style = null;
        this._idleActionsEnabled = false;
        if (!directorMode) return;

        const style = resolveMotionStyle(this.config);
        this._style = style;
        if (style) {
            // 预设先落，用户显式写在 motion_director.vad 里的散值再覆盖（用户配置优先）
            try {
                vadState.configure(style.vad);
                const explicit = {};
                if (vadCfg.baseline) explicit.baseline = vadCfg.baseline;
                for (const key of ['reactivity', 'decay_rate', 'hold_seconds', 'ambient_drift_strength']) {
                    if (vadCfg[key] !== undefined) explicit[key] = vadCfg[key];
                }
                if (Object.keys(explicit).length > 0) vadState.configure(explicit);
            } catch (_) {}
            const swayScale = this._positiveNumber(style.sway?.amplitude_scale, 1);
            this.bodyConfig.idle_amplitude *= swayScale;
            this.bodyConfig.sway_amplitude *= swayScale;
            if (faceMicroCfg.intensity === undefined) {
                this._faceMicroConfig.intensity = this._positiveNumber(style.face_micro?.intensity, 1);
            }
        }

        const idleActionsCfg = motion.idle_actions || {};
        this._idleActionsEnabled = idleActionsCfg.enabled !== false;
        if (this._idleActionsEnabled) {
            const options = { ...(style?.idle || {}), ...idleActionsCfg };
            const seed = idleActionsCfg.seed ?? style?.seed ?? null;
            this._idleScheduler.configure(options, seed);
        }
    }

    applyFrame(coreModel, now, deltaMs, speechEnergy) {
        if (this._motionMode === 'legacy') return;
        if (!coreModel || this._angleInfos.length === 0) return;

        this._updateEnergy(speechEnergy, deltaMs);
        const vadRuntime = this._updateVad(deltaMs);
        this._accumulateVadEnergy(deltaMs);
        this._applyTimelineFallback(now);
        this._advanceKeyframes(now);
        this._tickIdleActions(now, vadRuntime);

        const t = now / 1000;
        const swayFreq = this.bodyConfig.sway_frequency + 0.035 * Math.sin(TWO_PI * 0.017 * t);
        const bodyGain = this._vadBodyGain();
        const touched = new Set();

        for (const info of this._angleInfos) {
            const cur = readParamValue(coreModel, info);
            const offset = (this._idleOffset(info, t) + this._swayOffset(info, t, swayFreq)) * bodyGain;
            const value = cur + offset;
            this._lastApplied.set(info.id, value);
            touched.add(info.id);
            writeParamValue(coreModel, info, value);
        }

        this._applyFaceMicroOffsets(coreModel, t, vadRuntime, touched);

        for (const state of Array.from(this._active.values())) {
            const info = state.info;
            const base = touched.has(info.id)
                ? this._lastApplied.get(info.id)
                : readParamValue(coreModel, info);
            const w = state.weight;
            const value = base * (1 - w) + state.value * w;
            this._lastApplied.set(info.id, value);
            writeParamValue(coreModel, info, value);
        }
    }

    prepareSpeech(totalChars) {
        if (this._motionMode === 'legacy') return;
        const chars = Math.max(0, Math.floor(Number(totalChars) || 0));
        if (chars <= 0) return;
        this._pendingSpeech = true;
        this._totalChars = chars;
        this._lastProgressChars = 0;
        this._lastProgressAt = 0;
        this._clearTimelines();
    }

    noteSpeechProgress(absChars) {
        if (this._motionMode === 'legacy') return;
        const chars = Math.max(0, Math.floor(Number(absChars) || 0));
        if (chars <= this._lastProgressChars && this._lastProgressAt > 0) return;
        this._lastProgressChars = chars;
        this._lastProgressAt = performance.now();
        this._consumeTimeline(chars / Math.max(1, this._totalChars));
    }

    endSpeech() {
        this._speaking = false;
        this._pendingSpeech = false;
        this._clearTimelines();
        this._totalChars = 0;
        const now = performance.now();
        for (const state of this._active.values()) {
            this._startRelease(state, now, normalizeDuration(state.releaseMs, RELEASE_MS));
        }
    }

    cancel() {
        this._speaking = false;
        this._pendingSpeech = false;
        this._clearTimelines();
        this._totalChars = 0;
        this._energy = 0;
        const now = performance.now();
        for (const state of this._active.values()) {
            this._startRelease(state, now, CANCEL_RELEASE_MS);
        }
        if (this._idleScheduler) this._idleScheduler.interrupt(now);
        // 仅 director 档：被打断的"错愕"——arousal 瞬时小脉冲 + dominance 微降
        if (this._motionMode === 'director') {
            const vadCfg = this.config?.motion_director?.vad || {};
            if (vadCfg.enabled !== false && vadCfg.interrupt_pulse_enabled !== false) {
                try { vadState.nudgeVAD({ arousal: 0.14, dominance: -0.1 }, 1); } catch (_) {}
            }
        }
    }

    loadTimeline(keyframes, totalChars, channel = 'default') {
        if (this._motionMode === 'legacy') return false;
        if (!this._pendingSpeech && !this._speaking) {
            logToTerminal('warn', '[ParamDirector] 收到过期 timeline，已丢弃');
            return false;
        }
        if (!Array.isArray(keyframes) || keyframes.length === 0) return false;
        const timelineChannel = this._normalizeChannel(channel);
        const chars = Math.max(0, Math.floor(Number(totalChars) || this._totalChars || 0));
        if (chars > 0) this._totalChars = chars;
        const timeline = this._normalizeTimelineFrames(keyframes);
        this._timelines.set(timelineChannel, timeline);
        return timeline.length > 0;
    }

    appendTimelineFrames(frames, channel = 'default') {
        if (this._motionMode === 'legacy') return false;
        if (!this._pendingSpeech && !this._speaking) {
            logToTerminal('warn', '[ParamDirector] 收到过期 timeline 追加，已丢弃');
            return false;
        }
        if (!Array.isArray(frames) || frames.length === 0) return false;
        const timelineChannel = this._normalizeChannel(channel);
        const normalized = this._normalizeTimelineFrames(frames);
        if (normalized.length === 0) return false;

        const now = performance.now();
        const frac = this._currentTimelineFrac(now);
        const future = [];
        let dueFrame = null;
        for (const frame of normalized) {
            if (frame.at <= frac) {
                if (!dueFrame || frame.at >= dueFrame.at) dueFrame = frame;
            } else {
                future.push(frame);
            }
        }

        if (future.length > 0) {
            const timeline = this._getTimeline(timelineChannel);
            timeline.push(...future);
            timeline.sort((a, b) => a.at - b.at);
            this._timelines.set(timelineChannel, timeline);
        }
        if (dueFrame) this._startKeyframe(dueFrame, now, timelineChannel);
        return future.length > 0 || !!dueFrame;
    }

    truncateTimeline(channel = 'default', fromAt = 0) {
        const timelineChannel = this._normalizeChannel(channel);
        const timeline = this._getTimeline(timelineChannel);
        if (timeline.length === 0) return 0;
        const threshold = clamp(fromAt, 0, 1);
        const kept = timeline.filter(frame => frame.at < threshold);
        const removed = timeline.length - kept.length;
        this._timelines.set(timelineChannel, kept);
        return removed;
    }

    fireKeyframe(params, transitionMs = 400, holdMs = 1000, channel = 'default') {
        if (this._motionMode === 'legacy') return false;
        if (!params || typeof params !== 'object') return false;
        const frame = {
            params,
            transition_ms: normalizeDuration(transitionMs, 400, { max: 4000 }),
            hold_ms: normalizeDuration(holdMs, 1000, { max: 8000 })
        };
        return this._startKeyframe(frame, performance.now(), this._normalizeChannel(channel));
    }

    isChoreographyActive() {
        if (this._motionMode === 'legacy') return false;
        // 'idle' 通道的离散待机动作不算"编舞进行中"：既不阻断呼吸待机，也不触发调度器自锁。
        // blend 档没有任何 idle 通道帧，此判定与旧实现等价。
        for (const [channel, timeline] of this._timelines.entries()) {
            if (channel !== 'idle' && Array.isArray(timeline) && timeline.length > 0) return true;
        }
        for (const state of this._active.values()) {
            if (state.channel !== 'idle') return true;
        }
        return false;
    }

    isEyeControlled() {
        if (this._motionMode === 'legacy') return false;
        for (const state of this._active.values()) {
            if (state.weight > 0.01 && EYE_CONTROL_PARAMS.has(state.info.id)) return true;
        }
        return false;
    }

    getParamCatalog() {
        return this._visibleCatalog.map(item => ({ ...item }));
    }

    _attachEvents() {
        if (this._eventsAttached) return;
        eventBus.on(Events.TTS_START, this._boundTtsStart);
        eventBus.on(Events.TTS_END, this._boundTtsEnd);
        eventBus.on(Events.TTS_INTERRUPTED, this._boundTtsInterrupted);
        this._eventsAttached = true;
    }

    _detachEvents() {
        if (!this._eventsAttached) return;
        eventBus.off(Events.TTS_START, this._boundTtsStart);
        eventBus.off(Events.TTS_END, this._boundTtsEnd);
        eventBus.off(Events.TTS_INTERRUPTED, this._boundTtsInterrupted);
        this._eventsAttached = false;
    }

    _onTtsStart() {
        this._speaking = true;
        this._pendingSpeech = false;
        this._speechStartAt = performance.now();
        this._lastProgressAt = 0;
        this._lastProgressChars = 0;
        this._interruptIdleActions(260);
    }

    // 语音/编舞开始时：清空调度器待发步骤，并把 idle 通道在演的动作 260ms 内快速淡出
    _interruptIdleActions(fadeMs = 260) {
        const now = performance.now();
        if (this._idleScheduler) this._idleScheduler.interrupt(now);
        for (const state of this._active.values()) {
            if (state.channel === 'idle' && state.phase !== 'release') {
                this._startRelease(state, now, clamp(fadeMs, 80, 600));
            }
        }
    }

    // 仅 director 档：驱动离散待机动作调度器
    _tickIdleActions(now, vadRuntime) {
        if (this._motionMode !== 'director' || !this._idleActionsEnabled || !this._idleScheduler) return;
        const busy = this._speaking || this._pendingSpeech || this._hasNonIdleActivity();
        this._idleScheduler.tick(now, {
            active: !busy,
            vad: (vadRuntime || this._lastVadRuntime || {}).current || {},
            fire: (frame) => this._playIdleFrame(frame)
        });
    }

    _playIdleFrame(frame) {
        const normalized = this._normalizeTimelineFrames([frame]);
        if (normalized.length === 0) return false;
        return this._startKeyframe(normalized[0], performance.now(), 'idle');
    }

    _hasNonIdleActivity() {
        for (const [channel, timeline] of this._timelines.entries()) {
            if (channel !== 'idle' && Array.isArray(timeline) && timeline.length > 0) return true;
        }
        for (const state of this._active.values()) {
            if (state.channel !== 'idle' && state.weight > 0.01) return true;
        }
        return false;
    }

    // 仅 director 档：说话能量持续小幅推 arousal（VAD 第二输入源）
    _accumulateVadEnergy(deltaMs) {
        if (this._motionMode !== 'director') return;
        const vadCfg = this.config?.motion_director?.vad || {};
        if (vadCfg.enabled === false || vadCfg.energy_input_enabled === false) return;
        if (!this._speaking || this._energy <= 0.02) {
            this._vadEnergyAccumMs = 0;
            return;
        }
        this._vadEnergyAccumMs += Math.max(1, deltaMs || 16.6);
        if (this._vadEnergyAccumMs < 500) return;
        this._vadEnergyAccumMs = 0;
        const gain = clamp(Number(vadCfg.energy_arousal_gain ?? 0.05), 0, 0.5);
        if (gain <= 0) return;
        try { vadState.nudgeVAD({ arousal: this._energy * gain }, 0.5); } catch (_) {}
    }

    _resetRuntimeState() {
        this._speaking = false;
        this._pendingSpeech = false;
        this._totalChars = 0;
        this._lastProgressChars = 0;
        this._lastProgressAt = 0;
        this._speechStartAt = 0;
        this._clearTimelines();
        this._energy = 0;
        this._active.clear();
        this._lastApplied.clear();
        if (this._faceMicro) this._faceMicro.reset();
    }

    _buildCatalog(model, coreModel) {
        this._catalog = [];
        this._catalogById.clear();
        const names = this._readDisplayNames(model);
        const count = coreModel.getParameterCount();

        for (let i = 0; i < count; i++) {
            const id = this._getParamId(coreModel, i);
            if (!id) continue;
            const min = this._getParamBound(coreModel, i, 'min');
            const max = this._getParamBound(coreModel, i, 'max');
            const def = this._getParamBound(coreModel, i, 'default');
            const info = {
                id,
                index: i,
                min: Number.isFinite(min) ? min : -30,
                max: Number.isFinite(max) ? max : 30,
                default: Number.isFinite(def) ? def : 0,
                name: names[id] || ''
            };
            if (info.max < info.min) {
                const tmp = info.max;
                info.max = info.min;
                info.min = tmp;
            }
            this._catalog.push(info);
            this._catalogById.set(id, info);
        }

        this._visibleCatalog = this._catalog
            .filter(info => info.id !== 'ParamMouthOpenY' && PARAM_WHITELIST.test(info.id))
            .map(info => ({
                id: info.id,
                name: info.name,
                min: info.min,
                max: info.max,
                default: info.default
            }));
    }

    _cacheAngleParams() {
        this._angleInfos = [];
        for (const id of ANGLE_PARAMS) {
            const info = this._catalogById.get(id);
            if (!info) continue;
            this._angleInfos.push(info);
            this._phase.set(id, {
                p1: Math.random() * TWO_PI,
                p2: Math.random() * TWO_PI,
                f1: 0.065 + Math.random() * 0.015,
                f2: 0.107 + Math.random() * 0.019
            });
        }
    }

    _readDisplayNames(model) {
        const result = {};
        const displayInfo = this._resolveDisplayInfoPath(model);
        if (!displayInfo) return result;
        try {
            const json = JSON.parse(fs.readFileSync(displayInfo, 'utf8'));
            const groups = Array.isArray(json.Parameters) ? json.Parameters : [];
            for (const item of groups) {
                if (item?.Id && item?.Name) result[item.Id] = item.Name;
            }
        } catch (_) {}
        return result;
    }

    _resolveDisplayInfoPath(model) {
        try {
            const settings = model?.internalModel?.settings;
            const displayInfo = settings?.json?.FileReferences?.DisplayInfo || settings?.FileReferences?.DisplayInfo;
            if (!displayInfo) return null;
            const rawUrl = String(settings?.url || '');
            const decoded = decodeURIComponent(rawUrl).replace(/^\/?live-2d\//, '').replace(/^\/+/, '');
            const modelJsonPath = path.isAbsolute(decoded) ? decoded : path.join(APP_ROOT, decoded);
            const baseDir = path.dirname(modelJsonPath);
            const fullPath = path.join(baseDir, String(displayInfo).replace(/\//g, path.sep));
            return fs.existsSync(fullPath) ? fullPath : null;
        } catch (_) {
            return null;
        }
    }

    _getParamId(coreModel, index) {
        try {
            if (typeof coreModel.getParameterId === 'function') return coreModel.getParameterId(index);
        } catch (_) {}
        try {
            return coreModel._model?.parameters?.ids?.[index] || null;
        } catch (_) {
            return null;
        }
    }

    _getParamBound(coreModel, index, kind) {
        const field = kind === 'min' ? 'minimumValues' : kind === 'max' ? 'maximumValues' : 'defaultValues';
        try {
            const value = coreModel._model?.parameters?.[field]?.[index];
            if (Number.isFinite(Number(value))) return Number(value);
        } catch (_) {}

        const method = kind === 'min'
            ? 'getParameterMinimumValue'
            : kind === 'max'
                ? 'getParameterMaximumValue'
                : 'getParameterDefaultValue';
        try {
            if (typeof coreModel[method] === 'function') {
                const value = coreModel[method](index);
                if (Number.isFinite(Number(value))) return Number(value);
            }
        } catch (_) {}
        return NaN;
    }

    _positiveNumber(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
    }

    _amplitude(info, table, multiplier) {
        const raw = (table[info.id] || 0) * multiplier;
        if (!raw) return 0;
        const rangeCap = Math.max(Math.abs(info.min), Math.abs(info.max));
        return rangeCap > 0 && rangeCap < 10 ? Math.min(raw, rangeCap * 0.8) : raw;
    }

    _idleOffset(info, t) {
        if (!this.bodyConfig.idle_enabled) return 0;
        if (this._motionMode === 'director' && !this.bodyConfig.director_idle_during_speech && this.isChoreographyActive()) return 0;
        const phase = this._phase.get(info.id);
        if (!phase) return 0;
        const scale = INTENSITY_SCALE[this.bodyConfig.intensity] * this.bodyConfig.idle_amplitude;
        const amp = this._amplitude(info, NORMAL_IDLE, scale);
        if (!amp) return 0;
        const noise = 0.6 * Math.sin(TWO_PI * phase.f1 * t + phase.p1) +
            0.4 * Math.sin(TWO_PI * phase.f2 * t + phase.p2);
        return amp * noise;
    }

    _swayOffset(info, t, swayFreq) {
        if (!this.bodyConfig.sway_enabled) return 0;
        const scale = INTENSITY_SCALE[this.bodyConfig.intensity] * this.bodyConfig.sway_amplitude;
        const amp = this._amplitude(info, NORMAL_SWAY, scale);
        if (!amp || this._energy <= 0.001) return 0;

        switch (info.id) {
            case 'ParamAngleZ':
                return this._energy * amp * Math.sin(TWO_PI * swayFreq * t);
            case 'ParamAngleX':
                return this._energy * amp * Math.sin(TWO_PI * swayFreq * 0.7 * t + 1.1);
            case 'ParamBodyAngleZ':
                return this._energy * amp * Math.sin(TWO_PI * swayFreq * t - 0.55);
            case 'ParamBodyAngleX':
                return this._energy * amp * Math.sin(TWO_PI * swayFreq * 0.7 * t + 0.6);
            case 'ParamBodyAngleY':
                return this._energy * amp * Math.sin(TWO_PI * swayFreq * 0.55 * t - 0.4);
            default:
                return 0;
        }
    }

    _updateEnergy(speechEnergy, deltaMs) {
        const target = this._speaking ? clamp(speechEnergy || 0, 0, 1.5) / 1.5 : 0;
        const tau = target > this._energy ? 200 : 800;
        const alpha = 1 - Math.exp(-Math.max(1, deltaMs || 16.6) / tau);
        this._energy += (target - this._energy) * alpha;
        if (this._energy < 0.001) this._energy = 0;
    }

    _normalizeChannel(channel) {
        const value = String(channel || 'default').trim();
        return VALID_TIMELINE_CHANNELS.has(value) ? value : 'default';
    }

    _clearTimelines() {
        this._timelines = new Map();
    }

    _getTimeline(channel) {
        const timeline = this._timelines.get(channel);
        return Array.isArray(timeline) ? timeline : [];
    }

    _hasQueuedTimelineFrames() {
        for (const timeline of this._timelines.values()) {
            if (Array.isArray(timeline) && timeline.length > 0) return true;
        }
        return false;
    }

    _normalizeTimelineFrames(keyframes) {
        return (Array.isArray(keyframes) ? keyframes : [])
            .map(frame => ({
                at: clamp(frame.at, 0, 1),
                params: frame.params || {},
                transition_ms: normalizeDuration(frame.transition_ms, 400),
                hold_ms: normalizeDuration(frame.hold_ms, 800),
                release_ms: normalizeDuration(frame.release_ms, RELEASE_MS),
                sticky: frame.sticky === true,
                release_params: Array.isArray(frame.release_params) ? frame.release_params.map(String) : [],
                hold_group: typeof frame.hold_group === 'string' ? frame.hold_group.trim() : '',
                param_timing: this._normalizeParamTiming(frame.param_timing)
            }))
            .filter(frame => frame.params && Object.keys(frame.params).length > 0)
            .sort((a, b) => a.at - b.at);
    }

    _currentTimelineFrac(now = performance.now()) {
        if (this._totalChars <= 0) return 0;
        if (this._lastProgressChars > 0) {
            return clamp(this._lastProgressChars / Math.max(1, this._totalChars), 0, 1);
        }
        if (this._speaking && this._speechStartAt > 0 && now - this._speechStartAt >= NO_PROGRESS_FALLBACK_MS) {
            return clamp((now - this._speechStartAt) / Math.max(1, this._totalChars * this._estimatedCharMs()), 0, 1);
        }
        return 0;
    }

    // 估算语速（无进度回报时的时钟推进用）。仅 director 档允许通过
    // motion_director.estimated_char_ms 调整（如字节流式 TTS 语速偏快/偏慢时校准）；blend 档恒为 210。
    _estimatedCharMs() {
        if (this._motionMode !== 'director') return ESTIMATED_CHAR_MS;
        const value = Number(this.config?.motion_director?.estimated_char_ms);
        return Number.isFinite(value) && value >= 60 && value <= 600 ? value : ESTIMATED_CHAR_MS;
    }

    _updateVad(deltaMs) {
        if (this.config?.motion_director?.vad?.enabled === false) return null;
        try {
            const runtime = vadState.update(Math.max(1, deltaMs || 16.6) / 1000);
            this._lastVadRuntime = runtime;
            return runtime;
        } catch (_) {
            return this._lastVadRuntime;
        }
    }

    _vadBodyGain() {
        const arousal = Number(this._lastVadRuntime?.current?.arousal) || 0;
        const modulation = Number(this.bodyConfig?.sway_modulation) || 0;
        return clamp(1 + modulation * Math.max(0, arousal), 1, 1.4);
    }

    _applyFaceMicroOffsets(coreModel, timeSeconds, vadRuntime, touched) {
        if (!this._faceMicroConfig.enabled || this.config?.motion_director?.vad?.enabled === false) return;
        if (!this._faceMicro || !vadRuntime) return;
        const directorMode = this._motionMode === 'director';
        const motionCfg = this.config?.motion_director || {};
        const offsets = this._faceMicro.compute({
            timeSeconds,
            vadState: vadRuntime,
            catalogById: this._catalogById,
            speaking: this._speaking,
            intensity: this._faceMicroConfig.intensity,
            // 仅 director 档传入（undefined = face-micro 旧行为，blend 档不变）：
            mouthFormScale: directorMode
                ? clamp(Number(motionCfg.face?.mouth_form_speech_scale ?? motionCfg.mouth_form_speech_scale ?? 0.5), 0, 1)
                : undefined,
            gazeStability: directorMode && this._style ? Number(this._style.gaze?.stability) : undefined,
            activeWeight: (id) => Math.max(
                this._activeWeightForParam(id),
                Number(global.auDriver?.activeWeightForParam?.(id)) || 0
            )
        });
        for (const [id, offset] of Object.entries(offsets || {})) {
            const info = this._catalogById.get(id);
            if (!info) continue;
            const base = touched.has(id)
                ? this._lastApplied.get(id)
                : readParamValue(coreModel, info);
            const value = clamp(base + Number(offset), info.min, info.max);
            this._lastApplied.set(id, value);
            touched.add(id);
            writeParamValue(coreModel, info, value);
        }
    }

    _activeWeightForParam(id, channel = null) {
        const state = this._active.get(id);
        if (!state || state.phase === 'release') return 0;
        if (channel && state.channel !== channel) return 0;
        return clamp(state.weight || 0, 0, 1);
    }

    _applyTimelineFallback(now) {
        if (!this._speaking || !this._hasQueuedTimelineFrames() || this._totalChars <= 0) return;
        if (this._lastProgressAt > 0) return;
        if (now - this._speechStartAt < NO_PROGRESS_FALLBACK_MS) return;
        const frac = (now - this._speechStartAt) / Math.max(1, this._totalChars * this._estimatedCharMs());
        this._consumeTimeline(frac);
    }

    _consumeTimeline(frac) {
        if (!this._hasQueuedTimelineFrames()) return;
        const at = clamp(frac, 0, 1);
        for (const [channel, timeline] of Array.from(this._timelines.entries())) {
            if (!Array.isArray(timeline) || timeline.length === 0) continue;
            let index = -1;
            for (let i = 0; i < timeline.length; i++) {
                if (timeline[i].at <= at) index = i;
                else break;
            }
            if (index < 0) continue;
            const frame = timeline[index];
            timeline.splice(0, index + 1);
            this._timelines.set(channel, timeline);
            this._startKeyframe(frame, performance.now(), channel);
        }
    }

    _startKeyframe(frame, now, channel = 'default') {
        const timelineChannel = this._normalizeChannel(channel);
        let changed = false;
        const entries = Object.entries(frame.params || {})
            .filter(([id]) => this._catalogById.has(id));
        if (entries.length === 0) return false;

        const incomingIds = new Set(entries.map(([id]) => id));
        const releaseParamIds = new Set(Array.isArray(frame.release_params) ? frame.release_params.map(String) : []);
        for (const [id, state] of this._active.entries()) {
            const shouldRelease = timelineChannel === 'default' || state.channel === timelineChannel;
            const protectedGroup = !!state.holdGroup;
            if (shouldRelease && !protectedGroup && !incomingIds.has(id) && state.phase !== 'release') {
                this._startRelease(state, now, normalizeDuration(state.releaseMs, RELEASE_MS));
            }
        }

        for (const [id, rawValue] of entries) {
            const info = this._catalogById.get(id);
            const target = clamp(rawValue, info.min, info.max);
            const existing = this._active.get(id);
            const current = existing
                ? existing.value
                : readParamValue(this.coreModel, info);
            const timing = frame.param_timing?.[id] || {};
            const transitionMs = normalizeDuration(timing.transition_ms, frame.transition_ms ?? 400);
            const holdMs = normalizeDuration(timing.hold_ms, frame.hold_ms ?? 800);
            const releaseMs = normalizeDuration(timing.release_ms, frame.release_ms ?? RELEASE_MS);
            const sticky = timing.sticky === true
                ? true
                : timing.sticky === false
                    ? false
                    : frame.sticky === true && !releaseParamIds.has(id);
            this._active.set(id, {
                info,
                target,
                from: current,
                value: current,
                weight: existing ? existing.weight : 0,
                fromWeight: existing ? existing.weight : 0,
                phase: 'transition',
                phaseStart: now,
                transitionMs,
                holdMs,
                releaseMs,
                sticky,
                channel: timelineChannel,
                holdGroup: timing.hold_group || frame.hold_group || ''
            });
            changed = true;
        }
        return changed;
    }

    _advanceKeyframes(now) {
        for (const [id, state] of Array.from(this._active.entries())) {
            if (state.phase === 'transition') {
                if (state.transitionMs <= 0) {
                    state.phase = 'hold';
                    state.phaseStart = now;
                    state.weight = 1;
                    state.value = state.target;
                    continue;
                }
                const p = easeInOutCubic((now - state.phaseStart) / state.transitionMs);
                state.weight = state.fromWeight + (1 - state.fromWeight) * p;
                state.value = state.from + (state.target - state.from) * p;
                if (p >= 1) {
                    state.phase = 'hold';
                    state.phaseStart = now;
                    state.weight = 1;
                    state.value = state.target;
                }
            }
            if (state.phase === 'hold') {
                state.weight = 1;
                state.value = state.target;
                if (!state.sticky && now - state.phaseStart >= state.holdMs) {
                    this._startRelease(state, now, normalizeDuration(state.releaseMs, RELEASE_MS));
                }
            }
            if (state.phase === 'release') {
                if (state.releaseMs <= 0) {
                    state.weight = 0;
                    this._active.delete(id);
                    continue;
                }
                const p = easeInOutCubic((now - state.phaseStart) / state.releaseMs);
                state.weight = state.releaseFromWeight * (1 - p);
                state.value = state.releaseValue;
                if (p >= 1 || state.weight <= 0.001) {
                    this._active.delete(id);
                }
            }
        }
    }

    _startRelease(state, now, releaseMs) {
        state.phase = 'release';
        state.phaseStart = now;
        state.releaseMs = normalizeDuration(releaseMs, RELEASE_MS);
        state.releaseFromWeight = Number.isFinite(Number(state.weight)) ? Number(state.weight) : 1;
        state.releaseValue = state.value;
    }

    _normalizeParamTiming(raw) {
        if (!raw || typeof raw !== 'object') return {};
        const result = {};
        for (const [id, timing] of Object.entries(raw)) {
            if (!this._catalogById.has(id) || !timing || typeof timing !== 'object') continue;
            const normalized = {};
            for (const key of ['transition_ms', 'hold_ms', 'release_ms']) {
                if (timing[key] === undefined || timing[key] === null) continue;
                if (typeof timing[key] === 'string' && timing[key].trim() === '') continue;
                const value = Number(timing[key]);
                if (Number.isFinite(value)) normalized[key] = Math.max(0, value);
            }
            if (timing.sticky === true || timing.sticky === false) normalized.sticky = timing.sticky;
            if (typeof timing.hold_group === 'string' && timing.hold_group.trim()) normalized.hold_group = timing.hold_group.trim();
            if (Object.keys(normalized).length > 0) result[id] = normalized;
        }
        return result;
    }
}

module.exports = { ParamDirector };
