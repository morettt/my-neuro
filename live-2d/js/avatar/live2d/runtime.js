// runtime.js - Live2D 运行时驱动（口型 override + 眨眼 + 呼吸 + 视线跟随）
// Adapted from Project-N-E-K-O/N.E.K.O (Apache-2.0): static/live2d-model.js 的
// installMouthOverride 双注入点设计与眨眼/呼吸/视线 runtime 思路：
//   注入点1: hook motionManager.update —— 快照参数 -> 调原始 update -> diff 判断
//            "motion 是否正在驱动嘴部/眼部"（让位判定）
//   注入点2: hook coreModel.update —— 渲染前最后写入：口型（说话时强制覆盖）、
//            程序化眨眼（SDK 原生 eyeBlink 缺失时）、呼吸兜底
//   视线跟随: 走 pixi-live2d-display 的 FocusController（model.focus），
//            以 config.ui.focus_factor 为跟随强度（旧配置项，此前无消费者）
const { logToTerminal } = require('../../api-utils.js');
const { ParamDirector } = require('./param-director.js');
const { AuDriver } = require('./expression/au-driver.js');
const {
    LIVE2D_MOUTH_OPEN_PARAMS,
    LIVE2D_MOUTH_FALLBACK_PARAMS
} = require('./expression/semantic-actions.js');

const LIPSYNC_OVERRIDE_THRESHOLD = 0.001;
// 口型写入参数（按存在性缓存 index）；ParamA 仅在开口参数都不存在时兜底
const MOUTH_OPEN_PARAMS = LIVE2D_MOUTH_OPEN_PARAMS;
const MOUTH_FALLBACK_PARAMS = LIVE2D_MOUTH_FALLBACK_PARAMS;
const EYE_PARAM_PAIRS = [
    ['ParamEyeLOpen', 'ParamEyeROpen'],
    ['PARAM_EYE_L_OPEN', 'PARAM_EYE_R_OPEN']
];
const BREATH_PARAMS = ['ParamBreath', 'PARAM_BREATH'];

// 眨眼节奏（毫秒）
const BLINK_INTERVAL_MIN = 2000;
const BLINK_INTERVAL_MAX = 6000;
const BLINK_CLOSING_MS = 70;
const BLINK_CLOSED_MS = 50;
const BLINK_OPENING_MS = 110;

class Live2DRuntime {
    constructor() {
        this.model = null;
        this.config = null;

        // 口型
        this.mouthValue = 0;
        this._smoothedMouth = 0;
        this._mouthParamIndices = {};
        this._isMouthDrivenByMotion = false;

        // 眨眼
        this._eyeParams = [];             // [{id, idx}]
        this._blinkEnabled = false;
        this._isEyeDrivenByMotion = false;
        this._blinkState = 'idle';        // idle | closing | closed | opening
        this._blinkStateStart = 0;
        this._nextBlinkAt = 0;

        // 呼吸兜底
        this._breathParamIdx = -1;
        this._breathEnabled = false;
        this._breathPhase = 0;

        // 视线跟随
        this._gazeEnabled = true;
        this._focusFactor = 1;
        this._mouseHandler = null;
        this._lastFocus = null;

        // hook 管理
        this._installed = false;
        this._origMotionUpdate = null;
        this._origCoreUpdate = null;
        this._coreModelRef = null;
        this._motionManagerRef = null;
        this._lastFrameAt = 0;
        this.paramDirector = null;
        this.auDriver = null;
    }

    // ============ 安装 / 卸载 ============

