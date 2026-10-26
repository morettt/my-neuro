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

// PMX upper/lower bodies are often siblings. Move their common ancestor so
// pelvis translation moves the entire character, not only its legs.
function createPMXMotionRig(adapter) {
    const mesh = adapter.mesh, skeleton = mesh.skeleton, bones = {};
    for (const [name, aliases] of Object.entries(ALIASES)) {
        const bone = skeleton.bones.find(node => aliases.includes(node.name));
        if (bone) bones[name] = bone;
    }
    let root = bones.hips;
    const contains = (parent, node) => {
        for (; node; node = node.parent) if (node === parent) return true;
        return false;
    };
    while (root && !contains(root, bones.spine)) root = root.parent;
    if (!root?.isBone) throw new Error('PMX 缺少上下半身共用的中心骨骼');
    if (root !== bones.hips) bones.motionRoot = root;
    const bind = new Map(skeleton.bones.map((bone, index) => [bone, skeleton.boneInverses[index]]));
    const rest = new Map();
    for (const bone of Object.values(bones)) {
        const local = bind.get(bone).clone().invert();
        if (bind.has(bone.parent)) local.premultiply(bind.get(bone.parent));
        const position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
        local.decompose(position, quaternion, new THREE.Vector3());
        rest.set(bone, { position, quaternion });
    }
    return {
        scene: mesh,
        humanoid: {
            normalizedHumanBones: bones,
            getNormalizedBoneNode: name => bones[name],
            resetNormalizedPose() {
                for (const [bone, pose] of rest) {
                    bone.position.copy(pose.position);
                    bone.quaternion.copy(pose.quaternion);
                }
            }
        }
    };
}

module.exports = { createPMXMotionRig };
