// Retarget local motion-service 22-joint positions to VRM normalized humanoid.
// Coordinates are rotated to the desktop viewport orientation.
const THREE = require('three');
const { attachBodyPlayer } = require('./runtime-hooks');
const { PMXMotionRetargeter } = require('./pmx-rig');
const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();
const world = node => node.getWorldPosition(V());
function translateWorld(node, displacement) {
    const target = world(node).add(displacement);
    node.position.copy(node.parent ? node.parent.worldToLocal(target) : target);
    node.updateWorldMatrix(true, true);
}
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
    constructor(adapter, blendSeconds = 0.4) {
        this.adapter = adapter;
        this.freeMovement = true;
        this.retarget = adapter.modelType === 'mmd' ? new PMXMotionRetargeter(adapter, MotionRetargeter) : new MotionRetargeter(adapter.vrm);
        this.blend = THREE.MathUtils.clamp(Number(blendSeconds) || 0.4, 0.05, 1);
    }

    play(data) {
        if (this.active) throw new Error('身体动作仍在播放');
        const { fps, frames } = validateMotion(data);
        if (this.adapter._disposed) throw new Error('模型已经卸载');
        this.motion = { fps, frames };
        // Preserve the pre-plugin pose for explicit shutdown only. Normal
        // completion/interruption retains the actual displayed pose instead.
        this.original ||= this.retarget.capture();
        this.startPose = this.retarget.capture();
        this.startRotation = this.retarget.bones.hips.getWorldQuaternion(Q());
        // Keep the camera anchored while the body moves in all three axes.
        this.startHips = world(this.retarget.bones.hips);
        if (this.freeMovement) {
            this.adapter._bodyMotionCameraTarget ||= this.startHips.clone();
            this.cameraTarget = this.adapter._bodyMotionCameraTarget.clone();
        } else {
            delete this.adapter._bodyMotionCameraTarget;
            this.cameraTarget = this.startHips.clone();
        }
        this.retarget.calibrate(frames);
        // Derive fixed placement from the newly generated clip's first pose,
        // without showing that pose or changing the saved on-screen reference.
        try {
            this.retarget.apply(frames[0]);
            this.sourceHips = world(this.retarget.bones.hips);
            const sourceForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.retarget.bones.hips.getWorldQuaternion(Q()));
            const targetForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.startRotation);
            const yaw = sourceForward.x ** 2 + sourceForward.z ** 2 < 1e-8
                || targetForward.x ** 2 + targetForward.z ** 2 < 1e-8 ? 0
                : Math.atan2(targetForward.x, targetForward.z) - Math.atan2(sourceForward.x, sourceForward.z);
            this.heading = Q().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            this.placeFrame();
            const firstPose = this.retarget.capture();
            this.offsets = Object.fromEntries(Object.entries(firstPose).map(([name, pose]) => [name, {
                quaternion: this.startPose[name].quaternion.clone().multiply(pose.quaternion.clone().invert()),
                position: this.startPose[name].position.clone().sub(pose.position)
            }]));
        } finally {
            this.retarget.restore(this.startPose);
        }
        this.elapsed = 0;
        this.holding = false;
        this.heldPose = null;
        this.active = true;
        this.binding ||= attachBodyPlayer(this.adapter, this);
        return new Promise(resolve => { this.resolve = resolve; });
    }

    placeFrame() {
        const hips = this.retarget.bones.hips;
        const root = this.retarget.bones.motionMesh || this.retarget.bones.motionRoot || hips;
        const source = world(hips);
        const rotation = this.heading.clone().multiply(root.getWorldQuaternion(Q()));
        root.quaternion.copy(root.parent ? root.parent.getWorldQuaternion(Q()).invert().multiply(rotation) : rotation);
        root.updateWorldMatrix(true, true);
        const displacement = source.clone().sub(this.sourceHips).applyQuaternion(this.heading);
        const target = this.startHips.clone().add(displacement);
        // Keep vertical motion/floor placement from retargeting; its initial
        // height mismatch is removed gradually by the entry pose offsets.
        target.y = source.y;
        if (!this.freeMovement) { target.x = this.startHips.x; target.z = this.startHips.z; }
        translateWorld(root, target.sub(world(hips)));
    }

    enforceHold() {
        if (!this.holding || !this.heldPose) return;
        this.retarget.restore(this.heldPose);
        this.adapter.vrm?.humanoid?.update?.();
        this.adapter.vrm?.scene?.updateWorldMatrix(true, true);
    }

    update(delta) {
        if (this.holding) { this.enforceHold(); return true; }
        if (!this.active) return false;
        this.elapsed += Math.min(Math.max(Number(delta) || 0, 0), 0.1);
        const { fps, frames } = this.motion, duration = (frames.length - 1) / fps;
        try {
            const time = THREE.MathUtils.clamp(this.elapsed, 0, duration);
            this.retarget.apply(sampleFrame(frames, time * fps));
            this.placeFrame();
            // Decaying offsets preserve the frozen pose exactly at t=0 and
            // retain generated motion underneath. Quaternions keep limb lengths.
            if (this.elapsed < this.blend) {
                const t = this.elapsed / this.blend;
                const fade = 1 - (6 * t ** 5 - 15 * t ** 4 + 10 * t ** 3);
                for (const [name, bone] of Object.entries(this.retarget.bones)) {
                    const offset = this.offsets[name];
                    bone.quaternion.premultiply(Q().slerp(offset.quaternion, fade));
                    bone.position.addScaledVector(offset.position, fade);
                }
                (this.adapter.vrm?.scene || this.adapter.mesh)?.updateWorldMatrix(true, true);
            }
            if (this.elapsed >= duration) this.stop('completed');
        } catch (error) {
            this.stop('error', error.message);
        }
        return true;
    }

    getCameraTarget() {
        if ((this.active || this.holding) && this.freeMovement !== false) return this.cameraTarget.clone();
        const target = world(this.retarget.bones.hips);
        if (this.active || this.holding) target.y = this.cameraTarget.y;
        return target;
    }

    stop(reason = 'cancelled', error) {
        if (!this.active && !this.holding) return;
        this.active = false;
        if (reason === 'completed' || reason === 'interrupted') {
            this.heldPose = this.retarget.capture();
            this.holding = true;
        } else {
            this.holding = false;
            this.heldPose = null;
            this.retarget.restore(this.original);
            this.original = null;
            this.binding?.restore();
            this.binding = null;
            delete this.adapter._bodyMotionCameraTarget;
        }
        const resolve = this.resolve;
        this.resolve = null;
        resolve?.({ cancelled: reason !== 'completed', reason, error });
    }
}

module.exports = { MotionRetargeter, BodyMotionPlayer, validateMotion, sampleFrame };
