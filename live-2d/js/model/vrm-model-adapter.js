// vrm-model-adapter.js - VRM模型适配器
// 将VRM模型包装为与Live2D模型兼容的接口，复用现有交互控制器和情绪映射器

const EventEmitter = require('events');
const THREE = require('three');
const { VMCSender } = require('../services/vmc-sender.js');

class VRMModelAdapter extends EventEmitter {
    constructor(vrm, scene, camera, renderer, canvas) {
        super();
        this.vrm = vrm;
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.canvas = canvas;
        this.modelType = 'vrm';
        this.vrmGroup = null; // 由vrm-model-setup设置，包裹vrm.scene的Group（用于朝向修正）

        // 兼容Live2D的基本属性
        this._x = 0;
        this._y = 0;
        this._width = 300;
        this._height = 600;
        this._visible = true;
        this._interactive = true;

        // 渲染开关
        this._renderingEnabled = true;

        // VRM视口区域（CSS像素，屏幕坐标：y轴朝下）
        // 由model-interaction.js的setupInitialModelProperties设置实际值
        this._viewRect = { x: 0, y: 0, width: 400, height: 600 };

        // 模拟internalModel结构（用于兼容嘴型设置等）
        this.internalModel = {
            coreModel: {
                setParameterValueById: (paramId, value) => {
                    this._setVRMParameter(paramId, value);
                },
                SetParameterValue: (paramId, value) => {
                    this._setVRMParameter(paramId, value);
                }
            },
            settings: {
                url: this._getModelUrl()
            }
        };

        // VRM表情映射（Live2D情绪 → VRM表情）
        this._expressionMap = {
            '开心': 'happy',
            '生气': 'angry',
            '难过': 'sad',
            '惊讶': 'surprised',
            '害羞': 'relaxed',
            '俏皮': 'happy'
        };

        // 当前播放状态
        this._currentExpression = null;
        this._animationMixer = null;

        // 眨眼动画状态
        this._blinkTimer = 0;
        this._nextBlinkTime = 2 + Math.random() * 4;
        this._isBlinking = false;
        this._blinkProgress = 0;

        // VMC协议发送器
        this._vmcSender = null;

        // Camera orbit parameters
        this._orbitTheta = 0;       // horizontal angle (0 = front/+Z)
        this._orbitPhi = 0;         // vertical angle (0 = level)
        this._orbitDistance = 3.0;   // distance from orbit target
        this._orbitTarget = new THREE.Vector3(); // reusable vector
        this._orbitYOffset = 0.1;   // Y offset to align with Live2D position

        // 模型屏幕空间碰撞盒（由 _updateScreenHitBox 每帧更新）
        this._screenHitBox = null;
        this._vec3Proj = new THREE.Vector3();

        // 鼠标穿透模式
        this._clickThrough = false;
        this._hoverTransparent = false; // 当前是否处于悬停半透明状态

        // Idle动画状态
        this._idleTime = 0;
        this._breathPhase = Math.random() * Math.PI * 2;
        this._swayPhase = Math.random() * Math.PI * 2;
        this._idlePoseApplied = false;

        // 视线追踪鼠标
        this._gazeEnabled = false;
        this._gazeMouseX = 0;     // 鼠标屏幕坐标（像素）
        this._gazeMouseY = 0;
        this._gazeHeadYaw = 0;    // 当前平滑后的头部偏航
        this._gazeHeadPitch = 0;  // 当前平滑后的头部俯仰
        this._gazeEyeYaw = 0;     // 当前平滑后的眼睛偏航
        this._gazeEyePitch = 0;   // 当前平滑后的眼睛俯仰

        // 事件监听器映射（PIXI风格 → Node EventEmitter）
        this._pixiEventMap = new Map();

        // 初始化动画混合器
        this._initAnimationMixer();
    }

    get x() { return this._x; }
    set x(val) { this._x = val; }

    get y() { return this._y; }
    set y(val) { this._y = val; }

    get width() { return this._width; }
    set width(val) { this._width = val; }

    get height() { return this._height; }
    set height(val) { this._height = val; }

    get visible() { return this._visible; }
    set visible(val) {
        this._visible = val;
        if (this.vrmGroup) {
            this.vrmGroup.visible = val;
        } else if (this.vrm && this.vrm.scene) {
            this.vrm.scene.visible = val;
        }
    }

    get interactive() { return this._interactive; }
    set interactive(val) { this._interactive = val; }

