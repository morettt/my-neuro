const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const { RuntimeHooks, attachBodyPlayer, getBodyPlayer } = require('../runtime-hooks');
const { VRMModelAdapter } = require('../../../../js/avatar/vrm/model-adapter');
const { BodyMotionPlayer } = require('../retarget');

test('real orbit camera stays fixed while the pelvis moves, then resumes following on stop', () => {
    const hips = new THREE.Object3D();
    hips.position.set(0, 1, 0);
    const adapter = Object.assign(Object.create(VRMModelAdapter.prototype), {
        vrm: { humanoid: { getNormalizedBoneNode: () => hips } },
        camera: new THREE.PerspectiveCamera(), _orbitTarget: new THREE.Vector3(),
        _orbitYOffset: 0.1, _orbitDistance: 3, _orbitTheta: 0, _orbitPhi: 0,
        _updateScreenHitBox() {}
    });
    const player = Object.assign(Object.create(BodyMotionPlayer.prototype), {
        active: true, cameraTarget: hips.position.clone(), retarget: { bones: { hips } }
    });
    const binding = attachBodyPlayer(adapter, player);
    adapter.updateCameraOrbit();
    const initial = adapter.camera.position.clone();
    hips.position.set(2, 3, -4);
    adapter.updateCameraOrbit();
    assert.deepEqual(adapter.camera.position.toArray(), initial.toArray());
    assert.deepEqual(hips.position.toArray(), [2, 3, -4]);
    player.active = false;
    binding.restore();
    adapter.updateCameraOrbit();
    assert.deepEqual(adapter.camera.position.clone().sub(initial).toArray(), [2, 2, -4]);
});

test('walking keeps its destination through fade-out and consecutive actions without camera recentering', async () => {
    const scene = new THREE.Group();
    const definitions = {
        hips: [null, [0, 1, 0]], spine: ['hips', [0, 1.2, 0]], chest: ['spine', [0, 1.4, 0]],
        neck: ['chest', [0, 1.6, 0]], head: ['neck', [0, 1.8, 0]],
        leftUpperArm: ['chest', [0.3, 1.4, 0]], leftLowerArm: ['leftUpperArm', [0.6, 1.4, 0]], leftHand: ['leftLowerArm', [0.9, 1.4, 0]],
        rightUpperArm: ['chest', [-0.3, 1.4, 0]], rightLowerArm: ['rightUpperArm', [-0.6, 1.4, 0]], rightHand: ['rightLowerArm', [-0.9, 1.4, 0]],
        leftUpperLeg: ['hips', [0.1, 1, 0]], leftLowerLeg: ['leftUpperLeg', [0.1, 0.5, 0]], leftFoot: ['leftLowerLeg', [0.1, 0, 0]],
        rightUpperLeg: ['hips', [-0.1, 1, 0]], rightLowerLeg: ['rightUpperLeg', [-0.1, 0.5, 0]], rightFoot: ['rightLowerLeg', [-0.1, 0, 0]]
    };
    const bones = {};
    for (const [name, [parent, point]] of Object.entries(definitions)) {
        const bone = new THREE.Bone();
        bone.position.fromArray(point);
        if (parent) bone.position.sub(new THREE.Vector3().fromArray(definitions[parent][1]));
        (parent ? bones[parent] : scene).add(bone);
        bones[name] = bone;
    }
    const rest = Object.fromEntries(Object.entries(bones).map(([name, bone]) => [name, bone.position.clone()]));
    const bounds = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
    bounds.position.y = 1; scene.add(bounds);
    const adapter = Object.assign(Object.create(VRMModelAdapter.prototype), {
        modelType: 'vrm', vrm: { scene, humanoid: {
            normalizedHumanBones: bones, getNormalizedBoneNode: name => bones[name],
            resetNormalizedPose() {
                for (const [name, bone] of Object.entries(bones)) { bone.position.copy(rest[name]); bone.quaternion.identity(); }
            }
        } }, camera: new THREE.PerspectiveCamera(), _orbitTarget: new THREE.Vector3(),
        _orbitYOffset: 0.1, _orbitDistance: 3, _orbitTheta: 0, _orbitPhi: 0, _updateScreenHitBox() {}
    });
    const names = ['hips', 'leftUpperLeg', 'rightUpperLeg', 'spine', 'leftLowerLeg', 'rightLowerLeg', 'chest', 'leftFoot', 'rightFoot', 'neck', 'leftFoot', 'rightFoot', 'neck', 'leftUpperArm', 'rightUpperArm', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];
    const frame = names.map(name => definitions[name][1].map((v, i) => i === 1 ? v : -v));
    const data = { fps: 20, joints: [frame, frame.map(p => [p[0] - 0.5, p[1], p[2] + 0.5]), frame.map(p => [p[0] - 1, p[1], p[2] + 1])] };
    const player = new BodyMotionPlayer(adapter, 0.05);
    adapter.updateCameraOrbit();
    let camera;
    for (let step = 1; step <= 2; step++) {
        const done = player.play(data);
        adapter.updateCameraOrbit();
        camera ||= adapter.camera.position.clone();
        let ticks = 0;
        while (player.active && ticks++ < 100) {
            player.update(0.01);
            adapter.updateCameraOrbit();
            assert(adapter.camera.position.distanceTo(camera) < 1e-8);
            if (player.active && player.elapsed > 0.15) {
                assert(Math.abs(bones.hips.getWorldPosition(new THREE.Vector3()).x - step) < 1e-8, 'fade-out moved the body back');
                assert(Math.abs(bones.hips.getWorldPosition(new THREE.Vector3()).z + step) < 1e-8, 'fade-out lost depth travel');
            }
        }
        assert.equal((await done).reason, 'completed');
        assert(Math.abs(bones.hips.getWorldPosition(new THREE.Vector3()).x - step) < 1e-8);
        assert(Math.abs(bones.hips.getWorldPosition(new THREE.Vector3()).z + step) < 1e-8);
    }
    bounds.geometry.dispose(); bounds.material.dispose();
});

