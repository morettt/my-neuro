// emotion-engine.js - 统一表情/动作引擎（合并旧 EmotionMotionMapper + EmotionExpressionMapper）
// Adapted from Project-N-E-K-O/N.E.K.O (Apache-2.0): static/live2d-emotion.js 的
// 初始参数记录 / 表情软重置 / 无动作时参数动画降级（playSimpleMotion）思路。
//
// 配置来源（优先级从高到低）：
//   1. <模型目录>/emotion_mapping.json  —— per-model sidecar（可选）
//      { "emotions": { "开心": { "motions": [..], "expressions": [..] } },
//        "actions": { "动作1": [..] }, "idle": { "group": "Idle" } }
//   2. 旧版中央配置 emotion_actions.json / emotion_expressions.json（按角色名键）
//      —— WebUI 仍然直接编辑这两个文件，保持兼容（无 sidecar 时始终读它们）
//
// 对外暴露两个"门面"（兼容旧的双 Mapper 契约，避免 TTS 时间轴双份 marker 造成动作重复触发）：
//   engine.motionFacade     -> 旧 global.emotionMapper 接口
//   engine.expressionFacade -> 旧 global.expressionMapper 接口
const fs = require('fs');
const path = require('path');
const { logToTerminal } = require('../../api-utils.js');
const { shouldUseLegacyEmotionLogic } = require('../motion-mode.js');

const APP_ROOT = path.join(__dirname, '..', '..', '..');
const EMOTION_WHITELIST = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮'];
const SOFT_RESET_MS = 220;             // 表情软重置时长（N.E.K.O 同款节奏）
const SIMPLE_MOTION_MS = 900;          // 无动作降级的参数动画时长

// 表情/口型/头部角度参数：记录初始参数与软重置时跳过（口型归 lipsync，角度归视线跟随）
const LIPSYNC_PARAMS = ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y', 'ParamMouthForm', 'ParamMouthOpen', 'ParamA', 'ParamI', 'ParamU', 'ParamE', 'ParamO'];
const SKIP_PARAMS = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamEyeBallX', 'ParamEyeBallY', ...LIPSYNC_PARAMS];

// 简易参数动画预设：六情绪各给一个"点头/摇头/侧身"式的小动作（无 motion 配置时的降级表现）
const SIMPLE_MOTION_PRESETS = {
    '开心': { ParamAngleZ: 12, ParamBodyAngleZ: 4 },
    '生气': { ParamAngleX: -14, ParamBodyAngleX: -5 },
    '难过': { ParamAngleY: -18, ParamBodyAngleY: -4 },
    '惊讶': { ParamAngleY: 14, ParamBodyAngleY: 3 },
    '害羞': { ParamAngleZ: -10, ParamAngleY: -8 },
    '俏皮': { ParamAngleZ: 16, ParamAngleX: 8 }
};

function _readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function _writeJson(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error(`[EmotionEngine] 写入 ${filePath} 失败:`, e);
        return false;
    }
}

function _scanFiles(root, suffix) {
    const result = [];
    try {
        if (!root || !fs.existsSync(root)) return result;
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            const fullPath = path.join(root, entry.name);
            if (entry.isDirectory()) {
                result.push(..._scanFiles(fullPath, suffix));
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) {
                result.push(fullPath);
            }
        }
    } catch (_) {}
    return result;
}

// 解析 <标签>（与旧实现一致，含 <expression:xx> 之外的所有尖括号标签）
function parseEmotionTagsWithPosition(text) {
    const pattern = /<([^>]+)>/g;
    const tags = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
        tags.push({
            emotion: match[1],
            startIndex: match.index,
            endIndex: match.index + match[0].length,
            fullTag: match[0]
        });
    }
    return tags;
}