    get viewRect() { return this._viewRect; }
    set viewRect(rect) {
        this._viewRect = rect;
        this._width = rect.width;
        this._height = rect.height;
        this._x = rect.x;
        this._y = rect.y;
    }

    // 获取模型URL（用于兼容角色名提取）
    _getModelUrl() {
        return this._modelPath || '3D/unknown.vrm';
    }

    setModelPath(path) {
        this._modelPath = path;
        this.internalModel.settings.url = path;
    }

    // 初始化动画混合器
    _initAnimationMixer() {
        if (this.vrm && this.vrm.scene) {
            this._animationMixer = new THREE.AnimationMixer(this.vrm.scene);
        }
    }

    // 每帧更新眨眼动画
    _updateBlinkAnimation(deltaTime) {
        if (!this.vrm || !this.vrm.expressionManager) return;

        this._blinkTimer += deltaTime;

        if (!this._isBlinking && this._blinkTimer >= this._nextBlinkTime) {
            this._isBlinking = true;
            this._blinkProgress = 0;
        }

        if (this._isBlinking) {
            this._blinkProgress += deltaTime;
            const blinkDuration = 0.15;
            const halfBlink = blinkDuration / 2;

            let blinkValue;
            if (this._blinkProgress < halfBlink) {
                blinkValue = this._blinkProgress / halfBlink;
            } else if (this._blinkProgress < blinkDuration) {
                blinkValue = 1 - (this._blinkProgress - halfBlink) / halfBlink;
            } else {
                blinkValue = 0;
                this._isBlinking = false;
                this._blinkTimer = 0;
                this._nextBlinkTime = 2 + Math.random() * 4;
            }

            try {
                this.vrm.expressionManager.setValue('blink', blinkValue);
            } catch (e) {}
        }
    }

    // 设置VRM参数（兼容Live2D的嘴型参数）
    _setVRMParameter(paramId, value) {
        if (!this.vrm || !this.vrm.expressionManager) return;

        // 将Live2D嘴型参数映射到VRM
        const mouthParams = ['PARAM_MOUTH_OPEN_Y', 'ParamMouthOpenY'];
        if (mouthParams.includes(paramId)) {
            // 放大幅度并使用多元音混合
            const v = Math.max(0, Math.min(value * 1.3, 1.0));
            try {
                // aa = 大张嘴（主权重），oh/ou = 中幅度圆口
                this.vrm.expressionManager.setValue('aa', v);
                this.vrm.expressionManager.setValue('oh', v * 0.3);
                this.vrm.expressionManager.setValue('ou', v * 0.15);
            } catch (e) {
                // 静默处理
            }
        }
    }

    // 兼容Live2D的motion方法
    motion(group, index) {
        // VRM没有与Live2D完全相同的Motion系统
        // 简单实现：触发一个随机表情动画
        if (!this.vrm || !this.vrm.expressionManager) return;

        if (group === 'Tap' || group === 'TapBody') {
            // 点击时随机播放一个表情
            const expressions = ['happy', 'surprised', 'relaxed'];
            const randomExpr = expressions[Math.floor(Math.random() * expressions.length)];
            this._playExpression(randomExpr, 2000);
        }
    }

    // 兼容Live2D的expression方法
    expression(name) {
        if (!this.vrm || !this.vrm.expressionManager) return;

        if (name) {
            // 如果传入了具体的表情名，尝试映射
            const vrmExpr = this._expressionMap[name] || name;
            this._playExpression(vrmExpr, 3000);
        } else {
            // 随机表情
            const expressions = ['happy', 'angry', 'sad', 'surprised', 'relaxed'];
            const randomExpr = expressions[Math.floor(Math.random() * expressions.length)];
            this._playExpression(randomExpr, 2000);
        }
    }

    // 播放VRM表情
    _playExpression(expressionName, duration = 3000) {
        if (!this.vrm || !this.vrm.expressionManager) return;

        // 重置之前的表情
        if (this._currentExpression) {
            try {
                this.vrm.expressionManager.setValue(this._currentExpression, 0);
            } catch (e) {}
        }

        // 设置新表情
        try {
            this.vrm.expressionManager.setValue(expressionName, 1.0);
            this._currentExpression = expressionName;

            // 自动恢复
            setTimeout(() => {
                if (this._currentExpression === expressionName) {
                    try {
                        this.vrm.expressionManager.setValue(expressionName, 0);
                    } catch (e) {}
                    this._currentExpression = null;
                }
            }, duration);
        } catch (e) {
            console.warn(`VRM表情 "${expressionName}" 不可用`);
        }
    }

