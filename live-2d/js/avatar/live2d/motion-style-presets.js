'use strict';

// motion-style-presets.js - 动作风格预设（对齐 soullink-emotion-sdk engine 的 motionStyle presets）
// 仅「仅 AI 编舞」档（avatar_motion_mode: 'director'）消费；blend / legacy 档完全不读本文件。
// 配置入口：config.motion_director.style = 'natural' | 'lively' | 'calm' | 'shy'
// 可选覆盖：config.motion_director.style_overrides = { vad: {...}, idle: {...}, gaze: {...}, sway: {...}, face_micro: {...} }
// 可选固定随机序列：config.motion_director.style_seed = <整数>（用于录制回归对比）

const MOTION_STYLE_PRESETS = {
    // 自然：接近现有默认手感，作为基准档
    natural: {
        vad: {
            baseline: { valence: 0.1, arousal: 0, dominance: 0.05 },
            reactivity: 1,
            decay_rate: 0.018,
            hold_seconds: 18,
            ambient_drift_strength: 0.034
        },
        idle: {
            spontaneity: 1,
            gain: 1,
            avoid_repeat_window: 4,
            min_interval_seconds: 7,
            max_interval_seconds: 19,
            slow_blink_weight: 1,
            gaze_down_bias: 0
        },
        gaze: { stability: 0.55 },
        sway: { amplitude_scale: 1 },
        face_micro: { intensity: 1 }
    },
    // 活泼：更高唤醒基线、更频繁的自发动作、更游移的视线、更大的动作幅度
    lively: {
        vad: {
            baseline: { valence: 0.22, arousal: 0.18, dominance: 0.12 },
            reactivity: 1.35,
            decay_rate: 0.014,
            hold_seconds: 22,
            ambient_drift_strength: 0.05
        },
        idle: {
            spontaneity: 1.5,
            gain: 1.15,
            avoid_repeat_window: 3,
            min_interval_seconds: 4.5,
            max_interval_seconds: 12,
            slow_blink_weight: 0.7,
            gaze_down_bias: 0
        },
        gaze: { stability: 0.35 },
        sway: { amplitude_scale: 1.2 },
        face_micro: { intensity: 1.2 }
    },
    // 沉静：低唤醒、动作稀疏而缓慢、视线稳定、慢眨眼偏多
    calm: {
        vad: {
            baseline: { valence: 0.12, arousal: -0.18, dominance: 0.1 },
            reactivity: 0.75,
            decay_rate: 0.024,
            hold_seconds: 14,
            ambient_drift_strength: 0.02
        },
        idle: {
            spontaneity: 0.6,
            gain: 0.8,
            avoid_repeat_window: 5,
            min_interval_seconds: 10,
            max_interval_seconds: 26,
            slow_blink_weight: 1.4,
            gaze_down_bias: 0
        },
        gaze: { stability: 0.8 },
        sway: { amplitude_scale: 0.75 },
        face_micro: { intensity: 0.8 }
    },
    // 害羞：低支配基线、幅度收敛、视线稳定但偏下、脸红类情绪反应更强
    shy: {
        vad: {
            baseline: { valence: 0.08, arousal: 0.05, dominance: -0.22 },
            reactivity: 1.1,
            decay_rate: 0.02,
            hold_seconds: 20,
            ambient_drift_strength: 0.03,
            emotionBias: { shy: 1.25, happy: 1.05 }
        },
        idle: {
            spontaneity: 0.85,
            gain: 0.7,
            avoid_repeat_window: 4,
            min_interval_seconds: 6,
            max_interval_seconds: 16,
            slow_blink_weight: 1.2,
            gaze_down_bias: 0.3
        },
        gaze: { stability: 0.7, down_bias: 0.25 },
        sway: { amplitude_scale: 0.7 },
        face_micro: { intensity: 1.05 }
    }
};

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeSection(base, override) {
    if (!isPlainObject(override)) return { ...(base || {}) };
    const result = { ...(base || {}) };
    for (const [key, value] of Object.entries(override)) {
        if (isPlainObject(value) && isPlainObject(result[key])) result[key] = { ...result[key], ...value };
        else result[key] = value;
    }
    return result;
}

// 从 config 解析生效的风格预设。未配置 / 配置无效 / 非 director 调用方 → 返回 null（调用方走旧散配置路径）。
function resolveMotionStyle(config) {
    const motion = config?.motion_director || {};
    const rawName = typeof motion.style === 'string' ? motion.style.trim().toLowerCase() : '';
    if (!rawName || !MOTION_STYLE_PRESETS[rawName]) return null;
    const base = MOTION_STYLE_PRESETS[rawName];
    const overrides = isPlainObject(motion.style_overrides) ? motion.style_overrides : {};
    const seedRaw = Number(motion.style_seed);
    return {
        name: rawName,
        seed: Number.isFinite(seedRaw) ? Math.floor(seedRaw) : null,
        vad: mergeSection(base.vad, overrides.vad),
        idle: mergeSection(base.idle, overrides.idle),
        gaze: mergeSection(base.gaze, overrides.gaze),
        sway: mergeSection(base.sway, overrides.sway),
        face_micro: mergeSection(base.face_micro, overrides.face_micro)
    };
}

module.exports = {
    MOTION_STYLE_PRESETS,
    resolveMotionStyle
};
