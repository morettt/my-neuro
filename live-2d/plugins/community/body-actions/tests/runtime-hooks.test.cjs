const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const { RuntimeHooks, attachBodyPlayer, getBodyPlayer } = require('../runtime-hooks');

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
        updateCameraOrbit() { this.cameraY = 1.5 + this._orbitYOffset; }
        dispose() { this._disposed = true; }
    }
    const adapter = new Adapter(), before = adapter.update;
    let binding;
    const player = { active: true, update() { frames++; },
        getCameraTarget: () => new THREE.Vector3(0, 0.8, 0),
        stop() { this.active = false; binding.restore(); } };
    binding = attachBodyPlayer(adapter, player);
    adapter.update(); adapter.updateCameraOrbit();
    assert.equal(frames, 1); assert.equal(idle, 0); assert.equal(gaze, 0); assert.equal(mouth, 1);
    assert(Math.abs(adapter.cameraY - 0.9) < 1e-9);
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
