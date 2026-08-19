'use strict';

const FacialRegion = Object.freeze({
    BROW: 'brow',
    EYE: 'eye',
    MOUTH: 'mouth',
    HEAD: 'head',
    BODY: 'body'
});

const LIVE2D_MOUTH_OPEN_PARAMS = Object.freeze([
    'ParamMouthOpenY',
    'PARAM_MOUTH_OPEN_Y',
    'ParamMouthOpen'
]);
const LIVE2D_MOUTH_FALLBACK_PARAMS = Object.freeze(['ParamA']);

const SemanticAction = Object.freeze({
    BROW_HEIGHT: 'brow.height',
    BROW_HEIGHT_LEFT: 'brow.height.left',
    BROW_HEIGHT_RIGHT: 'brow.height.right',
    EYE_OPEN: 'eye.open',
    EYE_OPEN_LEFT: 'eye.open.left',
    EYE_OPEN_RIGHT: 'eye.open.right',
    EYE_GAZE_X: 'eye.gaze.x',
    EYE_GAZE_Y: 'eye.gaze.y',
    EYE_WIDE: 'eye.wide',
    MOUTH_OPEN: 'mouth.open',
    MOUTH_SMILE: 'mouth.smile',
    MOUTH_X: 'mouth.x',
    MOUTH_JAW_OPEN: 'mouth.jaw.open',
    MOUTH_FUNNEL: 'mouth.funnel',
    MOUTH_PUCKER: 'mouth.pucker',
    MOUTH_SHRUG: 'mouth.shrug',
    MOUTH_CHEEK_PUFF: 'mouth.cheek.puff',
    MOUTH_TONGUE_OUT: 'mouth.tongue.out',
    HEAD_YAW: 'head.yaw',
    HEAD_PITCH: 'head.pitch',
    HEAD_ROLL: 'head.roll',
    BODY_ANGLE_X: 'body.angle.x',
    BODY_ANGLE_Y: 'body.angle.y',
    BODY_ANGLE_Z: 'body.angle.z'
});

const DEFAULT_SEMANTIC_ACTION_SPECS = Object.freeze([
    spec(SemanticAction.BROW_HEIGHT, 0, 1, FacialRegion.BROW, 0.5, [
        SemanticAction.BROW_HEIGHT_LEFT,
        SemanticAction.BROW_HEIGHT_RIGHT
    ]),
    spec(SemanticAction.BROW_HEIGHT_LEFT, 0, 1, FacialRegion.BROW, 0.5, [SemanticAction.BROW_HEIGHT]),
    spec(SemanticAction.BROW_HEIGHT_RIGHT, 0, 1, FacialRegion.BROW, 0.5, [SemanticAction.BROW_HEIGHT]),
    spec(SemanticAction.EYE_OPEN, 0, 1, FacialRegion.EYE, 0.8, [
        SemanticAction.EYE_OPEN_LEFT,
        SemanticAction.EYE_OPEN_RIGHT
    ]),
    spec(SemanticAction.EYE_OPEN_LEFT, 0, 1, FacialRegion.EYE, 0.8, [SemanticAction.EYE_OPEN]),
    spec(SemanticAction.EYE_OPEN_RIGHT, 0, 1, FacialRegion.EYE, 0.8, [SemanticAction.EYE_OPEN]),
    spec(SemanticAction.EYE_GAZE_X, -1, 1, FacialRegion.EYE),
    spec(SemanticAction.EYE_GAZE_Y, -1, 1, FacialRegion.EYE),
    spec(SemanticAction.EYE_WIDE, 0, 1, FacialRegion.EYE),
    spec(SemanticAction.MOUTH_OPEN, 0, 1, FacialRegion.MOUTH),
    spec(SemanticAction.MOUTH_SMILE, 0, 1, FacialRegion.MOUTH, 0.5),
    spec(SemanticAction.MOUTH_X, -1, 1, FacialRegion.MOUTH),
    spec(SemanticAction.MOUTH_JAW_OPEN, 0, 1, FacialRegion.MOUTH),
    spec(SemanticAction.MOUTH_FUNNEL, 0, 1, FacialRegion.MOUTH),
    spec(SemanticAction.MOUTH_PUCKER, -1, 1, FacialRegion.MOUTH),
    spec(SemanticAction.MOUTH_SHRUG, 0, 1, FacialRegion.MOUTH),
    spec(SemanticAction.MOUTH_CHEEK_PUFF, 0, 1, FacialRegion.MOUTH),
    spec(SemanticAction.MOUTH_TONGUE_OUT, 0, 1, FacialRegion.MOUTH),
    spec(SemanticAction.HEAD_YAW, -1, 1, FacialRegion.HEAD),
    spec(SemanticAction.HEAD_PITCH, -1, 1, FacialRegion.HEAD),
    spec(SemanticAction.HEAD_ROLL, -1, 1, FacialRegion.HEAD),
    spec(SemanticAction.BODY_ANGLE_X, -1, 1, FacialRegion.BODY),
    spec(SemanticAction.BODY_ANGLE_Y, -1, 1, FacialRegion.BODY),
    spec(SemanticAction.BODY_ANGLE_Z, -1, 1, FacialRegion.BODY)
]);

