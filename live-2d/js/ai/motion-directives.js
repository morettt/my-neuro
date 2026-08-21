'use strict';

function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
}

function normalizeText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function looksLikeMotionDirective(value) {
    const text = normalizeText(value);
    return [
        '眨', 'wink', '闭眼', '睁眼', '眯眼', '挥手',
        '点头', '摇头', '歪头', '低头', '抬头', '侧头', '转头',
        '前倾', '后仰', '看向', '视线', '脸红', '害羞', '微笑'
    ].some(hint => text.includes(hint));
}

function looksLikeDirectMotionRequest(value) {
    const text = normalizeText(value);
    const hasRequestWord = [
        '请', '帮我', '帮', '做', '来个', '来一个', '来一下',
        '表演', '动作', '一下', '一个', '给我', '可以', '能不能', '能否'
    ].some(hint => text.includes(hint));
    return hasRequestWord && looksLikeMotionDirective(value);
}

function extractMotionDirectivesFromText(text, out) {
    const bracketPattern = /[（(【\[]([^（）()\[\]【】]{1,120})[）)】\]]/gu;
    let matched = false;
    let result;
    while ((result = bracketPattern.exec(String(text || ''))) !== null) {
        const directive = String(result[1] || '').trim();
        if (looksLikeMotionDirective(directive)) {
            out.push(directive);
            matched = true;
        }
    }
    if (!matched && looksLikeDirectMotionRequest(text)) {
        out.push(String(text || '').trim().slice(0, 120));
    }
}

function analyzeSpeechMotionInstruction(speechText, userMessage) {
    const originalSpeechText = String(speechText || '');
    const explicitMotionDirectives = [];
    if (String(userMessage || '').trim()) {
        extractMotionDirectivesFromText(userMessage, explicitMotionDirectives);
    }

    const bracketPattern = /[（(【\[]([^（）()\[\]【】]{1,120})[）)】\]]/gu;
    const speechTextForMotion = originalSpeechText.replace(bracketPattern, (match, content) => {
        const directive = String(content || '').trim();
        if (!looksLikeMotionDirective(directive)) return match;
        explicitMotionDirectives.push(directive);
        return '';
    }).replace(/\s+/gu, ' ').trim();

    if (explicitMotionDirectives.length === 0 && looksLikeDirectMotionRequest(originalSpeechText)) {
        explicitMotionDirectives.push(originalSpeechText.trim().slice(0, 120));
    }

    return {
        originalSpeechText,
        speechTextForMotion: speechTextForMotion || originalSpeechText,
        explicitMotionDirectives: Array.from(new Set(explicitMotionDirectives.filter(Boolean)))
    };
}

function detectWinkSide(directives) {
    const text = normalizeText(Array.isArray(directives) ? directives.join(' ') : directives);
    if (!(text.includes('眨') || text.includes('wink') || text.includes('闭眼') || text.includes('眯眼'))) {
        return null;
    }
    if (text.includes('右眼') || text.includes('righteye') || text.includes('right')) return 'right';
    if (text.includes('左眼') || text.includes('lefteye') || text.includes('left')) return 'left';
    return 'both';
}

function normalizeCatalog(catalogById) {
    if (!catalogById) return new Map();
    if (catalogById instanceof Map) return catalogById;
    if (Array.isArray(catalogById)) return new Map(catalogById.map(item => [item.id, item]));
    return new Map(Object.entries(catalogById));
}

function paramDefault(info, fallback = 0) {
    const value = Number(info?.default);
    return Number.isFinite(value) ? value : fallback;
}

function paramMin(info, fallback = 0) {
    const value = Number(info?.min);
    return Number.isFinite(value) ? value : fallback;
}

function paramMax(info, fallback = 1) {
    const value = Number(info?.max);
    return Number.isFinite(value) ? value : fallback;
}

function setCatalogParam(params, catalog, id, value) {
    const info = catalog.get(id);
    if (!info) return false;
    params[id] = clamp(value, paramMin(info), paramMax(info));
    return true;
}

function buildWinkFrames(side, catalog) {
    const close = {};
    const open = {};
    const ids = side === 'both'
        ? ['ParamEyeLOpen', 'ParamEyeROpen']
        : side === 'right'
            ? ['ParamEyeROpen']
            : ['ParamEyeLOpen'];

    for (const id of ids) {
        const info = catalog.get(id);
        if (!info) continue;
        close[id] = paramMin(info, 0);
        open[id] = paramDefault(info, paramMax(info, 1));
    }
    const squintIds = side === 'right'
        ? ['EyeR_Squint']
        : side === 'left'
            ? ['EyeL_Squint']
            : ['EyeL_Squint', 'EyeR_Squint'];
    for (const id of squintIds) {
        setCatalogParam(close, catalog, id, 0.22);
    }
    if (Object.keys(close).length === 0) return [];
    return [
        {
            at: 0.08,
            params: close,
            transition_ms: 70,
            hold_ms: 55,
            release_ms: 90,
            release_params: Object.keys(close)
        },
        {
            at: 0.2,
            params: open,
            transition_ms: 85,
            hold_ms: 80,
            release_ms: 160,
            release_params: Object.keys(open)
        }
    ];
}

