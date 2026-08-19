'use strict';

const { VAD_PRESETS, getVADPreset, normalizeEmotion, resolveStrictEmotionName, seededRandom } = require('./emotion-archetypes.js');

const NEUTRAL = { valence: 0, arousal: 0, dominance: 0 };

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function normalizeVector(value, fallback = NEUTRAL) {
    const source = value && typeof value === 'object' ? value : {};
    return clampVAD({
        valence: source.valence ?? source.v ?? fallback.valence,
        arousal: source.arousal ?? source.a ?? fallback.arousal,
        dominance: source.dominance ?? source.d ?? fallback.dominance
    });
}

function clampVAD(vector) {
    return {
        valence: clamp(vector.valence, -1, 1),
        arousal: clamp(vector.arousal, -1, 1),
        dominance: clamp(vector.dominance, -1, 1)
    };
}

function lerp(from, to, amount) {
    return from + (to - from) * clamp(amount, 0, 1);
}

function lerpVAD(from, to, amount) {
    return clampVAD({
        valence: lerp(from.valence, to.valence, amount),
        arousal: lerp(from.arousal, to.arousal, amount),
        dominance: lerp(from.dominance, to.dominance, amount)
    });
}

function magnitude(vector) {
    return clamp(
        (Math.abs(vector.valence) + Math.abs(vector.arousal) * 0.82 + Math.abs(vector.dominance) * 0.64) / 2.46,
        0,
        1
    );
}

function weightedDistance(a, b) {
    const valence = a.valence - b.valence;
    const arousal = a.arousal - b.arousal;
    const dominance = a.dominance - b.dominance;
    return valence * valence * 1.08 + arousal * arousal * 0.88 + dominance * dominance * 1.28;
}

class VADState {
    constructor(personality = {}) {
        this.random = seededRandom(9137);
        this.reactivity = 1;
        this.targetApproachRate = 1.35;
        this.decayRate = 0.018;
        this.emotionHoldSeconds = 18;
        this.ambientDriftStrength = 0.034;
        this.emotionBias = {};
        this.baseline = { ...NEUTRAL };
        this.current = { ...NEUTRAL };
        this.target = { ...NEUTRAL };
        this.ambient = { ...NEUTRAL };
        this.ambientTarget = { valence: 0.018, arousal: -0.012, dominance: 0.01 };
        this.driftClock = 0;
        this.nextDriftAt = 0;
        this.holdRemainingSeconds = 0;
        this.dominantEmotion = 'neutral';
        this.intensity = 0;
        this.configure(personality);
        this.reset();
    }

    configure(personality = {}) {
        const cfg = personality || {};
        if (cfg.baseline) this.setBaseline(cfg.baseline);
        if (Number.isFinite(Number(cfg.reactivity))) this.reactivity = clamp(cfg.reactivity, 0.2, 2.5);
        if (Number.isFinite(Number(cfg.targetApproachRate ?? cfg.target_approach_rate))) {
            this.targetApproachRate = clamp(cfg.targetApproachRate ?? cfg.target_approach_rate, 0.2, 4);
        }
        if (Number.isFinite(Number(cfg.decayRate ?? cfg.decay_rate))) {
            this.decayRate = clamp(cfg.decayRate ?? cfg.decay_rate, 0.002, 0.4);
        }
        if (Number.isFinite(Number(cfg.emotionHoldSeconds ?? cfg.hold_seconds))) {
            this.emotionHoldSeconds = clamp(cfg.emotionHoldSeconds ?? cfg.hold_seconds, 0, 90);
        }
        if (Number.isFinite(Number(cfg.ambientDriftStrength ?? cfg.ambient_drift_strength))) {
            this.ambientDriftStrength = clamp(cfg.ambientDriftStrength ?? cfg.ambient_drift_strength, 0, 0.09);
        }
        if (cfg.emotionBias && typeof cfg.emotionBias === 'object') {
            this.emotionBias = { ...this.emotionBias, ...cfg.emotionBias };
        }
    }

    setBaseline(baseline) {
        this.baseline = normalizeVector(baseline, this.baseline);
    }

    reset() {
        this.current = { ...this.baseline };
        this.target = { ...this.baseline };
        this.ambient = { ...NEUTRAL };
        this.ambientTarget = this._pickAmbientTarget();
        this.driftClock = 0;
        this.nextDriftAt = 0.8 + this.random() * 2.1;
        this.holdRemainingSeconds = 0;
        this.dominantEmotion = 'neutral';
        this.intensity = magnitude(this.current);
    }

    nudge(emotion, intensity = 0.65, options = null) {
        // strict 仅由「仅 AI 编舞」档调用方传入：允许直达 excited/calm/anxiety/tired 等
        // 被 normalizeEmotion 折叠的预设。不传 options = 旧行为，blend 档不变。
        const strict = !!(options && options.strict);
        const strictName = strict ? resolveStrictEmotionName(emotion) : null;
        const normalized = strictName || normalizeEmotion(emotion);
        const preset = getVADPreset(emotion, strict ? { strict: true } : null);
        const bias = this.emotionBias[normalized] ?? 1;
        const amount = clamp((0.28 + clamp(intensity, 0, 1.5) * 0.58) * this.reactivity * bias, 0, 0.96);
        this.target = lerpVAD(this.target, preset, amount);
        this._extendHold(6 + clamp(intensity, 0, 1.5) * this.emotionHoldSeconds);
        this.dominantEmotion = normalized;
        return this.getState();
    }

