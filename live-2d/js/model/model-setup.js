// model-setup.js - 模型和PIXI设置模块
const { EmotionMotionMapper } = require('../ui/emotion-motion-mapper.js');
const { EmotionExpressionMapper } = require('../ui/emotion-expression-mapper.js'); // 使用新的  
const { MusicPlayer } = require('../services/music-player.js');

class ModelSetup {
    // 初始化PIXI应用和Live2D模型
    static async initialize(modelController, config, ttsEnabled, asrEnabled, ttsProcessor, voiceChat) {
        const { ipcRenderer } = require('electron');
        
        // 获取所有显示器信息
        const displays = await ipcRenderer.invoke('get-all-displays');
        const windowBounds = await ipcRenderer.invoke('get-window-bounds');
        
        console.log(`=== PIXI 渲染器初始化 ===`);
        console.log(`检测到 ${displays.length} 个显示器`);
        displays.forEach((display, index) => {
            console.log(`显示器 ${index}: ${display.bounds.width}x${display.bounds.height} at (${display.bounds.x}, ${display.bounds.y})`);
        });
        console.log(`窗口尺寸: ${windowBounds.width}x${windowBounds.height}`);
        console.log(`window.innerWidth/Height: ${window.innerWidth}x${window.innerHeight}`);
        
        // 使用窗口的实际尺寸
        const actualWidth = windowBounds.width;
        const actualHeight = windowBounds.height;
        
        // 创建PIXI应用 - 使用窗口实际尺寸的2倍以支持高分辨率
        const app = new PIXI.Application({
            view: document.getElementById("canvas"),
            autoStart: true,
            transparent: true,
            width: actualWidth * 2,
            height: actualHeight * 2
        });

        // 设置Canvas的CSS尺寸以正确显示
        app.view.style.width = `${actualWidth}px`;
        app.view.style.height = `${actualHeight}px`;

        // 多屏幕坐标系统：舞台从左上角开始，不使用pivot和position偏移
        // 模型坐标需要乘以2来匹配Canvas的2倍分辨率
        
        // 保存实际尺寸和缩放因子到全局
        window.actualWindowWidth = actualWidth;
        window.actualWindowHeight = actualHeight;
        window.canvasScaleFactor = 2; // Canvas相对于窗口的缩放因子
        
        console.log(`Canvas内部尺寸: ${app.view.width}x${app.view.height}`);
        console.log(`Canvas CSS尺寸: ${app.view.style.width} x ${app.view.style.height}`);
        console.log(`窗口尺寸: ${actualWidth}x${actualHeight}`);
        console.log(`缩放因子: ${window.canvasScaleFactor}`);
        console.log(`坐标系统: Canvas坐标 = 窗口坐标 × 2`);
        console.log(`=========================`);

        // 加载Live2D模型
        const model = await PIXI.live2d.Live2DModel.from("2D/肥牛/",
        );
        app.stage.addChild(model);

        // 根据配置控制模型显示/隐藏
        const showModel = config.ui?.show_model !== false; // 默认显示
        model.visible = showModel;
        console.log(`模型显示状态: ${showModel ? '显示' : '隐藏'}`);

        // 初始化模型交互控制器
        modelController.init(model, app, config);
        modelController.setupInitialModelProperties(config.ui.model_scale || 2.3);

        // 调试输出：检查模型位置和尺寸
        console.log(`=== 模型调试信息 ===`);
        console.log(`模型位置: (${model.x}, ${model.y})`);
        console.log(`模型尺寸: ${model.width}x${model.height}`);
        console.log(`模型缩放: ${model.scale.x}`);
        console.log(`模型可见: ${model.visible}`);
        console.log(`Canvas尺寸: ${app.view.width}x${app.view.height}`);
        console.log(`窗口尺寸: ${actualWidth}x${actualHeight}`);
        console.log(`==================`);

        // 创建情绪动作映射器
        const emotionMapper = new EmotionMotionMapper(model);
        global.currentCharacterName = await emotionMapper.getCurrentCharacterName();
        global.emotionMapper = emotionMapper;

        // 创建新的表情映射器
        const expressionMapper = new EmotionExpressionMapper(model);
        global.currentCharacterName = await expressionMapper.getCurrentCharacterName();
        global.expressionMapper = expressionMapper;


        // 将情绪映射器传递给TTS处理器
        if (ttsEnabled && ttsProcessor.setEmotionMapper) {
            ttsProcessor.setEmotionMapper(emotionMapper);
        } 
        // else if (!ttsEnabled) {
        //     // TTS禁用时，设置回调以确保ASR正常工作
        //     ttsProcessor.onEndCallback = () => {
        //         // 状态管理已通过事件系统自动处理
        //         if (voiceChat && asrEnabled) {
        //             voiceChat.resumeRecording();
        //             console.log('TTS模拟结束，ASR已解锁');
        //         }
        //     };
        //     ttsProcessor.setEmotionMapper(emotionMapper);
        // }

        // 将表情映射器传递给TTS处理器
        if (ttsEnabled && ttsProcessor.setExpressionMapper) {
            ttsProcessor.setExpressionMapper(expressionMapper);
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

        return { app, model, emotionMapper, expressionMapper, musicPlayer };
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
