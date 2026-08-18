// setup.js - Live2D 形态装配（替代旧 js/model/model-setup.js）
// 职责：创建/复用舞台 -> 解析模型路径 -> 加载模型 -> 装配交互/情绪/音乐/口型 -> 注册热切换。
// 返回结构与旧 ModelSetup.initialize 完全一致：{ app, model, emotionMapper, expressionMapper, musicPlayer }
//
// 热切换策略：形态切走时只 suspend（保留 PIXI app 与 WebGL 上下文），切回时复用。
// （销毁上下文后立刻创建 Three.js 上下文会在 ANGLE/D3D11 原生层冻结渲染进程。）
const { ipcRenderer } = require('electron');
const { Live2DStage } = require('./core.js');
const { Live2DModelLoader } = require('./model-loader.js');
const { resolveLive2DModel } = require('../model-registry.js');
const { getModelPrefs } = require('../preferences-store.js');
const { EmotionEngine } = require('./emotion-engine.js');
const { Live2DRuntime } = require('./runtime.js');
const { MusicPlayer } = require('../../services/music-player.js');
const { logToTerminal } = require('../../api-utils.js');
const { bindVoiceChatAvatar } = require('../avatar-voice-chat-binding.js');

// 模块级单例（跨形态切换存活）
let _stage = null;
let _loader = null;
let _runtime = null;
let _musicPlayer = null;
let _engine = null;
let _ipcBound = false;
let _context = null;

