'use strict';

const fs = require('fs');
const path = require('path');
const {
    FacialRegion,
    SemanticAction,
    semanticActionRegion
} = require('./semantic-actions.js');

const EmotionKind = Object.freeze({
    JOY: 'joy',
    SADNESS: 'sadness',
    ANGER: 'anger',
    SURPRISE: 'surprise',
    PLAYFUL: 'playful',
    SMUG: 'smug',
    WRY: 'wry',
    SHY: 'shy'
});

const EMOTION_KIND_BY_TAG = Object.freeze({
    开心: EmotionKind.JOY,
    生气: EmotionKind.ANGER,
    难过: EmotionKind.SADNESS,
    惊讶: EmotionKind.SURPRISE,
    害羞: EmotionKind.SHY,
    俏皮: EmotionKind.PLAYFUL
});

const PROFILE_FILE_NAME = 'expression_profile.json';
const NATIVE_SCORE = 0.85;

function target(action, minValue, maxValue) {
    return { action, minValue, maxValue };
}

function semanticUnit(id, targets, emotions, options = {}) {
    return {
        id,
        kind: 'semantic',
        enabled: options.enabled !== false,
        targets,
        emotions: { ...emotions },
        baseline: Number(options.baseline) || 0,
        easing: typeof options.easing === 'string' ? options.easing : 'in_out_sine',
        linkedSampling: options.linkedSampling === true,
        regions: [...new Set(targets.map(item => semanticActionRegion(item.action)).filter(Boolean))]
    };
}

function nativeUnit(id, nativeType, nativeRef, regions, emotions, options = {}) {
    return {
        id,
        kind: 'native',
        enabled: options.enabled !== false,
        nativeType,
        nativeRef,
        regions: [...new Set(regions)],
        emotions: { ...emotions },
        baseline: Number(options.baseline) || 0
    };
}

