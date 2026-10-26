const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const { createPMXMotionRig } = require('../pmx-rig');
const { MotionRetargeter } = require('../retarget');
const BodyActionsPlugin = require('../index');

test('PMX pelvis translation moves the sibling upper body through their common center', () => {
    const mesh = new THREE.Group();
    const center = new THREE.Bone(), hips = new THREE.Bone(), spine = new THREE.Bone();
    center.name = 'センター'; hips.name = '下半身'; spine.name = '上半身';
    mesh.add(center); center.add(hips, spine);
    hips.position.y = 1; spine.position.y = 1.2;
    mesh.updateWorldMatrix(true, true);
    mesh.skeleton = new THREE.Skeleton([center, hips, spine]);
    const rig = createPMXMotionRig({ mesh });
    const bones = Object.fromEntries(Object.keys(rig.humanoid.normalizedHumanBones)
        .map(name => [name, rig.humanoid.getNormalizedBoneNode(name)]));
    assert.equal(bones.motionRoot, center);
    MotionRetargeter.prototype.moveHips.call({ bones }, new THREE.Vector3(2, 3, 4));
    mesh.updateWorldMatrix(true, true);
    assert(hips.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(2, 3, 4)) < 1e-9);
    assert(spine.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(2, 3.2, 4)) < 1e-9);
    rig.humanoid.resetNormalizedPose();
    mesh.updateWorldMatrix(true, true);
    assert.equal(center.position.length(), 0);
    assert.equal(hips.position.y, 1);
    assert.equal(spine.position.y, 1.2);
});

test('PMX is accepted as a playable model', () => {
    const previous = global.currentModel;
    try {
        global.currentModel = { modelType: 'mmd' };
        const plugin = new BodyActionsPlugin({}, {});
        assert.equal(plugin.adapter(), global.currentModel);
    } finally { global.currentModel = previous; }
});
