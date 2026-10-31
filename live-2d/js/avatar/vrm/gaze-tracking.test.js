const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const { VRMModelAdapter } = require('./model-adapter');

function fixture(metaVersion, mouseX, mouseY) {
    const scene = new THREE.Group();
    if (metaVersion === '1') scene.rotation.y = Math.PI;
    const head = new THREE.Object3D();
    scene.add(head);
    const values = {};
    const vrm = { scene, meta: { metaVersion },
        humanoid: { getNormalizedBoneNode: name => name === 'head' ? head : null },
        expressionManager: { setValue: (name, value) => { values[name] = value; } } };
    const camera = new THREE.PerspectiveCamera(40, 400 / 600, 0.1, 100);
    camera.position.set(0, 0, -3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const adapter = new VRMModelAdapter(vrm, scene, camera, null, null);
    adapter.viewRect = { x: 0, y: 0, width: 400, height: 600 };
    adapter._swayPhase = 0;
    scene.updateMatrixWorld(true);
    adapter.setMousePosition(mouseX, mouseY);
    adapter._updateGazeTracking(1);
    scene.updateMatrixWorld(true);
    // Project a point in the face's forward direction, rather than asserting an
    // implementation-specific Euler sign. This catches VRM 0/1 direction regressions.
    const forward = new THREE.Vector3(0, 0, metaVersion === '1' ? 1 : -1)
        .applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(0.2);
    const projected = head.getWorldPosition(new THREE.Vector3()).add(forward).project(camera);
    return { x: (projected.x + 1) * 200, y: (1 - projected.y) * 300, values };
}

for (const version of ['0', '1']) {
    test(`VRM ${version} head and eyes follow above/below cursor positions in screen space`, () => {
        const center = fixture(version, 200, 300);
        const up = fixture(version, 200, 200);
        const down = fixture(version, 200, 400);
        assert.ok(up.y < center.y, 'cursor above must tilt the face upward');
        assert.ok(down.y > center.y, 'cursor below must tilt the face downward');
        assert.ok(up.values.lookUp > 0 && up.values.lookDown === 0);
        assert.ok(down.values.lookDown > 0 && down.values.lookUp === 0);
    });
    test(`VRM ${version} horizontal gaze keeps its existing screen direction`, () => {
        const center = fixture(version, 200, 300);
        assert.ok(fixture(version, 100, 300).x < center.x);
        assert.ok(fixture(version, 300, 300).x > center.x);
    });
}