function defaultSemanticUnits() {
    const E = EmotionKind;
    const A = SemanticAction;
    return [
        semanticUnit('皱眉', [target(A.BROW_HEIGHT, 0, 0.1)], {
            [E.ANGER]: 1,
            [E.SADNESS]: 1,
            [E.WRY]: 1
        }),
        semanticUnit('轻微抬眉', [target(A.BROW_HEIGHT, 0.5, 0.7)], {
            [E.JOY]: 0.58,
            [E.PLAYFUL]: 0.45,
            [E.SMUG]: 0.5
        }),
        semanticUnit('抬眉', [target(A.BROW_HEIGHT, 0.7, 1)], {
            [E.JOY]: 0.69,
            [E.SURPRISE]: 1
        }),
        semanticUnit('闭眼', [target(A.EYE_OPEN, 0, 0)], {
            [E.SADNESS]: 0.23,
            [E.WRY]: 0.34,
            [E.SHY]: 0.3
        }),
        semanticUnit('眯眼', [target(A.EYE_OPEN, 0.2, 0.4)], {
            [E.JOY]: 0.76,
            [E.ANGER]: 0.88,
            [E.SADNESS]: 0.79,
            [E.SMUG]: 0.7
        }),
        semanticUnit('睁眼', [target(A.EYE_OPEN, 0.75, 1)], {
            [E.JOY]: 0.2,
            [E.SURPRISE]: 1
        }),
        semanticUnit('瞪眼', [target(A.EYE_WIDE, 0.5, 1)], {
            [E.SURPRISE]: 1,
            [E.ANGER]: 0.4
        }),
        semanticUnit('wink 左眼', [
            target(A.EYE_OPEN_LEFT, 0, 0),
            target(A.EYE_OPEN_RIGHT, 0.75, 1)
        ], {
            [E.JOY]: 0.58,
            [E.PLAYFUL]: 1
        }),
        semanticUnit('wink 右眼', [
            target(A.EYE_OPEN_LEFT, 0.75, 1),
            target(A.EYE_OPEN_RIGHT, 0, 0)
        ], {
            [E.JOY]: 0.58,
            [E.PLAYFUL]: 1
        }),
        semanticUnit('目移', [target(A.EYE_GAZE_X, -1, 1)], {
            [E.SADNESS]: 0.72,
            [E.SHY]: 0.7,
            [E.WRY]: 0.8
        }),
        semanticUnit('眼睛下看', [target(A.EYE_GAZE_Y, -1, -0.7)], {
            [E.SADNESS]: 0.8,
            [E.WRY]: 0.8,
            [E.SHY]: 0.4
        }),
        semanticUnit('眼睛上看', [target(A.EYE_GAZE_Y, 0.7, 1)], {}),
        semanticUnit('嘴角上扬', [target(A.MOUTH_SMILE, 0.6, 1)], {
            [E.JOY]: 0.82,
            [E.PLAYFUL]: 0.9,
            [E.SMUG]: 0.65,
            [E.WRY]: 0.7,
            [E.SHY]: 0.45
        }),
        semanticUnit('嘴角下撇', [target(A.MOUTH_SMILE, 0, 0.4)], {
            [E.SADNESS]: 0.92,
            [E.ANGER]: 0.44,
            [E.SMUG]: 0.45,
            [E.SURPRISE]: 1
        }),
        semanticUnit('闭嘴', [target(A.MOUTH_OPEN, 0, 0.1)], {
            [E.ANGER]: 0.3,
            [E.SADNESS]: 0.25,
            [E.SURPRISE]: 0.7
        }),
        semanticUnit('嘴巴微张', [target(A.MOUTH_OPEN, 0.15, 0.2)], {
            [E.JOY]: 0.76,
            [E.SADNESS]: 0.16,
            [E.SURPRISE]: 0.6,
            [E.PLAYFUL]: 0.4,
            [E.SMUG]: 0.8
        }),
        semanticUnit('嘴巴张大', [target(A.MOUTH_OPEN, 0.6, 1)], {
            [E.JOY]: 0.25,
            [E.SURPRISE]: 0.8
        }),
        semanticUnit('下颌张开', [target(A.MOUTH_JAW_OPEN, 0.5, 1)], {
            [E.SURPRISE]: 1,
            [E.JOY]: 0.3
        }),
        semanticUnit('抿嘴', [
            target(A.MOUTH_SMILE, 0.4, 0.4),
            target(A.MOUTH_OPEN, 0, 0)
        ], {
            [E.ANGER]: 0.86,
            [E.SADNESS]: 0.34
        }),
        semanticUnit('拢嘴', [target(A.MOUTH_FUNNEL, 0.5, 1)], {
            [E.SMUG]: 0.4
        }),
        semanticUnit('撅嘴', [target(A.MOUTH_PUCKER, 0.4, 1)], {
            [E.SHY]: 0.55,
            [E.SADNESS]: 0.3,
            [E.WRY]: 0.6
        }),
        semanticUnit('咧嘴', [target(A.MOUTH_PUCKER, -1, -0.4)], {
            [E.JOY]: 0.4,
            [E.SMUG]: 0.35,
            [E.WRY]: 0.6
        }),
        semanticUnit('耸嘴', [target(A.MOUTH_SHRUG, 0.4, 1)], {
            [E.WRY]: 0.62,
            [E.ANGER]: 0.35,
            [E.SADNESS]: 0.28,
            [E.SMUG]: 0.3
        }),
        semanticUnit('鼓腮', [target(A.MOUTH_CHEEK_PUFF, 0.5, 1)], {
            [E.SHY]: 0.7,
            [E.ANGER]: 0.9
        }),
        semanticUnit('微微吐舌', [target(A.MOUTH_TONGUE_OUT, 0.3, 0.6)], {
            [E.PLAYFUL]: 0.9,
            [E.SMUG]: 0.45,
            [E.JOY]: 0.35,
            [E.SHY]: 0.25
        }),
        semanticUnit('嘴移', [target(A.MOUTH_X, -1, 1)], {
            [E.ANGER]: 0.6,
            [E.PLAYFUL]: 0.7,
            [E.SMUG]: 0.6,
            [E.SURPRISE]: 0.5
        }),
        semanticUnit('嘴部居中', [target(A.MOUTH_X, 0, 0)], {
            [E.SADNESS]: 0.24
        }),
        semanticUnit('抬头', [target(A.HEAD_PITCH, 0.3, 0.7)], {}, {
            baseline: 0.05
        }),
        semanticUnit('低头', [target(A.HEAD_PITCH, -0.7, -0.3)], {
            [E.SADNESS]: 0.8,
            [E.ANGER]: 0.8,
            [E.SHY]: 0.55,
            [E.WRY]: 0.8
        }),
        semanticUnit('歪头', [target(A.HEAD_ROLL, -0.5, 0.5)], {
            [E.JOY]: 0.45,
            [E.PLAYFUL]: 0.8,
            [E.SMUG]: 0.55,
            [E.SHY]: 0.5
        }, {
            baseline: 0.25
        }),
        semanticUnit('转头', [target(A.HEAD_YAW, -0.5, 0.5)], {}, {
            baseline: 0.2
        }),
        semanticUnit('阴险抬眼', [
            target(A.HEAD_PITCH, -0.6, -0.3),
            target(A.EYE_GAZE_Y, 0.6, 1)
        ], {
            [E.SMUG]: 0.8,
            [E.ANGER]: 0.65
        }),
        semanticUnit('身体前倾', [target(A.BODY_ANGLE_Y, 0.45, 0.75)], {
            [E.JOY]: 0.75,
            [E.ANGER]: 0.85,
            [E.PLAYFUL]: 0.8
        }),
        semanticUnit('垂头含胸', [
            target(A.HEAD_PITCH, -0.6, -0.3),
            target(A.BODY_ANGLE_Y, -0.65, -0.35)
        ], {
            [E.SADNESS]: 0.75,
            [E.WRY]: 0.7,
            [E.SHY]: 0.5
        }),
        semanticUnit('惊讶后仰', [
            target(A.BODY_ANGLE_Y, -0.75, -0.45),
            target(A.HEAD_PITCH, 0.2, 0.5)
        ], {
            [E.SURPRISE]: 0.9
        }),
        semanticUnit('身体侧摆', [target(A.BODY_ANGLE_Z, -0.55, 0.55)], {}, {
            baseline: 0.25
        }),
        semanticUnit('扭身避视', [
            target(A.BODY_ANGLE_X, -0.65, 0.65),
            target(A.EYE_GAZE_X, -1, 1)
        ], {
            [E.SHY]: 0.6,
            [E.WRY]: 0.5
        }, {
            linkedSampling: true
        })
    ];
}

