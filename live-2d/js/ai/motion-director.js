'use strict';

// Live2D body/face choreography. The request endpoint, key, and model always
// come from config.llm so choreography cannot drift onto a second provider.
const fs = require('fs');
const path = require('path');
const { logToTerminal } = require('../api-utils.js');
const {
    getAvatarMotionMode,
    isDirectorOnly,
    shouldUseParamDirector
} = require('../avatar/motion-mode.js');
const facsMapper = require('../avatar/live2d/facs-mapper.js');
const emotionArchetypes = require('../avatar/live2d/emotion-archetypes.js');
const { vadState } = require('../avatar/live2d/vad-state.js');
const motionDirectives = require('./motion-directives.js');

const APP_ROOT = path.join(__dirname, '..', '..');
const TAG_PATTERN = /<([^<>]+)>/g;
const BODY_PARAM_PATTERN = /^(ParamAngle[XYZ]|Param[345]|ParamBodyAngle[XYZ]\d*)$/;
const FACE_PARAM_PATTERN = /^(ParamEye[LR]Open|ParamEye[LR]Smile|Eye[LR]_Squint|ParamEyeBall[XY]|ParamBrow[LR](Y|X|Angle|Form)|Param(74|100)|ParamCheek|ParamCheeckPuff|ParamMouth(Form|Funnel|PressLipOpen|Shrug|X|PuckerWiden)|ParamJawOpen)$/;
const MOUTH_OPEN_PARAMS = new Set(['ParamMouthOpenY']);
const DEFAULT_FRAME_POSITIONS = [0.05, 0.17, 0.3, 0.44, 0.58, 0.72, 0.86, 0.97];

const BODY_EMOTION_PROFILES = {
    neutral: {
        x: 1.2,
        y: 0,
        z: 1.5,
        bodyX: 0.8,
        bodyY: 0,
        bodyZ: 1,
        transition: 850,
        hold: 260,
        release: 1300
    },
    happy: {
        x: 2.2,
        y: 4.5,
        z: 2.8,
        bodyX: 1.8,
        bodyY: 4,
        bodyZ: 2.2,
        transition: 720,
        hold: 360,
        release: 1250
    },
    playful: {
        x: 3.2,
        y: 2.8,
        z: 4.2,
        bodyX: 2.4,
        bodyY: 2.2,
        bodyZ: 3.4,
        transition: 680,
        hold: 380,
        release: 1350
    },
    shy: {
        x: 1.5,
        y: -6,
        z: 2,
        bodyX: 1.2,
        bodyY: -5.2,
        bodyZ: 1.4,
        transition: 930,
        hold: 520,
        release: 1650
    },
    surprised: {
        x: 3.5,
        y: 6.5,
        z: 2.6,
        bodyX: 2.8,
        bodyY: 5.5,
        bodyZ: 2,
        transition: 500,
        hold: 360,
        release: 1450
    },
    sad: {
        x: 1.2,
        y: -7.5,
        z: 1.4,
        bodyX: 1,
        bodyY: -6.8,
        bodyZ: 1.2,
        transition: 1080,
        hold: 560,
        release: 1850
    },
    angry: {
        x: 3.5,
        y: -4,
        z: 2.8,
        bodyX: 2.8,
        bodyY: -3.5,
        bodyZ: 2.2,
        transition: 650,
        hold: 480,
        release: 1500
    }
};

const EMOTION_TAG_MAP = new Map([
    ['开心', 'happy'],
    ['高兴', 'happy'],
    ['快乐', 'happy'],
    ['happy', 'happy'],
    ['joy', 'happy'],
    ['俏皮', 'playful'],
    ['调皮', 'playful'],
    ['playful', 'playful'],
    ['惊讶', 'surprised'],
    ['惊喜', 'surprised'],
    ['surprised', 'surprised'],
    ['生气', 'angry'],
    ['愤怒', 'angry'],
    ['angry', 'angry'],
    ['难过', 'sad'],
    ['伤心', 'sad'],
    ['委屈', 'sad'],
    ['sad', 'sad'],
    ['害羞', 'shy'],
    ['脸红', 'shy'],
    ['shy', 'shy']
]);

function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
}

function boundedInteger(value, fallback, min, max) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
}

function safeText(value, maxLength = 240) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeDuration(value, fallback, min = 0, max = 8000) {
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.max(min, Math.min(max, Math.round(number)))
        : fallback;
}

