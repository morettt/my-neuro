// setup.js - VRM 形态装配（v2，替代旧 js/model/vrm-model-setup.js）
// 返回结构与旧 VRMModelSetup.initialize 一致：
//   { app, model, emotionMapper, expressionMapper, musicPlayer, vrmController, manager }
//
// 热切换策略：形态切走时 manager.suspend()（保留 Three renderer/WebGL 上下文），
// 切回时复用同一 manager 重新 loadModel。（热切换中销毁再新建上下文会冻结渲染进程。）
const fs = require('fs');
const path = require('path');
const { VRMManager } = require('./manager.js');
const { VRMInteractionController } = require('./interaction.js');
const { createVRMEmotionMapper, createVRMExpressionMapper, getCharacterName } = require('./emotion.js');
const { DEFAULT_EXPRESSION_MAP } = require('./model-adapter.js');
const { MusicPlayer } = require('../../services/music-player.js');
const { logToTerminal } = require('../../api-utils.js');
const { bindVoiceChatAvatar } = require('../avatar-voice-chat-binding.js');

const APP_ROOT = path.join(__dirname, '..', '..', '..');

// 模块级单例（跨形态切换存活，保留 WebGL 上下文）
let _manager = null;
let _controller = null;
let _musicPlayer = null;

// 中文情绪 -> VRM 表情映射：模型同目录 <名字>.emotion_mapping.json 可覆盖（可选）
function resolveExpressionMap(modelPath) {
    try {
        const abs = path.resolve(APP_ROOT, modelPath);
        const sidecar = abs.replace(/\.vrm$/i, '.emotion_mapping.json');
        if (fs.existsSync(sidecar)) {
            const data = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
            if (data && typeof data === 'object') {
                logToTerminal('info', `[VRMSetup] 使用表情映射 sidecar: ${sidecar}`);
                return { ...DEFAULT_EXPRESSION_MAP, ...data };
            }
        }
    } catch (_) {}
    return DEFAULT_EXPRESSION_MAP;
}

// 解析要加载的 VRM 路径：config.ui.vrm_model_path 有效 > 注册表第一个
function resolveVRMPath(config) {
    let modelPath = config?.ui?.vrm_model_path || '';
    if (modelPath && fs.existsSync(path.resolve(APP_ROOT, modelPath))) {
        return modelPath;
    }
    const { scanVRMModels } = require('../model-registry.js');
    const all = scanVRMModels();
    if (all.length > 0) {
        if (modelPath) console.warn(`[VRMSetup] 配置的 VRM 路径 "${modelPath}" 无效，回退到: ${all[0].modelPath}`);
        return all[0].modelPath;
    }
    throw new Error('3D 目录下没有找到任何 .vrm 模型');
}

class VRMSetup {
    static async initialize(modelController, config, ttsEnabled, asrEnabled, ttsProcessor, voiceChat) {
        // 1. Three.js 场景（首次创建 / 挂起后复用）
        if (!_manager) _manager = new VRMManager();
        if (!_manager.isAlive()) {
            _manager.initThreeJS('vrm-canvas');
        }

        // 2. 加载模型
        const modelPath = resolveVRMPath(config);
        const expressionMap = resolveExpressionMap(modelPath);
        const gazeEnabled = config?.ui?.live2d_gaze_tracking !== false;
        const model = await _manager.loadModel(modelPath, { expressionMap, gazeEnabled });

        const showModel = config?.ui?.show_model !== false;
        model.visible = showModel;

        // 3. 交互控制器（含 VMC/穿透/视线 控制面板）
        if (!_controller) _controller = new VRMInteractionController();
        _controller.init(model, _manager, config);
        _controller.setupInitialModelProperties();

        // 4. VMC 协议发送器（肥牛独有功能，保留）
        const vmcConfig = config?.vmc || {};
        model.setupVMC({
            enabled: vmcConfig.enabled !== false,
            host: vmcConfig.host || '127.0.0.1',
            port: vmcConfig.port || 39539
        });

        // 5. 情绪/表情映射器
        const emotionMapper = createVRMEmotionMapper(model, expressionMap);
        global.currentCharacterName = getCharacterName(modelPath);
        global.emotionMapper = emotionMapper;
        global.currentVRMAdapter = model;   // 供 HTTP API 访问 VMC

        const expressionMapper = createVRMExpressionMapper(model, expressionMap);
        global.expressionMapper = expressionMapper;

        if (ttsEnabled && ttsProcessor?.setEmotionMapper) {
            ttsProcessor.setEmotionMapper(emotionMapper);
        }
        if (ttsEnabled && ttsProcessor?.setExpressionMapper) {
            ttsProcessor.setExpressionMapper(expressionMapper);
        }

        // 6. 音乐播放器
        if (!_musicPlayer) {
            _musicPlayer = new MusicPlayer(_controller);
        }
        _musicPlayer.setEmotionMapper(emotionMapper);
        global.musicPlayer = _musicPlayer;

        // 7. 语音链路
        bindVoiceChatAvatar(voiceChat, model, emotionMapper);

        // 8. 渲染循环
        _manager.startLoop();
        logToTerminal('info', `[VRMSetup] VRM 形态就绪: ${modelPath}`);

        // app 代理（兼容周边对 global.pixiApp 的弱引用；仅提供必要字段）
        const appProxy = {
            renderer: { view: _manager.canvas },
            _isVRMProxy: true,
            _renderer: _manager.renderer,
            _scene: _manager.scene,
            _camera: _manager.camera
        };

        return { app: appProxy, model, emotionMapper, expressionMapper, musicPlayer: _musicPlayer, vrmController: _controller, manager: _manager };
    }

    // 形态切走：挂起而非销毁（保留 WebGL 上下文）
    static async suspend() {
        try { _controller?.destroy?.(); } catch (_) {}
        try { await _manager?.suspend?.(); } catch (_) {}
        logToTerminal('info', '[VRMSetup] 已挂起');
    }
}

module.exports = { VRMSetup };
