// Real Motion inference + hidden VRM integration test. No user config is changed.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const root = path.resolve(__dirname, '../../../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'feiniu-body-actions-test-'));
const log = (...args) => fs.appendFileSync(path.join(output, 'result.log'), args.map(String).join(' ') + '\n');
console.log = console.error = log;
const fail = error => { log(error?.stack || error); app.exit(1); };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
dialog.showErrorBox = (title, content) => fail(new Error(`${title}: ${content}`));
log(`Output: ${output}`);
app.setPath('userData', path.join(output, 'profile'));
let win;
ipcMain.handle('avatar-runtime-ready', () => ({ success: true }));
ipcMain.handle('body-actions-test:capture', async (_event, name) => {
    if (!['idle', 'action', 'restored'].includes(name) && !/^flip-(old|new)-\d+$/.test(name)) throw new Error('Invalid capture');
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(output, `${name}.png`), img.toPNG());
});
app.whenReady().then(async () => {
    win = new BrowserWindow({ width: 1000, height: 1000, show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => {
        log(message);
        if (level >= 3) errors.push(message);
    });
    try {
        const html = path.join(output, 'test.html');
        fs.writeFileSync(html, `<style>body{margin:0;background:#e6ebf2}canvas{position:fixed;inset:0}</style>
            <div id="vrm-container"><canvas id="vrm-canvas"></canvas></div><div id="live2d-container"></div>
            <div id="mmd-container"></div><div id="model-controls" style="display:none"></div>`);
        fs.appendFileSync(html, '<canvas id="mmd-canvas"></canvas>');
        await win.loadFile(html);
        const result = await win.webContents.executeJavaScript(`(${rendererTest.toString()})(${JSON.stringify(root)}, ${JSON.stringify(output)}, ${JSON.stringify(process.argv[2] || 'raise left hand')}, ${JSON.stringify(process.argv[3] || '')}, ${JSON.stringify(process.argv[4] || 'vrm')})`);
        if (errors.length) throw new Error(errors.join('\n'));
        log(JSON.stringify({ success: true, ...result, output }));
        app.exit(0);
    } catch (error) { fail(error); }
});
setTimeout(() => fail(new Error('Runtime test timed out')), 180000);

async function rendererTest(root, output, actionName, motionFile, modelType) {
    const assert = require('assert/strict');
    const fs = require('fs');
    const path = require('path');
    const THREE = require(path.join(root, 'node_modules/three'));
    const { getBodyPlayer } = require(path.join(root, 'plugins/community/body-actions/runtime-hooks'));
    const { ipcRenderer } = require('electron');
    require.cache[require.resolve(path.join(root, 'js/api-utils.js'))] = {
        exports: { logToTerminal: (_level, text) => console.log(text) }
    };
    const { scanVRMModels, scanMMDModels } = require(path.join(root, 'js/avatar/model-registry'));
    const models = modelType === 'mmd' ? scanMMDModels() : scanVRMModels();
    const selected = models.find(m => m.name.startsWith('Q')) || models[0];
    assert(selected, 'No 3D model found');
    const { avatarFacade } = require(path.join(root, 'js/avatar/avatar-facade'));
    const { registerBuiltinDrivers } = require(path.join(root, 'js/avatar/drivers'));
    registerBuiltinDrivers();
    const config = { ui: { model_type: modelType, vrm_model_path: selected.modelPath, mmd_model_path: selected.modelPath, model_scale: 0.65,
        live2d_gaze_tracking: false, model_position: { x: 0.75, y: 0.62, remember_position: true, bounce_back: false } },
        vmc: { enabled: false } };
    const state = await avatarFacade.init(modelType, { config, ttsEnabled: false, asrEnabled: false, ttsProcessor: null, voiceChat: null });
    const { model, manager } = state;
    // Exercise the compatibility entry used by deployments without a ready facade.
    delete global.avatarFacade;
    delete window.avatar;
    const frame = () => new Promise(requestAnimationFrame);
    await frame(); await frame();
    manager.stopLoop();
    await ipcRenderer.invoke('body-actions-test:capture', 'idle');
    const BodyActionsPlugin = require(path.join(root, 'plugins/community/body-actions'));
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'plugins/community/body-actions/plugin_config.json'), 'utf8'));
    const pluginConfig = Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, v.value ?? v.default]));
    const handlers = new Map();
    const context = { getPluginConfig: () => pluginConfig, on: (name, handler) => handlers.set(name, handler),
        off: name => handlers.delete(name), log: (level, text) => console.log(`[${level}] ${text}`) };
    const plugin = new BodyActionsPlugin({}, context);
    await plugin.onInit();
    try {
        if (motionFile) plugin.cache.set(actionName.toLowerCase(), JSON.parse(fs.readFileSync(motionFile, 'utf8')));
        else {
            await plugin.onStart();
            await plugin.service.ensureReady();
        }
        const request = { messages: [{ role: 'system', content: 'Test character' }] };
        await plugin.onLLMRequest(request);
        assert(!('deferTTSUntilResponse' in request));
        assert(request.messages[1].content.includes('[raise left hand]'));
        const response = { text: `你好！[${actionName}] 看这个动作。[wave right hand and bow]` };
        await plugin.onLLMResponse(response);
        assert.equal(response.text, '你好！ 看这个动作。');
        const started = performance.now();
        let workDone = false;
        plugin.work.finally(() => { workDone = true; });
        while (!plugin.player?.active && performance.now() - started < plugin.service.timeout + 5000) {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (workDone && !plugin.player?.active) break;
        }
        assert(plugin.player?.active, 'Generated action did not start; see service logs');
        const data = plugin.cache.get(actionName.toLowerCase());
        assert(data, 'No real Motion motion was cached');
        fs.writeFileSync(path.join(output, 'motion.json'), JSON.stringify(data));
        const baseline = plugin.player.original.leftUpperArm.quaternion.clone();
        const flip = actionName.toLowerCase() === 'backflip';
        const best = data.joints.reduce((best, joints, index, all) => flip
            ? joints[15][1] - joints[0][1] < all[best][15][1] - all[best][0][1] ? index : best
            : joints[20][1] - joints[0][1] > all[best][20][1] - all[best][0][1] ? index : best, 0);
        plugin.player.elapsed = plugin.player.blend + best / data.fps;
        model.update(0);
        assert(getBodyPlayer(model) === plugin.player);
        if (modelType === 'mmd') {
            const retarget = plugin.player.retarget;
            let invertedSource = 0, invertedModel = 0;
            for (let i = 0; i < data.joints.length; i++) {
                retarget.apply(data.joints[i]);
                if (data.joints[i][15][1] < data.joints[i][0][1]) {
                    invertedSource++;
                    if (retarget.bones.head.getWorldPosition(new THREE.Vector3()).y < retarget.bones.hips.getWorldPosition(new THREE.Vector3()).y) invertedModel++;
                }
                for (const side of ['左', '右']) for (const part of ['足', 'ひざ', '足首']) {
                    const source = model.mesh.skeleton.bones.find(bone => bone.name === side + part);
                    const deform = model.mesh.skeleton.bones.find(bone => bone.name === side + part + 'D');
                    if (!source || !deform) continue;
                    assert(source.getWorldQuaternion(new THREE.Quaternion()).angleTo(deform.getWorldQuaternion(new THREE.Quaternion())) < 1e-6,
                        `Deform leg differs from motion leg: ${side + part}, frame ${i}`);
                }
                for (const [name, child] of [['leftUpperArm', 'leftLowerArm'], ['rightUpperArm', 'rightLowerArm'], ['leftLowerLeg', 'leftFoot'], ['rightLowerLeg', 'rightFoot']]) {
                    const direction = (a, b) => b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize();
                    assert(direction(retarget.bones[name], retarget.bones[child]).dot(direction(retarget.core.bones[name], retarget.core.bones[child])) > 0.999,
                        `PMX limb diverges from proxy: ${name}, frame ${i}`);
                }
            }
            assert(invertedModel >= invertedSource * 0.8, 'PMX torso did not follow inverted motion');
            model.update(0);
        }
        const upper = model.vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        if (!flip) assert(baseline.angleTo(upper.quaternion) > 0.1, 'Motion did not change the left arm');
        // Idle and gaze must not overwrite body motion; mouth remains independent.
        const rotation = upper.quaternion.clone();
        model.update(0);
        assert(rotation.angleTo(upper.quaternion) < 0.001);
        avatarFacade.setMouth(0.7);
        if (modelType === 'mmd') assert(model.mesh.morphTargetInfluences.some(value => value > 0.5), 'PMX mouth lost control');
        else assert(model.vrm.expressionManager.getValue('aa') > 0.5, 'Mouth lost control during body motion');
        avatarFacade.setMouth(0);
        manager.startLoop(); manager.stopLoop();
        await ipcRenderer.invoke('body-actions-test:capture', 'action');
        const actionPose = {
            left: model.vrm.humanoid.getNormalizedBoneNode('leftHand').getWorldPosition(new THREE.Vector3()).toArray(),
            right: model.vrm.humanoid.getNormalizedBoneNode('rightHand').getWorldPosition(new THREE.Vector3()).toArray()
        };
        let cameraCheck;
        if (flip) {
            const player = plugin.player;
            const cameraTarget = player.getCameraTarget;
            const pelvis = model.vrm.humanoid.getNormalizedBoneNode('hips');
            const grid = new THREE.GridHelper(2, 10, 0x8996a5, 0xc1cad5);
            grid.position.y = player.retarget.floor;
            manager.scene.add(grid);
            const oldY = [], newY = [], pelvisY = [];
            const apex = data.joints.reduce((best, joints, i, all) => joints[0][1] > all[best][0][1] ? i : best, 0);
            const snapshots = new Set([0, apex, best, data.joints.length - 2]);
            const draw = () => {
                const r = manager.renderer, vr = model.viewRect;
                r.setScissorTest(false); r.setViewport(0, 0, window.innerWidth, window.innerHeight); r.clear(true, true, true);
                r.setViewport(vr.x, window.innerHeight - vr.y - vr.height, vr.width, vr.height);
                r.setScissor(vr.x, window.innerHeight - vr.y - vr.height, vr.width, vr.height); r.setScissorTest(true);
                manager.camera.aspect = vr.width / vr.height; manager.camera.updateProjectionMatrix();
                model.updateCameraOrbit(); manager.renderScene();
            };
            for (let i = 0; i < data.joints.length; i++) {
                player.elapsed = player.blend + i / data.fps;
                model.update(0);
                pelvisY.push(pelvis.getWorldPosition(new THREE.Vector3()).y);
                // Render the old behavior and fixed behavior using the same pose.
                player.getCameraTarget = () => pelvis.getWorldPosition(new THREE.Vector3());
                draw(); oldY.push(manager.camera.position.y);
                if (snapshots.has(i)) {
                    await frame(); draw(); await frame();
                    await ipcRenderer.invoke('body-actions-test:capture', `flip-old-${i}`);
                }
                player.getCameraTarget = cameraTarget;
                draw(); newY.push(manager.camera.position.y);
                if (snapshots.has(i)) {
                    await frame(); draw(); await frame();
                    await ipcRenderer.invoke('body-actions-test:capture', `flip-new-${i}`);
                }
            }
            const range = values => Math.max(...values) - Math.min(...values);
            assert(range(pelvisY) > 0.01, 'Generated clip has no vertical motion for this camera regression');
            assert(range(newY) < 1e-6, 'Camera is still cancelling vertical motion');
            assert(range(oldY) > 0.01, 'Old camera behavior was not reproduced');
            cameraCheck = { oldCameraHeightRange: range(oldY), newCameraHeightRange: range(newY),
                pelvisHeightRange: range(pelvisY), invertedSourceFrames: data.joints.filter(f => f[15][1] < f[0][1]).length,
                snapshots: [...snapshots] };
            manager.scene.remove(grid); grid.geometry.dispose(); grid.material.dispose();
        }
        // Finish manually through the same update loop used by the desktop.
        let guard = 0;
        while (plugin.player.active && guard++ < 1200) model.update(1 / 20);
        assert(!plugin.player.active, 'Body player did not finish');
        await plugin.work;
        assert(!getBodyPlayer(model), 'Idle ownership not released');
        assert(baseline.angleTo(upper.quaternion) < 0.001, 'Original pose not restored');
        manager.startLoop(); manager.stopLoop();
        await ipcRenderer.invoke('body-actions-test:capture', 'restored');
        // Cached replay must cancel immediately on the actual interrupt hook.
        await plugin.onLLMResponse({ text: `[${actionName}]` });
        assert(plugin.player.active);
        handlers.get('tts:interrupted')();
        await plugin.work;
        assert(!getBodyPlayer(model));
        assert.equal(manager._frameErrorCount, 0);
        return { model: selected.name, fps: data.fps, frames: data.joints.length,
            generationSeconds: data.generation_seconds, actionPose, cameraCheck,
            checks: [motionFile ? 'recorded motion playback' : 'real inference', 'single-action rejection', 'tag filtering', 'prompt injection',
                'body ownership', 'mouth during motion', 'pose restore', 'interrupt'] };
    } finally {
        await plugin.onStop();
        await manager.dispose();
    }
}