function createFirstFrameGate() {
    let settled = false;
    let resolvePromise;
    const promise = new Promise(resolve => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve(value) {
            if (settled) return;
            settled = true;
            resolvePromise(value);
        }
    };
}

function stripTags(text) {
    const tags = [];
    const purifiedText = String(text || '').replace(TAG_PATTERN, (_full, inner) => {
        const tag = String(inner || '').trim();
        if (tag) tags.push(tag);
        return '';
    });
    return { purifiedText, tags };
}

function resolveDialogueApi(config) {
    const llm = config?.llm || {};
    const apiUrl = String(llm.api_url || '').trim().replace(/\/+$/, '');
    const apiKey = String(llm.api_key || '').trim();
    const model = String(llm.model || '').trim();
    if (!apiUrl || !apiKey || !model) return null;
    return { api_url: apiUrl, api_key: apiKey, model };
}

function extractContentFromCompletion(payload) {
    if (!payload || typeof payload !== 'object') return '';
    return String(
        payload.choices?.[0]?.message?.content ??
        payload.data?.choices?.[0]?.message?.content ??
        ''
    );
}

class MotionDirector {
    constructor(options = {}) {
        this.config = {};
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this._runId = 0;
        this._controllers = new Set();
    }

    updateConfig(config) {
        this.config = config || {};
    }

    setFetchImplementation(fetchImpl) {
        this.fetchImpl = fetchImpl || globalThis.fetch;
    }

    isEnabled(config = this.config) {
        if (!shouldUseParamDirector(config)) return false;
        const cfg = config?.motion_director || {};
        if (cfg.enabled === false) return false;
        if (cfg.body?.enabled === false && cfg.face?.enabled === false) return false;
        return !!resolveDialogueApi(config);
    }

    cancel(reason = 'cancelled') {
        this._runId++;
        for (const controller of this._controllers) {
            try {
                controller.abort(reason);
            } catch (_) {}
        }
        this._controllers.clear();
    }

    choreograph(fullText, config = this.config, extras = {}) {
        this.cancel('superseded');
        this.updateConfig(config);
        const runId = this._runId;
        const firstFrameGate = createFirstFrameGate();
        const work = this._choreographInternal(
            fullText,
            config,
            extras,
            runId,
            firstFrameGate
        ).finally(() => firstFrameGate.resolve({ source: 'done' }));
        work.firstFrameLoaded = firstFrameGate.promise;
        return work;
    }

    async _choreographInternal(fullText, config, extras, runId, firstFrameGate) {
        const mode = getAvatarMotionMode(config);
        if (mode === 'legacy' || !global.paramDirector) {
            firstFrameGate.resolve({ source: 'disabled' });
            return { mode, source: 'disabled', accepted: 0 };
        }

        const cfg = config?.motion_director || {};
        if (cfg.enabled === false) {
            firstFrameGate.resolve({ source: 'disabled' });
            return { mode, source: 'disabled', accepted: 0 };
        }
        const { purifiedText, tags } = stripTags(fullText);
        const motionInstruction = motionDirectives.analyzeSpeechMotionInstruction(
            purifiedText,
            extras?.userMessage || ''
        );
        const speechText = motionInstruction.speechTextForMotion || purifiedText;
        const totalChars = Math.max(1, purifiedText.length);
        const emotionTags = this._effectiveEmotionTags(
            tags,
            speechText,
            extras?.userMessage || ''
        );
        const primaryEmotion = emotionTags[0] || 'neutral';

        global.paramDirector.prepareSpeech(totalChars);
        const catalog = global.paramDirector.getParamCatalog?.() || [];
        const catalogById = new Map(catalog.map(item => [item.id, item]));
        if (catalogById.size === 0) {
            logToTerminal('warn', '[MotionDirector] 参数目录为空，跳过编舞');
            firstFrameGate.resolve({ source: 'empty-catalog' });
            return { mode, source: 'empty-catalog', accepted: 0 };
        }

        this._nudgeVad(emotionTags, cfg);
        const fallbackLoaded = cfg.fallback_enabled === false
            ? false
            : this._loadFallbackTimelines(
                totalChars,
                cfg,
                emotionTags,
                catalogById
            );
        const directiveResult = this._loadDirectiveFrames(
            motionInstruction.explicitMotionDirectives,
            catalogById
        );
        if (fallbackLoaded || directiveResult.loaded) {
            firstFrameGate.resolve({
                source: fallbackLoaded ? 'fallback' : 'directive'
            });
        }

        const resolved = resolveDialogueApi(config);
        if (!resolved) {
            logToTerminal(
                'warn',
                '[MotionDirector] 主对话 API 配置不完整，保留本地编舞'
            );
            firstFrameGate.resolve({ source: 'missing-dialogue-api' });
            return { mode, source: 'fallback-only', accepted: 0 };
        }
        if (typeof this.fetchImpl !== 'function') {
            logToTerminal(
                'warn',
                '[MotionDirector] 当前环境没有 fetch，保留本地编舞'
            );
            return { mode, source: 'fallback-only', accepted: 0 };
        }

        const common = {
            resolved,
            text: speechText,
            tags: emotionTags,
            userMessage: extras?.userMessage || '',
            explicitDirectives: motionInstruction.explicitMotionDirectives,
            catalog,
            catalogById,
            totalChars,
            cfg,
            runId,
            firstFrameGate,
            primaryEmotion
        };
        const tasks = [];
        if (cfg.body?.enabled !== false) {
            tasks.push(this._runPath({ ...common, pathName: 'body' }));
        }
        if (cfg.face?.enabled !== false) {
            tasks.push(this._runPath({ ...common, pathName: 'face' }));
        }

        const results = await Promise.allSettled(tasks);
        const accepted = results.reduce((sum, result) => (
            sum + (result.status === 'fulfilled' ? Number(result.value?.accepted) || 0 : 0)
        ), 0);
        return {
            mode,
            source: accepted > 0 ? 'dialogue-api' : 'fallback-only',
            accepted
        };
    }