function defaultRules() {
    return [];
}

function emotionKindFromTag(tag) {
    return EMOTION_KIND_BY_TAG[String(tag || '').trim()] || null;
}

function buildNativeExpressionUnits(motionConfig = {}, expressionConfig = {}) {
    const unitsByKey = new Map();

    const add = (config, nativeType) => {
        for (const [tag, files] of Object.entries(config || {})) {
            const emotion = emotionKindFromTag(tag);
            if (!emotion || !Array.isArray(files)) continue;
            for (const rawFile of files) {
                const nativeRef = normalizeFileRef(rawFile);
                if (!nativeRef) continue;
                const key = `${nativeType}:${nativeRef.toLowerCase()}`;
                let unit = unitsByKey.get(key);
                if (!unit) {
                    unit = nativeUnit(
                        `原生${nativeType === 'motion' ? '动作' : '表情'}:${nativeRef}`,
                        nativeType,
                        nativeRef,
                        nativeType === 'motion'
                            ? [FacialRegion.HEAD, FacialRegion.BODY]
                            : [FacialRegion.BROW, FacialRegion.EYE, FacialRegion.MOUTH],
                        {}
                    );
                    unitsByKey.set(key, unit);
                }
                unit.emotions[emotion] = Math.max(Number(unit.emotions[emotion]) || 0, NATIVE_SCORE);
            }
        }
    };

    add(motionConfig, 'motion');
    add(expressionConfig, 'expression');
    return [...unitsByKey.values()];
}

function nativeExclusionRules(nativeUnits) {
    const rules = [];
    for (const nativeType of ['motion', 'expression']) {
        const ids = nativeUnits
            .filter(unit => unit.nativeType === nativeType)
            .map(unit => unit.id);
        if (ids.length > 1) {
            rules.push({
                kind: 'mutual_exclusion',
                id: `native-${nativeType}-exclusive`,
                unitIds: ids,
                emotions: []
            });
        }
    }
    return rules;
}

function createExpressionProfileSeed() {
    const units = {};
    for (const unit of defaultSemanticUnits()) {
        units[unit.id] = {
            enabled: unit.enabled !== false,
            emotions: { ...unit.emotions },
            baseline: unit.baseline,
            easing: unit.easing
        };
    }
    return {
        version: 1,
        bindings: {},
        units,
        rules: []
    };
}

function loadExpressionProfile(modelDir, logger = console) {
    const seed = createExpressionProfileSeed();
    if (!modelDir) return { profile: seed, path: null, seeded: false };
    const filePath = path.join(modelDir, PROFILE_FILE_NAME);
    if (!fs.existsSync(filePath)) {
        logger?.info?.(`[AuDriver] 未找到模型 AU 配置，使用内置默认值: ${filePath}`);
        return { profile: seed, path: filePath, seeded: false };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            profile: normalizeProfile(parsed, seed),
            path: filePath,
            seeded: false
        };
    } catch (error) {
        logger?.warn?.(`[AuDriver] 读取模型 AU 配置失败，使用内置默认值: ${error.message}`);
        return { profile: seed, path: filePath, seeded: false };
    }
}

function buildExpressionRuntime({ modelDir, motionConfig, expressionConfig, logger = console } = {}) {
    const loaded = loadExpressionProfile(modelDir, logger);
    const semanticUnits = applyUnitOverrides(defaultSemanticUnits(), loaded.profile.units);
    const nativeUnits = [
        ...buildNativeExpressionUnits(motionConfig, expressionConfig),
        ...normalizeCustomNativeUnits(loaded.profile.native_units)
    ];
    const rules = [
        ...defaultRules(),
        ...nativeExclusionRules(nativeUnits),
        ...normalizeRules(loaded.profile.rules)
    ];
    return {
        profile: loaded.profile,
        profilePath: loaded.path,
        seeded: loaded.seeded,
        units: [...semanticUnits, ...nativeUnits],
        rules
    };
}