    attach(model, config = null) {
        this.detach();
        this.model = model;
        if (config) this.config = config;

        const internalModel = model?.internalModel;
        const coreModel = internalModel?.coreModel;
        const motionManager = internalModel?.motionManager;
        if (!internalModel || !coreModel || !motionManager) {
            console.warn('[Live2DRuntime] 模型内部结构未就绪，跳过安装');
            return false;
        }

        this._cacheMouthParams(coreModel);
        this._cacheEyeParams(coreModel);
        this._cacheBreathParam(coreModel);

        // SDK 原生能力存在时让位，避免双重驱动
        this._blinkEnabled = this._eyeParams.length > 0 && !internalModel.eyeBlink;
        this._breathEnabled = this._breathParamIdx >= 0 && !internalModel.breath;
        this._scheduleNextBlink(performance.now());

        this.paramDirector = new ParamDirector(this.config);
        if (this.paramDirector.attach(model, coreModel)) {
            global.paramDirector = this.paramDirector;
        } else {
            this.paramDirector.detach();
            this.paramDirector = null;
            if (global.paramDirector) global.paramDirector = null;
        }

        this.auDriver = new AuDriver(model, this.config);
        global.auDriver = this.auDriver;

        // 视线跟随配置
        const uiCfg = this.config?.ui || {};
        this._gazeEnabled = uiCfg.live2d_gaze_tracking !== false;
        const factor = Number(uiCfg.focus_factor);
        this._focusFactor = Number.isFinite(factor) && factor > 0 ? Math.min(factor, 1) : 0.3;

        this._coreModelRef = coreModel;
        this._motionManagerRef = motionManager;

        // === 注入点 1: motionManager.update ===
        const origMotionUpdate = motionManager.update ? motionManager.update.bind(motionManager) : null;
        this._origMotionUpdate = origMotionUpdate;
        motionManager.update = (...args) => {
            if (!this._installed || this._coreModelRef !== coreModel) {
                return origMotionUpdate ? origMotionUpdate(...args) : undefined;
            }

            // 快照嘴部/眼部参数
            const preMouth = {};
            for (const [id, idx] of Object.entries(this._mouthParamIndices)) {
                try { preMouth[id] = coreModel.getParameterValueByIndex(idx); } catch (_) {}
            }
            const preEye = {};
            if (this._blinkEnabled) {
                for (const p of this._eyeParams) {
                    try { preEye[p.id] = coreModel.getParameterValueByIndex(p.idx); } catch (_) {}
                }
            }

            let result;
            if (origMotionUpdate) {
                try {
                    result = origMotionUpdate(...args);
                } catch (e) {
                    // motion 异步加载期间 SDK 可能抛 getParameterIndex 错误（已知问题），静默
                    if (!this.model?.internalModel?.coreModel) return;
                }
            }

            // diff: motion 是否接管
            this._isMouthDrivenByMotion = false;
            for (const [id, idx] of Object.entries(this._mouthParamIndices)) {
                try {
                    const post = coreModel.getParameterValueByIndex(idx);
                    if (preMouth[id] !== undefined && Math.abs(post - preMouth[id]) > 0.001) {
                        this._isMouthDrivenByMotion = true;
                        break;
                    }
                } catch (_) {}
            }
            this._isEyeDrivenByMotion = false;
            if (this._blinkEnabled) {
                for (const p of this._eyeParams) {
                    try {
                        const post = coreModel.getParameterValueByIndex(p.idx);
                        if (preEye[p.id] !== undefined && Math.abs(post - preEye[p.id]) > 0.001) {
                            this._isEyeDrivenByMotion = true;
                            break;
                        }
                    } catch (_) {}
                }
            }
            return result;
        };

        // === 注入点 2: coreModel.update（渲染前最后写入） ===
        const origCoreUpdate = coreModel.update ? coreModel.update.bind(coreModel) : null;
        this._origCoreUpdate = origCoreUpdate;
        coreModel.update = () => {
            if (!this._installed || this._coreModelRef !== coreModel) {
                if (origCoreUpdate) origCoreUpdate();
                return;
            }
            try {
                const now = performance.now();
                const delta = this._lastFrameAt ? Math.min(100, now - this._lastFrameAt) : 16.6;
                this._lastFrameAt = now;

                // 参数导演分层混合（在口型/眨眼之前，保证 lipsync 对嘴的最终覆盖权）
                if (this.paramDirector) {
                    try { this.paramDirector.applyFrame(coreModel, now, delta, this.mouthValue); } catch (_) {}
                }
                if (this.auDriver) {
                    try { this.auDriver.applyFrame(coreModel, now); } catch (_) {}
                }

                // 口型：说话时强制覆盖；静默时让位给 motion 或 AU 嘴部目标
                const lipSyncActive = this.mouthValue > LIPSYNC_OVERRIDE_THRESHOLD;
                const auMouthActive = !lipSyncActive && this.auDriver?.isMouthControlled();
                if (lipSyncActive || (!this._isMouthDrivenByMotion && !auMouthActive)) {
                    for (const idx of Object.values(this._mouthParamIndices)) {
                        try { coreModel.setParameterValueByIndex(idx, this.mouthValue); } catch (_) {}
                    }
                }
                // 眨眼（motion 未接管时）
                if (
                    this._blinkEnabled &&
                    !this._isEyeDrivenByMotion &&
                    !(this.paramDirector && this.paramDirector.isEyeControlled()) &&
                    !(this.auDriver && this.auDriver.isEyeControlled())
                ) {
                    this._updateBlink(coreModel, now);
                }
                // 呼吸兜底
                if (this._breathEnabled) {
                    this._breathPhase = (this._breathPhase + delta / 3200) % 1;
                    const v = 0.5 + 0.5 * Math.sin(this._breathPhase * Math.PI * 2);
                    try { coreModel.setParameterValueByIndex(this._breathParamIdx, v); } catch (_) {}
                }
            } catch (_) {}
            if (origCoreUpdate) origCoreUpdate();
        };

        this._setupGaze();
        this._installed = true;
        logToTerminal('info', `[Live2DRuntime] 已安装: 嘴部=${Object.keys(this._mouthParamIndices).join('/') || '无'}, 程序化眨眼=${this._blinkEnabled ? '开' : '关(SDK原生或无参数)'}, 呼吸兜底=${this._breathEnabled ? '开' : '关(SDK原生)'}, 视线跟随=${this._gazeEnabled ? '开' : '关'}(强度${this._focusFactor})`);
        return true;
    }

