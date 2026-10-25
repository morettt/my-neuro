// drivers.js - 当前 PR 中可用的 Avatar driver 注册。
const { avatarFacade } = require('./avatar-facade.js');
const { logToTerminal } = require('../api-utils.js');

// ============ Live2D driver（v2 渲染栈） ============
function createLive2DDriver() {
    let state = null; // { app, model, emotionMapper, expressionMapper, musicPlayer, stage, loader, controller }

    return {
        engine: 'pixi',
        async init(context) {
            const { Live2DSetup } = require('./live2d/setup.js');
            const result = await Live2DSetup.initialize(
                context.modelController,
                context.config,
                context.ttsEnabled,
                context.asrEnabled,
                context.ttsProcessor,
                context.voiceChat
            );
            state = { ...result, controller: context.modelController };
            global.pixiApp = result.app;
            global.modelController = context.modelController;
            global.live2dStage = result.stage;
            global.live2dLoader = result.loader;
            return result;
        },

        async dispose() {
            if (!state) return;
            const { Live2DSetup } = require('./live2d/setup.js');
            try { state.controller?.destroy?.(); } catch (_) {}
            await Live2DSetup.suspend();
            global.pixiApp = null;
            global.currentModel = null;
            state = null;
            logToTerminal('info', '[Live2DDriver] 已挂起（上下文保留）');
        },

        getModel() { return state?.loader?.currentModel || null; },
        getController() { return state?.controller || null; },

        setEmotion(emotion) {
            global.emotionMapper?.playConfiguredEmotion?.(emotion);
            global.expressionMapper?.triggerExpressionByEmotion?.(emotion);
        },
        setMouth(value) {
            state?.controller?.setMouthOpenY?.(value);
        },
        playMotion(indexOrGroup, index) {
            if (typeof indexOrGroup === 'number') {
                global.emotionMapper?.playMotion?.(indexOrGroup);
            } else if (state?.loader?.currentModel) {
                try { state.loader.currentModel.motion(indexOrGroup, index); } catch (_) {}
            }
        }
    };
}

// ============ 3D driver（VRM/PMX 共用交互与语音链路） ============
function createVRMDriver(type = 'vrm') {
    let state = null; // { app, model, emotionMapper, expressionMapper, musicPlayer, vrmController, manager }

    return {
        engine: type === 'mmd' ? 'three-mmd' : 'three',
        async init(context) {
            const Setup = type === 'mmd'
                ? require('./pmx/setup.js').PMXSetup : require('./vrm/setup.js').VRMSetup;
            logToTerminal('info', `[AvatarDriver] 正在加载 ${type === 'mmd' ? 'PMX' : 'VRM'} 3D 模型...`);
            const result = await Setup.initialize(
                context.modelController,
                context.config,
                context.ttsEnabled,
                context.asrEnabled,
                context.ttsProcessor,
                context.voiceChat
            );
            state = result;
            global.pixiApp = result.app;      // appProxy（周边弱引用兼容）
            global.modelController = result.vrmController;
            global.currentModel = result.model;
            return result;
        },

        async dispose() {
            if (!state) return;
            const Setup = type === 'mmd'
                ? require('./pmx/setup.js').PMXSetup : require('./vrm/setup.js').VRMSetup;
            await Setup.suspend();
            global.pixiApp = null;
            global.currentModel = null;
            global.currentVRMAdapter = null;
            state = null;
            logToTerminal('info', `[AvatarDriver] ${type} 已挂起（上下文保留）`);
        },

        getModel() { return state?.model || null; },
        getController() { return state?.vrmController || null; },

        setEmotion(emotion) {
            global.emotionMapper?.playConfiguredEmotion?.(emotion);
        },
        setMouth(value) {
            state?.vrmController?.setMouthOpenY?.(value);
        },
        playMotion(group) {
            try { state?.model?.motion?.(typeof group === 'string' ? group : 'Tap'); } catch (_) {}
        }
    };
}

function registerBuiltinDrivers() {
    avatarFacade.register('live2d', createLive2DDriver());
    avatarFacade.register('vrm', createVRMDriver());
    avatarFacade.register('mmd', createVRMDriver('mmd'));
}

module.exports = { registerBuiltinDrivers };