const SPEC_BY_ACTION = new Map(DEFAULT_SEMANTIC_ACTION_SPECS.map(item => [item.id, item]));

// Each inner array describes one compatible parameter layout. The resolver
// prefers a complete layout and falls back to any usable partial layout.
const DEFAULT_LIVE2D_BINDINGS = Object.freeze({
    [SemanticAction.BROW_HEIGHT]: [
        ['ParamBrowLY', 'ParamBrowRY'],
        ['PARAM_BROW_L_Y', 'PARAM_BROW_R_Y']
    ],
    [SemanticAction.BROW_HEIGHT_LEFT]: [
        ['ParamBrowLY'],
        ['PARAM_BROW_L_Y']
    ],
    [SemanticAction.BROW_HEIGHT_RIGHT]: [
        ['ParamBrowRY'],
        ['PARAM_BROW_R_Y']
    ],
    [SemanticAction.EYE_OPEN]: [
        ['ParamEyeLOpen', 'ParamEyeROpen'],
        ['PARAM_EYE_L_OPEN', 'PARAM_EYE_R_OPEN']
    ],
    [SemanticAction.EYE_OPEN_LEFT]: [
        ['ParamEyeLOpen'],
        ['PARAM_EYE_L_OPEN']
    ],
    [SemanticAction.EYE_OPEN_RIGHT]: [
        ['ParamEyeROpen'],
        ['PARAM_EYE_R_OPEN']
    ],
    [SemanticAction.EYE_GAZE_X]: [
        ['ParamEyeBallX'],
        ['PARAM_EYE_BALL_X']
    ],
    [SemanticAction.EYE_GAZE_Y]: [
        ['ParamEyeBallY'],
        ['PARAM_EYE_BALL_Y']
    ],
    [SemanticAction.EYE_WIDE]: [
        ['ParamEyeWideL', 'ParamEyeWideR'],
        ['ParamEyeLWide', 'ParamEyeRWide'],
        ['PARAM_EYE_L_WIDE', 'PARAM_EYE_R_WIDE'],
        ['ParamEyeWide']
    ],
    [SemanticAction.MOUTH_OPEN]: [
        ...LIVE2D_MOUTH_OPEN_PARAMS.map(id => [id]),
        ...LIVE2D_MOUTH_FALLBACK_PARAMS.map(id => [id])
    ],
    [SemanticAction.MOUTH_SMILE]: [
        ['ParamMouthForm'],
        ['PARAM_MOUTH_FORM']
    ],
    [SemanticAction.MOUTH_X]: [
        ['ParamMouthX'],
        ['PARAM_MOUTH_X']
    ],
    [SemanticAction.MOUTH_JAW_OPEN]: [
        ['ParamJawOpen'],
        ['PARAM_JAW_OPEN']
    ],
    [SemanticAction.MOUTH_FUNNEL]: [
        ['ParamMouthFunnel'],
        ['PARAM_MOUTH_FUNNEL']
    ],
    [SemanticAction.MOUTH_PUCKER]: [
        ['ParamMouthPuckerWiden'],
        ['PARAM_MOUTH_PUCKER_WIDEN']
    ],
    [SemanticAction.MOUTH_SHRUG]: [
        ['ParamMouthShrug'],
        ['PARAM_MOUTH_SHRUG']
    ],
    [SemanticAction.MOUTH_CHEEK_PUFF]: [
        ['ParamCheeckPuff'],
        ['ParamCheekPuff'],
        ['ParamCheek']
    ],
    [SemanticAction.MOUTH_TONGUE_OUT]: [
        ['ParamTongueOut'],
        ['PARAM_TONGUE_OUT']
    ],
    [SemanticAction.HEAD_YAW]: [
        ['ParamAngleX'],
        ['PARAM_ANGLE_X']
    ],
    [SemanticAction.HEAD_PITCH]: [
        ['ParamAngleY'],
        ['PARAM_ANGLE_Y']
    ],
    [SemanticAction.HEAD_ROLL]: [
        ['ParamAngleZ'],
        ['PARAM_ANGLE_Z']
    ],
    [SemanticAction.BODY_ANGLE_X]: [
        ['ParamBodyAngleX'],
        ['PARAM_BODY_ANGLE_X']
    ],
    [SemanticAction.BODY_ANGLE_Y]: [
        ['ParamBodyAngleY'],
        ['PARAM_BODY_ANGLE_Y']
    ],
    [SemanticAction.BODY_ANGLE_Z]: [
        ['ParamBodyAngleZ'],
        ['PARAM_BODY_ANGLE_Z']
    ]
});

