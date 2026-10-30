const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const { installPortraitLighting, createFrameLimiter } = require('./render-policy');

test('VRM key light stays on the camera side through the default negative-Z view and orbit', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const { key } = installPortraitLighting(scene, camera);
    assert.equal(key.intensity, Math.PI * 0.8);
    for (const pos of [[0, 1, -3], [3, 1, 0], [0, 1, 3]]) {
        camera.position.set(...pos);
        camera.lookAt(0, 1, 0);
        scene.updateMatrixWorld(true);
        const lightDirection = key.target.getWorldPosition(new THREE.Vector3()).sub(key.getWorldPosition(new THREE.Vector3())).normalize();
        const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
        assert.ok(lightDirection.dot(cameraDirection) > 0.8);
    }
});

test('30 FPS budget limits both 60 Hz and high-refresh displays without catch-up bursts', () => {
    for (const hz of [60, 144, 240]) {
        const allowed = createFrameLimiter(30);
        let count = 0;
        for (let i = 0; i < hz; i++) if (allowed(i * 1000 / hz)) count++;
        assert.equal(count, 30);
        assert.equal(allowed(10000), true);
        assert.equal(allowed(10001), false);
    }
});

test('VRM frame budget permits a configured 60 FPS and rejects non-finite rates', () => {
    const allowed = createFrameLimiter(60);
    assert.equal(allowed(0), true);
    assert.equal(allowed(8), false);
    assert.equal(allowed(17), true);
    const fallback = createFrameLimiter(NaN);
    assert.equal(fallback(0), true);
    assert.equal(fallback(17), false);
});