    _effectiveEmotionTags(tags, speechText, userMessage) {
        const normalized = [];
        const add = value => {
            const raw = String(value || '').trim().toLowerCase();
            const mapped = EMOTION_TAG_MAP.get(raw) || emotionArchetypes.normalizeEmotion(raw);
            if (mapped && mapped !== 'neutral' && !normalized.includes(mapped)) {
                normalized.push(mapped);
            }
        };
        for (const tag of tags || []) add(tag);
        if (normalized.length > 0) return normalized;

        const text = `${speechText || ''} ${userMessage || ''}`;
        const hints = [
            ['shy', /害羞|脸红|不好意思|羞/],
            ['playful', /俏皮|调皮|逗你|坏笑|捉弄/],
            ['surprised', /惊讶|惊喜|没想到|居然|竟然/],
            ['angry', /生气|愤怒|恼火|讨厌|烦死/],
            ['sad', /难过|伤心|委屈|想哭|失落/],
            ['happy', /开心|高兴|快乐|喜欢|太好了|真好/]
        ];
        for (const [emotion, pattern] of hints) {
            if (pattern.test(text)) {
                normalized.push(emotion);
                break;
            }
        }
        return normalized;
    }

    _nudgeVad(emotions, cfg) {
        if (cfg?.vad?.enabled === false) return;
        for (const emotion of emotions || []) {
            try {
                vadState.nudge(emotion, 0.7, {
                    strict: isDirectorOnly(this.config)
                });
            } catch (_) {}
        }
    }

    _loadDirectiveFrames(directives, catalogById) {
        const result = motionDirectives.buildDirectiveFrames(directives, catalogById);
        let loaded = false;
        if (result.bodyFrames.length > 0) {
            loaded = global.paramDirector?.appendTimelineFrames?.(
                result.bodyFrames,
                'body'
            ) || loaded;
        }
        if (result.faceFrames.length > 0) {
            loaded = global.paramDirector?.appendTimelineFrames?.(
                result.faceFrames,
                'face'
            ) || loaded;
        }
        if (result.applied.length > 0) {
            logToTerminal(
                'info',
                `[MotionDirector] 显式动作指令: ${result.applied.join(', ')}`
            );
        }
        return { loaded, applied: result.applied };
    }