    // 用情绪名称播放VRM表情（供情绪映射器使用）
    playEmotionExpression(emotionName) {
        const vrmExpr = this._expressionMap[emotionName] || emotionName;
        this._playExpression(vrmExpr, 3000);
    }

    // 碰撞检测：检查点是否在VRM模型碰撞范围内（client坐标）
    containsPoint(point) {
        if (!this._interactive || !this._visible) return false;
        return this.isPointOverModel(point.x, point.y);
    }

    // 检查屏幕坐标是否在模型碰撞范围内
    isPointOverModel(clientX, clientY) {
        const hb = this.getScreenHitBox();
        return clientX >= hb.x && clientX <= hb.x + hb.width &&
               clientY >= hb.y && clientY <= hb.y + hb.height;
    }

    // 获取模型屏幕空间碰撞盒（降级到 viewRect）
    getScreenHitBox() {
        return this._screenHitBox || this._viewRect;
    }

    // 兼容PIXI的hitTest方法
    hitTest(x, y) {
        return this.containsPoint({ x, y });
    }

    // 更新VRM（每帧调用）
    update(deltaTime) {
        if (!this.vrm) return;

        // 更新Idle动画（呼吸+身体晃动）
        this._updateIdleAnimation(deltaTime);

        // 更新视线追踪
        if (this._gazeEnabled) {
            this._updateGazeTracking(deltaTime);
        }

        // 更新眨眼动画
        this._updateBlinkAnimation(deltaTime);

        // 更新VRM（包括humanoid骨骼同步）
        this.vrm.update(deltaTime);

        // 更新动画混合器
        if (this._animationMixer) {
            this._animationMixer.update(deltaTime);
        }

        // 发送VMC协议数据
        if (this._vmcSender) {
            this._vmcSender.sendFrame();
        }
    }

    // Idle动画：呼吸 + 身体微晃（每帧更新）
    _updateIdleAnimation(deltaTime) {
        if (!this.vrm || !this.vrm.humanoid) return;

        // 首次调用时应用静态Idle姿态（手臂放下）
        if (!this._idlePoseApplied) {
            this._applyIdlePose();
            this._idlePoseApplied = true;
        }

        this._idleTime += deltaTime;
        const humanoid = this.vrm.humanoid;

        // === 呼吸：spine轻微前后旋转（~3秒周期） ===
        this._breathPhase += deltaTime * 2.1;
        const breathVal = Math.sin(this._breathPhase) * 0.012;

        const spine = humanoid.getNormalizedBoneNode('spine');
        if (spine) {
            spine.rotation.x = breathVal;
        }

        const upperChest = humanoid.getNormalizedBoneNode('upperChest');
        if (upperChest) {
            upperChest.rotation.x = breathVal * 0.8;
        }

        // === 身体微晃（~5-7秒周期） ===
        this._swayPhase += deltaTime * 0.9;
        const swayX = Math.sin(this._swayPhase * 0.7) * 0.006;
        const swayZ = Math.sin(this._swayPhase * 1.1 + 1.3) * 0.008;

        if (spine) {
            spine.rotation.x += swayX;
            spine.rotation.z = swayZ;
        }

        // === 手臂微摆（在Idle基础姿态上叠加） ===
        const armSway = Math.sin(this._swayPhase * 0.8 + 0.5) * 0.03;
        const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
        if (leftUpperArm) {
            leftUpperArm.rotation.x = 0.15 + armSway;
        }
        if (rightUpperArm) {
            rightUpperArm.rotation.x = 0.15 - armSway;
        }

        // === 头部微动（视线追踪关闭时才使用idle微动） ===
        const head = humanoid.getNormalizedBoneNode('head');
        if (head && !this._gazeEnabled) {
            head.rotation.y = Math.sin(this._swayPhase * 0.5 + 2.0) * 0.015;
            head.rotation.x = Math.sin(this._swayPhase * 0.6 + 0.7) * 0.008;
        }
    }

    // 一次性应用Idle姿态（手臂从 T-Pose 放下，VRM 0.x标准）
    _applyIdlePose() {
        const humanoid = this.vrm.humanoid;

        const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');

        // 上臂向下旋转~70°，略微前倾
        if (leftUpperArm) leftUpperArm.rotation.set(0.15, 0, 1.2);
        if (rightUpperArm) rightUpperArm.rotation.set(0.15, 0, -1.2);
        // 前臂微弯
        if (leftLowerArm) leftLowerArm.rotation.set(0, 0, 0.08);
        if (rightLowerArm) rightLowerArm.rotation.set(0, 0, -0.08);

        console.log('VRM Idle姿态已应用');
    }