    blendTo(target, amount = 0.65) {
        const clamped = clamp(amount, 0, 1);
        this.target = lerpVAD(this.target, normalizeVector(target, this.target), clamped);
        this._extendHold(4 + clamped * this.emotionHoldSeconds);
        return this.getState();
    }

    nudgeVAD(delta, amount = 1) {
        const source = normalizeVector(delta, NEUTRAL);
        const gain = clamp(amount * this.reactivity, 0, 2);
        this.target = clampVAD({
            valence: this.target.valence + source.valence * gain,
            arousal: this.target.arousal + source.arousal * gain,
            dominance: this.target.dominance + source.dominance * gain
        });
        this._extendHold(3 + clamp(amount, 0, 1.5) * this.emotionHoldSeconds * 0.55);
        return this.getState();
    }

    update(deltaSeconds) {
        const dt = clamp(deltaSeconds, 0, 1);
        const approach = 1 - Math.exp(-dt * this.targetApproachRate);
        const decay = this.holdRemainingSeconds > 0 ? 0 : 1 - Math.exp(-dt * this.decayRate);
        this._updateAmbientDrift(dt);
        this.holdRemainingSeconds = Math.max(0, this.holdRemainingSeconds - dt);
        this.current = lerpVAD(this.current, this._withAmbient(this.target), approach);
        this.target = lerpVAD(this.target, this.baseline, decay);
        this.intensity = magnitude(this.current);
        this.dominantEmotion = this._inferEmotion(this.current, this.intensity);
        return this.getState();
    }

    getState() {
        return {
            current: { ...this.current },
            target: { ...this.target },
            baseline: { ...this.baseline },
            ambient: { ...this.ambient },
            dominantEmotion: this.dominantEmotion,
            intensity: this.intensity,
            holdSeconds: this.holdRemainingSeconds,
            decayRate: this.decayRate
        };
    }

    _inferEmotion(vad, value) {
        if (value < 0.0018) return 'neutral';
        if (value < 0.08) return this._inferSubtleEmotion(vad);
        if (vad.valence > 0.12 && vad.dominance < -0.22) return 'shy';
        if (vad.valence < -0.34 && vad.arousal > 0.38 && vad.dominance < -0.12) return 'anxiety';
        if (vad.valence < -0.42 && vad.arousal > 0.42 && vad.dominance > 0.18) return 'angry';
        if (vad.valence > 0.58 && vad.arousal > 0.62) return 'excited';
        if (vad.valence > 0.2 && vad.arousal < -0.24) return 'calm';
        return this._nearestPreset(vad);
    }

    _inferSubtleEmotion(vad) {
        if (vad.valence > 0.004 && vad.arousal > 0.004) return 'soft-happy';
        if (vad.valence > 0.004 && vad.arousal < -0.004) return 'soft-calm';
        if (vad.valence > 0.004) return 'soft-positive';
        if (vad.valence < -0.004 && vad.arousal > 0.004) return 'soft-uneasy';
        if (vad.valence < -0.004) return 'soft-low';
        if (vad.arousal > 0.004) return 'soft-curious';
        if (vad.arousal < -0.004) return 'soft-calm';
        if (vad.dominance < -0.004) return 'soft-shy';
        if (vad.dominance > 0.004) return 'soft-steady';
        return 'neutral';
    }

    _nearestPreset(vad) {
        let bestEmotion = 'neutral';
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const [emotion, preset] of Object.entries(VAD_PRESETS)) {
            if (emotion === 'neutral' || emotion === 'angry') continue;
            const distance = weightedDistance(vad, preset);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestEmotion = emotion;
            }
        }
        return bestDistance < 0.92 ? bestEmotion : 'neutral';
    }

    _updateAmbientDrift(deltaSeconds) {
        if (this.ambientDriftStrength <= 0) return;
        this.driftClock += deltaSeconds;
        if (this.driftClock >= this.nextDriftAt) {
            this.ambientTarget = this._pickAmbientTarget();
            this.nextDriftAt = this.driftClock + 1.7 + this.random() * 4.2;
        }
        const approach = 1 - Math.exp(-deltaSeconds * 0.62);
        this.ambient = lerpVAD(this.ambient, this.ambientTarget, approach);
    }

    _pickAmbientTarget() {
        const strength = this.ambientDriftStrength;
        const centerBias = this.random() < 0.26 ? 0.42 : 1;
        const pick = (axisScale) => {
            const half = strength * axisScale * centerBias;
            return -half + this.random() * half * 2;
        };
        return clampVAD({
            valence: pick(1),
            arousal: pick(0.82),
            dominance: pick(0.68)
        });
    }

    _withAmbient(vector) {
        return clampVAD({
            valence: vector.valence + this.ambient.valence,
            arousal: vector.arousal + this.ambient.arousal,
            dominance: vector.dominance + this.ambient.dominance
        });
    }

    _extendHold(seconds) {
        this.holdRemainingSeconds = Math.max(this.holdRemainingSeconds, seconds);
    }
}

const vadState = global.vadState || new VADState();
global.vadState = vadState;

module.exports = {
    NEUTRAL,
    VADState,
    clamp,
    clampVAD,
    magnitude,
    normalizeVector,
    vadState
};
