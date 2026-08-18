'use strict';

const facsMapper = require('./facs-mapper.js');

const BLOCKED_PARAMS = new Set(['ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY']);

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function normalizeCatalog(catalogById) {
    if (!catalogById) return new Map();
    if (catalogById instanceof Map) return catalogById;
    if (Array.isArray(catalogById)) return new Map(catalogById.map(item => [item.id, item]));
    return new Map(Object.entries(catalogById));
}

function deltaMagnitude(vector) {
    return Math.abs(vector.valence) + Math.abs(vector.arousal) * 0.82 + Math.abs(vector.dominance) * 0.62;
}

function seededRandom(seed) {
    let state = Math.floor(Number(seed) || 0) >>> 0;
    if (state === 0) state = 0x9e3779b9;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

class FaceMicroMotion {
    constructor() {
        this.previous = null;
        this.pulse = null;
        this.random = seededRandom(4421);
        this.nextAllowedPulseAt = 0;
        this.nextGazeAt = 0;
        this.gaze = { x: 0, y: 0, startedAt: 0, duration: 1 };
    }

    reset() {
        this.previous = null;
        this.pulse = null;
        this.nextAllowedPulseAt = 0;
        this.nextGazeAt = 0;
        this.gaze = { x: 0, y: 0, startedAt: 0, duration: 1 };
    }

    compute(options = {}) {
        const catalog = normalizeCatalog(options.catalogById);
        const state = options.vadState || {};
        const vad = state.current || state;
        const timeSeconds = Number(options.timeSeconds) || 0;
        const speaking = options.speaking === true;
        const intensity = clamp(options.intensity ?? 1, 0, 2);
        const activeWeight = typeof options.activeWeight === 'function' ? options.activeWeight : () => 0;
        // 以下两项仅「仅 AI 编舞」档的调用方传入；未传（undefined）= 行为与旧版完全一致
        const mouthFormScale = Number.isFinite(Number(options.mouthFormScale)) ? clamp(Number(options.mouthFormScale), 0, 1) : null;
        this._gazeStability = Number.isFinite(Number(options.gazeStability)) ? clamp(Number(options.gazeStability), 0, 1) : null;
        if (!vad || typeof vad !== 'object' || intensity <= 0) return {};

        const focus = speaking ? 0.72 : 0;
        const toneWeight = speaking ? 0.4 : 1;
        const delta = this._getDelta(vad);
        this._maybeStartPulse(timeSeconds, delta, focus);
        this.previous = { ...vad };

        const offsets = {};
        this._addOffsets(offsets, this._toneLayer(vad, catalog, toneWeight));
        this._addOffsets(offsets, this._continuousLayer(timeSeconds, vad, focus, catalog));
        this._addOffsets(offsets, this._pulseLayer(timeSeconds, focus, catalog));

        const result = {};
        for (const [id, rawOffset] of Object.entries(offsets)) {
            if (BLOCKED_PARAMS.has(id) || !catalog.has(id)) continue;
            const remaining = 1 - clamp(activeWeight(id), 0, 1);
            let offset = rawOffset * intensity * remaining;
            // 口型仲裁（仅 director 档生效）：说话期微表情对 ParamMouthForm 的写入让位 lipsync
            if (mouthFormScale !== null && speaking && id === 'ParamMouthForm') offset *= mouthFormScale;
            if (Math.abs(offset) < 0.0001) continue;
            result[id] = offset;
        }
        return result;
    }

    _toneLayer(vad, catalog, weight) {
        const positive = Math.max(0, vad.valence || 0);
        const negative = Math.max(0, -(vad.valence || 0));
        const aroused = Math.max(0, vad.arousal || 0);
        const calm = Math.max(0, -(vad.arousal || 0));
        const submissive = Math.max(0, -(vad.dominance || 0));
        const dominant = Math.max(0, vad.dominance || 0);

        const au = {
            AU12: (positive * 0.15 + calm * positive * 0.06) * weight,
            AU6: (positive * 0.1 + calm * positive * 0.04) * weight,
            AU15: (negative * 0.12 + calm * negative * 0.05) * weight,
            AU1: (negative * 0.09 + submissive * 0.06) * weight,
            AU2: (aroused * 0.09 + positive * aroused * 0.04) * weight,
            AU4: dominant * negative * 0.11 * weight,
            AU7: (negative * dominant * 0.08 + calm * 0.035) * weight,
            blush: positive * submissive * 0.18 * weight,
            gazeY: (-submissive * 0.06 + dominant * 0.03) * weight
        };

        const offsets = facsMapper.expandToOffsets(au, catalog);
        delete offsets.ParamEyeLOpen;
        delete offsets.ParamEyeROpen;
        return offsets;
    }

    _continuousLayer(timeSeconds, vad, focus, catalog) {
        const magnitude = clamp(deltaMagnitude(vad) * 0.85, 0, 0.1);
        if (magnitude < 0.003) return {};

        const idleWeight = 1 - focus * 0.56;
        const slow = Math.sin(timeSeconds * 0.86 + (vad.valence || 0) * 9.2);
        const mid = Math.sin(timeSeconds * 1.34 + (vad.arousal || 0) * 7.6 + 1.7);
        const side = Math.sin(timeSeconds * 0.47 + (vad.dominance || 0) * 5.1);
        const positive = Math.max(0, vad.valence || 0);
        const negative = Math.max(0, -(vad.valence || 0));
        const aroused = Math.max(0, vad.arousal || 0);
        const calm = Math.max(0, -(vad.arousal || 0));
        const submissive = Math.max(0, -(vad.dominance || 0));

        const result = {
            ParamMouthForm: positive * 0.026 * (0.7 + slow * 0.3) * idleWeight - negative * 0.018 * (0.75 + mid * 0.25) * idleWeight,
            ParamBrowLY: (negative * 0.024 + submissive * 0.012 + aroused * 0.012) * (0.74 + slow * 0.22) * idleWeight,
            ParamBrowRY: (negative * 0.024 + submissive * 0.012 + aroused * 0.012) * (0.74 + slow * 0.22) * idleWeight,
            ParamEyeLSmile: positive * 0.02 * (0.75 + slow * 0.2) * idleWeight,
            ParamEyeRSmile: positive * 0.02 * (0.75 + slow * 0.2) * idleWeight,
            EyeL_Squint: (negative * 0.014 + calm * 0.01) * (0.75 + mid * 0.2) * idleWeight,
            EyeR_Squint: (negative * 0.014 + calm * 0.01) * (0.75 + mid * 0.2) * idleWeight,
            ParamEyeBallY: (Math.max(0, vad.dominance || 0) * 0.008 - submissive * 0.014 + calm * -0.006) * idleWeight,
            ParamAngleZ: ((vad.valence || 0) * submissive * -0.28 + (vad.dominance || 0) * 0.15 + side * magnitude * 0.5) * idleWeight
        };

        const gaze = this._gazeSweep(timeSeconds, vad);
        result.ParamEyeBallX = gaze.x + side * magnitude * 0.18;
        result.ParamEyeBallY += gaze.y;

        return this._filterExisting(result, catalog);
    }

    _pulseLayer(timeSeconds, focus, catalog) {
        if (!this.pulse) return {};
        const progress = (timeSeconds - this.pulse.startedAt) / this.pulse.duration;
        if (progress >= 1) {
            this.pulse = null;
            return {};
        }

        const envelope = Math.sin(Math.PI * clamp(progress, 0, 1));
        const amplitude = this.pulse.amplitude * envelope * (1 - focus * 0.34);
        const vector = this.pulse.vector;
        const positive = Math.max(0, vector.valence);
        const negative = Math.max(0, -vector.valence);
        const aroused = Math.max(0, vector.arousal);
        const submissive = Math.max(0, -vector.dominance);
        const dominant = Math.max(0, vector.dominance);

        return this._filterExisting({
            ParamMouthForm: positive * amplitude * 1.1 - negative * amplitude * 0.9,
            ParamBrowLY: (negative * 0.9 + submissive * 0.45 + aroused * 0.5) * amplitude,
            ParamBrowRY: (negative * 0.9 + submissive * 0.45 + aroused * 0.5) * amplitude,
            ParamBrowLAngle: dominant * negative * amplitude * -0.9,
            ParamBrowRAngle: dominant * negative * amplitude * 0.9,
            ParamEyeLSmile: positive * amplitude * 0.65,
            ParamEyeRSmile: positive * amplitude * 0.65,
            EyeL_Squint: (negative * dominant) * amplitude * 0.7,
            EyeR_Squint: (negative * dominant) * amplitude * 0.7,
            ParamJawOpen: aroused * amplitude * 0.34,
            ParamAngleZ: this.pulse.side * amplitude * 2.6
        }, catalog);
    }

    _gazeSweep(timeSeconds, vad) {
        if (timeSeconds >= this.nextGazeAt) {
            // gazeStability 仅 director 档传入：稳定度越高，扫视间隔越长、幅度越小（对齐 SDK gazeStability）
            const stability = this._gazeStability;
            const spanScale = stability == null ? 1 : (0.6 + stability * 1.6);
            const ampScale = stability == null ? 1 : (1.25 - stability * 0.7);
            const span = (2 + this.random() * 4) * spanScale;
            this.gaze = {
                x: (this.random() - 0.5) * 0.11 * ampScale * (1 + Math.max(0, vad.arousal || 0)),
                y: (this.random() - 0.5) * 0.08 * ampScale,
                startedAt: timeSeconds,
                duration: 0.45 + this.random() * 0.6
            };
            this.nextGazeAt = timeSeconds + span;
        }
        const progress = (timeSeconds - this.gaze.startedAt) / Math.max(0.001, this.gaze.duration);
        const envelope = progress >= 1 ? 0 : Math.sin(Math.PI * clamp(progress, 0, 1));
        return { x: this.gaze.x * envelope, y: this.gaze.y * envelope };
    }

    _getDelta(vad) {
        const previous = this.previous || { valence: 0, arousal: 0, dominance: 0 };
        return {
            valence: (vad.valence || 0) - previous.valence,
            arousal: (vad.arousal || 0) - previous.arousal,
            dominance: (vad.dominance || 0) - previous.dominance
        };
    }

    _maybeStartPulse(timeSeconds, delta, focus) {
        const magnitude = deltaMagnitude(delta);
        const threshold = focus > 0.5 ? 0.012 : 0.0048;
        if (magnitude < threshold || timeSeconds < this.nextAllowedPulseAt) return;
        this.pulse = {
            startedAt: timeSeconds,
            duration: 0.42 + this.random() * 0.38,
            vector: delta,
            amplitude: clamp(magnitude * 2.7, 0.018, 0.12) * (1 - focus * 0.48),
            side: this.random() < 0.5 ? -1 : 1
        };
        this.nextAllowedPulseAt = timeSeconds + 0.42 + this.random() * 0.7;
    }

    _addOffsets(target, source) {
        for (const [id, value] of Object.entries(source || {})) {
            if (!Number.isFinite(Number(value))) continue;
            target[id] = (target[id] || 0) + Number(value);
        }
    }

    _filterExisting(source, catalog) {
        const result = {};
        for (const [id, value] of Object.entries(source || {})) {
            if (BLOCKED_PARAMS.has(id) || !catalog.has(id)) continue;
            if (Math.abs(Number(value) || 0) < 0.0001) continue;
            result[id] = Number(value);
        }
        return result;
    }
}

module.exports = {
    BLOCKED_PARAMS,
    FaceMicroMotion
};
