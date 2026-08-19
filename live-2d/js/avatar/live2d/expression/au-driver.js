'use strict';

const { eventBus } = require('../../../core/event-bus.js');
const { Events } = require('../../../core/events.js');
const { logToTerminal } = require('../../../api-utils.js');
const {
    Live2DSemanticAdapter,
    LIVE2D_MOUTH_OPEN_PARAMS,
    LIVE2D_MOUTH_FALLBACK_PARAMS
} = require('./semantic-actions.js');
const {
    EmotionKind,
    emotionKindFromTag,
    buildExpressionRuntime
} = require('./expression-units.js');
const { ExpressionHistory, ExpressionSolver } = require('./expression-solver.js');

const EYE_LID_PARAM_PATTERN = /(?:ParamEye[LR]Open|PARAM_EYE_[LR]_OPEN|ParamEyeWide[LR]?|ParamEye[LR]Wide|PARAM_EYE_[LR]_WIDE|Eye[LR]_Squint|EyeWide)/;
const MOUTH_OPEN_PARAM_IDS = new Set([
    ...LIVE2D_MOUTH_OPEN_PARAMS,
    ...LIVE2D_MOUTH_FALLBACK_PARAMS
]);
const EXTERNAL_DRIVE_EPSILON = 1e-4;

class AuDriver {
    constructor(model, config = {}) {
        this.model = model;
        this.coreModel = model?.internalModel?.coreModel || null;
        this.config = config || {};
        this.adapter = new Live2DSemanticAdapter(this.model, this.coreModel);
        this.solver = null;
        this.expressionRuntime = null;
        this.emotionEngine = null;
        this.states = new Map();
        this.activeNative = { expression: [], motion: [] };
        this._triggeredAt = 0;
        this._releaseTimer = null;
        this._eventsAttached = false;
        this._boundRelease = () => this.release();
        this._attachEvents();
    }

    setEmotionEngine(emotionEngine) {
        this.emotionEngine = emotionEngine || null;
        if (!this.emotionEngine || !this.coreModel) return false;

        const runtime = buildExpressionRuntime({
            modelDir: this.emotionEngine.getModelAssetRoot?.(),
            motionConfig: this.emotionEngine.motionConfig,
            expressionConfig: this.emotionEngine.expressionConfig,
            logger: {
                info: message => logToTerminal('info', message),
                warn: message => logToTerminal('warn', message)
            }
        });
        this.expressionRuntime = runtime;
        this.adapter.updateBindings(runtime.profile.bindings);

        const units = runtime.units.filter(unit => {
            if (unit.kind !== 'semantic') return unit.enabled !== false;
            const unresolved = unit.targets
                .map(target => target.action)
                .filter(action => !this.adapter.canResolve(action));
            if (unresolved.length > 0) {
                logToTerminal('info', `[AuDriver] 跳过不可映射 AU "${unit.id}": ${unresolved.join(', ')}`);
                return false;
            }
            return unit.enabled !== false;
        });

        const solverConfig = getSolverConfig(this.config);
        this.solver = new ExpressionSolver(units, runtime.rules, {
            history: new ExpressionHistory(20),
            topCandidates: 14,
            typicalityFloor: solverConfig.typicalityFloor,
            typicalityPower: solverConfig.typicalityPower
        });
        logToTerminal(
            'info',
            `[AuDriver] 已就绪: 可用 AU=${units.length}, 原生=${units.filter(unit => unit.kind === 'native').length}, 参数绑定=${this.adapter.bindings.size}`
        );
        return true;
    }

    refreshExpressionRuntime() {
        return this.setEmotionEngine(this.emotionEngine);
    }

    updateConfig(config) {
        this.config = config || {};
        if (this.emotionEngine) this.refreshExpressionRuntime();
    }

    playEmotion(tag, options = {}) {
        const emotion = emotionKindFromTag(tag) || coerceEmotion(tag);
        if (!emotion || !this.solver || !this.isEnabled()) return false;

        const solverConfig = getSolverConfig(this.config);
        const selected = this.solver.solve({
            emotion,
            intensity: clamp(options.intensity ?? 1, 0, 1),
            randomness: solverConfig.randomness,
            diversity: solverConfig.diversity,
            historyAvoidance: solverConfig.historyAvoidance,
            maxUnits: solverConfig.maxUnits,
            coreScore: 0.65
        });
        if (selected.units.length === 0) {
            logToTerminal('warn', `[AuDriver] "${tag}" 没有可用的 AU，回退旧表情逻辑`);
            return false;
        }

        const now = nowMs();
        const transitionMs = nonNegative(options.transitionMs ?? options.transition_ms, solverConfig.transitionMs);
        const platformTargets = this._resolvePlatformTargets(selected.semanticTargets);

        this._clearReleaseTimer();
        this._triggeredAt = now;
        this._clearNative();
        this._playNativeTriggers(selected.nativeTriggers);
        this._transitionTo(platformTargets, now, transitionMs, solverConfig.neutralMs);
        logToTerminal(
            'info',
            `[AuDriver] 解算 ${tag}: ${selected.units.map(unit => unit.id).join(' + ') || '中性'}`
        );
        return true;
    }