function spec(id, minimum, maximum, region, neutral = 0, overlaps = []) {
    return Object.freeze({
        id,
        minimum,
        maximum,
        neutral,
        region,
        overlaps: Object.freeze([...overlaps])
    });
}

function clamp(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return minimum;
    return Math.max(minimum, Math.min(maximum, number));
}

function semanticActionsOverlap(left, right) {
    if (left === right) return true;
    const leftSpec = SPEC_BY_ACTION.get(left);
    const rightSpec = SPEC_BY_ACTION.get(right);
    return Boolean(leftSpec?.overlaps.includes(right) || rightSpec?.overlaps.includes(left));
}

function clampSemanticValue(action, value) {
    const actionSpec = SPEC_BY_ACTION.get(action);
    if (!actionSpec) return clamp(value, -1, 1);
    return clamp(value, actionSpec.minimum, actionSpec.maximum);
}

function neutralValue(action) {
    return SPEC_BY_ACTION.get(action)?.neutral ?? 0;
}

function semanticActionRegion(action) {
    return SPEC_BY_ACTION.get(action)?.region || null;
}

function buildLive2DParameterCatalog(model, coreModel) {
    const catalog = new Map();
    if (!coreModel || typeof coreModel.getParameterCount !== 'function') return catalog;

    const displayNames = readDisplayNames(model);
    const count = coreModel.getParameterCount();
    for (let index = 0; index < count; index++) {
        const id = getParameterId(coreModel, index);
        if (!id) continue;
        let minimum = getParameterBound(coreModel, index, 'min');
        let maximum = getParameterBound(coreModel, index, 'max');
        const defaultValue = getParameterBound(coreModel, index, 'default');
        if (!Number.isFinite(minimum)) minimum = -30;
        if (!Number.isFinite(maximum)) maximum = 30;
        if (maximum < minimum) [minimum, maximum] = [maximum, minimum];

        catalog.set(id, {
            id,
            index,
            minimum,
            maximum,
            defaultValue: Number.isFinite(defaultValue) ? defaultValue : (minimum + maximum) / 2,
            name: displayNames[id] || ''
        });
    }
    return catalog;
}

