const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const { PMXMotionRetargeter } = require('../pmx-rig');
const { MotionRetargeter } = require('../retarget');
const BodyActionsPlugin = require('../index');

test('PMX overlapping body pivots use a continuous proxy; scaled, rotated placement and restoration work', () => {
    const mesh = new THREE.Group();
    const definitions = {
        center: [null, [0, 0, 0]], hips: ['center', [0, 1, 0]], spine: ['center', [0, 1, 0]],
        chest: ['spine', [0, 1.4, 0]], neck: ['chest', [0, 1.6, 0]], head: ['neck', [0, 1.8, 0]],
        leftUpperArm: ['chest', [0.3, 1.4, 0]], leftLowerArm: ['leftUpperArm', [0.6, 1.4, 0]], leftHand: ['leftLowerArm', [0.9, 1.4, 0]],
        rightUpperArm: ['chest', [-0.3, 1.4, 0]], rightLowerArm: ['rightUpperArm', [-0.6, 1.4, 0]], rightHand: ['rightLowerArm', [-0.9, 1.4, 0]],
        leftUpperLeg: ['hips', [0.1, 1, 0]], leftLowerLeg: ['leftUpperLeg', [0.1, 0.5, 0]], leftFoot: ['leftLowerLeg', [0.1, 0, 0]],
        rightUpperLeg: ['hips', [-0.1, 1, 0]], rightLowerLeg: ['rightUpperLeg', [-0.1, 0.5, 0]], rightFoot: ['rightLowerLeg', [-0.1, 0, 0]]
    };
    const bones = {};
    for (const [name, [parent, point]] of Object.entries(definitions)) {
        const bone = new THREE.Bone(); bone.name = name;
        bone.position.fromArray(point);
        if (parent) bone.position.sub(new THREE.Vector3().fromArray(definitions[parent][1]));
        (parent ? bones[parent] : mesh).add(bone); bones[name] = bone;
    }
    const bounds = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
    bounds.position.y = 1; mesh.add(bounds);
    mesh.updateWorldMatrix(true, true);
    mesh.skeleton = new THREE.Skeleton(Object.values(bones));
    const group = new THREE.Group(); group.rotation.y = Math.PI; group.add(mesh);
    mesh.scale.setScalar(0.8); group.updateWorldMatrix(true, true);
    const rig = new PMXMotionRetargeter({ mesh }, MotionRetargeter);
    assert(rig.core.rest.spine.world.y > rig.core.rest.hips.world.y);
    const saved = rig.capture();
    const virtualNames = ['hips', 'leftUpperLeg', 'rightUpperLeg', 'spine', 'leftLowerLeg', 'rightLowerLeg', 'chest', 'leftFoot', 'rightFoot', 'neck', 'leftFoot', 'rightFoot', 'neck', 'leftUpperArm', 'rightUpperArm', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];
    const frame = virtualNames.map(name => rig.core.rest[name].world.toArray().map((value, i) => i === 1 ? value : -value));
    rig.calibrate([frame, frame]);
    rig.apply(frame);
    const baseHip = bones.hips.getWorldPosition(new THREE.Vector3());
    const baseHead = bones.head.getWorldPosition(new THREE.Vector3());
    rig.apply(frame.map(point => [point[0] - 0.4, point[1], point[2]]));
    assert(Math.abs(bones.hips.getWorldPosition(new THREE.Vector3()).x - baseHip.x - 0.4) < 1e-6);
    assert(Math.abs(bones.head.getWorldPosition(new THREE.Vector3()).x - baseHead.x - 0.4) < 1e-6);
    rig.restore(saved);
    assert(mesh.position.distanceTo(saved.motionMesh.position) < 1e-9);
    assert(bones.spine.quaternion.angleTo(saved.spine.quaternion) < 1e-9);
    bounds.geometry.dispose(); bounds.material.dispose();
});

test('PMX is accepted as a playable model', () => {
    const previous = global.currentModel;
    try {
        global.currentModel = { modelType: 'mmd' };
        const plugin = new BodyActionsPlugin({}, {});
        assert.equal(plugin.adapter(), global.currentModel);
    } finally { global.currentModel = previous; }
});