    // 设置鼠标位置（屏幕像素坐标）
    setMousePosition(px, py) {
        this._gazeMouseX = px;
        this._gazeMouseY = py;
    }

    // 投影头部骨骼到屏幕坐标
    _getHeadScreenPos() {
        const head = this.vrm.humanoid?.getNormalizedBoneNode('head');
        if (!head || !this.camera) return null;
        const v = this._vec3Proj;
        head.getWorldPosition(v);
        v.project(this.camera);
        const vr = this._viewRect;
        return {
            x: vr.x + (v.x * 0.5 + 0.5) * vr.width,
            y: vr.y + (-v.y * 0.5 + 0.5) * vr.height
        };
    }

    // 视线追踪：头部+眼睛跟随鼠标（以头部屏幕投影为中心）
    _updateGazeTracking(deltaTime) {
        if (!this.vrm?.humanoid) return;

        // 头部在屏幕上的位置
        const headPos = this._getHeadScreenPos();
        if (!headPos) return;

        // 鼠标相对于头部的像素偏移
        const pixelDx = this._gazeMouseX - headPos.x;
        const pixelDy = this._gazeMouseY - headPos.y;

        // 以视口宽度的一半为参考尺度，归一化偏移 [-1, 1]
        const refSize = this._viewRect.width * 0.5;
        const dx = Math.max(-1, Math.min(1, pixelDx / refSize));
        const dy = Math.max(-1, Math.min(1, pixelDy / refSize));

        // 头部目标角度（较小幅度，自然感）
        const headYawTarget = dx * 0.3;         // 左右最大±17°
        const headPitchTarget = -dy * 0.2;      // 上下最大±12°

        // 眼睛目标角度（更大幅度，快速跟随）
        const eyeYawTarget = dx * 0.7;          // 左右最大±40°
        const eyePitchTarget = -dy * 0.5;       // 上下最大±29°

        // 平滑插值（头部慢，眼睛快）
        const headSmooth = 1 - Math.exp(-4.0 * deltaTime);
        const eyeSmooth = 1 - Math.exp(-10.0 * deltaTime);

        this._gazeHeadYaw += (headYawTarget - this._gazeHeadYaw) * headSmooth;
        this._gazeHeadPitch += (headPitchTarget - this._gazeHeadPitch) * headSmooth;
        this._gazeEyeYaw += (eyeYawTarget - this._gazeEyeYaw) * eyeSmooth;
        this._gazeEyePitch += (eyePitchTarget - this._gazeEyePitch) * eyeSmooth;

        // 应用头部旋转（叠加在idle微动上）
        const humanoid = this.vrm.humanoid;
        const head = humanoid.getNormalizedBoneNode('head');
        if (head) {
            const idleYaw = Math.sin(this._swayPhase * 0.5 + 2.0) * 0.015;
            const idlePitch = Math.sin(this._swayPhase * 0.6 + 0.7) * 0.008;
            head.rotation.y = idleYaw + this._gazeHeadYaw;
            head.rotation.x = idlePitch + this._gazeHeadPitch;
        }

        // 应用眼睛注视（VRM表情 lookLeft/lookRight/lookUp/lookDown）
        const em = this.vrm.expressionManager;
        if (em) {
            const lookLeft = Math.max(0, this._gazeEyeYaw);
            const lookRight = Math.max(0, -this._gazeEyeYaw);
            const lookUp = Math.max(0, this._gazeEyePitch);
            const lookDown = Math.max(0, -this._gazeEyePitch);

            try {
                em.setValue('lookLeft', lookLeft);
                em.setValue('lookRight', lookRight);
                em.setValue('lookUp', lookUp);
                em.setValue('lookDown', lookDown);
            } catch (e) {}
        }
    }

    // 初始化VMC协议发送
    setupVMC(options = {}) {
        this._vmcSender = new VMCSender(options);
        this._vmcSender.setVRM(this.vrm);
        if (options.enabled !== false) {
            this._vmcSender.start();
        }
        return this._vmcSender;
    }

    // 获取VMC发送器实例
    getVMCSender() {
        return this._vmcSender;
    }

    // 获取/设置VRM渲染状态
    setRenderingEnabled(enabled) {
        this._renderingEnabled = enabled;
        // 使用vrmGroup控制可见性（它包裹了vrm.scene）
        if (this.vrmGroup) {
            this.vrmGroup.visible = enabled;
        } else if (this.vrm && this.vrm.scene) {
            this.vrm.scene.visible = enabled;
        }
    }
    isRenderingEnabled() {
        return this._renderingEnabled;
    }