function readDisplayNames(model) {
    const result = {};
    try {
        const entries = model?.internalModel?.settings?.json?.FileReferences?.DisplayInfo
            || model?.internalModel?.settings?.FileReferences?.DisplayInfo;
        if (!entries || typeof require !== 'function') return result;
        const fs = require('fs');
        const path = require('path');
        const rawUrl = String(model?.internalModel?.settings?.url || '');
        const decoded = decodeURIComponent(rawUrl).replace(/^\/?live-2d\//, '').replace(/^\/+/, '');
        const root = path.join(__dirname, '..', '..', '..', '..');
        const modelPath = path.isAbsolute(decoded) ? decoded : path.join(root, decoded);
        const displayInfoPath = path.join(path.dirname(modelPath), String(entries).replace(/\//g, path.sep));
        if (!fs.existsSync(displayInfoPath)) return result;
        const json = JSON.parse(fs.readFileSync(displayInfoPath, 'utf8'));
        for (const item of Array.isArray(json?.Parameters) ? json.Parameters : []) {
            if (item?.Id && item?.Name) result[item.Id] = item.Name;
        }
    } catch (_) {}
    return result;
}

function getParameterId(coreModel, index) {
    try {
        if (typeof coreModel.getParameterId === 'function') return coreModel.getParameterId(index);
    } catch (_) {}
    try {
        return coreModel?._model?.parameters?.ids?.[index] || null;
    } catch (_) {
        return null;
    }
}

function getParameterBound(coreModel, index, kind) {
    const field = kind === 'min'
        ? 'minimumValues'
        : kind === 'max'
            ? 'maximumValues'
            : 'defaultValues';
    try {
        const value = Number(coreModel?._model?.parameters?.[field]?.[index]);
        if (Number.isFinite(value)) return value;
    } catch (_) {}

    const method = kind === 'min'
        ? 'getParameterMinimumValue'
        : kind === 'max'
            ? 'getParameterMaximumValue'
            : 'getParameterDefaultValue';
    try {
        const value = Number(coreModel?.[method]?.(index));
        if (Number.isFinite(value)) return value;
    } catch (_) {}
    return NaN;
}

class Live2DSemanticAdapter {
    constructor(model, coreModel, bindingOverrides = {}) {
        this.model = model;
        this.coreModel = coreModel;
        this.catalog = buildLive2DParameterCatalog(model, coreModel);
        this.bindings = new Map();
        this.updateBindings(bindingOverrides);
    }

    updateBindings(bindingOverrides = {}) {
        this.bindings.clear();
        for (const action of Object.values(SemanticAction)) {
            const configured = Object.prototype.hasOwnProperty.call(bindingOverrides || {}, action)
                ? bindingOverrides[action]
                : DEFAULT_LIVE2D_BINDINGS[action];
            const parameters = resolveBindingGroup(this.catalog, configured);
            if (parameters.length > 0) this.bindings.set(action, parameters);
        }
    }

    canResolve(action) {
        return (this.bindings.get(action) || []).length > 0;
    }

    resolve(action) {
        return [...(this.bindings.get(action) || [])];
    }

    toPlatformTargets(action, semanticValue) {
        return this.resolve(action).map(info => ({
            ...info,
            action,
            value: semanticToPlatform(semanticValue, info, action),
            neutral: semanticToPlatform(neutralValue(action), info, action)
        }));
    }
}

function resolveBindingGroup(catalog, rawBinding) {
    const groups = normalizeBindingGroups(rawBinding);
    let partial = [];
    for (const group of groups) {
        const resolved = group
            .map(id => catalog.get(id))
            .filter(Boolean);
        if (resolved.length === group.length && resolved.length > 0) return resolved;
        if (partial.length === 0 && resolved.length > 0) partial = resolved;
    }
    return partial;
}

function normalizeBindingGroups(rawBinding) {
    if (typeof rawBinding === 'string') return [[rawBinding]];
    if (!Array.isArray(rawBinding)) return [];
    if (rawBinding.every(value => typeof value === 'string')) return [rawBinding];
    return rawBinding
        .filter(Array.isArray)
        .map(group => group.filter(value => typeof value === 'string' && value));
}

function semanticToPlatform(semanticValue, platformSpec, action) {
    const actionSpec = SPEC_BY_ACTION.get(action);
    if (!actionSpec) {
        const midpoint = (platformSpec.minimum + platformSpec.maximum) / 2;
        const normalized = clamp(semanticValue, -1, 1);
        const value = normalized >= 0
            ? midpoint + normalized * (platformSpec.maximum - midpoint)
            : midpoint + normalized * (midpoint - platformSpec.minimum);
        return clamp(value, platformSpec.minimum, platformSpec.maximum);
    }

    const clamped = clampSemanticValue(action, semanticValue);
    const span = actionSpec.maximum - actionSpec.minimum;
    const ratio = span <= 0 ? 0 : (clamped - actionSpec.minimum) / span;
    return clamp(
        platformSpec.minimum + ratio * (platformSpec.maximum - platformSpec.minimum),
        platformSpec.minimum,
        platformSpec.maximum
    );
}

function platformToSemantic(platformValue, platformSpec, action) {
    const actionSpec = SPEC_BY_ACTION.get(action);
    const value = clamp(platformValue, platformSpec.minimum, platformSpec.maximum);
    if (!actionSpec) {
        const midpoint = (platformSpec.minimum + platformSpec.maximum) / 2;
        if (value >= midpoint) {
            const span = platformSpec.maximum - midpoint;
            return span <= 0 ? 0 : (value - midpoint) / span;
        }
        const span = midpoint - platformSpec.minimum;
        return span <= 0 ? 0 : -(midpoint - value) / span;
    }

    const span = platformSpec.maximum - platformSpec.minimum;
    const ratio = span <= 0 ? 0 : (value - platformSpec.minimum) / span;
    return actionSpec.minimum + ratio * (actionSpec.maximum - actionSpec.minimum);
}

module.exports = {
    FacialRegion,
    SemanticAction,
    LIVE2D_MOUTH_OPEN_PARAMS,
    LIVE2D_MOUTH_FALLBACK_PARAMS,
    DEFAULT_SEMANTIC_ACTION_SPECS,
    DEFAULT_LIVE2D_BINDINGS,
    Live2DSemanticAdapter,
    buildLive2DParameterCatalog,
    clampSemanticValue,
    neutralValue,
    semanticActionRegion,
    semanticActionsOverlap,
    semanticToPlatform,
    platformToSemantic
};
