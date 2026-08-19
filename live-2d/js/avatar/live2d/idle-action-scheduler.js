'use strict';

// idle-action-scheduler.js - 离散待机动作调度器
// 对齐 soullink-emotion-sdk engine 的 idle action system：非周期的小动作（点头/歪头/侧目/
// 重心转移/前倾/后撤/叹气/慢眨眼），按 VAD 状态 + 风格权重挑选，带防重复窗口，说话立即打断。
//
// 范围铁律：本模块仅由 ParamDirector 在「仅 AI 编舞」档（director）驱动，blend / legacy 档不会
// 实例化调用。动作只产出关键帧，经 ParamDirector 的 'idle' 通道走既有 transition/hold/release
// 状态机落地——不直写任何 Live2D 参数。

const { seededRandom } = require('./emotion-archetypes.js');
const { normalizeDuration } = require('./duration-utils.js');

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

// 每个动作：
//   id            动作名（防重复窗口按 id+direction 记账）
//   base          基础权重
//   affinity      VAD 亲和度：score = base + valence*v + arousal*a + dominance*d
//   requires(vad) 可选硬门槛
//   directional   是否有左右方向
//   cooldownSec   自身冷却
//   build(ctx)    产出 [{ delayMs, frame }]，frame 为 ParamDirector 时间轴帧格式
const ACTIONS = [
    {
        id: 'slow_nod', base: 1.0, affinity: { valence: 0.3, arousal: 0.2 }, cooldownSec: 14,
        build(ctx) {
            const depth = -(3.2 + ctx.random() * 2.4) * ctx.gain;
            return [
                { delayMs: 0, frame: ctx.frame({ ParamAngleY: depth, Param5: depth }, 620, 260, 900) },
                { delayMs: 950, frame: ctx.frame({ ParamAngleY: depth * -0.35, Param5: depth * -0.35 }, 540, 160, 1100) }
            ];
        }
    },
    {
        id: 'head_tilt', base: 1.0, affinity: { valence: 0.2 }, directional: true, cooldownSec: 16,
        build(ctx) {
            const z = (3 + ctx.random() * 2.2) * ctx.direction * ctx.gain;
            return [
                { delayMs: 0, frame: ctx.frame({ ParamAngleZ: z, Param4: z, ParamBodyAngleZ: -z * 0.24 }, 760, 1250, 1500) }
            ];
        }
    },
    {
        id: 'glance_side', base: 0.9, affinity: { arousal: 0.4 }, directional: true, cooldownSec: 10,
        build(ctx) {
            const x = (0.45 + ctx.random() * 0.3) * ctx.direction;
            const z = 1.6 * ctx.direction * ctx.gain;
            return [
                { delayMs: 0, frame: ctx.frame({ ParamEyeBallX: x, ParamAngleZ: z, Param4: z }, 420, 700, 800) },
                { delayMs: 1300, frame: ctx.frame({ ParamEyeBallX: 0, ParamAngleZ: 0, Param4: 0 }, 520, 120, 900) }
            ];
        }
    },
    {
        id: 'weight_shift', base: 1.0, affinity: { arousal: -0.3 }, directional: true, cooldownSec: 18,
        build(ctx) {
            const bx = (2.2 + ctx.random() * 1.4) * ctx.direction * ctx.gain;
            const hx = bx * 0.6;
            return [
                { delayMs: 0, frame: ctx.frame({ ParamBodyAngleX: bx, ParamAngleX: hx, Param3: hx }, 950, 1500, 1500) }
            ];
        }
    },
    {
        id: 'lean_in', base: 0.8, affinity: { valence: 0.4, dominance: 0.2 }, cooldownSec: 20,
        build(ctx) {
            const y = (3 + ctx.random() * 1.6) * ctx.gain;
            return [
                { delayMs: 0, frame: ctx.frame({ ParamAngleY: y, Param5: y, ParamBodyAngleY: y * 0.35 }, 820, 1100, 1400) }
            ];
        }
    },
    {
        id: 'settle_back', base: 0.8, affinity: { arousal: -0.4, valence: -0.1 }, cooldownSec: 20,
        build(ctx) {
            const y = -(2.4 + ctx.random() * 1.4) * ctx.gain;
            return [
                { delayMs: 0, frame: ctx.frame({ ParamAngleY: y, Param5: y, ParamBodyAngleY: y * 0.3 }, 1050, 1300, 1600) }
            ];
        }
    },
    {
        id: 'sigh', base: 0.7, affinity: { valence: -0.5, arousal: -0.2 }, cooldownSec: 26,
        requires: (vad) => (vad.valence || 0) < 0.08,
        build(ctx) {
            const y = -(3.4 + ctx.random() * 1.8) * ctx.gain;
            return [
                { delayMs: 0, frame: ctx.frame({ ParamAngleY: y * 0.4, Param5: y * 0.4 }, 480, 220, 500) },
                {
                    delayMs: 760,
                    frame: ctx.frame({
                        ParamAngleY: y, Param5: y, ParamBodyAngleY: y * 0.3,
                        ParamBrowLY: -0.12, ParamBrowRY: -0.12
                    }, 700, 520, 1700)
                }
            ];
        }
    },
    {
        id: 'slow_blink', base: 1.0, affinity: { arousal: -0.2 }, cooldownSec: 9,
        build(ctx) {
            const frame = ctx.frame({ ParamEyeLOpen: 0, ParamEyeROpen: 0, EyeL_Squint: 0.3, EyeR_Squint: 0.3 }, 150, 130, 280);
            frame.release_params = ['ParamEyeLOpen', 'ParamEyeROpen', 'EyeL_Squint', 'EyeR_Squint'];
            return [{ delayMs: 0, frame }];
        }
    }
];

