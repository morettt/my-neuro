'use strict';

const VAD_PRESETS = {
    happy: { valence: 0.75, arousal: 0.45, dominance: 0.35 },
    excited: { valence: 0.85, arousal: 0.85, dominance: 0.45 },
    shy: { valence: 0.35, arousal: 0.6, dominance: -0.45 },
    sad: { valence: -0.65, arousal: -0.45, dominance: -0.5 },
    angry: { valence: -0.7, arousal: 0.75, dominance: 0.55 },
    anger: { valence: -0.7, arousal: 0.75, dominance: 0.55 },
    calm: { valence: 0.25, arousal: -0.45, dominance: 0.2 },
    surprised: { valence: 0.35, arousal: 0.72, dominance: 0.05 },
    playful: { valence: 0.6, arousal: 0.5, dominance: 0.3 },
    anxiety: { valence: -0.6, arousal: 0.7, dominance: -0.55 },
    tired: { valence: -0.25, arousal: -0.7, dominance: -0.3 },
    neutral: { valence: 0, arousal: 0, dominance: 0 }
};

const ARCHETYPES = {
    happy: {
        base: { AU12: [0.42, 0.74], AU6: [0.18, 0.45], AU2: [0.04, 0.18], blush: [0.02, 0.16], gazeY: [0.02, 0.16] },
        variants: {
            soft_smile: { AU12: [0.32, 0.55], AU6: [0.14, 0.32], gazeY: [-0.04, 0.08] },
            bright_smile: { AU12: [0.62, 0.88], AU6: [0.34, 0.58], AU5: [0.08, 0.2], blush: [0.08, 0.24] },
            shy_happy: { AU12: [0.36, 0.62], AU6: [0.2, 0.44], gazeY: [-0.22, -0.06], blush: [0.22, 0.55] }
        }
    },
    playful: {
        base: { AU12: [0.38, 0.68], AU6: [0.26, 0.54], AU2: [0.1, 0.32], gazeX: [-0.22, 0.22], blush: [0.06, 0.22] },
        variants: {
            tease: { AU12: [0.46, 0.78], AU6: [0.32, 0.62], AU2: [0.18, 0.42], gazeX: [-0.36, 0.36], AU18: [0.06, 0.18] },
            wink_side: { AU12: [0.48, 0.74], AU6: [0.28, 0.55], AU7: [0.04, 0.16], gazeX: [-0.3, 0.3] }
        }
    },
    surprised: {
        base: { AU1: [0.2, 0.48], AU2: [0.25, 0.58], AU5: [0.36, 0.72], AU25: [0.12, 0.34], AU26: [0.08, 0.28], gazeY: [0.04, 0.24] },
        variants: {
            startled: { AU1: [0.36, 0.7], AU2: [0.35, 0.75], AU5: [0.48, 0.86], AU25: [0.16, 0.38] },
            delighted: { AU12: [0.28, 0.58], AU6: [0.12, 0.28], AU5: [0.32, 0.64], AU2: [0.22, 0.5] }
        }
    },
    angry: {
        base: { AU4: [0.36, 0.72], AU7: [0.16, 0.4], AU15: [0.24, 0.55], AU23: [0.16, 0.36], gazeY: [-0.04, 0.08] },
        variants: {
            annoyed: { AU4: [0.24, 0.52], AU7: [0.12, 0.3], AU15: [0.16, 0.38], AU23: [0.08, 0.24] },
            firm: { AU4: [0.42, 0.78], AU7: [0.22, 0.48], AU23: [0.2, 0.44], AU15: [0.22, 0.44] }
        }
    },
    sad: {
        base: { AU1: [0.18, 0.46], AU15: [0.3, 0.62], AU7: [0.06, 0.22], gazeY: [-0.34, -0.12], blush: [0, 0.08] },
        variants: {
            downcast: { AU1: [0.18, 0.4], AU15: [0.34, 0.66], gazeY: [-0.44, -0.2], AU7: [0.08, 0.24] },
            teary: { AU1: [0.32, 0.62], AU15: [0.28, 0.58], AU6: [0.04, 0.16], gazeY: [-0.34, -0.12] }
        }
    },
    shy: {
        base: { AU12: [0.22, 0.48], AU6: [0.12, 0.34], AU1: [0.08, 0.24], gazeY: [-0.34, -0.1], gazeX: [-0.2, 0.2], blush: [0.32, 0.82] },
        variants: {
            bashful: { AU12: [0.28, 0.54], AU6: [0.18, 0.38], gazeY: [-0.42, -0.18], blush: [0.46, 0.92] },
            embarrassed: { AU1: [0.14, 0.36], AU15: [0.04, 0.18], AU12: [0.14, 0.36], gazeY: [-0.5, -0.2], blush: [0.55, 1] }
        }
    },
    neutral: {
        base: { AU12: [0.06, 0.2], AU6: [0.02, 0.12], AU2: [0.02, 0.1], gazeY: [-0.04, 0.08], blush: [0, 0.08] },
        variants: {
            attentive: { AU12: [0.08, 0.22], AU2: [0.05, 0.16], gazeY: [0, 0.12] },
            quiet: { AU12: [0.04, 0.16], AU6: [0.02, 0.1], gazeY: [-0.06, 0.04] }
        }
    }
};

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function normalizeEmotion(emotion) {
    const text = String(emotion || '').trim().toLowerCase();
    if (!text) return 'neutral';
    if (text.includes('happy') || text.includes('joy') || text.includes('开心') || text.includes('高兴') || text.includes('快乐')) return 'happy';
    if (text.includes('playful') || text.includes('tease') || text.includes('俏皮') || text.includes('调皮') || text.includes('得意')) return 'playful';
    if (text.includes('surpris') || text.includes('惊讶') || text.includes('惊喜') || text.includes('吃惊')) return 'surprised';
    if (text.includes('angry') || text.includes('anger') || text.includes('生气') || text.includes('愤怒') || text.includes('恼火')) return 'angry';
    if (text.includes('sad') || text.includes('down') || text.includes('难过') || text.includes('伤心') || text.includes('委屈')) return 'sad';
    if (text.includes('shy') || text.includes('害羞') || text.includes('脸红')) return 'shy';
    if (text.includes('excited')) return 'happy';
    if (text.includes('calm')) return 'neutral';
    return ARCHETYPES[text] ? text : 'neutral';
}

