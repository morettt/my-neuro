// vrm-model-setup.js - VRM模型初始化模块（对应Live2D的model-setup.js）
const THREE = require('three');
const path = require('path');
const fs = require('fs');
// GLTFLoader.js 是纯ESM模块，Electron 28 (Node 18) 无法 require() ESM
// 因此使用 esbuild 预打包的 CJS 版本
const { GLTFLoader } = require('../lib/gltf-loader-bundle.cjs');
const { VRMLoaderPlugin, VRMUtils } = require('@pixiv/three-vrm');
const { VRMModelAdapter } = require('./vrm-model-adapter.js');
const { VRMInteractionController } = require('./vrm-model-interaction.js');
const { MusicPlayer } = require('../services/music-player.js');

class VRMModelSetup {
    // 初始化Three.js场景和VRM模型
    static async initialize(modelController, config, ttsEnabled, asrEnabled, ttsProcessor, voiceChat) {
        const canvas = document.getElementById('canvas');

        // 创建Three.js渲染器（使用已有的canvas）
        const renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            alpha: true,
            antialias: true,
            premultipliedAlpha: false
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 0); // 完全透明背景
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        // 创建场景
        const scene = new THREE.Scene();

        // 创建相机
        const camera = new THREE.PerspectiveCamera(
            40,
            window.innerWidth / window.innerHeight,
            0.1,
            100
        );
        camera.position.set(0, 1.0, 3.0);
        camera.lookAt(0, 1.0, 0);

