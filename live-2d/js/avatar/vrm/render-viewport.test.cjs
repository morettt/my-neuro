const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const { VRMModelAdapter } = require('./model-adapter');

const pixel = (point, camera, rect) => {
    const p = point.clone().project(camera);
    return new THREE.Vector2(rect.x + (p.x + 1) * rect.width / 2,
        rect.y + (1 - p.y) * rect.height / 2);
};

function fixture(rect) {
    const camera = new THREE.PerspectiveCamera(40, rect.width / rect.height, 0.1, 100);
    camera.position.set(0, 1, 3);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
    const calls = [];
    const renderer = {
        setViewport: (...args) => calls.push(['viewport', ...args]),
        setScissorTest: enabled => calls.push(['scissor', enabled])
    };
    const bones = {};
    for (const [name, position] of Object.entries({ head: [1.2, 1.8, 0], hips: [1.2, 1, 0],
        leftHand: [2, 1.2, 0], rightHand: [0.4, 1.2, 0] })) {
        bones[name] = new THREE.Object3D(); bones[name].position.fromArray(position);
    }
    const vrm = { humanoid: { getNormalizedBoneNode: name => bones[name], getRawBoneNode: name => bones[name] } };
    const adapter = new VRMModelAdapter(vrm, null, camera, renderer, null);
    adapter.viewRect = { ...rect };
    return { adapter, camera, calls, bones };
}

test('full-window projection preserves framing through dragging, scaling and window resizing', () => {
    for (const rect of [{ x: 500, y: 150, width: 300, height: 600 },
        { x: -50, y: 300, width: 600, height: 900 }]) {
        const { adapter, camera, calls } = fixture(rect);
        const points = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 1.5, 0.5)];
        const expected = points.map(point => pixel(point, camera, rect));
        for (const [width, height] of [[1920, 1080], [1280, 720]]) {
            adapter.updateRenderViewport(width, height);
            for (let i = 0; i < points.length; i++) {
                assert(pixel(points[i], camera, { x: 0, y: 0, width, height }).distanceTo(expected[i]) < 1e-8);
            }
            assert.deepEqual(calls.slice(-2), [['scissor', false], ['viewport', 0, 0, width, height]]);
        }
    }
});

test('body outside the old rectangle remains visible and its gaze and mouse hit box stay aligned', () => {
    const rect = { x: 500, y: 150, width: 300, height: 600 };
    const { adapter, camera, bones } = fixture(rect);
    const oldHand = pixel(bones.leftHand.position, camera, rect);
    assert(oldHand.x > rect.x + rect.width, 'fixture must extend past the old clipping edge');
    adapter.updateRenderViewport(1920, 1080);
    const projected = bones.leftHand.position.clone().project(camera);
    assert(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1);
    const head = pixel(bones.head.position, camera, { x: 0, y: 0, width: 1920, height: 1080 });
    const gaze = adapter._getHeadScreenPos();
    assert(head.distanceTo(new THREE.Vector2(gaze.x, gaze.y)) < 1e-8);
    adapter._updateScreenHitBox();
    assert(adapter.isPointOverModel(oldHand.x, oldHand.y));
});

test('depth travel grows toward the viewer, shrinks away and never crosses the camera', () => {
    const { adapter, camera, bones } = fixture({ x: 500, y: 150, width: 300, height: 600 });
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    adapter.updateRenderViewport(rect.width, rect.height);
    adapter.updateCameraOrbit();
    const height = () => pixel(bones.head.position, camera, rect).distanceTo(pixel(bones.hips.position, camera, rect));
    const initialHeight = height();
    adapter._bodyMotionCameraTarget = bones.hips.position.clone();
    adapter.updateCameraOrbit();
    assert(Math.abs(height() - initialHeight) < 1e-8, 'longer lens changed the starting size');
    for (const z of [-4, 3, -20]) {
        for (const bone of Object.values(bones)) bone.position.z = z;
        adapter.updateCameraOrbit();
        assert(camera.position.z < z - camera.near);
        assert(z < 0 ? height() > initialHeight : height() < initialHeight);
        assert(Math.abs(bones.head.position.clone().project(camera).z) < 1);
    }
});