test('disabling restores the exact original TTS and UI instance methods', () => {
    const runtime = { ttsProcessor: {
        reset() {}, addStreamingText() {}, processTextToSpeech() {}, finalizeStreamingText() {}
    }, uiController: { showSubtitle() {} }, showSubtitle() {} };
    const beforeTTS = { ...runtime.ttsProcessor };
    const beforeUI = runtime.uiController.showSubtitle, beforeGlobal = runtime.showSubtitle;
    const plugin = { adapter: () => ({}), onDisplayText: text => text };
    const hooks = new RuntimeHooks(plugin, runtime);
    hooks.beginRequest(true);
    assert.notEqual(runtime.ttsProcessor.addStreamingText, beforeTTS.addStreamingText);
    hooks.dispose();
    for (const key of Object.keys(beforeTTS)) assert.equal(runtime.ttsProcessor[key], beforeTTS[key]);
    assert.equal(runtime.uiController.showSubtitle, beforeUI);
    assert.equal(runtime.showSubtitle, beforeGlobal);
});

test('body ownership suppresses idle but retains normal updates, and fully restores on stop', () => {
    let idle = 0, gaze = 0, mouth = 0, frames = 0;
    const hips = { getWorldPosition: v => v.set(0, 1.5, 0) };
    class Adapter {
        constructor() { this.vrm = { humanoid: { getNormalizedBoneNode: () => hips } }; this._orbitYOffset = 0.1; }
        update() { this._updateIdleAnimation(); this._updateGazeTracking(); mouth++; }
        _updateIdleAnimation() { idle++; }
        _updateGazeTracking() { gaze++; }
        updateCameraOrbit(target) {
            this.cameraTarget = target ? target.clone() : hips.getWorldPosition(new THREE.Vector3());
            this.cameraY = this.cameraTarget.y + this._orbitYOffset;
        }
        dispose() { this._disposed = true; }
    }
    const adapter = new Adapter(), before = adapter.update;
    let binding;
    const player = { active: true, update() { frames++; },
        getCameraTarget: () => new THREE.Vector3(2, 0.8, -3),
        stop() { this.active = false; binding.restore(); } };
    binding = attachBodyPlayer(adapter, player);
    adapter.update(); adapter.updateCameraOrbit();
    assert.equal(frames, 1); assert.equal(idle, 0); assert.equal(gaze, 0); assert.equal(mouth, 1);
    assert(Math.abs(adapter.cameraY - 0.9) < 1e-9);
    assert.deepEqual(adapter.cameraTarget.toArray(), [2, 0.8, -3]);
    assert.equal(adapter._orbitYOffset, 0.1);
    player.stop();
    assert.equal(adapter.update, before);
    assert(!Object.hasOwn(adapter, 'update'));
    assert.equal(getBodyPlayer(adapter), null);
    adapter.update(); adapter.updateCameraOrbit();
    assert.equal(idle, 1); assert.equal(gaze, 1); assert.equal(adapter.cameraY, 1.6);
});

test('model disposal releases the plugin binding before the original dispose runs', () => {
    const adapter = { update() {}, _updateIdleAnimation() {}, _updateGazeTracking() {},
        dispose() { assert.equal(getBodyPlayer(this), null); this._disposed = true; } };
    const original = adapter.dispose;
    let binding;
    const player = { active: true, stop() { this.active = false; binding.restore(); } };
    binding = attachBodyPlayer(adapter, player);
    adapter.dispose();
    assert(adapter._disposed);
    assert.equal(adapter.dispose, original);
});
