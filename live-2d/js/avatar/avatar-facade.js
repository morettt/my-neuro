// avatar-facade.js - 四形态皮套统一门面（driver 分发表）
// 参考 N.E.K.O live2d-init.js 的 LanLan1 门面 + _getActiveModelType 分发模式：
//   每种形态注册一个 driver：{ init, dispose, setEmotion, setMouth, playMotion, getModel, getController }
//   门面按 config.ui.model_type 分发；未实现的方法允许 no-op；
//   形态切换 = dispose 当前 driver -> init 新 driver（dispose 不支持时降级整窗 reload）。
// AI/TTS/插件层只跟门面（或 global 兼容别名）交互，对具体渲染栈无感知。
const { ipcRenderer } = require('electron');
const { logToTerminal } = require('../api-utils.js');

const AVATAR_TYPES = ['live2d', 'vrm', 'mmd', 'pngtuber'];
const IPC_RESULT_PHASES = new Set([
    'ready',
    'busy',
    'failed',
    'rolled-back',
    'reload-required',
    'reload-scheduled'
]);
const CONTAINER_IDS = {
    live2d: 'live2d-container',
    vrm: 'vrm-container',
    mmd: 'mmd-container',
    pngtuber: 'pngtuber-container'
};

function normalizeType(type) {
    const t = String(type || 'live2d').toLowerCase();
    return AVATAR_TYPES.includes(t) ? t : 'live2d';
}

function summarizeIPCResult(result) {
    const summary = {
        success: result?.success === true,
        message: typeof result?.message === 'string'
            ? result.message
            : (result?.success === true ? '操作成功' : '操作失败')
    };
    if (Object.prototype.hasOwnProperty.call(result || {}, 'restored')) {
        summary.restored = result.restored === true;
    }
    if (Object.prototype.hasOwnProperty.call(result || {}, 'reloadRequired')) {
        summary.reloadRequired = result.reloadRequired === true;
    }
    if (IPC_RESULT_PHASES.has(result?.phase)) {
        summary.phase = result.phase;
    }
    if (AVATAR_TYPES.includes(result?.targetType)) {
        summary.targetType = result.targetType;
    }
    if (AVATAR_TYPES.includes(result?.activeType)) {
        summary.activeType = result.activeType;
    } else if (Object.prototype.hasOwnProperty.call(result || {}, 'activeType')) {
        summary.activeType = null;
    }
    return summary;
}

async function reportIPCResult(channel, requestId, result) {
    if (!requestId) return;
    const summary = summarizeIPCResult(result);
    try {
        await ipcRenderer.invoke(channel, { requestId, ...summary });
    } catch (error) {
        console.warn(`[AvatarFacade] 上报 ${channel} 失败:`, error);
    }
}

async function reportAvatarRuntimeReady(result) {
    const summary = summarizeIPCResult(result);
    try {
        await ipcRenderer.invoke('avatar-runtime-ready', summary);
    } catch (error) {
        console.warn('[AvatarFacade] 上报运行时 ready 失败:', error);
    }
}

class AvatarFacade {
    constructor() {
        this._drivers = {};        // type -> driver 工厂产物
        this._activeType = null;
        this._activeDriver = null;
        this._context = null;      // { modelController, config, ttsEnabled, asrEnabled, ttsProcessor, voiceChat }
        this._switching = false;
        this._ipcBound = false;
        this._webglEnginesUsed = new Set();  // 本页已创建过上下文的 WebGL 引擎（pixi/three）
    }

    /** 注册形态 driver（factory: (facade) => driver 对象） */
    register(type, driver) {
        this._drivers[normalizeType(type)] = driver;
    }

    getActiveType() {
        return this._activeType;
    }

    getModel() {
        return this._activeDriver?.getModel?.() || null;
    }

    getController() {
        return this._activeDriver?.getController?.() || null;
    }

    getActiveCanvas() {
        const containerId = CONTAINER_IDS[this._activeType] || 'live2d-container';
        return document.querySelector(`#${containerId} canvas`);
    }

