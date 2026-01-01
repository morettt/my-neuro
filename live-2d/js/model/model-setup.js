// model-setup.js - 模型和PIXI设置模块
const { EmotionMotionMapper } = require('../ui/emotion-motion-mapper.js');
const { MusicPlayer } = require('../services/music-player.js');

class ModelSetup {
    // 初始化PIXI应用和Live2D模型
    static async initialize(modelController, config, ttsEnabled, asrEnabled, ttsProcessor, voiceChat) {
        // 创建PIXI应用
        const app = new PIXI.Application({
            view: document.getElementById("canvas"),
            autoStart: true,
            transparent: true,
            width: window.innerWidth * 2,
            height: window.innerHeight * 2
        });

        app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
        app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);

        // 加载Live2D模型
        const model = await PIXI.live2d.Live2DModel.from("2D/肥牛/hiyori_pro_mic.model3.json");
        app.stage.addChild(model);

        // 初始化模型交互控制器
        modelController.init(model, app, config);
        modelController.setupInitialModelProperties(config.ui.model_scale || 2.3);

        // 创建情绪动作映射器
        const emotionMapper = new EmotionMotionMapper(model);
        global.currentCharacterName = '肥牛';
        global.emotionMapper = emotionMapper;

        // 将情绪映射器传递给TTS处理器
        if (ttsEnabled && ttsProcessor.setEmotionMapper) {
            ttsProcessor.setEmotionMapper(emotionMapper);
        } else if (!ttsEnabled) {
            // TTS禁用时，设置回调以确保ASR正常工作
            ttsProcessor.onEndCallback = () => {
                // 状态管理已通过事件系统自动处理
                if (voiceChat && asrEnabled) {
                    voiceChat.resumeRecording();
                    console.log('TTS模拟结束，ASR已解锁');
                }
            };
            ttsProcessor.setEmotionMapper(emotionMapper);
        }

        // 创建音乐播放器
        const musicPlayer = new MusicPlayer(modelController);
        musicPlayer.setEmotionMapper(emotionMapper);
        global.musicPlayer = musicPlayer;

        // 设置模型和情绪映射器
        voiceChat.setModel(model);
        voiceChat.setEmotionMapper = emotionMapper;

        // 设置模型碰撞检测
        ModelSetup.setupHitTest(model, modelController);

        return { app, model, emotionMapper, musicPlayer };
    }

    // 设置模型碰撞检测
    static setupHitTest(model, modelController) {
        // 从modelController获取交互区域（如果有的话）
        // 注意：这里假设modelController有interactionX等属性
        // 如果没有，可能需要从其他地方获取或使用默认值
        const getInteractionBounds = () => {
            if (modelController.interactionX !== undefined) {
                return {
                    x: modelController.interactionX,
                    y: modelController.interactionY,
                    width: modelController.interactionWidth,
                    height: modelController.interactionHeight
                };
            }
            // 默认值（如果modelController没有定义这些属性）
            return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
        };

        model.hitTest = function(x, y) {
            const bounds = getInteractionBounds();
            return x >= bounds.x &&
                x <= bounds.x + bounds.width &&
                y >= bounds.y &&
                y <= bounds.y + bounds.height;
        };
    }
}

module.exports = { ModelSetup };