function buildBlushFrames(catalog) {
    const params = {};
    setCatalogParam(
        params,
        catalog,
        'ParamCheek',
        paramMax(catalog.get('ParamCheek'), 1) * 0.82
    );
    setCatalogParam(
        params,
        catalog,
        'Param100',
        paramMax(catalog.get('Param100'), 1) * 0.38
    );
    if (Object.keys(params).length === 0) return [];
    return [
        {
            at: 0.1,
            params,
            transition_ms: 260,
            hold_ms: 900,
            release_ms: 1600,
            sticky: true
        },
        {
            at: 0.62,
            params: Object.fromEntries(
                Object.keys(params).map(id => [id, paramDefault(catalog.get(id), 0)])
            ),
            transition_ms: 650,
            hold_ms: 0,
            release_ms: 900
        }
    ];
}

function buildHeadFrames(text, catalog) {
    const frames = [];
    const add = (at, values, transitionMs = 260, holdMs = 80, releaseMs = 500) => {
        const params = {};
        for (const [id, value] of Object.entries(values)) {
            setCatalogParam(params, catalog, id, value);
        }
        if (Object.keys(params).length > 0) {
            frames.push({
                at,
                params,
                transition_ms: transitionMs,
                hold_ms: holdMs,
                release_ms: releaseMs
            });
        }
    };

    const angleX = catalog.get('ParamAngleX');
    const angleY = catalog.get('ParamAngleY');
    const angleZ = catalog.get('ParamAngleZ');
    const xAmp = Math.max(Math.abs(paramMin(angleX, -30)), Math.abs(paramMax(angleX, 30))) * 0.4;
    const yAmp = Math.max(Math.abs(paramMin(angleY, -30)), Math.abs(paramMax(angleY, 30))) * 0.35;
    const zAmp = Math.max(Math.abs(paramMin(angleZ, -30)), Math.abs(paramMax(angleZ, 30))) * 0.35;

    if (text.includes('点头') || text.includes('低头') || text.includes('抬头')) {
        add(0.08, {
            ParamAngleY: text.includes('抬头') ? yAmp : -yAmp,
            Param5: text.includes('抬头') ? yAmp : -yAmp
        });
        add(0.22, {
            ParamAngleY: text.includes('低头') ? -yAmp * 0.6 : yAmp * 0.45,
            Param5: text.includes('低头') ? -yAmp * 0.6 : yAmp * 0.45
        });
        add(0.36, { ParamAngleY: 0, Param5: 0 }, 320, 40, 700);
    }
    if (text.includes('摇头')) {
        add(0.08, { ParamAngleZ: zAmp, Param4: zAmp });
        add(0.22, { ParamAngleZ: -zAmp, Param4: -zAmp });
        add(0.38, { ParamAngleZ: 0, Param4: 0 }, 320, 40, 700);
    }
    if (text.includes('歪头') || text.includes('侧头') || text.includes('转头')) {
        const sign = text.includes('右') ? -1 : 1;
        add(0.12, {
            ParamAngleZ: zAmp * sign,
            Param4: zAmp * sign,
            ParamAngleX: xAmp * sign,
            Param3: xAmp * sign
        }, 360, 260, 900);
    }
    if (text.includes('前倾') || text.includes('后仰')) {
        const sign = text.includes('后') ? 1 : -1;
        add(0.14, {
            ParamAngleY: yAmp * sign,
            Param5: yAmp * sign
        }, 360, 220, 900);
    }
    return frames;
}

function buildDirectiveFrames(directives, catalogById) {
    const catalog = normalizeCatalog(catalogById);
    const text = normalizeText(Array.isArray(directives) ? directives.join(' ') : directives);
    const faceFrames = [];
    const bodyFrames = [];
    const applied = [];

    const winkSide = detectWinkSide(directives);
    if (winkSide) {
        const frames = buildWinkFrames(winkSide, catalog);
        if (frames.length > 0) {
            faceFrames.push(...frames);
            applied.push(`wink:${winkSide}`);
        }
    }
    if (text.includes('脸红') || text.includes('害羞')) {
        const frames = buildBlushFrames(catalog);
        if (frames.length > 0) {
            faceFrames.push(...frames);
            applied.push('blush');
        }
    }
    if (
        text.includes('点头') ||
        text.includes('摇头') ||
        text.includes('歪头') ||
        text.includes('低头') ||
        text.includes('抬头') ||
        text.includes('侧头') ||
        text.includes('转头') ||
        text.includes('前倾') ||
        text.includes('后仰')
    ) {
        const frames = buildHeadFrames(text, catalog);
        if (frames.length > 0) {
            bodyFrames.push(...frames);
            applied.push('head');
        }
    }

    return { bodyFrames, faceFrames, applied };
}

module.exports = {
    analyzeSpeechMotionInstruction,
    buildDirectiveFrames,
    detectWinkSide,
    extractMotionDirectivesFromText,
    looksLikeDirectMotionRequest,
    looksLikeMotionDirective
};