    /** 初始化指定形态（app-initializer 启动时调用一次） */
    async init(type, context) {
        this._context = context;
        const t = normalizeType(type);
        const driver = this._drivers[t];
        if (!driver) {
            const error = new Error(`形态 "${t}" 的 driver 未注册（该形态尚未移植完成）`);
            await reportAvatarRuntimeReady({
                success: false,
                phase: 'failed',
                targetType: t,
                activeType: null,
                message: error.message
            });
            throw error;
        }

        try {
            this._showContainer(t);
            const result = await driver.init(context);
            this._activeType = t;
            this._activeDriver = driver;
            if (['pixi', 'three', 'three-mmd'].includes(driver.engine)) {
                this._webglEnginesUsed.add(driver.engine);
            }

            this._wireMouthSink();
            this._bindIPC();
            logToTerminal('info', `[AvatarFacade] 形态已激活: ${t}`);
            await reportAvatarRuntimeReady({
                success: true,
                phase: 'ready',
                targetType: t,
                activeType: t,
                message: `${t} 形态已就绪`
            });
            return result;
        } catch (error) {
            this._activeType = null;
            this._activeDriver = null;
            await reportAvatarRuntimeReady({
                success: false,
                phase: 'failed',
                targetType: t,
                activeType: null,
                message: `初始化 ${t} 失败: ${error.message}`
            });
            throw error;
        }
    }

    /** 形态切换（写配置由主进程完成，这里只做渲染侧交接） */
    async switchType(nextType) {
        const t = normalizeType(nextType);
        if (this._switching) {
            return {
                success: false,
                phase: 'busy',
                targetType: t,
                activeType: this._activeType,
                message: '形态切换进行中'
            };
        }
        if (t === this._activeType) {
            return {
                success: true,
                phase: 'ready',
                targetType: t,
                activeType: t,
                reloadRequired: false,
                message: `已是 ${t} 形态`
            };
        }
        const nextDriver = this._drivers[t];
        if (!nextDriver) {
            return {
                success: false,
                phase: 'failed',
                targetType: t,
                activeType: this._activeType,
                message: `形态 "${t}" 尚未移植`
            };
        }

        // 跨 WebGL 引擎切换（PIXI <-> Three）必须整窗 reload：
        // 透明桌宠窗口中在已有 WebGL 上下文的渲染进程里再创建另一引擎的上下文，
        // 会在 ANGLE/D3D11 原生层死锁冻结主线程（实测，Debugger 都无法中断）。
        // 判定基于"本页已创建过的引擎集合"（覆盖经由 pngtuber 的间接路径），
        // config.ui.model_type 由主进程先持久化；这里只报告需要 reload，
        // reload 的调度与启动确认也全部由主进程负责。
        const WEBGL_ENGINES = ['pixi', 'three', 'three-mmd'];
        const nextEngine = nextDriver.engine || 'none';
        if (WEBGL_ENGINES.includes(nextEngine)) {
            const conflicting = [...this._webglEnginesUsed].some(e => e !== nextEngine);
            if (conflicting) {
                logToTerminal('info', `[AvatarFacade] 页内已存在其他 WebGL 引擎(${[...this._webglEnginesUsed].join(',')})，切换 ${t} 需要窗口重载`);
                return {
                    success: true,
                    phase: 'reload-required',
                    targetType: t,
                    activeType: this._activeType,
                    reloadRequired: true,
                    message: `切换到 ${t} 需要重载（跨渲染引擎）`
                };
            }
        }

        this._switching = true;
        const previousType = this._activeType;
        const previousDriver = this._activeDriver;
        const previousConfigType = this._context?.config?.ui?.model_type;
        try {
            // 1. dispose 当前形态
            if (previousDriver) {
                if (typeof previousDriver.dispose === 'function') {
                    await previousDriver.dispose();
                } else {
                    logToTerminal('warn', `[AvatarFacade] ${previousType} driver 无 dispose，需要窗口重载`);
                    return {
                        success: true,
                        phase: 'reload-required',
                        targetType: t,
                        activeType: previousType,
                        reloadRequired: true,
                        message: `${previousType} 不支持热释放，需要重载以切换到 ${t}`
                    };
                }
            }
            this._activeDriver = null;
            this._activeType = null;

            // 2. 初始化新形态。只有成功后才更新共享配置，避免失败时
            // 把 renderer 留在一个没有可用 Avatar 的目标状态。
            this._showContainer(t);
            const result = await nextDriver.init(this._context);
            this._activeType = t;
            this._activeDriver = nextDriver;
            if (this._context?.config?.ui) {
                this._context.config.ui.model_type = t;
            }
            if (['pixi', 'three', 'three-mmd'].includes(nextDriver.engine)) {
                this._webglEnginesUsed.add(nextDriver.engine);
            }
            this._wireMouthSink();

            logToTerminal('info', `[AvatarFacade] 形态切换完成: ${previousType} -> ${t}`);
            return {
                success: true,
                phase: 'ready',
                targetType: t,
                activeType: t,
                reloadRequired: false,
                message: `已切换到 ${t}`,
                result
            };
        } catch (e) {
            console.error('[AvatarFacade] 形态切换失败:', e);
            try { await nextDriver.dispose?.(); } catch (_) {}

            this._activeDriver = null;
            this._activeType = null;
            if (this._context?.config?.ui && previousConfigType !== undefined) {
                this._context.config.ui.model_type = previousConfigType;
            }

            let restored = false;
            let restoreError = null;
            if (previousDriver && previousType) {
                try {
                    this._showContainer(previousType);
                    await previousDriver.init(this._context);
                    this._activeType = previousType;
                    this._activeDriver = previousDriver;
                    this._wireMouthSink();
                    restored = true;
                    logToTerminal('warn', `[AvatarFacade] 切换失败，已恢复 ${previousType}`);
                } catch (error) {
                    restoreError = error;
                }
            }

            if (!restored) {
                logToTerminal('error', `[AvatarFacade] 形态切换失败: ${e.message}，恢复旧形态也失败`);
            } else {
                logToTerminal('error', `[AvatarFacade] 形态切换失败: ${e.message}，已恢复旧形态`);
            }
            const suffix = restoreError ? `；恢复失败: ${restoreError.message}` : '';
            return {
                success: false,
                phase: restored ? 'rolled-back' : 'reload-required',
                targetType: t,
                activeType: restored ? previousType : null,
                restored,
                reloadRequired: !restored,
                message: `切换失败(${e.message})${restored ? '，已恢复原形态' : '，需要主进程重载恢复'}${suffix}`
            };
        } finally {
            this._switching = false;
        }
    }

