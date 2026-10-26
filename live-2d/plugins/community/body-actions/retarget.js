// Retarget local motion-service 22-joint positions to VRM normalized humanoid.
// Coordinates are rotated to the desktop viewport orientation.
const THREE = require('three');
const { attachBodyPlayer } = require('./runtime-hooks');
const { PMXMotionRetargeter } = require('./pmx-rig');
const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();
const world = node => node.getWorldPosition(V());
const LIMBS = [
    ['leftShoulder', 'leftUpperArm', 13, 16], ['rightShoulder', 'rightUpperArm', 14, 17],
    ['leftUpperArm', 'leftLowerArm', 16, 18], ['rightUpperArm', 'rightLowerArm', 17, 19],
    ['leftLowerArm', 'leftHand', 18, 20], ['rightLowerArm', 'rightHand', 19, 21],
    ['leftUpperLeg', 'leftLowerLeg', 1, 4], ['rightUpperLeg', 'rightLowerLeg', 2, 5],
    ['leftLowerLeg', 'leftFoot', 4, 7], ['rightLowerLeg', 'rightFoot', 5, 8],
    ['leftFoot', 'leftToes', 7, 10], ['rightFoot', 'rightToes', 8, 11]
];

function validateMotion(data) {
    const fps = Number(data?.fps), frames = data?.joints;
    if (!Number.isFinite(fps) || fps < 1 || fps > 60 || !Array.isArray(frames) || frames.length < 2 || frames.length > 600 || frames.length / fps > 15) {
        throw new Error('动作服务返回的帧数或帧率无效');
    }
    for (const frame of frames) {
        if (!Array.isArray(frame) || frame.length !== 22 || frame.some(point => !Array.isArray(point) || point.length !== 3 || point.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1000))) {
            throw new Error('动作服务必须返回有限数值的 22×3 关节坐标');
        }
    }
    return { fps, frames };
}

function basis(left, up) {
    if (up.lengthSq() < 1e-10 || left.lengthSq() < 1e-10) return Q();
    const y = up.clone().normalize();
    const x = left.clone().addScaledVector(y, -left.dot(y));
    if (x.lengthSq() < 1e-10) return Q();
    x.normalize();
    return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y).normalize()));
}

class MotionRetargeter {
    constructor(vrm) {
        this.vrm = vrm;
        this.bones = {};
        this.rest = {};
        const rig = vrm.humanoid;
        for (const name of Object.keys(rig.normalizedHumanBones)) {
            const bone = rig.getNormalizedBoneNode(name);
            if (bone) this.bones[name] = bone;
        }
        const previous = this.capture();
        try {
            rig.resetNormalizedPose();
            vrm.scene.updateWorldMatrix(true, true);
            for (const [name, bone] of Object.entries(this.bones)) {
                this.rest[name] = { position: bone.position.clone(), quaternion: bone.quaternion.clone(),
                    world: world(bone), worldQ: bone.getWorldQuaternion(Q()) };
            }
            const r = this.rest;
            for (const name of ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']) {
                if (!r[name]) throw new Error(`模型缺少必要骨骼: ${name}`);
            }
            this.restLeft = r.leftUpperLeg.world.clone().sub(r.rightUpperLeg.world);
            this.restShoulders = (r.leftShoulder || r.leftUpperArm).world.clone().sub((r.rightShoulder || r.rightUpperArm).world);
            this.body = [['hips', 'spine', 0, 3], ['spine', 'chest', 3, 6],
                ['chest', r.upperChest ? 'upperChest' : 'neck', 6, 9],
                ...(r.upperChest ? [['upperChest', 'neck', 9, 12]] : []), ['neck', 'head', 12, 15]];
            this.legLength = ['left', 'right'].map(side => r[`${side}UpperLeg`].world.distanceTo(r[`${side}LowerLeg`].world)
                + r[`${side}LowerLeg`].world.distanceTo(r[`${side}Foot`].world)).reduce((a, b) => a + b) / 2;
            this.feet = ['leftFoot', 'rightFoot', 'leftToes', 'rightToes'].filter(name => r[name]);
            this.floor = new THREE.Box3().setFromObject(vrm.scene).min.y;
            this.sole = THREE.MathUtils.clamp(Math.min(...this.feet.map(name => r[name].world.y)) - this.floor, 0, 0.15);
        } finally {
            this.restore(previous);
        }
    }

    capture() {
        return Object.fromEntries(Object.entries(this.bones).map(([name, bone]) => [name,
            { position: bone.position.clone(), quaternion: bone.quaternion.clone() }]));
    }

    restore(pose) {
        for (const [name, value] of Object.entries(pose)) {
            this.bones[name].position.copy(value.position);
            this.bones[name].quaternion.copy(value.quaternion);
        }
        this.vrm.scene.updateWorldMatrix(true, true);
    }

    calibrate(frames) {
        const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
        const lengths = frames.slice(0, 20).map(f => (distance(f[1], f[4]) + distance(f[4], f[7])
            + distance(f[2], f[5]) + distance(f[5], f[8])) / 2).sort((a, b) => a - b);
        this.scale = this.legLength / Math.max(0.1, lengths[Math.floor(lengths.length / 2)]);
        this.anchor = V().set(this.rest.hips.world.x + frames[0][0][0] * this.scale,
            this.floor, this.rest.hips.world.z + frames[0][0][2] * this.scale);
    }