function normalizeProfile(raw, fallback) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
    return {
        version: Number(raw.version) || fallback.version,
        bindings: isPlainObject(raw.bindings) ? raw.bindings : {},
        units: isPlainObject(raw.units) ? raw.units : fallback.units,
        native_units: Array.isArray(raw.native_units) ? raw.native_units : [],
        rules: Array.isArray(raw.rules) ? raw.rules : []
    };
}

function applyUnitOverrides(units, overrides) {
    return units.map(unit => {
        const override = overrides?.[unit.id];
        if (!isPlainObject(override)) return unit;
        const targets = Array.isArray(override.targets)
            ? normalizeTargets(override.targets, unit.targets)
            : unit.targets;
        return {
            ...unit,
            enabled: typeof override.enabled === 'boolean' ? override.enabled : unit.enabled,
            targets,
            emotions: isPlainObject(override.emotions)
                ? { ...unit.emotions, ...normalizeEmotionScores(override.emotions) }
                : unit.emotions,
            baseline: Number.isFinite(Number(override.baseline)) ? Number(override.baseline) : unit.baseline,
            easing: typeof override.easing === 'string' && override.easing ? override.easing : unit.easing,
            regions: [...new Set(targets.map(item => semanticActionRegion(item.action)).filter(Boolean))]
        };
    });
}

function normalizeTargets(rawTargets, fallback) {
    const targets = rawTargets
        .map(item => {
            if (!isPlainObject(item) || !semanticActionRegion(item.action)) return null;
            const minValue = Number(item.min_value ?? item.minValue);
            const maxValue = Number(item.max_value ?? item.maxValue);
            if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return null;
            return target(item.action, minValue, maxValue);
        })
        .filter(Boolean);
    return targets.length > 0 ? targets : fallback;
}

function normalizeCustomNativeUnits(rawUnits) {
    return (Array.isArray(rawUnits) ? rawUnits : [])
        .map(item => {
            if (!isPlainObject(item) || !item.id || !item.native_ref || !item.native_type) return null;
            const nativeType = item.native_type === 'motion' ? 'motion' : item.native_type === 'expression' ? 'expression' : null;
            if (!nativeType) return null;
            const regions = Array.isArray(item.regions)
                ? item.regions.filter(region => Object.values(FacialRegion).includes(region))
                : nativeType === 'motion'
                    ? [FacialRegion.HEAD, FacialRegion.BODY]
                    : [FacialRegion.BROW, FacialRegion.EYE, FacialRegion.MOUTH];
            return nativeUnit(
                String(item.id),
                nativeType,
                normalizeFileRef(item.native_ref),
                regions,
                normalizeEmotionScores(item.emotions),
                {
                    enabled: item.enabled !== false,
                    baseline: item.baseline
                }
            );
        })
        .filter(Boolean);
}

function normalizeRules(rawRules) {
    return rawRules
        .map(rule => {
            if (!isPlainObject(rule) || !rule.id) return null;
            const kind = rule.kind;
            const unitIds = Array.isArray(rule.unit_ids ?? rule.unitIds)
                ? [...new Set((rule.unit_ids ?? rule.unitIds).map(String).filter(Boolean))]
                : [];
            if (kind === 'mutual_exclusion' && unitIds.length > 1) {
                return {
                    kind,
                    id: String(rule.id),
                    unitIds,
                    emotions: normalizeEmotionList(rule.emotions)
                };
            }
            if (kind === 'bonus' && unitIds.length > 0 && Number.isFinite(Number(rule.value))) {
                return {
                    kind,
                    id: String(rule.id),
                    unitIds,
                    value: Number(rule.value),
                    emotions: normalizeEmotionList(rule.emotions)
                };
            }
            return null;
        })
        .filter(Boolean);
}

function normalizeEmotionScores(raw) {
    const result = {};
    for (const [emotion, score] of Object.entries(raw || {})) {
        if (!Object.values(EmotionKind).includes(emotion)) continue;
        const value = Number(score);
        if (Number.isFinite(value)) result[emotion] = value;
    }
    return result;
}

function normalizeEmotionList(raw) {
    return Array.isArray(raw)
        ? [...new Set(raw.filter(emotion => Object.values(EmotionKind).includes(emotion)))]
        : [];
}

function normalizeFileRef(value) {
    return typeof value === 'string' ? value.replace(/\\/g, '/').trim() : '';
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
    EmotionKind,
    EMOTION_KIND_BY_TAG,
    PROFILE_FILE_NAME,
    emotionKindFromTag,
    defaultSemanticUnits,
    defaultRules,
    buildNativeExpressionUnits,
    createExpressionProfileSeed,
    loadExpressionProfile,
    buildExpressionRuntime
};