    detach() {
        if (this.auDriver) {
            try { this.auDriver.destroy(); } catch (_) {}
            if (global.auDriver === this.auDriver) global.auDriver = null;
            this.auDriver = null;
        }
        if (this.paramDirector) {
            try { this.paramDirector.detach(); } catch (_) {}
            if (global.paramDirector === this.paramDirector) global.paramDirector = null;
            this.paramDirector = null;
        }
        if (this._mouseHandler) {
            window.removeEventListener('mousemove', this._mouseHandler);
            this._mouseHandler = null;
        }
        if (!this._installed) {
            this.model = null;
            return;
        }
        this._installed = false;
        try {
            if (this._motionManagerRef && this._origMotionUpdate) {
                this._motionManagerRef.update = this._origMotionUpdate;
            }
        } catch (_) {}
        try {
            if (this._coreModelRef && this._origCoreUpdate) {
                this._coreModelRef.update = this._origCoreUpdate;
            }
        } catch (_) {}
        this._origMotionUpdate = null;
        this._origCoreUpdate = null;
        this._coreModelRef = null;
        this._motionManagerRef = null;
        this.model = null;
        this.mouthValue = 0;
        this._smoothedMouth = 0;
        this._lastFrameAt = 0;
        this._headPatParams = [];
        this._headPatHx = 0;
        this._headPatHy = 0;
        this._headPatActive = false;
    }

    // ============ 参数缓存 ============

    _cacheMouthParams(coreModel) {
        this._mouthParamIndices = {};
        const tryCache = (paramId) => {
            try {
                const idx = coreModel.getParameterIndex(paramId);
                if (idx >= 0 && this._paramIdExists(coreModel, paramId, idx)) {
                    this._mouthParamIndices[paramId] = idx;
                    return true;
                }
            } catch (_) {}
            return false;
        };
        let found = false;
        for (const id of MOUTH_OPEN_PARAMS) {
            if (tryCache(id)) found = true;
        }
        if (!found) {
            for (const id of MOUTH_FALLBACK_PARAMS) {
                if (tryCache(id)) found = true;
            }
        }
    }

    _cacheEyeParams(coreModel) {
        this._eyeParams = [];
        for (const pair of EYE_PARAM_PAIRS) {
            const cached = [];
            for (const id of pair) {
                try {
                    const idx = coreModel.getParameterIndex(id);
                    if (idx >= 0 && this._paramIdExists(coreModel, id, idx)) {
                        cached.push({ id, idx });
                    }
                } catch (_) {}
            }
            if (cached.length > 0) {
                this._eyeParams = cached;
                return;
            }
        }
    }

    _cacheBreathParam(coreModel) {
        this._breathParamIdx = -1;
        for (const id of BREATH_PARAMS) {
            try {
                const idx = coreModel.getParameterIndex(id);
                if (idx >= 0 && this._paramIdExists(coreModel, id, idx)) {
                    this._breathParamIdx = idx;
                    return;
                }
            } catch (_) {}
        }
    }