    // ============ 统一能力分发（AI/TTS/插件的稳定入口） ============

    setEmotion(emotion) {
        try { this._activeDriver?.setEmotion?.(emotion); } catch (_) {}
    }

    setMouth(value) {
        try { this._activeDriver?.setMouth?.(value); } catch (_) {}
    }

    playMotion(indexOrGroup, index) {
        try { this._activeDriver?.playMotion?.(indexOrGroup, index); } catch (_) {}
    }

    // ============ 内部 ============

    _showContainer(type) {
        for (const [t, id] of Object.entries(CONTAINER_IDS)) {
            const el = document.getElementById(id);
            if (!el) continue;
            // vrm/mmd 共用容器：目标形态所在容器显示，其余隐藏
            el.style.display = (id === CONTAINER_IDS[type]) ? 'block' : 'none';
        }
    }

    // TTS 口型回调统一接到门面（形态切换后无需重接 TTS 链路）
    _wireMouthSink() {
        const playbackEngine = this._context?.ttsProcessor?.playbackEngine;
        if (playbackEngine) {
            playbackEngine.onAudioDataCallback = (value) => this.setMouth(value);
        }
    }

    /** 同形态重载（换模型用）：配置与 driver 初始化一起提交，失败时恢复。 */
    async reloadActiveModel(configPatch = null) {
        if (this._switching) {
            return { success: false, message: '形态切换进行中' };
        }
        const driver = this._activeDriver;
        const type = this._activeType;
        if (!driver || !type) {
            return { success: false, message: '当前没有激活的形态' };
        }

        const uiPatch = configPatch && typeof configPatch === 'object'
            ? configPatch
            : {};
        const config = this._context?.config;
        if (!config) {
            return { success: false, message: 'Avatar 配置尚未初始化' };
        }
        if (!config.ui || typeof config.ui !== 'object') config.ui = {};
        const previousValues = {};
        const hadPreviousValue = {};
        for (const [key, value] of Object.entries(uiPatch)) {
            hadPreviousValue[key] = Object.prototype.hasOwnProperty.call(config.ui, key);
            previousValues[key] = config.ui[key];
            config.ui[key] = value;
        }

        this._switching = true;
        try {
            if (typeof driver.dispose !== 'function') {
                throw new Error(`${type} driver 不支持重载`);
            }
            await driver.dispose();
            this._activeDriver = null;
            this._activeType = null;
            this._showContainer(type);
            const result = await driver.init(this._context);
            this._activeDriver = driver;
            this._activeType = type;
            this._wireMouthSink();
            logToTerminal('info', `[AvatarFacade] ${type} 模型已重载`);
            return { success: true, message: `${type} 模型已重载`, result };
        } catch (e) {
            console.error('[AvatarFacade] 模型重载失败:', e);
            try { await driver.dispose?.(); } catch (_) {}

            for (const key of Object.keys(uiPatch)) {
                if (hadPreviousValue[key]) config.ui[key] = previousValues[key];
                else delete config.ui[key];
            }

            let restored = false;
            let restoreError = null;
            try {
                this._showContainer(type);
                const restoredResult = await driver.init(this._context);
                this._activeDriver = driver;
                this._activeType = type;
                this._wireMouthSink();
                restored = true;
                logToTerminal('warn', `[AvatarFacade] ${type} 重载失败，已恢复原模型`);
                return {
                    success: false,
                    restored: true,
                    message: `重载失败(${e.message})，已恢复原模型`,
                    result: restoredResult
                };
            } catch (restoreFailure) {
                restoreError = restoreFailure;
            }

            this._activeDriver = null;
            this._activeType = null;
            logToTerminal('error', `[AvatarFacade] 模型重载失败: ${e.message}，恢复也失败`);
            const suffix = restoreError ? `；恢复失败: ${restoreError.message}` : '';
            return {
                success: false,
                phase: 'reload-required',
                targetType: type,
                activeType: null,
                restored,
                reloadRequired: true,
                message: `重载失败(${e.message})，需要主进程重载恢复${suffix}`
            };
        } finally {
            this._switching = false;
        }
    }