class Live2DSetup {
    /**
     * @param {object} modelController Live2DInteractionController 实例（app.js 创建）
     * @returns {{ app, model, emotionMapper, expressionMapper, musicPlayer, stage, loader }}
     */
    static async initialize(modelController, config, ttsEnabled, asrEnabled, ttsProcessor, voiceChat) {
        _context = { modelController, config, ttsEnabled, ttsProcessor, voiceChat };

        // 1. 舞台（首次创建 / 挂起后复用）
        if (!_stage) _stage = new Live2DStage();
        await _stage.init('canvas', config);

        // 2. 通过注册表解析模型（config.ui.live2d_model 驱动）
        const { modelPath, entry, all } = resolveLive2DModel(config?.ui?.live2d_model);
        if (!modelPath) {
            throw new Error('2D 目录下没有找到任何 .model3.json 模型');
        }
        const fallbackPath = (all.find(m => m.modelPath !== modelPath) || {}).modelPath || null;
        logToTerminal('info', `[Live2DSetup] 共发现 ${all.length} 个模型，选用: ${entry.name} (${modelPath})`);

        // 3. 加载（应用 per-model 偏好，回退全局 config）
        if (!_loader) _loader = new Live2DModelLoader(_stage);
        if (!_runtime) _runtime = new Live2DRuntime();
        global.live2dRuntime = _runtime;

        const prefs = getModelPrefs('live2d', entry.name);
        const model = await _loader.loadModel(modelPath, {
            config,
            preferences: prefs,
            fallbackPath,
            // The explicit wireModel call below is the single setup path for
            // startup and resume. The loader callback is reserved for hot
            // switches so a resume cannot assemble the same model twice.
            notifyLoaded: false
        });

        // 4. 交互控制器
        modelController.init(model, _stage.app, config, { stage: _stage });
        modelController.setupInitialModelProperties();
        modelController.setMouthSetter((v) => {
            _runtime.setMouth(v);
            _stage.notifyActivity();
        });

        // 5. 装配上下游（首次 + 每次热切换/模型切换都要执行）
        const wireModel = async (m) => {
            const ctx = _context;
            m.isPointOverModel = (x, y) => ctx.modelController.isPointOverModel(x, y);
            m.hitTest = (x, y) => ctx.modelController.isPointOverModel(x, y);
            ctx.modelController.rebind(m);
            global.currentModel = m;
            _runtime.attach(m, ctx.config);

            // 统一表情/动作引擎（双门面兼容旧 Mapper 契约）
            if (_engine) {
                try { _engine.destroy(); } catch (_) {}
            }
            _engine = await EmotionEngine.create(m, ctx.config);
            global.emotionEngine = _engine;

            const emotionMapper = _engine.motionFacade;
            const expressionMapper = _engine.expressionFacade;
            global.currentCharacterName = await _engine.getCurrentCharacterName();
            global.emotionMapper = emotionMapper;
            global.expressionMapper = expressionMapper;

            if (ctx.ttsEnabled && ctx.ttsProcessor?.setEmotionMapper) {
                ctx.ttsProcessor.setEmotionMapper(emotionMapper);
            }
            if (ctx.ttsEnabled && ctx.ttsProcessor?.setExpressionMapper) {
                ctx.ttsProcessor.setExpressionMapper(expressionMapper);
            }
            if (_musicPlayer) {
                _musicPlayer.setEmotionMapper(emotionMapper);
            }
            bindVoiceChatAvatar(ctx.voiceChat, m, emotionMapper);
            return { emotionMapper, expressionMapper };
        };

        const { emotionMapper, expressionMapper } = await wireModel(model);

        // 6. 音乐播放器（依赖 modelController.setMouthOpenY）
        if (!_musicPlayer) {
            _musicPlayer = new MusicPlayer(modelController);
        }
        _musicPlayer.setEmotionMapper(emotionMapper);
        global.musicPlayer = _musicPlayer;

        // 7. 热切换：主进程 switch-live2d-model / update-live2d-model 触发
        _loader.onModelLoaded = async (newModel) => {
            await wireModel(newModel);
        };
        _loader.onModelRemoved = () => {
            _runtime.detach();
        };

        if (!_ipcBound) {
            _ipcBound = true;
            ipcRenderer.on('live2d-switch-model', async (event, payload) => {
                const { modelName, modelPath: nextPath, requestId } = payload || {};
                let result = { success: false, message: 'Live2D 模型切换未执行' };
                const reportResult = async () => {
                    if (!requestId) return;
                    try {
                        await ipcRenderer.invoke('live2d-switch-model-result', {
                            requestId,
                            success: result.success === true,
                            message: result.message,
                            restored: result.restored === true
                        });
                    } catch (reportError) {
                        console.warn('[Live2DSetup] 上报切换结果失败:', reportError);
                    }
                };

                if (!nextPath) {
                    result = { success: false, message: '缺少 Live2D 模型路径' };
                    await reportResult();
                    return;
                }
                if (global.avatarFacade && global.avatarFacade.getActiveType() !== 'live2d') {
                    console.log('[Live2DSetup] 当前非 Live2D 形态，忽略模型切换事件');
                    result = { success: false, message: '当前不是 Live2D 形态' };
                    await reportResult();
                    return;
                }
                if (_loader.currentModelPath === nextPath) {
                    console.log(`[Live2DSetup] 已是当前模型，跳过切换: ${modelName}`);
                    result = { success: true, message: `已经是当前模型: ${modelName}` };
                    await reportResult();
                    return;
                }
                const previousModel = _loader.currentModel;
                try {
                    logToTerminal('info', `[Live2DSetup] 热切换模型: ${modelName} (${nextPath})`);
                    const nextPrefs = getModelPrefs('live2d', modelName);
                    await _loader.loadModel(nextPath, {
                        config: _context.config,
                        preferences: nextPrefs,
                        fallbackPath: null
                    });
                    _stage.notifyActivity();
                    result = { success: true, message: `模型已切换到 ${modelName}` };
                } catch (e) {
                    console.error('[Live2DSetup] 热切换失败:', e);
                    logToTerminal('error', `[Live2DSetup] 热切换失败: ${e.message}`);
                    let restored = Boolean(previousModel && _loader.currentModel === previousModel);
                    let restoreError = null;
                    if (restored && global.currentModel !== previousModel) {
                        try {
                            await wireModel(previousModel);
                        } catch (error) {
                            restored = false;
                            restoreError = error;
                        }
                    }
                    const suffix = restoreError ? `；恢复失败: ${restoreError.message}` : '';
                    result = {
                        success: false,
                        restored,
                        message: `模型切换失败: ${e.message}${restored ? '，已保留原模型' : ''}${suffix}`
                    };
                }
                await reportResult();
            });
        }

        return { app: _stage.app, model, emotionMapper, expressionMapper, musicPlayer: _musicPlayer, stage: _stage, loader: _loader };
    }

    // 形态切走：挂起而非销毁（保留 WebGL 上下文）
    static async suspend() {
        try { _runtime?.detach?.(); } catch (_) {}
        try { await _loader?.removeModel?.(); } catch (_) {}
        try { _engine?.destroy?.(); } catch (_) {}
        _engine = null;
        try { _stage?.suspend?.(); } catch (_) {}
        logToTerminal('info', '[Live2DSetup] 已挂起（保留渲染上下文）');
    }
}

module.exports = { Live2DSetup };
