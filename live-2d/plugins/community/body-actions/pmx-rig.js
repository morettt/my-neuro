const THREE = require('three');

const ALIASES = {
    hips: ['下半身', 'hips'], spine: ['上半身', 'spine'], chest: ['上半身2', '上半身２', 'chest'],
    neck: ['首', 'neck'], head: ['頭', '头', 'head'],
    leftShoulder: ['左肩', 'leftShoulder'], rightShoulder: ['右肩', 'rightShoulder'],
    leftUpperArm: ['左腕', 'leftUpperArm'], rightUpperArm: ['右腕', 'rightUpperArm'],
    leftLowerArm: ['左ひじ', '左肘', 'leftLowerArm'], rightLowerArm: ['右ひじ', '右肘', 'rightLowerArm'],
    leftHand: ['左手首', 'leftHand'], rightHand: ['右手首', 'rightHand'],
    leftUpperLeg: ['左足', 'leftUpperLeg'], rightUpperLeg: ['右足', 'rightUpperLeg'],
    leftLowerLeg: ['左ひざ', '左膝', 'leftLowerLeg'], rightLowerLeg: ['右ひざ', '右膝', 'rightLowerLeg'],
    leftFoot: ['左足首', 'leftFoot'], rightFoot: ['右足首', 'rightFoot'],
    leftToes: ['左つま先', 'leftToes'], rightToes: ['右つま先', 'rightToes']
};

const PARENTS = {
    hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
    leftShoulder: 'chest', rightShoulder: 'chest',
    leftUpperArm: 'leftShoulder', rightUpperArm: 'rightShoulder',
    leftLowerArm: 'leftUpperArm', rightLowerArm: 'rightUpperArm',
    leftHand: 'leftLowerArm', rightHand: 'rightLowerArm',
    leftUpperLeg: 'hips', rightUpperLeg: 'hips',
    leftLowerLeg: 'leftUpperLeg', rightLowerLeg: 'rightUpperLeg',
    leftFoot: 'leftLowerLeg', rightFoot: 'rightLowerLeg',
    leftToes: 'leftFoot', rightToes: 'rightFoot'
};
const depth = node => node.parent ? 1 + depth(node.parent) : 0;
const position = node => node.getWorldPosition(new THREE.Vector3());

class PMXMotionRetargeter {
    constructor(adapter, CoreRetargeter) {
        this.mesh = adapter.mesh;
        this.bones = {};
        for (const [name, aliases] of Object.entries(ALIASES)) {
            const bone = this.mesh.skeleton.bones.find(node => aliases.includes(node.name));
            if (!bone && !name.endsWith('Toes') && !name.endsWith('Shoulder')) throw new Error(`PMX 缺少必要骨骼: ${aliases[0]}`);
            if (bone) this.bones[name] = bone;
        }
        this.ordered = Object.keys(this.bones).sort((a, b) => depth(this.bones[a]) - depth(this.bones[b]));
        // Capture every bone, including deform/twist bones, and the mesh root.
        // Blending and stopping must restore the actual relaxed desktop pose.
        for (const [index, bone] of this.mesh.skeleton.bones.entries()) {
            if (!Object.values(this.bones).includes(bone)) this.bones[`extra:${index}`] = bone;
        }
        this.bones.motionMesh = this.mesh;
        const previous = this.capture();
        try {
            const bind = new Map(this.mesh.skeleton.bones.map((bone, index) => [bone, this.mesh.skeleton.boneInverses[index]]));
            for (const bone of this.mesh.skeleton.bones) {
                const local = bind.get(bone).clone().invert();
                if (bind.has(bone.parent)) local.premultiply(bind.get(bone.parent));
                local.decompose(bone.position, bone.quaternion, new THREE.Vector3());
            }
            this.mesh.updateWorldMatrix(true, true);
            this.bindPose = this.capture();
            this.bindWorld = Object.fromEntries(this.ordered.map(name => [name, this.bones[name].getWorldQuaternion(new THREE.Quaternion())]));
            const points = Object.fromEntries(this.ordered.map(name => [name, position(this.bones[name])]));
            // PMX upper/lower body pivots overlap or point downwards. A continuous
            // proxy spine avoids treating that offset as a humanoid spine segment.
            points.spine.lerp(points.chest, 0.35);
            const root = new THREE.Group(), virtual = {}, rest = {};
            for (const name of Object.keys(PARENTS)) {
                if (!points[name]) continue;
                const bone = new THREE.Bone();
                let parent = PARENTS[name];
                if (parent && !points[parent]) parent = PARENTS[parent];
                bone.position.copy(points[name]);
                if (parent) bone.position.sub(points[parent]);
                (parent ? virtual[parent] : root).add(bone);
                virtual[name] = bone;
                rest[name] = { position: bone.position.clone(), quaternion: bone.quaternion.clone() };
            }
            const bounds = new THREE.Box3().setFromObject(this.mesh);
            const size = bounds.getSize(new THREE.Vector3());
            const box = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial());
            box.position.copy(bounds.getCenter(new THREE.Vector3()));
            root.add(box);
            try {
                this.core = new CoreRetargeter({ scene: root, humanoid: {
                    normalizedHumanBones: virtual,
                    getNormalizedBoneNode: name => virtual[name],
                    resetNormalizedPose() {
                        for (const [name, bone] of Object.entries(virtual)) {
                            bone.position.copy(rest[name].position);
                            bone.quaternion.copy(rest[name].quaternion);
                        }
                    }
                } });
            } finally { root.remove(box); box.geometry.dispose(); box.material.dispose(); }
            this.hipsRest = points.hips.clone();
            this.meshRestWorld = position(this.mesh);
        } finally { this.restore(previous); }
    }

    get floor() { return this.core.floor; }
    capture() {
        return Object.fromEntries(Object.entries(this.bones).map(([name, bone]) => [name,
            { position: bone.position.clone(), quaternion: bone.quaternion.clone() }]));
    }
    restore(pose) {
        for (const [name, value] of Object.entries(pose)) {
            this.bones[name].position.copy(value.position);
            this.bones[name].quaternion.copy(value.quaternion);
        }
        this.mesh.updateWorldMatrix(true, true);
    }
    calibrate(frames) { this.core.calibrate(frames); }
    apply(frame) {
        this.core.apply(frame);
        this.restore(this.bindPose);
        const displacement = position(this.core.bones.hips).sub(this.hipsRest);
        // Displacement is in world metres; mesh.position is in its parent's axes.
        this.mesh.position.copy(this.mesh.parent.worldToLocal(this.meshRestWorld.clone().add(displacement)));
        this.mesh.updateWorldMatrix(true, true);
        for (const name of this.ordered) {
            const actual = this.bones[name];
            const rotation = this.core.bones[name].getWorldQuaternion(new THREE.Quaternion()).multiply(this.bindWorld[name]);
            actual.quaternion.copy(actual.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
            actual.updateWorldMatrix(false, true);
        }
        for (const side of ['左', '右']) for (const segment of ['足', 'ひざ', '足首']) {
            const source = this.mesh.skeleton.bones.find(bone => bone.name === side + segment);
            const target = this.mesh.skeleton.bones.find(bone => bone.name === side + segment + 'D');
            if (!source || !target) continue;
            const rotation = source.getWorldQuaternion(new THREE.Quaternion());
            target.quaternion.copy(target.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
            target.updateWorldMatrix(false, true);
        }
        this.mesh.updateWorldMatrix(true, true);
    }
}

module.exports = { PMXMotionRetargeter };
