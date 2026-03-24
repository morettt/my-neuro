// vmc-sender.js — VMC (Virtual Motion Capture) 协议发送器
// 通过OSC/UDP将VRM模型的骨骼、表情、位置数据广播出去
// 可被VSeeFace、VMagicMirror等外部软件接收

const dgram = require('dgram');

// ===== 最小OSC编码器（无外部依赖） =====

function oscString(str) {
    const buf = Buffer.from(str + '\0', 'ascii');
    const padded = Buffer.alloc(Math.ceil(buf.length / 4) * 4);
    buf.copy(padded);
    return padded;
}

function oscInt(val) {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(val, 0);
    return buf;
}

function oscFloat(val) {
    const buf = Buffer.alloc(4);
    buf.writeFloatBE(val, 0);
    return buf;
}

function oscMessage(address, args) {
    const parts = [oscString(address)];
    // 类型标签字符串
    let typeTag = ',';
    for (const arg of args) {
        if (arg.type === 'integer') typeTag += 'i';
        else if (arg.type === 'float') typeTag += 'f';
        else if (arg.type === 'string') typeTag += 's';
    }
    parts.push(oscString(typeTag));
    // 参数值
    for (const arg of args) {
        if (arg.type === 'integer') parts.push(oscInt(arg.value));
        else if (arg.type === 'float') parts.push(oscFloat(arg.value));
        else if (arg.type === 'string') parts.push(oscString(arg.value));
    }
    return Buffer.concat(parts);
}

function oscBundle(elements) {
    const parts = [
        oscString('#bundle'),
        Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]) // timetag: 立即执行
    ];
    for (const elem of elements) {
        const msg = oscMessage(elem.address, elem.args);
        const sizeBuf = Buffer.alloc(4);
        sizeBuf.writeInt32BE(msg.length, 0);
        parts.push(sizeBuf, msg);
    }
    return Buffer.concat(parts);
}

// VRM humanoid骨骼名 → Unity骨骼名映射（VMC协议使用Unity命名）
const VRM_TO_UNITY_BONE = {
    'hips': 'Hips',
    'spine': 'Spine',
    'chest': 'Chest',
    'upperChest': 'UpperChest',
    'neck': 'Neck',
    'head': 'Head',
    'leftShoulder': 'LeftShoulder',
    'leftUpperArm': 'LeftUpperArm',
    'leftLowerArm': 'LeftLowerArm',
    'leftHand': 'LeftHand',
    'rightShoulder': 'RightShoulder',
    'rightUpperArm': 'RightUpperArm',
    'rightLowerArm': 'RightLowerArm',
    'rightHand': 'RightHand',
    'leftUpperLeg': 'LeftUpperLeg',
    'leftLowerLeg': 'LeftLowerLeg',
    'leftFoot': 'LeftFoot',
    'leftToes': 'LeftToes',
    'rightUpperLeg': 'RightUpperLeg',
    'rightLowerLeg': 'RightLowerLeg',
    'rightFoot': 'RightFoot',
    'rightToes': 'RightToes',
    'leftEye': 'LeftEye',
    'rightEye': 'RightEye',
    'jaw': 'Jaw',
    // 手指
    'leftThumbMetacarpal': 'LeftThumbProximal',
    'leftThumbProximal': 'LeftThumbIntermediate',
    'leftThumbDistal': 'LeftThumbDistal',
    'leftIndexProximal': 'LeftIndexProximal',
    'leftIndexIntermediate': 'LeftIndexIntermediate',
    'leftIndexDistal': 'LeftIndexDistal',
    'leftMiddleProximal': 'LeftMiddleProximal',
    'leftMiddleIntermediate': 'LeftMiddleIntermediate',
    'leftMiddleDistal': 'LeftMiddleDistal',
    'leftRingProximal': 'LeftRingProximal',
    'leftRingIntermediate': 'LeftRingIntermediate',
    'leftRingDistal': 'LeftRingDistal',
    'leftLittleProximal': 'LeftLittleProximal',
    'leftLittleIntermediate': 'LeftLittleIntermediate',
    'leftLittleDistal': 'LeftLittleDistal',
    'rightThumbMetacarpal': 'RightThumbProximal',
    'rightThumbProximal': 'RightThumbIntermediate',
    'rightThumbDistal': 'RightThumbDistal',
    'rightIndexProximal': 'RightIndexProximal',
    'rightIndexIntermediate': 'RightIndexIntermediate',
    'rightIndexDistal': 'RightIndexDistal',
    'rightMiddleProximal': 'RightMiddleProximal',
    'rightMiddleIntermediate': 'RightMiddleIntermediate',
    'rightMiddleDistal': 'RightMiddleDistal',
    'rightRingProximal': 'RightRingProximal',
    'rightRingIntermediate': 'RightRingIntermediate',
    'rightRingDistal': 'RightRingDistal',
    'rightLittleProximal': 'RightLittleProximal',
    'rightLittleIntermediate': 'RightLittleIntermediate',
    'rightLittleDistal': 'RightLittleDistal'
};