    release() {
        if (this.states.size === 0 && this.activeNative.expression.length === 0 && this.activeNative.motion.length === 0) {
            return;
        }
        const now = nowMs();
        const solverConfig = getSolverConfig(this.config);
        const remainingHoldMs = Math.max(0, solverConfig.minHoldMs - (now - this._triggeredAt));
        if (remainingHoldMs > 0) {
            if (!this._releaseTimer) {
                this._releaseTimer = setTimeout(() => {
                    this._releaseTimer = null;
                    this._releaseNow();
                }, remainingHoldMs);
                this._releaseTimer.unref?.();
            }
            return;
        }
        this._releaseNow(now, solverConfig.neutralMs);
    }

    _releaseNow(now = nowMs(), neutralMs = getSolverConfig(this.config).neutralMs) {
        this._clearReleaseTimer();
        for (const state of this.states.values()) {
            this._startRelease(state, now, neutralMs);
        }
        this._clearNative();
    }

    applyFrame(coreModel = this.coreModel, now = nowMs()) {
        if (!coreModel || this.states.size === 0) return;

        for (const [id, state] of [...this.states.entries()]) {
            const current = readParameter(coreModel, state.info);
            if (state.phase === 'transition') {
                const progress = state.durationMs <= 0
                    ? 1
                    : clamp((now - state.startedAt) / state.durationMs, 0, 1);
                const eased = ease(state.easing, progress);
                state.value = lerp(state.from, state.target, eased);
                state.weight = eased;
                writeStateParameter(coreModel, state, state.value);
                if (progress >= 1) {
                    state.phase = 'hold';
                    state.value = state.target;
                    state.weight = 1;
                }
                continue;
            }

            if (state.phase === 'hold') {
                state.value = state.target;
                state.weight = 1;
                writeStateParameter(coreModel, state, state.target);
                continue;
            }

            const progress = state.releaseMs <= 0
                ? 1
                : clamp((now - state.releaseStartedAt) / state.releaseMs, 0, 1);
            const hasExternalDrive = Number.isFinite(state.lastWritten)
                && Math.abs(current - state.lastWritten) > EXTERNAL_DRIVE_EPSILON;
            if (progress >= 1) {
                state.weight = 0;
                if (!hasExternalDrive) {
                    state.value = state.neutral;
                    writeStateParameter(coreModel, state, state.neutral);
                }
                this.states.delete(id);
                continue;
            }

            const releaseValue = lerp(state.releaseFrom, state.neutral, ease('in_out_sine', progress));
            state.value = hasExternalDrive
                ? lerp(releaseValue, current, progress)
                : releaseValue;
            state.weight = 1 - progress;
            writeStateParameter(coreModel, state, state.value);
        }
    }

    activeWeightForParam(paramId) {
        return clamp(this.states.get(paramId)?.weight || 0, 0, 1);
    }

    isEyeControlled() {
        for (const [id, state] of this.states) {
            if (state.weight > 0.01 && EYE_LID_PARAM_PATTERN.test(id)) return true;
        }
        return false;
    }

    isMouthControlled() {
        for (const [id, state] of this.states) {
            if (state.weight > 0.01 && MOUTH_OPEN_PARAM_IDS.has(id)) return true;
        }
        return false;
    }

    isEnabled() {
        return this.config?.expression_solver?.enabled !== false;
    }

    destroy() {
        this._clearReleaseTimer();
        this._clearNative();
        this.states.clear();
        this.solver = null;
        this._detachEvents();
        this.emotionEngine = null;
        this.coreModel = null;
        this.model = null;
    }

    _resolvePlatformTargets(semanticTargets) {
        const targets = new Map();
        for (const semanticTarget of semanticTargets || []) {
            for (const platformTarget of this.adapter.toPlatformTargets(semanticTarget.action, semanticTarget.value)) {
                if (targets.has(platformTarget.id)) continue;
                targets.set(platformTarget.id, {
                    ...platformTarget,
                    easing: semanticTarget.easing
                });
            }
        }
        return targets;
    }