    // 将模型中心投影到屏幕坐标（兼容Live2D的toGlobal）
    toGlobal(localPos) {
        const vr = this._viewRect;
        return {
            x: vr.x + vr.width / 2 + (localPos.x || 0),
            y: vr.y + vr.height / 2 + (localPos.y || 0)
        };
    }

    // 获取可用表情列表
    getAvailableExpressions() {
        if (!this.vrm || !this.vrm.expressionManager) return [];

        const expressions = [];
        // VRM 1.0 expressions
        const presetNames = ['happy', 'angry', 'sad', 'relaxed', 'surprised',
                             'aa', 'ih', 'ou', 'ee', 'oh',
                             'blink', 'blinkLeft', 'blinkRight',
                             'lookUp', 'lookDown', 'lookLeft', 'lookRight',
                             'neutral'];

        for (const name of presetNames) {
            try {
                const expr = this.vrm.expressionManager.getExpression(name);
                if (expr) expressions.push(name);
            } catch (e) {}
        }

        return expressions;
    }

    // 更新摄像头轨道位置（每帧调用，跟随Hips骨骼）
    updateCameraOrbit() {
        if (!this.camera || !this.vrm) return;

        const target = this._orbitTarget;
        const hips = this.vrm.humanoid?.getNormalizedBoneNode('hips');
        if (hips) {
            hips.getWorldPosition(target);
        } else {
            target.set(0, 1, 0);
        }
        target.y += this._orbitYOffset;

        const d = this._orbitDistance;
        const theta = this._orbitTheta;
        const phi = this._orbitPhi;

        this.camera.position.set(
            target.x - d * Math.sin(theta) * Math.cos(phi),
            target.y + d * Math.sin(phi),
            target.z - d * Math.cos(theta) * Math.cos(phi)
        );
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld();
        this._updateScreenHitBox();
    }

    // 更新模型的屏幕空间碰撞盒（基于骨骼投影）
    _updateScreenHitBox() {
        if (!this.vrm?.humanoid || !this.camera) return;

        const vr = this._viewRect;
        const humanoid = this.vrm.humanoid;
        const v = this._vec3Proj;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        const boneNames = ['head', 'hips', 'leftUpperArm', 'rightUpperArm',
                           'leftFoot', 'rightFoot', 'leftHand', 'rightHand'];

        let count = 0;
        for (const name of boneNames) {
            const bone = humanoid.getRawBoneNode(name);
            if (!bone) continue;
            bone.getWorldPosition(v);
            v.project(this.camera);
            const sx = vr.x + (v.x * 0.5 + 0.5) * vr.width;
            const sy = vr.y + (-v.y * 0.5 + 0.5) * vr.height;
            minX = Math.min(minX, sx);
            maxX = Math.max(maxX, sx);
            minY = Math.min(minY, sy);
            maxY = Math.max(maxY, sy);
            count++;
        }

        if (count < 2) return;

        // 在骨骼范围基础上添加padding（覆盖头顶/头发、脚底、身体宽度）
        const h = maxY - minY;
        const w = maxX - minX;
        const padX = Math.max(w * 0.3, 30);
        const padTop = Math.max(h * 0.15, 25);
        const padBot = Math.max(h * 0.05, 15);

        this._screenHitBox = {
            x: minX - padX,
            y: minY - padTop,
            width: (maxX - minX) + padX * 2,
            height: (maxY - minY) + padTop + padBot
        };
    }

    // 重置摄像头轨道参数
    resetOrbit() {
        this._orbitTheta = 0;
        this._orbitPhi = 0;
        this._orbitDistance = 3.0;
    }

    // 设置/获取鼠标穿透状态
    get clickThrough() { return this._clickThrough; }
    set clickThrough(val) {
        this._clickThrough = val;
        // 关闭穿透时，确保恢复canvas不透明
        if (!val && this._hoverTransparent) {
            this._hoverTransparent = false;
            if (this.canvas) this.canvas.style.opacity = '1.0';
        }
    }

    // 穿透模式下：悬停模型时窗口半透明，离开时恢复
    setHoverTransparent(isOver) {
        if (!this._clickThrough) return;
        if (isOver === this._hoverTransparent) return;
        this._hoverTransparent = isOver;
        // 仅对canvas设置透明度，不影响UI元素（文本框、控制按钮）
        if (this.canvas) this.canvas.style.opacity = isOver ? '0.35' : '1.0';
    }
}

module.exports = { VRMModelAdapter };