const DEFAULT_OPTIONS = {
    spontaneity: 1,
    gain: 1,
    avoid_repeat_window: 4,
    min_interval_seconds: 7,
    max_interval_seconds: 19,
    slow_blink_weight: 1,
    gaze_down_bias: 0
};

class IdleActionScheduler {
    constructor() {
        this.options = { ...DEFAULT_OPTIONS };
        this.random = Math.random;
        this._seed = null;
        this._recent = [];            // [{id, direction}]，防重复窗口
        this._cooldownUntil = new Map(); // actionId -> ms 时间戳
        this._pendingSteps = [];      // [{fireAt, frame}]
        this._nextActionAt = 0;
        this._suspended = true;
    }

    configure(options = {}, seed = null) {
        const merged = { ...DEFAULT_OPTIONS };
        for (const key of Object.keys(DEFAULT_OPTIONS)) {
            const value = Number(options[key]);
            if (Number.isFinite(value)) merged[key] = value;
        }
        merged.spontaneity = clamp(merged.spontaneity, 0, 3);
        merged.gain = clamp(merged.gain, 0, 2.5);
        merged.avoid_repeat_window = clamp(Math.floor(merged.avoid_repeat_window), 0, 12);
        merged.min_interval_seconds = clamp(merged.min_interval_seconds, 1.5, 120);
        merged.max_interval_seconds = clamp(Math.max(merged.max_interval_seconds, merged.min_interval_seconds), 2, 180);
        this.options = merged;
        const normalizedSeed = Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : null;
        if (normalizedSeed !== this._seed) {
            this._seed = normalizedSeed;
            this.random = normalizedSeed === null ? Math.random : seededRandom(normalizedSeed);
        }
    }

    // 说话/编舞/交互开始时调用：清空未发帧，动作由 ParamDirector 侧淡出
    interrupt(nowMs) {
        this._pendingSteps = [];
        this._suspended = true;
        this._nextActionAt = (nowMs || 0) + this._intervalMs() * 0.6;
    }