    apply(frame) {
        const p = frame.map(point => V().set(-point[0], point[1], -point[2]));
        const b = this.bones, r = this.rest;
        this.restore(r);
        const setWorld = (name, rotation) => {
            const node = b[name];
            node.quaternion.copy(node.parent.getWorldQuaternion(Q()).invert().multiply(rotation));
            node.updateWorldMatrix(false, true);
        };
        for (const [name, child, a, c] of this.body) {
            const left = name === 'hips' ? p[1].clone().sub(p[2]) : p[13].clone().sub(p[14]);
            const restLeft = name === 'hips' ? this.restLeft : this.restShoulders;
            const delta = basis(left, p[c].clone().sub(p[a])).multiply(basis(restLeft, r[child].world.clone().sub(r[name].world)).invert());
            setWorld(name, delta.multiply(r[name].worldQ));
        }
        for (const [name, child, a, c] of LIMBS) {
            if (!b[name] || !r[child]) continue;
            const restDir = r[child].world.clone().sub(r[name].world).applyQuaternion(r[name].worldQ.clone().invert()).normalize();
            const target = p[c].clone().sub(p[a]).applyQuaternion(b[name].parent.getWorldQuaternion(Q()).invert()).normalize();
            if (target.lengthSq() < 0.5 || restDir.lengthSq() < 0.5) continue;
            b[name].quaternion.setFromUnitVectors(restDir, target);
            b[name].updateWorldMatrix(false, true);
        }
        const hips = b.hips;
        this.moveHips(p[0].clone().multiplyScalar(this.scale).add(this.anchor));
        this.vrm.scene.updateWorldMatrix(true, true);
        const avatarMin = Math.min(...this.feet.map(name => world(b[name]).y));
        const sourceMin = Math.min(...[7, 8, 10, 11].map(i => p[i].y)) * this.scale + this.floor;
        const root = world(hips);
        root.y += sourceMin + this.sole - avatarMin;
        this.moveHips(root);
        this.vrm.scene.updateWorldMatrix(true, true);
    }

    moveHips(target) {
        const hips = this.bones.hips, root = this.bones.motionRoot || hips;
        const position = world(root).add(target.clone().sub(world(hips)));
        root.position.copy(root.parent.worldToLocal(position));
    }
}

function sampleFrame(frames, index) {
    const i = Math.min(Math.floor(index), frames.length - 1), a = frames[i], b = frames[Math.min(i + 1, frames.length - 1)];
    const fraction = index - i;
    return a.map((point, j) => point.map((v, k) => v + (b[j][k] - v) * fraction));
}

class BodyMotionPlayer {
    constructor(adapter, blendSeconds = 0.3) {
        this.adapter = adapter;
        this.retarget = adapter.modelType === 'mmd' ? new PMXMotionRetargeter(adapter, MotionRetargeter) : new MotionRetargeter(adapter.vrm);
        this.blend = THREE.MathUtils.clamp(Number(blendSeconds) || 0.3, 0.05, 1);
    }

    play(data) {
        if (this.active) throw new Error('身体动作仍在播放');
        const { fps, frames } = validateMotion(data);
        if (this.adapter._disposed) throw new Error('模型已经卸载');
        this.motion = { fps, frames };
        this.original = this.retarget.capture();
        // Preserve the ground-relative camera height throughout the clip. Tracking
        // the moving pelvis vertically would visually cancel jumps and flips.
        this.cameraTargetY = world(this.retarget.bones.hips).y;
        this.retarget.calibrate(frames);
        this.elapsed = 0;
        this.active = true;
        this.binding = attachBodyPlayer(this.adapter, this);
        return new Promise(resolve => { this.resolve = resolve; });
    }

    update(delta) {
        if (!this.active) return false;
        this.elapsed += Math.min(Math.max(Number(delta) || 0, 0), 0.1);
        const { fps, frames } = this.motion, duration = (frames.length - 1) / fps;
        try {
            if (this.elapsed >= duration + this.blend * 2) {
                this.stop('completed');
                return true;
            }
            const time = THREE.MathUtils.clamp(this.elapsed - this.blend, 0, duration);
            this.retarget.apply(sampleFrame(frames, time * fps));
            const entering = this.elapsed < this.blend;
            const leaving = this.elapsed > this.blend + duration;
            if (entering || leaving) {
                let amount = entering ? this.elapsed / this.blend : 1 - (this.elapsed - this.blend - duration) / this.blend;
                amount = THREE.MathUtils.smoothstep(amount, 0, 1);
                for (const [name, bone] of Object.entries(this.retarget.bones)) {
                    const original = this.original[name];
                    bone.quaternion.copy(original.quaternion.clone().slerp(bone.quaternion, amount));
                    bone.position.copy(original.position.clone().lerp(bone.position, amount));
                }
            }
        } catch (error) {
            this.stop('error', error.message);
        }
        return true;
    }

    getCameraTarget() {
        const target = world(this.retarget.bones.hips);
        if (this.active) target.y = this.cameraTargetY;
        return target;
    }

    stop(reason = 'cancelled', error) {
        if (!this.active) return;
        this.active = false;
        this.retarget.restore(this.original);
        this.binding?.restore();
        this.binding = null;
        const resolve = this.resolve;
        this.resolve = null;
        resolve?.({ cancelled: reason !== 'completed', reason, error });
    }
}

module.exports = { MotionRetargeter, BodyMotionPlayer, validateMotion, sampleFrame };
