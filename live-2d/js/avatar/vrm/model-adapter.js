// model-adapter.js - VRM 模型适配器（v2）
// 由 js/model/vrm-model-adapter.js 迁移，将 VRM 包装为与 Live2D 模型兼容的接口。
// v2 变更：
//   - 支持 VRM 0.x 与 1.0（朝向统一由 core.js 的 rotateVRM0 处理）
//   - 新增 dispose()（VMC 停止 / mixer 清理），配合形态热切换
//   - 表情映射表可由外部注入（默认六情绪 -> VRM preset）
const EventEmitter = require('events');
const THREE = require('three');
const { VMCSender } = require('../../services/vmc-sender.js');

const DEFAULT_EXPRESSION_MAP = {
    '开心': 'happy',
    '生气': 'angry',
    '难过': 'sad',
    '惊讶': 'surprised',
    '害羞': 'relaxed',
    '俏皮': 'happy'
};

class VRMModelAdapter extends EventEmitter {
    constructor(vrm, scene, camera, renderer, canvas, options = {}) {
        super();
        this.vrm = vrm;
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.canvas = canvas;
        this.modelType = 'vrm';
        this.vrmGroup = null;

        this._x = 0;
        this._y = 0;
        this._width = 300;
        this._height = 600;
        this._visible = true;
        this._interactive = true;
        this._renderingEnabled = true;
        this._viewRect = { x: 0, y: 0, width: 400, height: 600 };

        // 模拟 internalModel 结构（兼容口型链路与角色名提取）
        this.internalModel = {
            coreModel: {
                setParameterValueById: (paramId, value) => this._setVRMParameter(paramId, value),
                SetParameterValue: (paramId, value) => this._setVRMParameter(paramId, value)
            },
            settings: { url: '3D/unknown.vrm' }
        };

        this._expressionMap = { ...DEFAULT_EXPRESSION_MAP, ...(options.expressionMap || {}) };
        this._currentExpression = null;
        this._animationMixer = null;

        // 眨眼
        this._blinkTimer = 0;
        this._nextBlinkTime = 2 + Math.random() * 4;
        this._isBlinking = false;
        this._blinkProgress = 0;

        this._vmcSender = null;

        // 摄像头轨道
        this._orbitTheta = 0;
        this._orbitPhi = 0;
        this._orbitDistance = 3.0;
        this._orbitTarget = new THREE.Vector3();
        this._orbitYOffset = 0.1;

        this._screenHitBox = null;
        this._vec3Proj = new THREE.Vector3();

        this._clickThrough = false;
        this._hoverTransparent = false;

        // Idle 动画
        this._idleTime = 0;
        this._breathPhase = Math.random() * Math.PI * 2;
        this._swayPhase = Math.random() * Math.PI * 2;
        this._idlePoseApplied = false;

        // 视线跟随
        this._gazeEnabled = options.gazeEnabled !== false;
        this._gazeMouseX = 0;
        this._gazeMouseY = 0;
        this._gazeHeadYaw = 0;
        this._gazeHeadPitch = 0;
        this._gazeEyeYaw = 0;
        this._gazeEyePitch = 0;

        this._disposed = false;
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

    setModelPath(path) {
        this._modelPath = path;
        this.internalModel.settings.url = path;
    }

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
            const half = blinkDuration / 2;
            let v;
            if (this._blinkProgress < half) {
                v = this._blinkProgress / half;
            } else if (this._blinkProgress < blinkDuration) {
                v = 1 - (this._blinkProgress - half) / half;
            } else {
                v = 0;
                this._isBlinking = false;
                this._blinkTimer = 0;
                this._nextBlinkTime = 2 + Math.random() * 4;
            }
            try { this.vrm.expressionManager.setValue('blink', v); } catch (_) {}
        }
    }

    // Live2D 口型参数 -> VRM 元音 blendshape
    _setVRMParameter(paramId, value) {
        if (!this.vrm || !this.vrm.expressionManager) return;
        const mouthParams = ['PARAM_MOUTH_OPEN_Y', 'ParamMouthOpenY'];
        if (mouthParams.includes(paramId)) {
            const v = Math.max(0, Math.min(value * 1.3, 1.0));
            try {
                this.vrm.expressionManager.setValue('aa', v);
                this.vrm.expressionManager.setValue('oh', v * 0.3);
                this.vrm.expressionManager.setValue('ou', v * 0.15);
            } catch (_) {}
        }
    }

    // 兼容 Live2D motion：点击时随机表情
    motion(group) {
        if (!this.vrm || !this.vrm.expressionManager) return;
        if (group === 'Tap' || group === 'TapBody') {
            const expressions = ['happy', 'surprised', 'relaxed'];
            this._playExpression(expressions[Math.floor(Math.random() * expressions.length)], 2000);
        }
    }

    // 兼容 Live2D expression
    expression(name) {
        if (!this.vrm || !this.vrm.expressionManager) return;
        if (name) {
            this._playExpression(this._expressionMap[name] || name, 3000);
        } else {
            const expressions = ['happy', 'angry', 'sad', 'surprised', 'relaxed'];
            this._playExpression(expressions[Math.floor(Math.random() * expressions.length)], 2000);
        }
    }

    _playExpression(expressionName, duration = 3000) {
        if (!this.vrm || !this.vrm.expressionManager) return;
        if (this._currentExpression) {
            try { this.vrm.expressionManager.setValue(this._currentExpression, 0); } catch (_) {}
        }
        try {
            this.vrm.expressionManager.setValue(expressionName, 1.0);
            this._currentExpression = expressionName;
            setTimeout(() => {
                if (this._disposed) return;
                if (this._currentExpression === expressionName) {
                    try { this.vrm.expressionManager.setValue(expressionName, 0); } catch (_) {}
                    this._currentExpression = null;
                }
            }, duration);
        } catch (_) {
            console.warn(`VRM表情 "${expressionName}" 不可用`);
        }
    }

    playEmotionExpression(emotionName) {
        this._playExpression(this._expressionMap[emotionName] || emotionName, 3000);
    }

    containsPoint(point) {
        if (!this._interactive || !this._visible) return false;
        return this.isPointOverModel(point.x, point.y);
    }

    isPointOverModel(clientX, clientY) {
        const hb = this.getScreenHitBox();
        return clientX >= hb.x && clientX <= hb.x + hb.width &&
               clientY >= hb.y && clientY <= hb.y + hb.height;
    }

    getScreenHitBox() {
        return this._screenHitBox || this._viewRect;
    }

    hitTest(x, y) {
        return this.containsPoint({ x, y });
    }

    // 每帧更新
    update(deltaTime) {
        if (!this.vrm || this._disposed) return;
        this._updateIdleAnimation(deltaTime);
        if (this._gazeEnabled) this._updateGazeTracking(deltaTime);
        this._updateBlinkAnimation(deltaTime);
        this.vrm.update(deltaTime);
        if (this._animationMixer) this._animationMixer.update(deltaTime);
        if (this._vmcSender) this._vmcSender.sendFrame();
    }

    _updateIdleAnimation(deltaTime) {
        if (!this.vrm || !this.vrm.humanoid) return;
        if (!this._idlePoseApplied) {
            this._applyIdlePose();
            this._idlePoseApplied = true;
        }

        this._idleTime += deltaTime;
        const humanoid = this.vrm.humanoid;

        this._breathPhase += deltaTime * 2.1;
        const breathVal = Math.sin(this._breathPhase) * 0.012;

        const spine = humanoid.getNormalizedBoneNode('spine');
        if (spine) spine.rotation.x = breathVal;
        const upperChest = humanoid.getNormalizedBoneNode('upperChest');
        if (upperChest) upperChest.rotation.x = breathVal * 0.8;

        this._swayPhase += deltaTime * 0.9;
        const swayX = Math.sin(this._swayPhase * 0.7) * 0.006;
        const swayZ = Math.sin(this._swayPhase * 1.1 + 1.3) * 0.008;
        if (spine) {
            spine.rotation.x += swayX;
            spine.rotation.z = swayZ;
        }

        const armSway = Math.sin(this._swayPhase * 0.8 + 0.5) * 0.03;
        const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
        if (leftUpperArm) leftUpperArm.rotation.x = 0.15 + armSway;
        if (rightUpperArm) rightUpperArm.rotation.x = 0.15 - armSway;

        const head = humanoid.getNormalizedBoneNode('head');
        if (head && !this._gazeEnabled) {
            head.rotation.y = Math.sin(this._swayPhase * 0.5 + 2.0) * 0.015;
            head.rotation.x = Math.sin(this._swayPhase * 0.6 + 0.7) * 0.008;
        }
    }

    _applyIdlePose() {
        const humanoid = this.vrm.humanoid;
        const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');
        if (leftUpperArm) leftUpperArm.rotation.set(0.15, 0, 1.2);
        if (rightUpperArm) rightUpperArm.rotation.set(0.15, 0, -1.2);
        if (leftLowerArm) leftLowerArm.rotation.set(0, 0, 0.08);
        if (rightLowerArm) rightLowerArm.rotation.set(0, 0, -0.08);
    }

    setMousePosition(px, py) {
        this._gazeMouseX = px;
        this._gazeMouseY = py;
    }

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

    _updateGazeTracking(deltaTime) {
        if (!this.vrm?.humanoid) return;
        const headPos = this._getHeadScreenPos();
        if (!headPos) return;

        const pixelDx = this._gazeMouseX - headPos.x;
        const pixelDy = this._gazeMouseY - headPos.y;
        const refSize = this._viewRect.width * 0.5;
        const dx = Math.max(-1, Math.min(1, pixelDx / refSize));
        const dy = Math.max(-1, Math.min(1, pixelDy / refSize));

        const headYawTarget = dx * 0.3;
        const headPitchTarget = -dy * 0.2;
        const eyeYawTarget = dx * 0.7;
        const eyePitchTarget = -dy * 0.5;

        const headSmooth = 1 - Math.exp(-4.0 * deltaTime);
        const eyeSmooth = 1 - Math.exp(-10.0 * deltaTime);
        this._gazeHeadYaw += (headYawTarget - this._gazeHeadYaw) * headSmooth;
        this._gazeHeadPitch += (headPitchTarget - this._gazeHeadPitch) * headSmooth;
        this._gazeEyeYaw += (eyeYawTarget - this._gazeEyeYaw) * eyeSmooth;
        this._gazeEyePitch += (eyePitchTarget - this._gazeEyePitch) * eyeSmooth;

        const humanoid = this.vrm.humanoid;
        const head = humanoid.getNormalizedBoneNode('head');
        if (head) {
            const idleYaw = Math.sin(this._swayPhase * 0.5 + 2.0) * 0.015;
            const idlePitch = Math.sin(this._swayPhase * 0.6 + 0.7) * 0.008;
            head.rotation.y = idleYaw + this._gazeHeadYaw;
            head.rotation.x = idlePitch + this._gazeHeadPitch;
        }

        const em = this.vrm.expressionManager;
        if (em) {
            try {
                em.setValue('lookLeft', Math.max(0, this._gazeEyeYaw));
                em.setValue('lookRight', Math.max(0, -this._gazeEyeYaw));
                em.setValue('lookUp', Math.max(0, this._gazeEyePitch));
                em.setValue('lookDown', Math.max(0, -this._gazeEyePitch));
            } catch (_) {}
        }
    }

    setupVMC(options = {}) {
        this._vmcSender = new VMCSender(options);
        this._vmcSender.setVRM(this.vrm);
        if (options.enabled !== false) {
            this._vmcSender.start();
        }
        return this._vmcSender;
    }

    getVMCSender() {
        return this._vmcSender;
    }

    setRenderingEnabled(enabled) {
        this._renderingEnabled = enabled;
        if (this.vrmGroup) {
            this.vrmGroup.visible = enabled;
        } else if (this.vrm && this.vrm.scene) {
            this.vrm.scene.visible = enabled;
        }
    }

    isRenderingEnabled() {
        return this._renderingEnabled;
    }

    toGlobal(localPos) {
        const vr = this._viewRect;
        return {
            x: vr.x + vr.width / 2 + (localPos.x || 0),
            y: vr.y + vr.height / 2 + (localPos.y || 0)
        };
    }

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

    resetOrbit() {
        this._orbitTheta = 0;
        this._orbitPhi = 0;
        this._orbitDistance = 3.0;
    }

    get clickThrough() { return this._clickThrough; }
    set clickThrough(val) {
        this._clickThrough = val;
        if (!val && this._hoverTransparent) {
            this._hoverTransparent = false;
            if (this.canvas) this.canvas.style.opacity = '1.0';
        }
    }

    setHoverTransparent(isOver) {
        if (!this._clickThrough) return;
        if (isOver === this._hoverTransparent) return;
        this._hoverTransparent = isOver;
        if (this.canvas) this.canvas.style.opacity = isOver ? '0.35' : '1.0';
    }

    // v2: 释放适配器持有的资源（配合形态热切换）
    dispose() {
        this._disposed = true;
        try {
            if (this._vmcSender) {
                this._vmcSender.stop();
                this._vmcSender = null;
            }
        } catch (_) {}
        try {
            if (this._animationMixer) {
                this._animationMixer.stopAllAction();
                this._animationMixer = null;
            }
        } catch (_) {}
        if (this.canvas) this.canvas.style.opacity = '1.0';
    }
}

module.exports = { VRMModelAdapter, DEFAULT_EXPRESSION_MAP };