// 表情名 → VMC BlendShape名映射
// three-vrm v3 对所有VRM版本统一使用这些表情名，VMC协议沿用VRM 0.x的BlendShape命名
const VRM_TO_VMC_EXPRESSION = {
    'happy': 'Joy',
    'angry': 'Angry',
    'sad': 'Sorrow',
    'relaxed': 'Fun',
    'surprised': 'Surprised',
    'neutral': 'Neutral',
    'aa': 'A',
    'ih': 'I',
    'ou': 'U',
    'ee': 'E',
    'oh': 'O',
    'blink': 'Blink',
    'blinkLeft': 'Blink_L',
    'blinkRight': 'Blink_R',
    'lookUp': 'LookUp',
    'lookDown': 'LookDown',
    'lookLeft': 'LookLeft',
    'lookRight': 'LookRight'
};

class VMCSender {
    constructor(options = {}) {
        this.host = options.host || '127.0.0.1';
        this.port = options.port || 39539;
        this.enabled = options.enabled !== false;
        this.socket = null;
        this._vrm = null;
        this._frameCount = 0;
    }

    // 启动VMC发送
    start() {
        if (this.socket) return;
        this.socket = dgram.createSocket('udp4');
        this.socket.on('error', (err) => {
            console.warn('VMC发送器UDP错误:', err.message);
        });
        console.log(`VMC发送器已启动 → ${this.host}:${this.port}`);
    }