function seededRandom(seed) {
    let state = Math.floor(Number(seed) || 0) >>> 0;
    if (state === 0) state = 0x6d2b79f5;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function seedFromNow() {
    return ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function sampleRange(range, random) {
    if (!Array.isArray(range)) return 0;
    const min = Number(range[0]);
    const max = Number(range[1]);
    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(max) ? max : lo;
    return lo + (hi - lo) * random();
}

function mergeRanges(base, variant) {
    return { ...(base || {}), ...(variant || {}) };
}

function sample(emotion, intensity = 1, seed = null, variantName = null) {
    const normalized = normalizeEmotion(emotion);
    const archetype = ARCHETYPES[normalized] || ARCHETYPES.neutral;
    const random = seededRandom(seed == null ? seedFromNow() : seed);
    const variants = Object.keys(archetype.variants || {});
    const pickedVariant = variantName && archetype.variants[variantName]
        ? variantName
        : variants[Math.floor(random() * variants.length)] || '';
    const ranges = mergeRanges(archetype.base, archetype.variants[pickedVariant]);
    const gain = clamp(intensity, 0, 1.5);
    const auMap = {};

    for (const [key, range] of Object.entries(ranges)) {
        auMap[key] = sampleRange(range, random) * gain;
    }

    return {
        emotion: normalized,
        variant: pickedVariant,
        auMap
    };
}

// strict 模式下可直达的补充词表：这些预设被 normalizeEmotion 折叠（excited→happy、calm→neutral）
// 或完全不识别（anxiety/tired → neutral），导致对应 VAD 预设永远取不到。
// 仅「仅 AI 编舞」档的调用方传 { strict: true } 启用，blend 档行为不变。
const STRICT_PRESET_ALIASES = {
    '兴奋': 'excited', '激动': 'excited', 'hyped': 'excited',
    '平静': 'calm', '冷静': 'calm', '淡定': 'calm', 'relaxed': 'calm',
    '焦虑': 'anxiety', '紧张': 'anxiety', '不安': 'anxiety', 'anxious': 'anxiety', 'nervous': 'anxiety',
    '疲惫': 'tired', '困倦': 'tired', '困': 'tired', '累': 'tired', 'sleepy': 'tired', 'exhausted': 'tired',
    '温柔': 'affectionate', '亲昵': 'affectionate', '喜欢': 'affectionate',
    '好奇': 'curious',
    '担心': 'concerned', '担忧': 'concerned', 'worried': 'concerned',
    '困惑': 'confused', '疑惑': 'confused', '迷茫': 'confused'
};

// 仅 strict 路径可达的扩展预设（对齐 soullink classifier 的 14 类情绪）。
// 故意不并入 VAD_PRESETS：_nearestPreset 会遍历 VAD_PRESETS，
// 并入会改变 blend 档的情绪反查结果，违反冻结要求。
const STRICT_EXTRA_PRESETS = {
    affectionate: { valence: 0.68, arousal: 0.18, dominance: 0.12 },
    curious: { valence: 0.32, arousal: 0.38, dominance: 0.08 },
    concerned: { valence: -0.34, arousal: 0.22, dominance: -0.12 },
    confused: { valence: -0.12, arousal: 0.3, dominance: -0.18 }
};

function resolveStrictEmotionName(emotion) {
    const raw = String(emotion || '').trim().toLowerCase();
    if (!raw) return null;
    if (VAD_PRESETS[raw] || STRICT_EXTRA_PRESETS[raw]) return raw;
    const alias = STRICT_PRESET_ALIASES[raw];
    if (alias && (VAD_PRESETS[alias] || STRICT_EXTRA_PRESETS[alias])) return alias;
    return null;
}

function getVADPreset(emotion, options = null) {
    if (options && options.strict) {
        const name = resolveStrictEmotionName(emotion);
        if (name) return { ...(VAD_PRESETS[name] || STRICT_EXTRA_PRESETS[name]) };
        // strict 下无直配再走旧归一化，保证兜底
    }
    const normalized = normalizeEmotion(emotion);
    return { ...(VAD_PRESETS[normalized] || VAD_PRESETS.neutral) };
}

module.exports = {
    ARCHETYPES,
    STRICT_EXTRA_PRESETS,
    VAD_PRESETS,
    getVADPreset,
    normalizeEmotion,
    resolveStrictEmotionName,
    sample,
    seededRandom
};