    _paramIdExists(coreModel, paramId, idx) {
        try {
            if (typeof coreModel.getParameterId === 'function') {
                return coreModel.getParameterId(idx) === paramId;
            }
        } catch (_) {}
        return true;
    }

    // ============ 口型 ============

    /** TTS 音量包络驱动（0~1，带平滑） */
    setMouth(value) {
        const v = Math.max(0, Math.min(Number(value) || 0, 1.5));
        this._smoothedMouth = this._smoothedMouth * 0.5 + v * 0.5;
        // 收尾时快速归零，避免嘴巴悬停半开
        this.mouthValue = this._smoothedMouth < 0.01 ? 0 : this._smoothedMouth;
    }

    // ============ 眨眼 ============

    _scheduleNextBlink(now) {
        this._nextBlinkAt = now + BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN);
        this._blinkState = 'idle';
    }

    _updateBlink(coreModel, now) {
        let eyeValue = null;
        switch (this._blinkState) {
            case 'idle':
                if (now >= this._nextBlinkAt) {
                    this._blinkState = 'closing';
                    this._blinkStateStart = now;
                }
                break;
            case 'closing': {
                const t = Math.min(1, (now - this._blinkStateStart) / BLINK_CLOSING_MS);
                eyeValue = 1 - t;
                if (t >= 1) {
                    this._blinkState = 'closed';
                    this._blinkStateStart = now;
                }
                break;
            }
            case 'closed': {
                eyeValue = 0;
                if (now - this._blinkStateStart >= BLINK_CLOSED_MS) {
                    this._blinkState = 'opening';
                    this._blinkStateStart = now;
                }
                break;
            }
            case 'opening': {
                const t = Math.min(1, (now - this._blinkStateStart) / BLINK_OPENING_MS);
                eyeValue = t;
                if (t >= 1) this._scheduleNextBlink(now);
                break;
            }
        }
        if (eyeValue !== null) {
            for (const p of this._eyeParams) {
                try { coreModel.setParameterValueByIndex(p.idx, eyeValue); } catch (_) {}
            }
        }
    }

    // ============ 视线跟随 ============

    _setupGaze() {
        if (this._mouseHandler) {
            window.removeEventListener('mousemove', this._mouseHandler);
        }
        let pending = false;
        this._mouseHandler = (e) => {
            if (!this._gazeEnabled || !this.model || pending) return;
            pending = true;
            requestAnimationFrame(() => {
                pending = false;
                this._applyGaze(e.clientX, e.clientY);
            });
        };
        window.addEventListener('mousemove', this._mouseHandler, { passive: true });
    }

    _applyGaze(clientX, clientY) {
        const model = this.model;
        if (!model || typeof model.focus !== 'function') return;
        try {
            // 以模型头部附近为锚点，按 focus_factor 衰减跟随幅度
            const anchorX = model.x + model.width / 2;
            const anchorY = model.y + model.height * 0.3;
            const fx = anchorX + (clientX - anchorX) * this._focusFactor;
            const fy = anchorY + (clientY - anchorY) * this._focusFactor;
            model.focus(fx, fy);
            this._lastFocus = { x: fx, y: fy };
        } catch (_) {}
    }

    setGazeTracking(enabled) {
        this._gazeEnabled = !!enabled;
        if (!enabled && this.model) {
            // 关闭时视线回正（对准模型头部锚点，FocusController 自带平滑）
            try {
                this.model.focus(this.model.x + this.model.width / 2, this.model.y + this.model.height * 0.3);
            } catch (_) {}
        }
    }

    isGazeTrackingEnabled() {
        return this._gazeEnabled;
    }

    updateConfig(config) {
        this.config = config;
        const factor = Number(config?.ui?.focus_factor);
        if (Number.isFinite(factor) && factor > 0) this._focusFactor = Math.min(factor, 1);
        if (this.paramDirector) {
            try { this.paramDirector.updateConfig(config); } catch (_) {}
        }
        if (this.auDriver) {
            try { this.auDriver.updateConfig(config); } catch (_) {}
        }
    }
}

module.exports = { Live2DRuntime, LIPSYNC_OVERRIDE_THRESHOLD };