    _loadFallbackTimelines(totalChars, cfg, emotions, catalogById) {
        const count = this._fallbackFrameCount(totalChars, cfg);
        const positions = this._framePositions(count);
        const bodyFrames = [];
        const faceFrames = [];
        const faceSchedule = new Map();

        positions.forEach((at, index) => {
            const emotion = emotions[index % Math.max(1, emotions.length)] || 'neutral';
            bodyFrames.push(
                this._buildFallbackBodyFrame(at, index, emotion, catalogById, cfg)
            );
            faceFrames.push(
                this._buildFallbackFaceFrame(
                    at,
                    index,
                    emotion,
                    catalogById,
                    this._nextFaceExpressionMode(emotion, faceSchedule),
                    cfg
                )
            );
        });

        const bodyOk = cfg.body?.enabled === false
            ? false
            : global.paramDirector?.loadTimeline?.(bodyFrames, totalChars, 'body') === true;
        const faceOk = cfg.face?.enabled === false
            ? false
            : global.paramDirector?.loadTimeline?.(faceFrames, totalChars, 'face') === true;
        return bodyOk || faceOk;
    }

    _fallbackFrameCount(totalChars, cfg) {
        const minimum = boundedInteger(cfg.min_keyframes, 6, 3, 14);
        const maximum = boundedInteger(cfg.max_keyframes, 10, minimum, 16);
        const estimated = Math.round(Math.max(1, totalChars) / 12) + 3;
        return Math.max(minimum, Math.min(maximum, estimated));
    }

    _framePositions(count) {
        if (count === DEFAULT_FRAME_POSITIONS.length) {
            return [...DEFAULT_FRAME_POSITIONS];
        }
        const safeCount = Math.max(1, count);
        return Array.from({ length: safeCount }, (_item, index) => (
            clamp(0.05 + (index / Math.max(1, safeCount - 1)) * 0.92, 0, 1)
        ));
    }

    _buildFallbackBodyFrame(at, index, emotion, catalogById, cfg = {}) {
        const normalized = emotionArchetypes.normalizeEmotion(emotion);
        const profile = BODY_EMOTION_PROFILES[normalized] || BODY_EMOTION_PROFILES.neutral;
        const phase = index * 0.9 + (normalized === 'playful' ? 0.8 : 0);
        const wave = Math.sin(phase);
        const softWave = Math.cos(phase * 0.72);
        const bodyCfg = cfg.body || {};
        const amplitude = clamp(bodyCfg.fallback_amplitude ?? 1, 0.2, 2);
        const params = {};

        this._setCatalogValue(
            params,
            catalogById,
            'ParamAngleX',
            profile.x * wave * amplitude
        );
        this._setCatalogValue(
            params,
            catalogById,
            'ParamAngleY',
            (profile.y + softWave * 1.4) * amplitude
        );
        this._setCatalogValue(
            params,
            catalogById,
            'ParamAngleZ',
            profile.z * wave * amplitude
        );
        this._setCatalogValue(
            params,
            catalogById,
            'ParamBodyAngleX',
            profile.bodyX * wave * amplitude
        );
        this._setCatalogValue(
            params,
            catalogById,
            'ParamBodyAngleY',
            (profile.bodyY + softWave) * amplitude
        );
        this._setCatalogValue(
            params,
            catalogById,
            'ParamBodyAngleZ',
            profile.bodyZ * wave * amplitude
        );

        return {
            at,
            params,
            transition_ms: profile.transition,
            hold_ms: profile.hold,
            release_ms: profile.release
        };
    }

    _nextFaceExpressionMode(emotion, schedule) {
        const normalized = emotionArchetypes.normalizeEmotion(emotion);
        const count = schedule.get(normalized) || 0;
        schedule.set(normalized, count + 1);
        if (count === 0) return 'event';
        if (count <= 2) return 'sustain';
        return 'off';
    }

    _buildFallbackFaceFrame(
        at,
        index,
        emotion,
        catalogById,
        expressionMode = 'event',
        cfg = {}
    ) {
        const intensity = expressionMode === 'event'
            ? 1.15
            : expressionMode === 'sustain'
                ? 0.72
                : 0.18;
        const sample = emotionArchetypes.sample(
            expressionMode === 'off' ? 'neutral' : emotion,
            intensity,
            0x13579 + index * 7919
        );
        const params = facsMapper.expand(sample.auMap, catalogById, {
            modelDir: this._resolveModelDir(),
            mouthFormScale: isDirectorOnly(this.config)
                ? clamp(cfg.face?.mouth_form_speech_scale ?? 0.5, 0, 1)
                : undefined
        });
        for (const id of MOUTH_OPEN_PARAMS) delete params[id];
        return {
            at,
            params,
            transition_ms: expressionMode === 'event' ? 380 : 520,
            hold_ms: expressionMode === 'event' ? 720 : 420,
            release_ms: expressionMode === 'event' ? 1450 : 1100
        };
    }