// 移除标签并生成 { purifiedText, positions: [{ position, emotion }] }
function stripTags(text) {
    const tags = parseEmotionTagsWithPosition(text);
    if (tags.length === 0) return { purifiedText: text, positions: [] };

    let purifiedText = text;
    for (let i = tags.length - 1; i >= 0; i--) {
        const t = tags[i];
        purifiedText = purifiedText.substring(0, t.startIndex) + purifiedText.substring(t.endIndex);
    }

    const positions = [];
    let offset = 0;
    for (const t of tags) {
        positions.push({ position: t.startIndex - offset, emotion: t.emotion });
        offset += t.endIndex - t.startIndex;
    }
    return { purifiedText, positions };
}

class EmotionEngine {
    constructor(model, config = null) {
        this.model = model;
        this.config = config || {};
        this.currentMotionGroup = 'TapBody';
        this.idleGroup = 'Idle';
        this.idleExpression = '';
        this.defaultExpression = '默认表情';
        this.currentCharacter = null;
        this.modelDirName = null;

        // 统一配置（motionConfig/expressionConfig 沿用旧字典结构：六情绪 + 动作N/表情N）
        this.motionConfig = {};
        this.expressionConfig = {};
        this._sidecarPath = null;
        this._usingSidecar = false;
        this._expressionDefinitionsSynced = false;
        this._lastAuTrigger = null;

        // N.E.K.O 机制：初始参数快照 / 软重置 / 简易动画句柄
        this.initialParameters = {};
        this._softResetFrame = null;
        this._simpleMotionFrame = null;

        // 双门面（对外兼容旧 Mapper 契约）
        this.motionFacade = this._createMotionFacade();
        this.expressionFacade = this._createExpressionFacade();
    }

    static async create(model, config = null) {
        const engine = new EmotionEngine(model, config);
        await engine.loadConfig();
        engine.recordInitialParameters();
        engine._configureAuDriver();
        return engine;
    }

    // ============ 配置加载 ============