    // 停止VMC发送
    stop() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        console.log('VMC发送器已停止');
    }

    // 设置VRM实例引用
    setVRM(vrm) {
        this._vrm = vrm;
    }

    // 更新目标地址
    setTarget(host, port) {
        this.host = host;
        this.port = port;
    }

    // 每帧调用：发送完整的VMC数据
    sendFrame() {
        if (!this.enabled || !this.socket || !this._vrm) return;

        this._frameCount++;
        const messages = [];

        // 1. 发送状态标志
        messages.push(this._createOKMessage());

        // 2. 发送根位置
        messages.push(this._createRootPosMessage());

        // 3. 发送所有骨骼
        const boneMessages = this._createBoneMessages();
        messages.push(...boneMessages);

        // 4. 发送表情/BlendShape
        const blendMessages = this._createBlendShapeMessages();
        messages.push(...blendMessages);

        // 5. 发送BlendShape应用信号
        messages.push(this._createBlendShapeApplyMessage());

        // 打包成OSC bundle发送
        this._sendBundle(messages);
    }

    // /VMC/Ext/OK — 状态心跳
    _createOKMessage() {
        return {
            address: '/VMC/Ext/OK',
            args: [
                { type: 'integer', value: 1 },      // loaded
                { type: 'integer', value: 3 },       // calibration state (3=calibrated)
                { type: 'integer', value: 0 }        // tracking status
            ]
        };
    }

    // /VMC/Ext/Root/Pos — 根位置和旋转
    // 使用归一化hips骨骼世界坐标，发送恒等旋转（模型始终面向前方）
    _createRootPosMessage() {
        const humanoid = this._vrm.humanoid;
        if (humanoid) {
            const hips = humanoid.getNormalizedBoneNode('hips');
            if (hips) {
                hips.getWorldPosition(_tempVec3);
                return {
                    address: '/VMC/Ext/Root/Pos',
                    args: [
                        { type: 'string', value: 'root' },
                        // 位置: glTF右手(x,y,z) → Unity左手(x,y,-z)
                        { type: 'float', value: _tempVec3.x },
                        { type: 'float', value: _tempVec3.y },
                        { type: 'float', value: -_tempVec3.z },
                        // 恒等旋转：模型静止时面向默认方向
                        { type: 'float', value: 0 },
                        { type: 'float', value: 0 },
                        { type: 'float', value: 0 },
                        { type: 'float', value: 1 }
                    ]
                };
            }
        }

        return {
            address: '/VMC/Ext/Root/Pos',
            args: [
                { type: 'string', value: 'root' },
                { type: 'float', value: 0 },
                { type: 'float', value: 0 },
                { type: 'float', value: 0 },
                { type: 'float', value: 0 },
                { type: 'float', value: 0 },
                { type: 'float', value: 0 },
                { type: 'float', value: 1 }
            ]
        };
    }

    // /VMC/Ext/Bone/Pos — 每根骨骼的旋转
    // 使用归一化骨骼（getNormalizedBoneNode），发送“相对于T-Pose的旋转差”
    _createBoneMessages() {
        const messages = [];
        const humanoid = this._vrm.humanoid;
        if (!humanoid) return messages;

        for (const [vrmName, unityName] of Object.entries(VRM_TO_UNITY_BONE)) {
            const bone = humanoid.getNormalizedBoneNode(vrmName);
            if (!bone) continue;

            const q = _tempQuat.setFromEuler(bone.rotation);

            messages.push({
                address: '/VMC/Ext/Bone/Pos',
                args: [
                    { type: 'string', value: unityName },
                    // 骨骼局部位置（通常为0, VMC主要关心旋转）
                    { type: 'float', value: 0 },
                    { type: 'float', value: 0 },
                    { type: 'float', value: 0 },
                    // 四元数: glTF右手 → Unity左手 (Z轴镜像: 取反X和Y，保留Z和W)
                    { type: 'float', value: -q.x },
                    { type: 'float', value: -q.y },
                    { type: 'float', value: q.z },
                    { type: 'float', value: q.w }
                ]
            });
        }

        return messages;
    }

    // /VMC/Ext/Blend/Val — 表情/BlendShape值
    _createBlendShapeMessages() {
        const messages = [];
        const exprManager = this._vrm.expressionManager;
        if (!exprManager) return messages;

        for (const [vrmName, vmcName] of Object.entries(VRM_TO_VMC_EXPRESSION)) {
            let value = 0;
            try {
                const expr = exprManager.getExpression(vrmName);
                if (expr) value = expr.weight;
            } catch (e) { continue; }

            messages.push({
                address: '/VMC/Ext/Blend/Val',
                args: [
                    { type: 'string', value: vmcName },
                    { type: 'float', value: value }
                ]
            });
        }

        // 也发送自定义表情（模型特有的非预设表情）
        const expressionMap = exprManager.expressionMap;
        if (expressionMap) {
            for (const [name, expr] of Object.entries(expressionMap)) {
                if (VRM_TO_VMC_EXPRESSION[name]) continue; // 已发送的预设表情跳过
                messages.push({
                    address: '/VMC/Ext/Blend/Val',
                    args: [
                        { type: 'string', value: name },
                        { type: 'float', value: expr.weight || 0 }
                    ]
                });
            }
        }

        return messages;
    }

    // /VMC/Ext/Blend/Apply — 通知接收方应用BlendShape
    _createBlendShapeApplyMessage() {
        return {
            address: '/VMC/Ext/Blend/Apply',
            args: []
        };
    }

    // 将多条OSC消息打包为bundle发送
    _sendBundle(messages) {
        if (!this.socket || messages.length === 0) return;

        try {
            const bundle = oscBundle(messages);
            this.socket.send(bundle, 0, bundle.length, this.port, this.host);
        } catch (e) {
            // 发送失败时静默处理（目标可能不在线）
        }
    }
}

// 复用的临时对象（避免每帧分配）
const THREE = require('three');
const _tempQuat = new THREE.Quaternion();
const _tempVec3 = new THREE.Vector3();

module.exports = { VMCSender, VRM_TO_UNITY_BONE, VRM_TO_VMC_EXPRESSION };