    _setCatalogValue(target, catalogById, id, value) {
        const info = catalogById.get(id);
        if (!info || !Number.isFinite(Number(value))) return false;
        const min = Number.isFinite(Number(info.min)) ? Number(info.min) : -1;
        const max = Number.isFinite(Number(info.max)) ? Number(info.max) : 1;
        target[id] = clamp(value, min, max);
        return true;
    }

    async _runPath(options) {
        const pathCfg = {
            ...options.cfg,
            ...(options.cfg?.[options.pathName] || {})
        };
        const timeoutMs = boundedInteger(pathCfg.timeout_ms, 8000, 1000, 30000);
        const stream = pathCfg.stream !== false;
        const controller = new AbortController();
        this._controllers.add(controller);
        const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
        const startedAt = Date.now();
        let accepted = 0;
        let firstAccepted = false;
        const faceSchedule = new Map();

        const acceptFrame = (raw, index = accepted) => {
            if (options.runId !== this._runId) return false;
            const frame = options.pathName === 'body'
                ? this._validateBodyFrame(raw, options.catalogById, pathCfg)
                : this._validateFaceFrame(
                    raw,
                    options.catalogById,
                    pathCfg,
                    options.primaryEmotion,
                    this._nextFaceExpressionMode(options.primaryEmotion, faceSchedule),
                    index
                );
            if (!frame) return false;
            if (!firstAccepted) {
                global.paramDirector?.truncateTimeline?.(options.pathName, frame.at);
                firstAccepted = true;
                options.firstFrameGate.resolve({
                    source: `${options.pathName}-dialogue-api`,
                    at: frame.at
                });
            }
            if (global.paramDirector?.appendTimelineFrames?.([frame], options.pathName)) {
                accepted++;
                return true;
            }
            return false;
        };

        try {
            const messages = this._buildPathMessages(options.pathName, {
                text: options.text,
                tags: options.tags,
                userMessage: options.userMessage,
                explicitDirectives: options.explicitDirectives,
                catalog: options.catalog,
                cfg: pathCfg
            });
            if (stream) {
                await this._chatCompletionStream(
                    options.resolved,
                    messages,
                    pathCfg,
                    controller.signal,
                    acceptFrame
                );
            } else {
                const content = await this._chatCompletionCompact(
                    options.resolved,
                    messages,
                    pathCfg,
                    controller.signal
                );
                this._parseFrameList(content).forEach((frame, index) => {
                    acceptFrame(frame, index);
                });
            }
            logToTerminal(
                'info',
                `[MotionDirector] ${options.pathName} 使用主对话模型 ${safeText(options.resolved.model, 80)}，接受 ${accepted} 帧，耗时 ${Date.now() - startedAt}ms`
            );
        } catch (error) {
            const timeout = error?.name === 'AbortError' || controller.signal.aborted;
            logToTerminal(
                'warn',
                `[MotionDirector] ${options.pathName} ${timeout ? '超时' : '失败'}，保留本地编舞: ${safeText(error?.message || error)}`
            );
        } finally {
            clearTimeout(timer);
            this._controllers.delete(controller);
        }
        return { accepted };
    }

    _buildPathMessages(pathName, options) {
        const modelPrompt = this._readModelPrompt().slice(0, 600);
        const userPayload = {
            speechText: options.text,
            userMessage: safeText(options.userMessage, 400),
            emotionTags: options.tags,
            explicitDirectives: options.explicitDirectives,
            modelRules: modelPrompt
        };
        return [
            {
                role: 'system',
                content: pathName === 'body'
                    ? this._buildBodySystemPrompt(options.cfg)
                    : this._buildFaceSystemPrompt(options.cfg)
            },
            {
                role: 'user',
                content: JSON.stringify(userPayload)
            }
        ];
    }