    _transitionTo(nextTargets, now, transitionMs, neutralMs) {
        for (const [id, state] of this.states) {
            if (!nextTargets.has(id)) this._startRelease(state, now, neutralMs);
        }

        for (const [id, next] of nextTargets) {
            const existing = this.states.get(id);
            const from = existing ? existing.value : readParameter(this.coreModel, next);
            this.states.set(id, {
                info: next,
                from,
                target: next.value,
                neutral: next.neutral,
                value: from,
                weight: existing?.weight || 0,
                phase: transitionMs <= 0 ? 'hold' : 'transition',
                startedAt: now,
                durationMs: transitionMs,
                easing: next.easing || 'in_out_sine',
                releaseFrom: from,
                releaseStartedAt: 0,
                releaseMs: neutralMs,
                lastWritten: existing?.lastWritten
            });
            if (transitionMs <= 0) {
                const state = this.states.get(id);
                state.value = next.value;
                state.weight = 1;
            }
        }
    }

    _startRelease(state, now, releaseMs) {
        if (state.phase === 'release') return;
        state.releaseFrom = state.value;
        state.releaseStartedAt = now;
        state.releaseMs = releaseMs;
        state.phase = 'release';
        state.weight = 1;
    }

    _playNativeTriggers(triggers) {
        const seenTypes = new Set();
        for (const trigger of triggers || []) {
            const nativeType = trigger?.nativeType;
            if (seenTypes.has(nativeType)) continue;
            let played = false;
            if (nativeType === 'expression') {
                played = this.emotionEngine?.playNativeExpressionFile?.(trigger.nativeRef) === true;
            } else if (nativeType === 'motion') {
                played = this.emotionEngine?.playNativeMotionFile?.(trigger.nativeRef) === true;
            }
            if (played) {
                seenTypes.add(nativeType);
                this.activeNative[nativeType].push(trigger.nativeRef);
            }
        }
    }

    _clearNative() {
        if (this.activeNative.expression.length > 0) {
            try { this.emotionEngine?.clearNativeExpressions?.(); } catch (_) {}
        }
        if (this.activeNative.motion.length > 0) {
            try { this.emotionEngine?.stopNativeMotions?.(); } catch (_) {}
        }
        this.activeNative = { expression: [], motion: [] };
    }

    _clearReleaseTimer() {
        if (!this._releaseTimer) return;
        clearTimeout(this._releaseTimer);
        this._releaseTimer = null;
    }

    _attachEvents() {
        if (this._eventsAttached) return;
        eventBus.on(Events.TTS_END, this._boundRelease);
        eventBus.on(Events.TTS_INTERRUPTED, this._boundRelease);
        this._eventsAttached = true;
    }

    _detachEvents() {
        if (!this._eventsAttached) return;
        eventBus.off(Events.TTS_END, this._boundRelease);
        eventBus.off(Events.TTS_INTERRUPTED, this._boundRelease);
        this._eventsAttached = false;
    }
}

function getSolverConfig(config) {
    const raw = config?.expression_solver || {};
    return {
        transitionMs: nonNegative(raw.transition_ms, 600),
        neutralMs: nonNegative(raw.neutral_ms, 600),
        minHoldMs: nonNegative(raw.min_hold_ms, 1500),
        randomness: clamp(raw.randomness ?? 0.5, 0, 1),
        diversity: clamp(raw.diversity ?? 0.6, 0, 1),
        historyAvoidance: clamp(raw.history_avoidance ?? 0.7, 0, 1),
        maxUnits: Math.max(1, Math.floor(Number(raw.max_units) || 5)),
        typicalityFloor: clamp(raw.typicality_floor ?? 0.3, 0, 1),
        typicalityPower: nonNegative(raw.typicality_power, 0.5)
    };
}

function coerceEmotion(value) {
    const emotion = String(value || '').trim();
    return Object.values(EmotionKind).includes(emotion) ? emotion : null;
}

function readParameter(coreModel, info) {
    try {
        return Number(coreModel.getParameterValueByIndex(info.index));
    } catch (_) {
        return Number(info.defaultValue) || 0;
    }
}

function writeParameter(coreModel, info, value) {
    const written = clamp(value, info.minimum, info.maximum);
    try {
        coreModel.setParameterValueByIndex(info.index, written);
        return written;
    } catch (_) {
        return NaN;
    }
}

function writeStateParameter(coreModel, state, value) {
    const written = writeParameter(coreModel, state.info, value);
    if (Number.isFinite(written)) state.lastWritten = written;
}

function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function ease(name, progress) {
    const t = clamp(progress, 0, 1);
    if (name === 'linear') return t;
    if (name === 'out_cubic') return 1 - Math.pow(1 - t, 3);
    return -(Math.cos(Math.PI * t) - 1) / 2;
}

function lerp(from, to, progress) {
    return from + (to - from) * progress;
}

function nonNegative(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clamp(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return minimum;
    return Math.max(minimum, Math.min(maximum, number));
}

module.exports = { AuDriver, getSolverConfig };
