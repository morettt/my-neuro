'use strict';

const fs = require('fs');
const path = require('path');

const MOUTH_OPEN_PARAMS = new Set(['ParamMouthOpenY']);
const MAX_SQUINT = 0.45;

const FACE_PARAM_WHITELIST = new Set([
    'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLX', 'ParamBrowRX',
    'ParamBrowLAngle', 'ParamBrowRAngle', 'ParamBrowLForm', 'ParamBrowRForm',
    'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeLSmile', 'ParamEyeRSmile',
    'EyeL_Squint', 'EyeR_Squint', 'ParamEyeBallX', 'ParamEyeBallY',
    'ParamMouthForm', 'ParamMouthX', 'ParamMouthFunnel', 'ParamMouthPressLipOpen',
    'ParamMouthShrug', 'ParamMouthPuckerWiden', 'ParamJawOpen',
    'Param100', 'ParamCheek', 'ParamCheeckPuff',
    'Param74'
]);

const DEFAULT_AU_MAP = {
    AU1: {
        ParamBrowLY: 0.42,
        ParamBrowRY: 0.42,
        ParamBrowLAngle: -0.18,
        ParamBrowRAngle: 0.18
    },
    AU2: {
        ParamBrowLY: 0.24,
        ParamBrowRY: 0.24,
        ParamBrowLX: -0.16,
        ParamBrowRX: 0.16
    },
    AU4: {
        ParamBrowLY: -0.45,
        ParamBrowRY: -0.45,
        ParamBrowLAngle: -0.42,
        ParamBrowRAngle: 0.42,
        ParamBrowLForm: -0.18,
        ParamBrowRForm: -0.18
    },
    AU5: {
        ParamEyeLOpen: 0.22,
        ParamEyeROpen: 0.22,
        ParamBrowLY: 0.12,
        ParamBrowRY: 0.12
    },
    AU6: {
        ParamEyeLSmile: 1,
        ParamEyeRSmile: 1,
        EyeL_Squint: 0.44,
        EyeR_Squint: 0.44,
        ParamCheek: 0.56,
        ParamCheeckPuff: 0.22
    },
    AU7: {
        EyeL_Squint: 0.85,
        EyeR_Squint: 0.85,
        ParamEyeLOpen: -0.16,
        ParamEyeROpen: -0.16
    },
    AU12: {
        ParamMouthForm: 0.78,
        ParamMouthPuckerWiden: 0.26,
        ParamEyeLSmile: 0.62,
        ParamEyeRSmile: 0.62,
        ParamCheek: 0.5
    },
    AU15: {
        ParamMouthForm: -0.86,
        ParamMouthShrug: -0.24,
        ParamBrowLY: -0.08,
        ParamBrowRY: -0.08
    },
    AU18: {
        ParamMouthFunnel: 0.9,
        ParamMouthPuckerWiden: -0.34,
        ParamMouthX: 0.08
    },
    AU23: {
        ParamMouthPressLipOpen: 0.58,
        ParamMouthForm: -0.18,
        ParamJawOpen: -0.12
    },
    AU25: {
        ParamJawOpen: 0.28,
        ParamMouthFunnel: 0.12
    },
    AU26: {
        ParamJawOpen: 0.72,
        ParamMouthFunnel: 0.2,
        ParamMouthForm: 0.08
    },
    AU43: {
        ParamEyeLOpen: -0.95,
        ParamEyeROpen: -0.95,
        EyeL_Squint: 0.22,
        EyeR_Squint: 0.22
    },
    blush: {
        ParamCheek: 1,
        Param100: 0.7,
        Param74: 1
    },
    gazeX: {
        ParamEyeBallX: 1
    },
    gazeY: {
        ParamEyeBallY: 1
    }
};

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function normalizeAUKey(key) {
    const raw = String(key || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    const aliases = {
        blush: 'blush',
        gazex: 'gazeX',
        gazey: 'gazeY'
    };
    const compact = lower.replace(/[\s_-]+/g, '');
    if (aliases[compact]) {
        return aliases[compact];
    }
    const numeric = lower.replace(/^au/, '').replace(/^0+/, '');
    if (/^\d+$/.test(numeric)) return `AU${Number(numeric)}`;
    return raw.toUpperCase();
}

function normalizeCatalog(catalogById) {
    if (!catalogById) return new Map();
    if (catalogById instanceof Map) return catalogById;
    if (Array.isArray(catalogById)) return new Map(catalogById.map(item => [item.id, item]));
    if (typeof catalogById === 'object') return new Map(Object.entries(catalogById));
    return new Map();
}

function defaultFor(info) {
    const value = Number(info?.default);
    return Number.isFinite(value) ? value : 0;
}

function deltaForParam(id, info, coeff) {
    const min = Number.isFinite(Number(info?.min)) ? Number(info.min) : -1;
    const max = Number.isFinite(Number(info?.max)) ? Number(info.max) : 1;
    const span = Math.max(0.001, max - min);
    const absMax = Math.max(Math.abs(min), Math.abs(max), 0.001);

    if (id === 'ParamEyeBallX' || id === 'ParamEyeBallY') return coeff * Math.min(absMax, span * 0.5);
    if (id === 'ParamEyeLOpen' || id === 'ParamEyeROpen') return coeff * span * 0.46;
    if (id === 'ParamEyeLSmile' || id === 'ParamEyeRSmile') return coeff * span * 0.92;
    if (id === 'EyeL_Squint' || id === 'EyeR_Squint') return Math.sign(coeff) * Math.min(MAX_SQUINT, Math.abs(coeff) * span);
    if (id === 'ParamJawOpen') return coeff * span * 0.42;
    if (id === 'ParamCheek' || id === 'ParamCheeckPuff' || id === 'Param100') return coeff * span * 0.86;
    if (id === 'Param74') return coeff * span;
    return coeff * span * 0.45;
}

function readOverrideFileUncached(modelDir) {
    if (!modelDir) return null;
    const filePath = path.join(modelDir, 'facs_map.json');
    try {
        if (!fs.existsSync(filePath)) return null;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

// facs_map.json 读盘缓存（纯性能优化，输出与逐次读盘完全一致）：
// 旧实现每个关键帧都 existsSync + readFileSync + JSON.parse，一轮对话 20~40 次同步 IO 在渲染进程主线程上。
// 现在按 modelDir 缓存，2 秒内直接复用；超过 2 秒重新 stat mtime，文件没变继续复用，变了才重读。
// 校准面板保存 facs_map.json 后可调 clearOverrideCache() 立即失效。
const OVERRIDE_CACHE_STAT_INTERVAL_MS = 2000;
const overrideCache = new Map(); // modelDir -> { checkedAt, mtimeMs, override }

function readOverrideFile(modelDir) {
    if (!modelDir) return null;
    const now = Date.now();
    const cached = overrideCache.get(modelDir);
    if (cached && (now - cached.checkedAt) < OVERRIDE_CACHE_STAT_INTERVAL_MS) {
        return cached.override;
    }
    let mtimeMs = -1;
    try {
        const stat = fs.statSync(path.join(modelDir, 'facs_map.json'));
        mtimeMs = stat.mtimeMs;
    } catch (_) {
        mtimeMs = -1; // 文件不存在
    }
    if (cached && cached.mtimeMs === mtimeMs) {
        cached.checkedAt = now;
        return cached.override;
    }
    const override = mtimeMs === -1 ? null : readOverrideFileUncached(modelDir);
    overrideCache.set(modelDir, { checkedAt: now, mtimeMs, override });
    return override;
}

function clearOverrideCache(modelDir = null) {
    if (modelDir) overrideCache.delete(modelDir);
    else overrideCache.clear();
}

// 读取 facs_map.json 里的声明式情绪规则（profile-generator 产出，仅 director 档消费）。
// 规则形如 { id, trigger: { emotion: [..] | vad_window: {axis:[min,max]} }, targets: {param: value},
//            intensity, priority, exclusive_group }
function getModelRules(modelDir) {
    const override = readOverrideFile(modelDir);
    const rules = override?.rules;
    if (!Array.isArray(rules)) return [];
    return rules.filter(rule =>
        rule && typeof rule === 'object' &&
        rule.targets && typeof rule.targets === 'object' &&
        rule.trigger && typeof rule.trigger === 'object'
    );
}

function mergeMappings(base, override) {
    const result = {};
    for (const [au, mapping] of Object.entries(base || {})) {
        result[normalizeAUKey(au)] = { ...(mapping || {}) };
    }
    const source = override?.mappings || override?.au_map || override;
    if (!source || typeof source !== 'object') return result;
    for (const [au, mapping] of Object.entries(source)) {
        if (!mapping || typeof mapping !== 'object') continue;
        const key = normalizeAUKey(au);
        result[key] = { ...(result[key] || {}), ...mapping };
    }
    return result;
}

class FACSMapper {
    constructor(mapping = DEFAULT_AU_MAP) {
        this.mapping = mergeMappings(mapping, null);
    }

    loadModelOverride(modelDir) {
        const override = readOverrideFile(modelDir);
        if (!override) return false;
        this.mapping = mergeMappings(this.mapping, override);
        return true;
    }

    expand(auMap, catalogById, options = {}) {
        const catalog = normalizeCatalog(catalogById);
        const offsets = this.expandToOffsets(auMap, catalog, options);
        const result = {};
        for (const [id, offset] of Object.entries(offsets)) {
            const info = catalog.get(id);
            if (!info) continue;
            const value = defaultFor(info) + offset;
            result[id] = clampParam(id, value, info);
        }
        return result;
    }

    expandToOffsets(auMap, catalogById, options = {}) {
        const catalog = normalizeCatalog(catalogById);
        const modelOverride = options.modelDir ? readOverrideFile(options.modelDir) : null;
        const mapping = modelOverride ? mergeMappings(this.mapping, modelOverride) : this.mapping;
        const result = {};
        const source = auMap && typeof auMap === 'object' ? auMap : {};

        for (const [rawKey, rawIntensity] of Object.entries(source)) {
            const auKey = normalizeAUKey(rawKey);
            const intensity = clamp(rawIntensity, -1, 1);
            if (!intensity) continue;
            const auMapping = mapping[auKey];
            if (!auMapping) continue;

            for (const [id, coeff] of Object.entries(auMapping)) {
                if (MOUTH_OPEN_PARAMS.has(id) || !FACE_PARAM_WHITELIST.has(id)) continue;
                const info = catalog.get(id);
                if (!info) continue;
                let delta = deltaForParam(id, info, Number(coeff) || 0) * intensity;
                // 口型仲裁（仅 director 档调用方传入）：说话期 ParamMouthForm 让位 lipsync，
                // 避免微笑口型与嘴形动画抢同一参数产生抖动。mouthFormScale 缺省 undefined = 行为不变。
                if (id === 'ParamMouthForm' && Number.isFinite(options.mouthFormScale)) {
                    delta *= clamp(options.mouthFormScale, 0, 1);
                }
                if (!Number.isFinite(delta) || delta === 0) continue;
                result[id] = (result[id] || 0) + delta;
            }
        }

        for (const id of ['EyeL_Squint', 'EyeR_Squint']) {
            const info = catalog.get(id);
            if (!info || result[id] === undefined) continue;
            const target = clamp(defaultFor(info) + result[id], info.min, Math.min(info.max, MAX_SQUINT));
            result[id] = target - defaultFor(info);
        }

        return result;
    }
}

function clampParam(id, value, info) {
    const min = Number.isFinite(Number(info?.min)) ? Number(info.min) : -1;
    const max = Number.isFinite(Number(info?.max)) ? Number(info.max) : 1;
    const effectiveMax = (id === 'EyeL_Squint' || id === 'EyeR_Squint') ? Math.min(max, MAX_SQUINT) : max;
    return clamp(value, min, effectiveMax);
}

const defaultMapper = new FACSMapper();

module.exports = {
    AU_VOCABULARY: Object.keys(DEFAULT_AU_MAP),
    DEFAULT_AU_MAP,
    FACSMapper,
    clamp,
    clearOverrideCache,
    getModelRules,
    expand: (...args) => defaultMapper.expand(...args),
    expandToOffsets: (...args) => defaultMapper.expandToOffsets(...args),
    loadModelOverride: (...args) => defaultMapper.loadModelOverride(...args),
    normalizeAUKey
};