    _resolveCharacterName() {
        try {
            const modelPath = this.model?.internalModel?.settings?.url || '';
            const match = decodeURIComponent(modelPath).match(/2D\/([^\/]+)\//);
            if (match) return match[1];
        } catch (_) {}
        return '肥牛';
    }

    async loadConfig() {
        this.currentCharacter = this._resolveCharacterName();
        this.modelDirName = this.currentCharacter;
        this._sidecarPath = path.join(APP_ROOT, '2D', this.modelDirName, 'emotion_mapping.json');

        const emptyEmotions = () => Object.fromEntries(EMOTION_WHITELIST.map(e => [e, []]));
        this.motionConfig = emptyEmotions();
        this.expressionConfig = emptyEmotions();
        this.idleGroup = 'Idle';
        this.idleExpression = '';
        this._usingSidecar = false;
        this._expressionDefinitionsSynced = false;

        // 1) sidecar 优先
        const sidecar = _readJson(this._sidecarPath);
        if (sidecar && typeof sidecar === 'object') {
            this._usingSidecar = true;
            const emotions = sidecar.emotions || {};
            for (const [emotion, entry] of Object.entries(emotions)) {
                if (Array.isArray(entry?.motions)) this.motionConfig[emotion] = entry.motions;
                if (Array.isArray(entry?.expressions)) this.expressionConfig[emotion] = entry.expressions;
            }
            for (const [name, files] of Object.entries(sidecar.actions || {})) {
                if (Array.isArray(files)) this.motionConfig[name] = files;
            }
            for (const [name, files] of Object.entries(sidecar.expressions_named || {})) {
                if (Array.isArray(files)) this.expressionConfig[name] = files;
            }
            if (sidecar.idle && Object.prototype.hasOwnProperty.call(sidecar.idle, 'group')) {
                this.idleGroup = sidecar.idle.group || '';
            }
            if (typeof sidecar.idle?.expression === 'string') this.idleExpression = sidecar.idle.expression;
            if (sidecar.motion_group) this.currentMotionGroup = sidecar.motion_group;
            logToTerminal('info', `[EmotionEngine] 使用 per-model 配置: ${this._sidecarPath}`);
            return;
        }

        // 2) 旧版中央配置（WebUI 的编辑目标，保持兼容）
        const legacyActions = _readJson(path.join(APP_ROOT, 'emotion_actions.json'));
        const actionEntry = legacyActions?.[this.currentCharacter]?.emotion_actions;
        if (actionEntry && typeof actionEntry === 'object') {
            this.motionConfig = { ...emptyEmotions(), ...actionEntry };
        }

        const legacyExpr = _readJson(path.join(APP_ROOT, 'emotion_expressions.json'));
        const exprEntry = legacyExpr?.[this.currentCharacter]?.emotion_expressions;
        if (exprEntry && typeof exprEntry === 'object') {
            this.expressionConfig = { ...emptyEmotions(), ...exprEntry };
        }

        const motionCount = Object.values(this.motionConfig).flat().length;
        const exprCount = Object.values(this.expressionConfig).flat().length;
        logToTerminal('info', `[EmotionEngine] 角色 "${this.currentCharacter}" 配置加载完成（legacy），动作文件 ${motionCount} 个 / 表情文件 ${exprCount} 个`);
    }

    async reloadConfig() {
        await this.loadConfig();
        this._configureAuDriver();
    }

    async getCurrentCharacterName() {
        return this.currentCharacter || this._resolveCharacterName();
    }

    getModelAssetRoot() {
        return this._modelAssetBase();
    }

    _runtimeConfig() {
        return global.live2dRuntime?.config || this.config || {};
    }

    _isAuExpressionMode() {
        const config = this._runtimeConfig();
        return (
            shouldUseLegacyEmotionLogic(config) &&
            String(config?.ui?.expression_engine || 'au').toLowerCase() === 'au' &&
            config?.expression_solver?.enabled !== false
        );
    }

    _configureAuDriver() {
        if (!this._isAuExpressionMode()) return false;
        try {
            return global.auDriver?.setEmotionEngine?.(this) === true;
        } catch (error) {
            logToTerminal('warn', `[EmotionEngine] 配置 AU 表情驱动失败: ${error?.stack || error?.message || error}`);
            return false;
        }
    }

    _tryPlayAuEmotion(emotion) {
        if (!this._isAuExpressionMode() || !EMOTION_WHITELIST.includes(emotion)) return false;
        try {
            const handled = global.auDriver?.playEmotion?.(emotion) === true;
            if (handled) {
                this._lastAuTrigger = { emotion, at: Date.now() };
            }
            return handled;
        } catch (error) {
            console.warn('[EmotionEngine] AU 表情触发失败，回退预制动作:', error);
            return false;
        }
    }

    _wasJustHandledByAu(emotion) {
        const marker = this._lastAuTrigger;
        return Boolean(marker && marker.emotion === emotion && Date.now() - marker.at < 1000);
    }

    // ============ N.E.K.O 机制：初始参数记录 / 软重置 / 简易动画 ============

    recordInitialParameters() {
        this.initialParameters = {};
        try {
            const coreModel = this.model?.internalModel?.coreModel;
            if (!coreModel || typeof coreModel.getParameterCount !== 'function') return;

            const count = coreModel.getParameterCount();
            for (let i = 0; i < count; i++) {
                let paramId = null;
                try { paramId = coreModel.getParameterId ? coreModel.getParameterId(i) : null; } catch (_) {}
                if (paramId && SKIP_PARAMS.includes(paramId)) continue;
                try {
                    this.initialParameters[`#${i}`] = {
                        id: paramId,
                        index: i,
                        value: coreModel.getParameterValueByIndex(i)
                    };
                } catch (_) {}
            }
        } catch (e) {
            console.warn('[EmotionEngine] 记录初始参数失败:', e);
        }
    }

    // 表情软重置：把（非口型/角度）参数在 SOFT_RESET_MS 内插值回初始快照
    softResetToInitial() {
        const coreModel = this.model?.internalModel?.coreModel;
        if (!coreModel || Object.keys(this.initialParameters).length === 0) return;
        if (this._softResetFrame) cancelAnimationFrame(this._softResetFrame);

        const start = performance.now();
        const from = {};
        for (const key of Object.keys(this.initialParameters)) {
            const p = this.initialParameters[key];
            try { from[key] = coreModel.getParameterValueByIndex(p.index); } catch (_) {}
        }

        const step = (now) => {
            const t = Math.min(1, (now - start) / SOFT_RESET_MS);
            for (const key of Object.keys(this.initialParameters)) {
                const p = this.initialParameters[key];
                if (!(key in from)) continue;
                const v = from[key] + (p.value - from[key]) * t;
                try { coreModel.setParameterValueByIndex(p.index, v); } catch (_) {}
            }
            if (t < 1) {
                this._softResetFrame = requestAnimationFrame(step);
            } else {
                this._softResetFrame = null;
            }
        };
        this._softResetFrame = requestAnimationFrame(step);
    }

    // 无 motion 配置时的降级表现：短促的头部/身体参数动画（正弦进出）
    playSimpleMotion(emotion) {
        if (!shouldUseLegacyEmotionLogic()) return;
        // 参数导演有编舞在进行时让位，避免双重驱动头部角度
        if (global.paramDirector && global.paramDirector.isChoreographyActive()) return;
        const preset = SIMPLE_MOTION_PRESETS[emotion];
        const coreModel = this.model?.internalModel?.coreModel;
        if (!preset || !coreModel || typeof coreModel.setParameterValueById !== 'function') return;
        if (this._simpleMotionFrame) cancelAnimationFrame(this._simpleMotionFrame);

        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / SIMPLE_MOTION_MS);
            const wave = Math.sin(t * Math.PI); // 0 -> 1 -> 0
            for (const [paramId, amp] of Object.entries(preset)) {
                try { coreModel.setParameterValueById(paramId, amp * wave); } catch (_) {}
            }
            if (t < 1) {
                this._simpleMotionFrame = requestAnimationFrame(step);
            } else {
                this._simpleMotionFrame = null;
            }
        };
        this._simpleMotionFrame = requestAnimationFrame(step);
        console.log(`[EmotionEngine] 情绪 "${emotion}" 无动作配置，使用参数动画降级`);
    }

    // ============ 动作 ============

    playConfiguredEmotion(emotion) {
        if (this._tryPlayAuEmotion(emotion)) return true;
        return this._playConfiguredEmotionLegacy(emotion);
    }

    _playConfiguredEmotionLegacy(emotion) {
        const files = this.motionConfig?.[emotion];
        if (!files || files.length === 0) {
            this.playSimpleMotion(emotion);
            return false;
        }
        const selected = files[Math.floor(Math.random() * files.length)];
        const index = this._findMotionIndexByFileName(selected);
        if (index !== -1) {
            this.playMotionByIndex(index);
            console.log(`[EmotionEngine] 情绪动作: ${emotion} -> ${selected}`);
            return true;
        } else if (this.playNativeMotionFile(selected)) {
            console.log(`[EmotionEngine] 情绪动作: ${emotion} -> ${selected}`);
            return true;
        } else {
            console.warn(`[EmotionEngine] 未找到动作文件 "${selected}" 对应的索引，使用参数动画降级`);
            this.playSimpleMotion(emotion);
            return false;
        }
    }

    _findMotionIndexByFileName(fileName) {
        try {
            const defs = this.model.internalModel.settings.motions[this.currentMotionGroup];
            if (!defs) return -1;
            return defs.findIndex(m => m.File === fileName);
        } catch (_) {
            return -1;
        }
    }

    playMotionByIndex(index) {
        return this._playMotionAt(this.currentMotionGroup, index);
    }

    _playMotionAt(group, index) {
        if (!this.model) return;
        try {
            const defs = this.model.internalModel.settings.motions?.[group];
            if (!defs || defs.length === 0) {
                console.warn(`[EmotionEngine] 动作组 "${group}" 为空或不存在`);
                return false;
            }
            const motionIndex = index % defs.length;
            if (this.model.internalModel?.motionManager) {
                this.model.internalModel.motionManager.stopAllMotions();
            }
            this.model.motion(group, motionIndex);
            return true;
        } catch (e) {
            console.error('[EmotionEngine] 播放动作失败:', e);
            return false;
        }
    }

    playNativeMotionFile(fileName) {
        const location = this._findOrRegisterMotionFile(fileName);
        if (!location) {
            console.warn(`[EmotionEngine] 原生动作文件不可用: ${fileName}`);
            return false;
        }
        return this._playMotionAt(location.group, location.index);
    }

    stopNativeMotions() {
        try {
            const idleDefinitions = this.model?.internalModel?.settings?.motions?.[this.idleGroup];
            if (this.idleGroup && Array.isArray(idleDefinitions) && idleDefinitions.length > 0) {
                this.model.motion(this.idleGroup, 0);
                return true;
            }
            this.model?.internalModel?.motionManager?.stopAllMotions?.();
            return true;
        } catch (_) {
            return false;
        }
    }

    _findOrRegisterMotionFile(fileName) {
        const settings = this.model?.internalModel?.settings;
        const motionManager = this.model?.internalModel?.motionManager;
        if (!settings || !motionManager || !fileName) return null;
        const normalized = String(fileName).replace(/\\/g, '/');
        settings.motions = settings.motions || {};

        for (const [group, definitions] of Object.entries(settings.motions)) {
            if (!Array.isArray(definitions)) continue;
            const index = definitions.findIndex(item => String(item?.File || '').replace(/\\/g, '/') === normalized);
            if (index >= 0) return { group, index };
        }

        const group = this.currentMotionGroup || 'TapBody';
        const definitions = settings.motions[group] || (settings.motions[group] = []);
        definitions.push({ File: normalized });
        motionManager.definitions = settings.motions;
        motionManager.motionGroups = motionManager.motionGroups || {};
        if (!Array.isArray(motionManager.motionGroups[group])) {
            motionManager.motionGroups[group] = [];
        }
        return { group, index: definitions.length - 1 };
    }

    playDefaultMotion() {
        try {
            if (!this.idleGroup) {
                this.model.internalModel?.motionManager?.stopAllMotions?.();
            } else if (this.model.internalModel.settings.motions[this.idleGroup]) {
                this.model.motion(this.idleGroup, 0);
            } else {
                this.model.motion(this.currentMotionGroup, 0);
            }
            if (this.idleExpression) {
                this._playExpressionFile(this.idleExpression);
            } else {
                this.resetExpressionToNeutral();
            }
        } catch (e) {
            console.error('[EmotionEngine] 播放默认动作失败:', e);
        }
    }

    // ============ 表情 ============

    triggerExpressionByEmotion(emotion) {
        // TTS 同一标签会依次通知 motion/expression 两个旧门面。
        // AU 成功处理过同一标签时，第二次通知在这里吞掉。
        if (this._isAuExpressionMode() && EMOTION_WHITELIST.includes(emotion)) {
            if (this._wasJustHandledByAu(emotion) || this._tryPlayAuEmotion(emotion)) {
                return null;
            }
        }
        const files = this.expressionConfig?.[emotion];
        if (files && files.length > 0) {
            const selected = files[Math.floor(Math.random() * files.length)];
            this._playExpressionFile(selected);
            return this._expressionNameFromPath(selected);
        }
        this.playDefaultExpression();
        return null;
    }

    triggerExpression(expressionName) {
        if (!expressionName || expressionName === '默认表情' || expressionName === this.defaultExpression) {
            // 请求默认表情时，若存在配置则播放，否则软重置回初始状态
            return this.playDefaultExpression();
        }
        const files = this.expressionConfig?.[expressionName];
        if (!files || files.length === 0) {
            console.warn(`[EmotionEngine] 表情 "${expressionName}" 未配置，使用默认表情`);
            this.playDefaultExpression();
            return false;
        }
        const selected = files[Math.floor(Math.random() * files.length)];
        this._playExpressionFile(selected);
        return true;
    }

    playDefaultExpression() {
        // 显式配置了“默认表情”时才播放文件；否则回到模型中性表情。
        for (const name of [this.defaultExpression, '默认表情']) {
            const files = this.expressionConfig?.[name];
            if (files && files.length > 0) {
                this._playExpressionFile(files[0]);
                return true;
            }
        }
        return this.resetExpressionToNeutral();
    }

    _expressionNameFromPath(file) {
        try {
            let name = file.split('/').pop().replace('.exp3.json', '');
            if (name.startsWith('expression')) {
                const num = name.replace('expression', '');
                if (!isNaN(parseInt(num))) name = `表情${num}`;
            }
            return name;
        } catch (_) {
            return '未知表情';
        }
    }

    _modelAssetBase() {
        try {
            const rawUrl = String(this.model?.internalModel?.settings?.url || '');
            const decoded = decodeURIComponent(rawUrl)
                .replace(/^\/?live-2d\//, '')
                .replace(/^\/+/, '');
            const modelJsonPath = path.isAbsolute(decoded) ? decoded : path.join(APP_ROOT, decoded);
            if (fs.existsSync(modelJsonPath)) return path.dirname(modelJsonPath);
        } catch (_) {}
        return path.join(APP_ROOT, '2D', this.modelDirName || this.currentCharacter || '');
    }

    _collectExpressionDefinitions() {
        const settings = this.model?.internalModel?.settings;
        const assetBase = this._modelAssetBase();
        const modelRoot = path.join(APP_ROOT, '2D', this.modelDirName || this.currentCharacter || '');
        const definitions = [];
        const seenFiles = new Set();

        const addDefinition = (name, file) => {
            const normalized = String(file || '').replace(/\\/g, '/');
            if (!normalized || seenFiles.has(normalized)) return;
            seenFiles.add(normalized);
            definitions.push({
                Name: name || path.basename(normalized).replace(/\.exp3\.json$/i, ''),
                File: normalized
            });
        };

        for (const item of settings?.expressions || []) {
            if (item?.File) addDefinition(item.Name, item.File);
        }
        for (const item of settings?.json?.FileReferences?.Expressions || []) {
            if (item?.File) addDefinition(item.Name, item.File);
        }

        const configuredFiles = new Set([this.idleExpression]);
        for (const files of Object.values(this.expressionConfig || {})) {
            if (Array.isArray(files)) {
                for (const file of files) configuredFiles.add(file);
            }
        }
        for (const file of configuredFiles) {
            if (!file) continue;
            const absolute = path.join(assetBase, String(file).replace(/\//g, path.sep));
            if (fs.existsSync(absolute)) addDefinition(null, file);
        }

        for (const expressionPath of _scanFiles(modelRoot, '.exp3.json')) {
            const rel = path.relative(assetBase, expressionPath).replace(/\\/g, '/');
            addDefinition(null, rel);
        }
        return definitions;
    }

    _ensureExpressionDefinitions() {
        if (this._expressionDefinitionsSynced) return true;
        const motionManager = this.model?.internalModel?.motionManager;
        const settings = this.model?.internalModel?.settings;
        const PixiLive2D = globalThis.PIXI?.live2d || globalThis.window?.PIXI?.live2d;
        if (!motionManager || !settings || !PixiLive2D?.Cubism4ExpressionManager) {
            return false;
        }

        const definitions = this._collectExpressionDefinitions();
        if (!definitions.length) return false;

        settings.expressions = definitions;
        settings.resolveURL = settings.resolveURL || function(url) { return url; };

        let expressionManager = motionManager.expressionManager;
        if (!expressionManager) {
            try {
                expressionManager = new PixiLive2D.Cubism4ExpressionManager(settings, {
                    autoFocus: false,
                    autoHitTest: false
                });
                motionManager.expressionManager = expressionManager;
            } catch (e) {
                console.warn('[EmotionEngine] 创建表情管理器失败:', e);
                return false;
            }
        }

        expressionManager.definitions = definitions;
        expressionManager.expressions = expressionManager.expressions || [];
        this._expressionDefinitionsSynced = true;
        return true;
    }

    resetExpressionToNeutral() {
        try {
            this._ensureExpressionDefinitions();
            const expressionManager = this.model?.internalModel?.motionManager?.expressionManager;
            if (expressionManager && typeof expressionManager.resetExpression === 'function') {
                expressionManager.resetExpression();
                return true;
            }
        } catch (e) {
            console.warn('[EmotionEngine] 重置表情失败:', e);
        }
        this.softResetToInitial();
        return false;
    }

    clearNativeExpressions() {
        return this.resetExpressionToNeutral();
    }

    playNativeExpressionFile(expressionFile) {
        return this._playExpressionFile(expressionFile);
    }

    _playExpressionFile(expressionFile) {
        if (!this.model || typeof this.model.expression !== 'function') return false;
        try {
            this._ensureExpressionDefinitions();
            const originalName = expressionFile.split('/').pop().replace('.exp3.json', '');
            this.model.expression(originalName);
            return true;
        } catch (e) {
            console.error('[EmotionEngine] 播放表情失败:', e);
            return false;
        }
    }

    // 表情绑定（WebUI /bind-expression 走这里）：更新内存 + 持久化
    bindExpressionToEmotion(emotion, expressionName) {
        if (!this.expressionConfig) return false;

        let files = this.expressionConfig[expressionName];
        if (!files || files.length === 0) {
            const guessed = `expressions/${expressionName}.exp3.json`;
            this.expressionConfig[expressionName] = [guessed];
            files = this.expressionConfig[expressionName];
        }
        if (!this.expressionConfig[emotion]) this.expressionConfig[emotion] = [];
        for (const f of files) {
            if (!this.expressionConfig[emotion].includes(f)) {
                this.expressionConfig[emotion].push(f);
            }
        }
        this._persistExpressionConfig();
        return true;
    }

    _persistExpressionConfig() {
        if (this._usingSidecar) {
            // 写回 sidecar
            const sidecar = _readJson(this._sidecarPath) || {};
            sidecar.emotions = sidecar.emotions || {};
            for (const emotion of EMOTION_WHITELIST) {
                sidecar.emotions[emotion] = sidecar.emotions[emotion] || {};
                sidecar.emotions[emotion].expressions = this.expressionConfig[emotion] || [];
            }
            sidecar.expressions_named = {};
            for (const [name, files] of Object.entries(this.expressionConfig)) {
                if (!EMOTION_WHITELIST.includes(name)) sidecar.expressions_named[name] = files;
            }
            _writeJson(this._sidecarPath, sidecar);
            return;
        }
        // 写回旧版中央配置（修复旧实现 fetch('/api/...') 必然失败的保存路径）
        const legacyPath = path.join(APP_ROOT, 'emotion_expressions.json');
        const legacy = _readJson(legacyPath) || {};
        if (!legacy[this.currentCharacter]) legacy[this.currentCharacter] = {};
        legacy[this.currentCharacter].emotion_expressions = this.expressionConfig;
        _writeJson(legacyPath, legacy);
    }

    // ============ TTS 时间轴 ============

    // kind: 'motion' | 'expression' —— 门面各取所需，marker 结构与旧实现一致
    prepareTextForTTS(text, kind) {
        const { purifiedText, positions } = stripTags(text);
        const config = kind === 'expression' ? this.expressionConfig : this.motionConfig;
        const fileKey = kind === 'expression' ? 'expressionFiles' : 'motionFiles';

        const emotionMarkers = [];
        for (const p of positions) {
            if (config && config[p.emotion]) {
                emotionMarkers.push({
                    position: p.position,
                    emotion: p.emotion,
                    [fileKey]: config[p.emotion]
                });
            }
        }
        return { text: purifiedText, emotionMarkers };
    }

    triggerEmotionByTextPosition(position, textLength, markers, kind) {
        if (!markers || markers.length === 0) return;
        const fire = (emotion) => {
            if (kind === 'expression') {
                this.triggerExpressionByEmotion(emotion);
            } else {
                this.playConfiguredEmotion(emotion);
            }
        };

        for (let i = markers.length - 1; i >= 0; i--) {
            const marker = markers[i];
            if (position >= marker.position && position <= marker.position + 2) {
                fire(marker.emotion);
                markers.splice(i, 1);
                break;
            }
        }
        if (position >= textLength - 1 && markers.length > 0) {
            for (const marker of markers) fire(marker.emotion);
            markers.length = 0;
        }
    }

    // ============ 门面（兼容旧双 Mapper 契约） ============

    _createMotionFacade() {
        const engine = this;
        return {
            get model() { return engine.model; },
            get currentCharacter() { return engine.currentCharacter; },
            getCurrentCharacterName: () => engine.getCurrentCharacterName(),
            playConfiguredEmotion: (emotion) => engine.playConfiguredEmotion(emotion),
            playMotion: (index) => engine.playMotionByIndex(index),
            playDefaultMotion: () => engine.playDefaultMotion(),
            prepareTextForTTS: (text) => engine.prepareTextForTTS(text, 'motion'),
            triggerEmotionByTextPosition: (pos, len, markers) => engine.triggerEmotionByTextPosition(pos, len, markers, 'motion'),
            reloadConfig: () => engine.reloadConfig(),
            // 旧接口兼容（无外部消费者，保守保留）
            triggerMotionByEmotion: (text) => {
                const m = text.match(/<([^>]+)>/);
                if (m && m[1]) engine.playConfiguredEmotion(m[1]);
                return text.replace(/<[^>]+>/g, '').trim();
            },
            _engine: engine
        };
    }

    _createExpressionFacade() {
        const engine = this;
        return {
            get model() { return engine.model; },
            get currentCharacter() { return engine.currentCharacter; },
            get defaultExpression() { return engine.defaultExpression; },
            set defaultExpression(v) { engine.defaultExpression = v; },
            getCurrentCharacterName: () => engine.getCurrentCharacterName(),
            setEmotionMapper: () => {},   // 旧接口，双 Mapper 互联已不需要
            prepareTextForTTS: (text) => engine.prepareTextForTTS(text, 'expression'),
            triggerEmotionByTextPosition: (pos, len, markers) => engine.triggerEmotionByTextPosition(pos, len, markers, 'expression'),
            triggerExpressionByEmotion: (emotion) => engine.triggerExpressionByEmotion(emotion),
            triggerExpression: (name) => engine.triggerExpression(name),
            playExpression: (name) => engine.triggerExpression(name),
            playDefaultExpression: () => engine.playDefaultExpression(),
            bindExpressionToEmotion: (emotion, name) => engine.bindExpressionToEmotion(emotion, name),
            reloadConfig: () => engine.reloadConfig(),
            _engine: engine
        };
    }

    destroy() {
        if (this._softResetFrame) cancelAnimationFrame(this._softResetFrame);
        if (this._simpleMotionFrame) cancelAnimationFrame(this._simpleMotionFrame);
        this._softResetFrame = null;
        this._simpleMotionFrame = null;
        this.model = null;
    }
}

module.exports = { EmotionEngine, LIPSYNC_PARAMS, EMOTION_WHITELIST };
