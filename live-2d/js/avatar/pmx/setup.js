const { PMXManager } = require('./manager');
const { VRMInteractionController } = require('../vrm/interaction');
const { createVRMEmotionMapper, createVRMExpressionMapper } = require('../vrm/emotion');
const { DEFAULT_EXPRESSION_MAP } = require('../vrm/model-adapter');
const { MusicPlayer } = require('../../services/music-player');
const { bindVoiceChatAvatar } = require('../avatar-voice-chat-binding');
const { scanMMDModels } = require('../model-registry');

let manager, controller, musicPlayer;

class PMXSetup {
    static async initialize(_modelController, config, ttsEnabled, _asrEnabled, ttsProcessor, voiceChat) {
        manager ||= new PMXManager();
        if (!manager.isAlive()) manager.initThreeJS('mmd-canvas');
        const models = scanMMDModels();
        const selected = models.find(m => m.modelPath === config.ui?.mmd_model_path)
            || models.find(m => m.name === config.ui?.mmd_model) || models[0];
        if (!selected) throw new Error('请将 PMX 模型放在 3D/PMX/模型名/模型文件.pmx');
        const model = await manager.loadModel(selected.modelPath, { gazeEnabled: config.ui?.live2d_gaze_tracking !== false });
        model.visible = config.ui?.show_model !== false;
        controller ||= new VRMInteractionController();
        controller.init(model, manager, config);
        controller.setupInitialModelProperties();
        const emotionMapper = createVRMEmotionMapper(model, DEFAULT_EXPRESSION_MAP);
        const expressionMapper = createVRMExpressionMapper(model, DEFAULT_EXPRESSION_MAP);
        global.currentCharacterName = selected.name;
        global.emotionMapper = emotionMapper;
        global.expressionMapper = expressionMapper;
        global.currentVRMAdapter = null;
        if (ttsEnabled) {
            ttsProcessor?.setEmotionMapper?.(emotionMapper);
            ttsProcessor?.setExpressionMapper?.(expressionMapper);
        }
        musicPlayer ||= new MusicPlayer(controller);
        musicPlayer.setEmotionMapper(emotionMapper);
        global.musicPlayer = musicPlayer;
        bindVoiceChatAvatar(voiceChat, model, emotionMapper);
        manager.startLoop();
        const app = { renderer: { view: manager.canvas }, _isVRMProxy: true,
            _renderer: manager.renderer, _scene: manager.scene, _camera: manager.camera };
        return { app, model, emotionMapper, expressionMapper, musicPlayer, vrmController: controller, manager };
    }

    static async suspend() {
        controller?.destroy();
        await manager?.suspend();
    }
}

module.exports = { PMXSetup };