    _bindIPC() {
        if (this._ipcBound) return;
        this._ipcBound = true;
        ipcRenderer.on('avatar-switch-type', async (event, payload) => {
            const requestId = payload?.requestId;
            let res;
            try {
                res = await this.switchType(payload?.type);
            } catch (error) {
                res = { success: false, message: `切换异常: ${error.message}` };
            }
            const summary = summarizeIPCResult(res);
            logToTerminal('info', `[AvatarFacade] IPC 切换结果: ${JSON.stringify(summary)}`);
            await reportIPCResult('avatar-switch-type-result', requestId, res);
        });
        ipcRenderer.on('avatar-reload-model', async (event, payload) => {
            const requestId = payload?.requestId;
            let res;
            try {
                const patch = payload?.configKey
                    ? { [payload.configKey]: payload.configValue }
                    : null;
                res = await this.reloadActiveModel(patch);
            } catch (error) {
                res = { success: false, message: `重载异常: ${error.message}` };
            }
            logToTerminal('info', `[AvatarFacade] IPC 模型重载结果: ${JSON.stringify(summarizeIPCResult(res))}`);
            await reportIPCResult('avatar-reload-model-result', requestId, res);
        });
        ipcRenderer.on('avatar-config-updated', (_event, payload) => {
            this._applyConfigPatch(payload);
        });
    }

    _applyConfigPatch(payload) {
        const patch = payload?.ui && typeof payload.ui === 'object'
            ? payload.ui
            : payload;
        if (!patch || typeof patch !== 'object' || !this._context) return;
        if (!this._context.config || typeof this._context.config !== 'object') {
            this._context.config = {};
        }
        if (!this._context.config.ui || typeof this._context.config.ui !== 'object') {
            this._context.config.ui = {};
        }
        Object.assign(this._context.config.ui, patch);
    }
}

const avatarFacade = new AvatarFacade();
global.avatarFacade = avatarFacade;
window.avatar = avatarFacade;

module.exports = { avatarFacade, AVATAR_TYPES };
