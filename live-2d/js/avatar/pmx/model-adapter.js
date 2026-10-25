// PMX reuses VRM viewport, hit testing, orbit and Live2D-compatible mouth API.
const THREE = require('three');
const { VRMModelAdapter } = require('../vrm/model-adapter');

const BONES = {
    hips: ['下半身', 'センター', 'hips'], spine: ['上半身', 'spine'],
    upperChest: ['上半身2', 'chest'], head: ['頭', '头', 'head'],
    leftUpperArm: ['左腕', 'leftUpperArm'], rightUpperArm: ['右腕', 'rightUpperArm'],
    leftLowerArm: ['左ひじ', 'leftLowerArm'], rightLowerArm: ['右ひじ', 'rightLowerArm'],
    leftHand: ['左手首', 'leftHand'], rightHand: ['右手首', 'rightHand'],
    leftFoot: ['左足首', 'leftFoot'], rightFoot: ['右足首', 'rightFoot']
};
const MORPHS = {
    aa: ['あ', 'ああ', 'A', 'a', '口開け', 'mouthOpen'],
    oh: ['お', 'O', 'o'], ou: ['う', 'U', 'u'],
    blink: ['まばたき', '瞬き', '両目閉じ', 'blink'],
    happy: ['笑い', 'にこり', '笑顔', 'happy'],
    angry: ['怒り', '怒る', 'angry'], sad: ['悲しい', '困る', 'sad'],
    surprised: ['びっくり', '驚き', 'surprised'], relaxed: ['にこり', '笑い', 'relaxed']
};

function createPMXBridge(mesh) {
    const bones = {};
    for (const [name, aliases] of Object.entries(BONES)) {
        bones[name] = mesh.skeleton.bones.find(b => aliases.includes(b.name));
    }
    const indices = {};
    const dictionary = mesh.morphTargetDictionary || {};
    for (const [preset, aliases] of Object.entries(MORPHS)) {
        const alias = aliases.find(name => dictionary[name] !== undefined);
        if (alias !== undefined) indices[preset] = dictionary[alias];
    }
    const values = new Map();
    const expressionManager = {
        setValue(name, value) {
            const index = indices[name] ?? dictionary[name];
            if (index === undefined) return;
            values.set(name, { index, value: THREE.MathUtils.clamp(Number(value) || 0, 0, 1) });
            // Several presets may address the same PMX morph (happy/relaxed).
            mesh.morphTargetInfluences[index] = Math.max(0, ...[...values.values()]
                .filter(entry => entry.index === index).map(entry => entry.value));
        }
    };
    return {
        scene: mesh, expressionManager,
        humanoid: { getNormalizedBoneNode: name => bones[name], getRawBoneNode: name => bones[name] },
        update() {}, mouthAvailable: indices.aa !== undefined
    };
}

class PMXModelAdapter extends VRMModelAdapter {
    constructor(mesh, scene, camera, renderer, canvas, options = {}) {
        const bridge = createPMXBridge(mesh);
        super(bridge, scene, camera, renderer, canvas, options);
        this.modelType = 'mmd';
        this.mesh = mesh;
        this.mouthAvailable = bridge.mouthAvailable;
        this._relaxArms();
        this._baseRotations = new Map(mesh.skeleton.bones.map(b => [b, b.rotation.clone()]));
    }

    _relaxArms() {
        // PMX bind poses may use different bone axes and A/T poses. Aim each
        // segment using its actual joint positions rather than fixed Euler angles.
        const humanoid = this.vrm.humanoid;
        const meshRotation = this.mesh.getWorldQuaternion(new THREE.Quaternion());
        const aim = (bone, end, direction) => {
            if (!bone || !end || !bone.parent) return;
            this.mesh.updateWorldMatrix(true, true);
            const start = bone.getWorldPosition(new THREE.Vector3());
            const current = end.getWorldPosition(new THREE.Vector3()).sub(start);
            if (current.lengthSq() < 1e-10) return;
            const target = direction.normalize().applyQuaternion(meshRotation);
            const adjustment = new THREE.Quaternion().setFromUnitVectors(current.normalize(), target);
            const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(adjustment);
            const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
            bone.quaternion.copy(parent.invert().multiply(world));
            this.mesh.updateWorldMatrix(true, true);
        };
        for (const [side, sign] of [['left', 1], ['right', -1]]) {
            const upper = humanoid.getNormalizedBoneNode(`${side}UpperArm`);
            const lower = humanoid.getNormalizedBoneNode(`${side}LowerArm`);
            const hand = humanoid.getNormalizedBoneNode(`${side}Hand`);
            // Leave room between sleeves and skirt, with a slight elbow bend.
            aim(upper, lower, new THREE.Vector3(sign * 0.48, -1, 0.025));
            aim(lower, hand, new THREE.Vector3(sign * 0.42, -1, 0.20));
        }
    }

    _updateIdleAnimation(delta) {
        this._swayPhase += delta * 0.9;
        this._breathPhase += delta * 2.1;
        const spine = this.vrm.humanoid.getNormalizedBoneNode('spine');
        if (spine) {
            spine.rotation.copy(this._baseRotations.get(spine));
            spine.rotation.x += Math.sin(this._breathPhase) * 0.008;
            spine.rotation.z += Math.sin(this._swayPhase) * 0.006;
        }
        const head = this.vrm.humanoid.getNormalizedBoneNode('head');
        if (head) head.rotation.copy(this._baseRotations.get(head));
        for (const [side, offset] of [['left', 0], ['right', 1.7]]) {
            for (const [segment, amplitude] of [['UpperArm', 0.012], ['LowerArm', 0.008], ['Hand', 0.01]]) {
                const bone = this.vrm.humanoid.getNormalizedBoneNode(`${side}${segment}`);
                if (!bone) continue;
                bone.rotation.copy(this._baseRotations.get(bone));
                bone.rotation.x += Math.sin(this._breathPhase * 0.55 + offset) * amplitude;
                bone.rotation.z += Math.sin(this._swayPhase + offset) * amplitude * 0.5;
            }
        }
    }

    _updateGazeTracking(delta) {
        super._updateGazeTracking(delta);
        const head = this.vrm.humanoid.getNormalizedBoneNode('head');
        if (head) {
            const base = this._baseRotations.get(head);
            head.rotation.x += base.x;
            head.rotation.y += base.y;
        }
    }
}

module.exports = { PMXModelAdapter, createPMXBridge };