    // 每渲染帧由 ParamDirector 调用。active=false 表示当前不允许待机动作（说话中等）。
    // fire(frame) 由调用方提供，负责把帧送进 'idle' 通道。
    tick(nowMs, { active, vad, fire }) {
        if (!active) {
            if (!this._suspended) this.interrupt(nowMs);
            return;
        }
        if (this._suspended) {
            this._suspended = false;
            if (this._nextActionAt < nowMs) this._nextActionAt = nowMs + this._intervalMs() * (0.4 + this.random() * 0.6);
        }

        // 先发到期的后续步骤
        if (this._pendingSteps.length > 0) {
            const due = [];
            this._pendingSteps = this._pendingSteps.filter(step => {
                if (step.fireAt <= nowMs) {
                    due.push(step);
                    return false;
                }
                return true;
            });
            for (const step of due) {
                try { fire(step.frame); } catch (_) {}
            }
        }

        if (this.options.spontaneity <= 0 || this.options.gain <= 0) return;
        if (nowMs < this._nextActionAt || this._pendingSteps.length > 0) return;

        const action = this._pickAction(nowMs, vad || {});
        this._nextActionAt = nowMs + this._intervalMs();
        if (!action) return;

        const direction = action.def.directional ? action.direction : 0;
        const ctx = this._buildCtx(direction);
        let steps = [];
        try {
            steps = action.def.build(ctx) || [];
        } catch (_) {
            return;
        }
        this._cooldownUntil.set(action.def.id, nowMs + (action.def.cooldownSec || 12) * 1000);
        this._recent.push({ id: action.def.id, direction });
        const windowSize = Math.max(1, this.options.avoid_repeat_window);
        while (this._recent.length > windowSize) this._recent.shift();

        for (const step of steps) {
            if (!step || !step.frame) continue;
            const delay = Math.max(0, Number(step.delayMs) || 0);
            if (delay === 0) {
                try { fire(step.frame); } catch (_) {}
            } else {
                this._pendingSteps.push({ fireAt: nowMs + delay, frame: step.frame });
            }
        }
    }

    _intervalMs() {
        const { min_interval_seconds, max_interval_seconds, spontaneity } = this.options;
        const span = min_interval_seconds + this.random() * Math.max(0.1, max_interval_seconds - min_interval_seconds);
        return (span / Math.max(0.2, spontaneity)) * 1000;
    }

    _pickAction(nowMs, vadInput) {
        const vad = vadInput.current || vadInput;
        const candidates = [];
        for (const def of ACTIONS) {
            if ((this._cooldownUntil.get(def.id) || 0) > nowMs) continue;
            if (typeof def.requires === 'function' && !def.requires(vad)) continue;
            const weightScale = def.id === 'slow_blink' ? this.options.slow_blink_weight : 1;
            const affinity = def.affinity || {};
            const score = (def.base
                + (Number(vad.valence) || 0) * (affinity.valence || 0)
                + (Number(vad.arousal) || 0) * (affinity.arousal || 0)
                + (Number(vad.dominance) || 0) * (affinity.dominance || 0)) * weightScale;
            if (score <= 0.02) continue;
            const directions = def.directional ? [-1, 1] : [0];
            for (const direction of directions) {
                if (this._recent.some(item => item.id === def.id && item.direction === direction)) continue;
                candidates.push({ def, direction, score });
            }
        }
        if (candidates.length === 0) return null;
        let total = 0;
        for (const item of candidates) total += item.score;
        let roll = this.random() * total;
        for (const item of candidates) {
            roll -= item.score;
            if (roll <= 0) return item;
        }
        return candidates[candidates.length - 1];
    }

    _buildCtx(direction) {
        const gain = this.options.gain;
        const random = this.random;
        const gazeDownBias = clamp(this.options.gaze_down_bias, 0, 1);
        return {
            direction,
            gain,
            random,
            frame(params, transitionMs, holdMs, releaseMs) {
                const finalParams = { ...params };
                // 害羞风格：视线类动作附带向下偏置
                if (gazeDownBias > 0 && finalParams.ParamEyeBallX !== undefined && finalParams.ParamEyeBallY === undefined) {
                    finalParams.ParamEyeBallY = -0.18 * gazeDownBias;
                }
                return {
                    at: 0,
                    params: finalParams,
                    transition_ms: normalizeDuration(transitionMs, 500),
                    hold_ms: normalizeDuration(holdMs, 400),
                    release_ms: normalizeDuration(releaseMs, 900),
                    sticky: false
                };
            }
        };
    }
}

module.exports = { IdleActionScheduler, IDLE_ACTIONS: ACTIONS };
