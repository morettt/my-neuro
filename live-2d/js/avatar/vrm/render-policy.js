const THREE = require('three');

function installPortraitLighting(scene, camera) {
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    // MToon's current lighting uses physical units. Keep the key on the camera
    // side as the orbit moves; a world-space +Z light backlights the default -Z view.
    const key = new THREE.DirectionalLight(0xffffff, Math.PI * 0.8);
    key.position.set(-1, 1.5, 2);
    key.target.position.set(0, 0, -1);
    camera.add(key, key.target);
    scene.add(ambient, camera);
    return { ambient, key };
}

function createFrameLimiter(maxFPS = 30) {
    const fps = Number.isFinite(maxFPS) ? Math.max(1, Math.min(120, maxFPS)) : 30;
    const interval = 1000 / fps;
    let next = null;
    return now => {
        if (next !== null && now + 0.01 < next) return false;
        next = next === null || now - next >= interval ? now + interval : next + interval;
        return true;
    };
}

module.exports = { installPortraitLighting, createFrameLimiter };