    _buildBodySystemPrompt(cfg) {
        const minFrames = boundedInteger(cfg.min_keyframes, 6, 3, 14);
        const maxFrames = boundedInteger(cfg.max_keyframes, 10, minFrames, 16);
        return [
            'You are a Live2D body choreographer.',
            'Output NDJSON only: one compact JSON object per line, no markdown.',
            `Create ${minFrames}-${maxFrames} continuous keyframes.`,
            'Format: {"at":0.2,"x":2,"y":-4,"z":3,"t":700,"h":300,"r":1300}.',
            'at is normalized speech progress from 0 to 1.',
            'x/y/z are small readable head and body posture targets.',
            'Use y posture and held poses more than alternating left-right sway.',
            'Keep x/z normally inside -6..6 and y inside -12..12.',
            'Do not output face, eye, brow, mouth, blush, gaze, or ParamXXX fields.',
            'Respect explicit nod, shake, tilt, lean, or turn directives.',
            'Return NDJSON lines only.'
        ].join('\n');
    }

    _buildFaceSystemPrompt(cfg) {
        const minFrames = boundedInteger(cfg.min_keyframes, 6, 3, 14);
        const maxFrames = boundedInteger(cfg.max_keyframes, 10, minFrames, 16);
        return [
            'You are a Live2D facial choreographer.',
            'Output NDJSON only: one compact JSON object per line, no markdown.',
            `Create ${minFrames}-${maxFrames} continuous keyframes.`,
            'Format: {"at":0.2,"au":{"12":0.7,"6":0.4},"gaze":[-0.2,0.1],"blink":0}.',
            'AU values and gaze values must be within 0..1 and -1..1 respectively.',
            'Use AU1/2/4/5/6/7/12/15/18/23/25/26/43 plus blush.',
            'Do not output model-specific ParamXXX fields.',
            'Do not control lipsync mouth opening.',
            'Use one strong emotion event, then weaker sustain/decay frames.',
            'Do not repeat the same strong AU combination on every frame.',
            'Respect explicit wink, eye, gaze, or blush directives.',
            'Return NDJSON lines only.'
        ].join('\n');
    }

    _buildRequestBody(resolved, messages, cfg, stream) {
        const body = {
            model: resolved.model,
            messages,
            stream,
            temperature: clamp(cfg.temperature ?? 0.25, 0, 2),
            max_tokens: boundedInteger(cfg.max_tokens, 900, 256, 4096)
        };
        if (/deepseek/i.test(`${resolved.api_url} ${resolved.model}`) &&
            cfg.disable_thinking !== false) {
            body.thinking = { type: 'disabled' };
            body.reasoning = { enabled: false };
        }
        return body;
    }

    async _request(resolved, messages, cfg, stream, signal) {
        const response = await this.fetchImpl(
            `${resolved.api_url}/chat/completions`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${resolved.api_key}`
                },
                body: JSON.stringify(
                    this._buildRequestBody(resolved, messages, cfg, stream)
                ),
                signal
            }
        );
        if (!response?.ok) {
            throw new Error(`HTTP ${response?.status || 'unknown'}`);
        }
        return response;
    }

    async _chatCompletionCompact(resolved, messages, cfg, signal) {
        const response = await this._request(resolved, messages, cfg, false, signal);
        const payload = await response.json();
        return extractContentFromCompletion(payload);
    }

    async _chatCompletionStream(resolved, messages, cfg, signal, onFrame) {
        const response = await this._request(resolved, messages, cfg, true, signal);
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let contentBuffer = '';
        let acceptedLines = 0;
        let rejectedLines = 0;

        const acceptParsed = parsed => {
            if (Array.isArray(parsed)) {
                for (const frame of parsed) {
                    if (onFrame(frame, acceptedLines + rejectedLines)) acceptedLines++;
                    else rejectedLines++;
                }
                return;
            }
            if (parsed && Array.isArray(parsed.frames)) {
                acceptParsed(parsed.frames);
                return;
            }
            if (parsed && Array.isArray(parsed.keyframes)) {
                acceptParsed(parsed.keyframes);
                return;
            }
            if (onFrame(parsed, acceptedLines + rejectedLines)) acceptedLines++;
            else rejectedLines++;
        };

        const consumePayload = payload => {
            const content =
                payload?.choices?.[0]?.delta?.content ??
                payload?.choices?.[0]?.message?.content ??
                payload?.data?.choices?.[0]?.delta?.content ??
                payload?.data?.choices?.[0]?.message?.content;
            if (typeof content === 'string') {
                appendContent(content);
                return;
            }
            acceptParsed(payload);
        };

        const parseContentLine = line => {
            const cleaned = String(line || '')
                .trim()
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/```$/i, '')
                .replace(/,$/, '')
                .trim();
            if (!cleaned) return;
            try {
                acceptParsed(JSON.parse(cleaned));
            } catch (_) {
                rejectedLines++;
            }
        };