        // 添加灯光
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1.0, 1.5, 1.0);
        scene.add(directionalLight);

        // 加载VRM模型
        const modelPath = config.ui?.vrm_model_path || '3D/Fioka1.vrm';
        console.log(`正在加载VRM模型: ${modelPath}`);

        let vrm;
        try {
            vrm = await VRMModelSetup._loadVRM(modelPath);
        } catch (e) {
            console.error('VRM模型加载失败:', e);
            throw e;
        }

        // 拒绝VRM 1.0模型（仅支持VRM 0.x）
        if (vrm.meta?.metaVersion === '1') {
            throw new Error('不支持VRM 1.0模型，请使用VRM 0.x格式的模型');
        }

        // 用 Group 包裹 vrm.scene（用于统一控制可见性）
        // 朝向由轨道摄像头控制，不在此处旋转
        const vrmGroup = new THREE.Group();
        vrmGroup.add(vrm.scene);
        scene.add(vrmGroup);

        // 创建VRM适配器（提供与Live2D模型兼容的接口）
        const model = new VRMModelAdapter(vrm, scene, camera, renderer, canvas);
        model.vrmGroup = vrmGroup;
        model.setModelPath(modelPath);

        // 根据配置控制模型显示/隐藏
        const showModel = config.ui?.show_model !== false;
        model.visible = showModel;
        console.log(`VRM模型显示状态: ${showModel ? '显示' : '隐藏'}`);

        // 构造兼容PIXI app的代理对象（供model-interaction使用）
        const appProxy = VRMModelSetup._createAppProxy(renderer, scene, camera, canvas, model);

        // 初始化VRM专用交互控制器（不使用Live2D的modelController）
        const vrmController = new VRMInteractionController();
        vrmController.init(model, appProxy, config);
        vrmController.setupInitialModelProperties();
        console.log(`VRM模型交互初始化完成`);

        // 初始化VMC协议发送器
        const vmcConfig = config.vmc || {};
        model.setupVMC({
            enabled: vmcConfig.enabled !== false,
            host: vmcConfig.host || '127.0.0.1',
            port: vmcConfig.port || 39539
        });

        // 创建简化的情绪映射器（VRM版本）
        const emotionMapper = VRMModelSetup._createEmotionMapper(model);
        global.currentCharacterName = VRMModelSetup._getCharacterName(modelPath);
        global.emotionMapper = emotionMapper;
        global.currentVRMAdapter = model;  // 供HTTP API访问VMC发送器

        // 创建简化的表情映射器（VRM版本）
        const expressionMapper = VRMModelSetup._createExpressionMapper(model);
        global.expressionMapper = expressionMapper;

        // 将映射器传递给TTS处理器
        if (ttsEnabled && ttsProcessor.setEmotionMapper) {
            ttsProcessor.setEmotionMapper(emotionMapper);
        }
        if (ttsEnabled && ttsProcessor.setExpressionMapper) {
            ttsProcessor.setExpressionMapper(expressionMapper);
        }

        // 创建音乐播放器
        const musicPlayer = new MusicPlayer(vrmController);
        musicPlayer.setEmotionMapper(emotionMapper);
        global.musicPlayer = musicPlayer;

        // 设置模型和情绪映射器
        voiceChat.setModel(model);
        voiceChat.setEmotionMapper = emotionMapper;

        // 启动渲染循环（使用视口/裁剪实现局部渲染）
        renderer.autoClear = false;
        const clock = new THREE.Clock();
        function animate() {
            requestAnimationFrame(animate);
            const delta = clock.getDelta();
            model.update(delta);

            // 清除整个画布为透明（防止拖拽后旧位置残影）
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
            renderer.clear(true, true, true);

            // 在视口区域内渲染模型
            const vr = model.viewRect;
            const vpY = window.innerHeight - vr.y - vr.height;
            renderer.setViewport(vr.x, vpY, vr.width, vr.height);
            renderer.setScissor(vr.x, vpY, vr.width, vr.height);
            renderer.setScissorTest(true);
            model.updateCameraOrbit();
            camera.aspect = vr.width / vr.height;
            camera.updateProjectionMatrix();
            renderer.render(scene, camera);
        }
        animate();

        // 注意：窗口大小变化由model-interaction.js中的_setupWindowResize处理

        return { app: appProxy, model, emotionMapper, expressionMapper, musicPlayer, vrmController };
    }

    // 加载VRM模型
    static async _loadVRM(modelPath) {
        // 将相对路径转为绝对路径（基于应用根目录）
        const basePath = path.dirname(__dirname); // js/ -> live-2d/
        const absPath = path.resolve(path.dirname(basePath), modelPath);
        console.log(`VRM文件绝对路径: ${absPath}`);

        if (!fs.existsSync(absPath)) {
            throw new Error(`VRM文件不存在: ${absPath}`);
        }

        // 用 Node.js fs 读取文件（绕过 fetch + file:// 协议问题）
        const fileBuffer = fs.readFileSync(absPath);
        const arrayBuffer = fileBuffer.buffer.slice(
            fileBuffer.byteOffset,
            fileBuffer.byteOffset + fileBuffer.byteLength
        );
        console.log(`VRM文件大小: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));

        // 使用 parse 直接解析 ArrayBuffer，而非走 HTTP fetch
        // 第二个参数是资源基础路径，用于加载VRM引用的外部资源
        const resourcePath = path.dirname(absPath) + path.sep;
        const gltf = await new Promise((resolve, reject) => {
            loader.parse(arrayBuffer, resourcePath, (gltf) => {
                resolve(gltf);
            }, (error) => {
                reject(error);
            });
        });

        const vrm = gltf.userData.vrm;
        if (!vrm) {
            throw new Error('GLTF文件中未找到VRM数据');
        }

        // 优化VRM模型
        console.time('VRM优化');
        VRMUtils.removeUnnecessaryJoints(vrm.scene);
        if (VRMUtils.combineSkeletons) {
            VRMUtils.combineSkeletons(vrm.scene);
        }
        console.timeEnd('VRM优化');

        // 禁用视锥体剔除，防止模型在边缘消失
        vrm.scene.traverse((object) => {
            object.frustumCulled = false;
        });

        console.log('VRM模型加载成功');
        console.log('可用表情:', vrm.expressionManager ?
            Object.keys(vrm.expressionManager._expressionMap || {}) : '无');

        return vrm;
    }

    // 创建PIXI app的代理对象（让model-interaction.js等模块能正常工作）
    static _createAppProxy(renderer, scene, camera, canvas, model) {
        return {
            stage: {
                addChild: () => {}, // VRM已在initialize时添加到场景
                position: {
                    set: () => {} // Three.js不需要这个
                },
                pivot: {
                    set: () => {} // Three.js不需要这个
                }
            },
            renderer: {
                view: canvas,
                resize: (w, h) => {
                    renderer.setSize(w / 2, h / 2); // 除以2是因为PIXI使用2倍尺寸
                },
                plugins: {
                    interaction: {
                        mouse: {
                            global: { x: 0, y: 0 }
                        }
                    }
                }
            },
            // 标记这是VRM代理
            _isVRMProxy: true,
            _renderer: renderer,
            _scene: scene,
            _camera: camera
        };
    }

    // 从模型路径提取角色名
    static _getCharacterName(modelPath) {
        // 从 "3D/Fioka1.vrm" 提取 "Fioka1"
        const match = modelPath.match(/3D\/([^\/]+?)\.vrm$/i);
        if (match) return match[1];
        // 默认名称
        return 'VRM角色';
    }

    // 解析情绪标签（VRM和Live2D共用的纯文本处理逻辑）
    static _parseEmotionTagsWithPosition(text) {
        const pattern = /<([^>]+)>/g;
        const emotions = [];
        let match;
        while ((match = pattern.exec(text)) !== null) {
            emotions.push({
                emotion: match[1],
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                fullTag: match[0]
            });
        }
        return emotions;
    }

    // 预处理文本（移除情绪标签，生成位置标记）
    static _prepareTextForTTS(text) {
        const emotionTags = VRMModelSetup._parseEmotionTagsWithPosition(text);
        if (emotionTags.length === 0) {
            return { text: text, emotionMarkers: [] };
        }

        let purifiedText = text;
        for (let i = emotionTags.length - 1; i >= 0; i--) {
            const tag = emotionTags[i];
            purifiedText = purifiedText.substring(0, tag.startIndex) +
                           purifiedText.substring(tag.endIndex);
        }

        const emotionMarkers = [];
        let offset = 0;
        for (const tag of emotionTags) {
            const adjustedPosition = tag.startIndex - offset;
            offset += tag.endIndex - tag.startIndex;
            emotionMarkers.push({
                position: adjustedPosition,
                emotion: tag.emotion
            });
        }

        return { text: purifiedText, emotionMarkers: emotionMarkers };
    }

    // 创建VRM兼容的情绪动作映射器
    static _createEmotionMapper(model) {
        const emotionToVRM = {
            '开心': 'happy',
            '生气': 'angry',
            '难过': 'sad',
            '惊讶': 'surprised',
            '害羞': 'relaxed',
            '俏皮': 'happy'
        };

        return {
            model: model,
            currentMotionGroup: 'TapBody',
            emotionConfig: emotionToVRM,
            isPlayingMotion: false,
            currentCharacter: VRMModelSetup._getCharacterName(model._modelPath || '3D/unknown.vrm'),

            async getCurrentCharacterName() {
                return VRMModelSetup._getCharacterName(model._modelPath || '3D/unknown.vrm');
            },

            // TTS引擎调用：预处理文本
            prepareTextForTTS(text) {
                return VRMModelSetup._prepareTextForTTS(text);
            },

            // TTS引擎调用：根据文本位置触发情绪
            triggerEmotionByTextPosition(position, textLength, emotionMarkers) {
                if (!emotionMarkers || emotionMarkers.length === 0) return;

                for (let i = emotionMarkers.length - 1; i >= 0; i--) {
                    const marker = emotionMarkers[i];
                    if (position >= marker.position && position <= marker.position + 2) {
                        this.playConfiguredEmotion(marker.emotion);
                        emotionMarkers.splice(i, 1);
                        break;
                    }
                }

                if (position >= textLength - 1 && emotionMarkers.length > 0) {
                    for (const marker of emotionMarkers) {
                        this.playConfiguredEmotion(marker.emotion);
                    }
                    emotionMarkers.length = 0;
                }
            },

            // TTS引擎调用：播放情绪动作
            playConfiguredEmotion(emotion) {
                const vrmExpr = emotionToVRM[emotion];
                if (vrmExpr) {
                    model.playEmotionExpression(emotion);
                    console.log(`VRM播放情绪: ${emotion} -> ${vrmExpr}`);
                } else {
                    console.warn(`VRM未配置情绪: ${emotion}`);
                }
            },

            parseEmotionTagsWithPosition(text) {
                return VRMModelSetup._parseEmotionTagsWithPosition(text);
            },

            playMotionByEmotion(emotion) {
                this.playConfiguredEmotion(emotion);
            },

            playMotion(group) {
                model.motion(group);
            },

            getEmotionList() {
                return Object.keys(emotionToVRM);
            },

            getEmotionConfig() {
                const config = {};
                for (const [emotion, vrmName] of Object.entries(emotionToVRM)) {
                    config[emotion] = [`vrm_expression:${vrmName}`];
                }
                return config;
            },

            async loadEmotionConfig() {
                console.log('VRM情绪映射器已就绪');
            },

            triggerMotionByEmotion(text) {
                const match = text.match(/<([^>]+)>/);
                if (match && match[1]) {
                    this.playConfiguredEmotion(match[1]);
                }
                return text.replace(/<[^>]+>/g, '').trim();
            },

            setEmotionCallback(callback) {
                this._emotionCallback = callback;
            }
        };
    }

    // 创建VRM兼容的表情映射器
    static _createExpressionMapper(model) {
        const emotionToExpression = {
            '开心': 'happy',
            '生气': 'angry',
            '难过': 'sad',
            '惊讶': 'surprised',
            '害羞': 'relaxed',
            '俏皮': 'happy'
        };

        return {
            model: model,
            defaultExpression: 'neutral',
            expressionConfig: emotionToExpression,
            currentCharacter: VRMModelSetup._getCharacterName(model._modelPath || '3D/unknown.vrm'),

            async getCurrentCharacterName() {
                return VRMModelSetup._getCharacterName(model._modelPath || '3D/unknown.vrm');
            },

            // TTS引擎调用：预处理文本
            prepareTextForTTS(text) {
                return VRMModelSetup._prepareTextForTTS(text);
            },

            // TTS引擎调用：根据情绪触发表情
            triggerExpressionByEmotion(emotion) {
                const vrmExpr = emotionToExpression[emotion];
                if (vrmExpr) {
                    model.playEmotionExpression(emotion);
                    console.log(`VRM触发表情: ${emotion} -> ${vrmExpr}`);
                    return vrmExpr;
                }
                return null;
            },

            // TTS引擎调用：根据文本位置触发表情
            triggerEmotionByTextPosition(position, textLength, expressionMarkers) {
                if (!expressionMarkers || expressionMarkers.length === 0) return;

                for (let i = expressionMarkers.length - 1; i >= 0; i--) {
                    const marker = expressionMarkers[i];
                    if (position >= marker.position && position <= marker.position + 2) {
                        this.triggerExpressionByEmotion(marker.emotion);
                        expressionMarkers.splice(i, 1);
                        break;
                    }
                }

                if (position >= textLength - 1 && expressionMarkers.length > 0) {
                    for (const marker of expressionMarkers) {
                        this.triggerExpressionByEmotion(marker.emotion);
                    }
                    expressionMarkers.length = 0;
                }
            },

            // TTS引擎调用：直接触发表情
            triggerExpression(expressionName) {
                if (!expressionName || expressionName === 'neutral' || expressionName === this.defaultExpression) {
                    // 播放默认表情（重置）
                    model._playExpression('neutral', 2000);
                    return true;
                }

                // 尝试从情绪名称映射
                const vrmExpr = emotionToExpression[expressionName];
                if (vrmExpr) {
                    model.playEmotionExpression(expressionName);
                    return true;
                }

                // 尝试直接作为VRM表情名使用
                model._playExpression(expressionName, 3000);
                return true;
            },

            parseEmotionTagsWithPosition(text) {
                return VRMModelSetup._parseEmotionTagsWithPosition(text);
            },

            playExpressionByEmotion(emotion) {
                return this.triggerExpressionByEmotion(emotion);
            },

            playDefaultExpression() {
                model._playExpression('neutral', 2000);
            },

            getExpressionList() {
                return model.getAvailableExpressions();
            },

            async loadExpressionConfig() {
                console.log('VRM表情映射器已就绪');
            }
        };
    }
}

module.exports = { VRMModelSetup };