        const appendContent = chunk => {
            if (!chunk) return;
            contentBuffer += chunk;
            const lines = contentBuffer.split(/\r?\n/);
            contentBuffer = lines.pop() || '';
            for (const line of lines) parseContentLine(line);
        };

        const parseStreamLine = line => {
            const trimmed = String(line || '').trim();
            if (!trimmed || trimmed.startsWith(':')) return;
            const data = trimmed.startsWith('data:')
                ? trimmed.slice(5).trim()
                : trimmed;
            if (!data || data === '[DONE]') return;
            try {
                consumePayload(JSON.parse(data));
            } catch (_) {
                rejectedLines++;
            }
        };

        const appendSse = text => {
            sseBuffer += text;
            const lines = sseBuffer.split(/\r?\n/);
            sseBuffer = lines.pop() || '';
            for (const line of lines) parseStreamLine(line);
        };

        if (response.body?.getReader) {
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                appendSse(decoder.decode(value, { stream: true }));
            }
            appendSse(decoder.decode());
        } else if (response.body && typeof response.body[Symbol.asyncIterator] === 'function') {
            for await (const chunk of response.body) {
                appendSse(
                    typeof chunk === 'string'
                        ? chunk
                        : Buffer.isBuffer(chunk)
                        ? chunk.toString('utf8')
                        : decoder.decode(chunk, { stream: true })
                );
            }
            appendSse(decoder.decode());
        } else {
            const text = await response.text();
            appendSse(text);
        }

        if (sseBuffer.trim()) {
            parseStreamLine(sseBuffer);
            sseBuffer = '';
        }
        if (contentBuffer.trim()) {
            const parsed = this._parseFrameList(contentBuffer);
            if (parsed.length > 0) acceptParsed(parsed);
            else parseContentLine(contentBuffer);
        }
        return { acceptedLines, rejectedLines };
    }

    _parseFrameList(content) {
        const text = String(content || '')
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();
        if (!text) return [];

        const lines = [];
        for (const line of text.split(/\r?\n/)) {
            const cleaned = line.trim().replace(/,$/, '');
            if (!cleaned) continue;
            try {
                const parsed = JSON.parse(cleaned);
                if (Array.isArray(parsed)) lines.push(...parsed);
                else if (Array.isArray(parsed.frames)) lines.push(...parsed.frames);
                else if (Array.isArray(parsed.keyframes)) lines.push(...parsed.keyframes);
                else lines.push(parsed);
            } catch (_) {}
        }
        if (lines.length > 0) return lines;

        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed;
            if (Array.isArray(parsed.frames)) return parsed.frames;
            if (Array.isArray(parsed.keyframes)) return parsed.keyframes;
        } catch (_) {}
        return [];
    }

    _validateBodyFrame(raw, catalogById, cfg) {
        if (!raw || typeof raw !== 'object') return null;
        const params = {};
        const headLimit = clamp(cfg.body_head_limit ?? 8, 1, 20);
        const yLimit = clamp(cfg.body_y_limit ?? 14, 2, 30);

        const add = (id, value, limit = headLimit) => {
            const info = catalogById.get(id);
            if (!info || !Number.isFinite(Number(value))) return;
            const min = Math.max(Number(info.min), -limit);
            const max = Math.min(Number(info.max), limit);
            params[id] = clamp(value, min, max);
        };

        if (raw.params && typeof raw.params === 'object') {
            for (const [id, value] of Object.entries(raw.params)) {
                if (!BODY_PARAM_PATTERN.test(id)) continue;
                add(id, value, /AngleY|Param5/.test(id) ? yLimit : headLimit);
            }
        } else {
            const x = Number(raw.x ?? raw.angle_x);
            const y = Number(raw.y ?? raw.angle_y);
            const z = Number(raw.z ?? raw.angle_z);
            if (Number.isFinite(x)) {
                add('ParamAngleX', x);
                add('Param3', x);
                add('ParamBodyAngleX', x * 0.75);
            }
            if (Number.isFinite(y)) {
                add('ParamAngleY', y, yLimit);
                add('Param5', y, yLimit);
                add('ParamBodyAngleY', y * 0.8, yLimit);
            }
            if (Number.isFinite(z)) {
                add('ParamAngleZ', z);
                add('Param4', z);
                add('ParamBodyAngleZ', z * 0.75);
            }
        }
        if (Object.keys(params).length === 0) return null;
        return {
            at: clamp(raw.at ?? raw.position, 0, 1),
            params,
            transition_ms: normalizeDuration(raw.transition_ms ?? raw.t, 700, 40, 4000),
            hold_ms: normalizeDuration(raw.hold_ms ?? raw.h, 300, 0, 4000),
            release_ms: normalizeDuration(raw.release_ms ?? raw.r, 1300, 80, 6000)
        };
    }

    _validateFaceFrame(
        raw,
        catalogById,
        cfg,
        emotion,
        expressionMode,
        index
    ) {
        if (!raw || typeof raw !== 'object') return null;
        const params = {};
        if (raw.params && typeof raw.params === 'object') {
            for (const [id, value] of Object.entries(raw.params)) {
                if (!FACE_PARAM_PATTERN.test(id) || MOUTH_OPEN_PARAMS.has(id)) continue;
                this._setCatalogValue(params, catalogById, id, value);
            }
        } else {
            const auMap = {};
            if (raw.au && typeof raw.au === 'object') {
                for (const [key, value] of Object.entries(raw.au)) {
                    auMap[key] = clamp(value, 0, 1);
                }
            }
            if (Array.isArray(raw.gaze)) {
                auMap.gazeX = clamp(raw.gaze[0], -1, 1);
                auMap.gazeY = clamp(raw.gaze[1], -1, 1);
            }
            if (raw.blush !== undefined) {
                auMap.blush = clamp(raw.blush, 0, 1);
            }
            const gain = expressionMode === 'event'
                ? 1
                : expressionMode === 'sustain'
                    ? 0.68
                    : 0.24;
            for (const key of Object.keys(auMap)) auMap[key] *= gain;
            Object.assign(params, facsMapper.expand(auMap, catalogById, {
                modelDir: this._resolveModelDir(),
                mouthFormScale: isDirectorOnly(this.config)
                    ? clamp(cfg.mouth_form_speech_scale ?? 0.5, 0, 1)
                    : undefined
            }));

            if (Number(raw.blink) > 0 && expressionMode !== 'event') {
                this._setCatalogValue(params, catalogById, 'ParamEyeLOpen', 0.08);
                this._setCatalogValue(params, catalogById, 'ParamEyeROpen', 0.08);
            }
        }

        for (const id of MOUTH_OPEN_PARAMS) delete params[id];
        if (Object.keys(params).length === 0) {
            return this._buildFallbackFaceFrame(
                clamp(raw.at ?? raw.position, 0, 1),
                index,
                emotion,
                catalogById,
                expressionMode,
                cfg
            );
        }
        return {
            at: clamp(raw.at ?? raw.position, 0, 1),
            params,
            transition_ms: normalizeDuration(raw.transition_ms ?? raw.t, 420, 40, 3000),
            hold_ms: normalizeDuration(raw.hold_ms ?? raw.h, expressionMode === 'event' ? 700 : 380, 0, 4000),
            release_ms: normalizeDuration(raw.release_ms ?? raw.r, expressionMode === 'event' ? 1450 : 1000, 80, 6000)
        };
    }

    _readModelPrompt() {
        const modelDir = this._resolveModelDir();
        if (!modelDir) return '';
        const promptPath = path.join(modelDir, 'motion_prompt.txt');
        try {
            return fs.existsSync(promptPath)
                ? fs.readFileSync(promptPath, 'utf8').trim()
                : '';
        } catch (_) {
            return '';
        }
    }

    _resolveModelDir() {
        try {
            const settings = global.currentModel?.internalModel?.settings;
            const rawUrl = String(settings?.url || '');
            const decoded = decodeURIComponent(rawUrl)
                .replace(/^\/?live-2d\//, '')
                .replace(/^\/+/, '');
            const modelPath = path.isAbsolute(decoded)
                ? decoded
                : path.join(APP_ROOT, decoded);
            if (fs.existsSync(modelPath)) return path.dirname(modelPath);
        } catch (_) {}
        const name = this.config?.ui?.live2d_model;
        return name ? path.join(APP_ROOT, '2D', name) : '';
    }
}

const motionDirector = new MotionDirector();

module.exports = {
    MotionDirector,
    extractContentFromCompletion,
    motionDirector,
    resolveDialogueApi,
    stripTags
};
