// Run: node_modules/electron/dist/electron.exe scripts/test-pmx-runtime.cjs
// Uses an isolated hidden Electron window; does not read/write config.json.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'feiniu-pmx-test-'));
const logPath = path.join(output, 'result.log');
for (const name of ['log', 'error']) {
    console[name] = (...args) => {
        fs.appendFileSync(logPath, args.map(String).join(' ') + '\n');
    };
}
console.log(`Test output: ${output}`);
const fail = error => { console.error(error?.stack || error); app.exit(1); };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
require('electron').dialog.showErrorBox = (title, content) => fail(new Error(`${title}: ${content}`));
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
ipcMain.handle('avatar-runtime-ready', () => ({ success: true }));
app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1000, height: 900, show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 3) errors.push(message);
        console.log(message);
    });
    try {
        const htmlPath = path.join(output, 'test.html');
        fs.writeFileSync(htmlPath, `
            <style>body{margin:0;background:#dce4ed}canvas{position:fixed;inset:0}#model-controls{display:none}</style>
            <div id="mmd-container"><canvas id="mmd-canvas"></canvas></div>
            <div id="live2d-container"></div><div id="vrm-container"></div>
            <div id="model-controls"><button id="btn-toggle-vmc"></button><button id="btn-toggle-render"></button></div>
            <p id="subtitle-text"></p>`);
        await win.loadFile(htmlPath);
        const result = await win.webContents.executeJavaScript(`(${rendererTest.toString()})(${JSON.stringify(root)})`);
        await win.webContents.capturePage().then(img => {
            fs.writeFileSync(path.join(output, 'pmx.png'), img.toPNG());
            const scale = img.getSize().width / result.viewport.width;
            const face = result.face;
            if (face) {
                fs.writeFileSync(path.join(output, 'face.png'), img.crop({
                    x: Math.max(0, Math.round((face.x - 55) * scale)),
                    y: Math.max(0, Math.round((face.y - 100) * scale)),
                    width: Math.round(110 * scale), height: Math.round(120 * scale)
                }).toPNG());
            }
        });
        await win.webContents.executeJavaScript(`(async () => {
            const { model, manager } = global.__pmxTestState;
            const THREE = require(${JSON.stringify(path.join(root, 'node_modules/three'))});
            const head = model.vrm.humanoid.getNormalizedBoneNode('head').getWorldPosition(new THREE.Vector3());
            const hips = model.vrm.humanoid.getNormalizedBoneNode('hips').getWorldPosition(new THREE.Vector3());
            model._orbitYOffset = head.y - hips.y - 0.06;
            model._orbitDistance = 0.65;
            model.viewRect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
            await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        })()`);
        await win.webContents.capturePage().then(img => fs.writeFileSync(path.join(output, 'portrait.png'), img.toPNG()));
        if (errors.length) throw new Error(errors.join('\n'));
        console.log(JSON.stringify({ success: true, ...result, screenshot: path.join(output, 'pmx.png') }));
        app.exit(0);
    } catch (error) {
        await win.webContents.capturePage().then(img => fs.writeFileSync(path.join(output, 'failure.png'), img.toPNG())).catch(() => {});
        console.error(error.stack);
        app.exit(1);
    }
});
setTimeout(() => { console.error('PMX runtime test timed out'); app.exit(1); }, 60000);

async function rendererTest(root) {
    const assert = require('assert/strict');
    const path = require('path');
    // Avoid test logs entering the user's runtime.log.
    require.cache[require.resolve(path.join(root, 'js/api-utils.js'))] = {
        exports: { logToTerminal: (level, text) => console.log(text) }
    };
    const { scanMMDModels } = require(path.join(root, 'js/avatar/model-registry'));
    const selected = scanMMDModels()[0];
    assert(selected, 'No PMX model folder found');
    const { TTSPlaybackEngine } = require(path.join(root, 'js/voice/tts-playback-engine'));
    const playback = new TTSPlaybackEngine({ ui: { text_only_mode: true } });
    const ttsProcessor = { playbackEngine: playback,
        setEmotionMapper: mapper => playback.setEmotionMapper(mapper),
        setExpressionMapper: mapper => playback.setExpressionMapper(mapper) };
    const { registerBuiltinDrivers } = require(path.join(root, 'js/avatar/drivers'));
    const { avatarFacade } = require(path.join(root, 'js/avatar/avatar-facade'));
    registerBuiltinDrivers();
    const config = { ui: { model_type: 'mmd', mmd_model_path: selected.modelPath,
        model_scale: 0.7, model_position: { x: 0.8, y: 0.6, remember_position: true, bounce_back: false } } };
    const state = await avatarFacade.init('mmd', { config, ttsEnabled: true, asrEnabled: false, ttsProcessor, voiceChat: null });
    const { model, manager, vrmController: controller } = state;
    assert(model.mouthAvailable, 'Model lacks a supported mouth morph');
    assert.equal(global.currentCharacterName, selected.name);
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await frame(); await frame();
    model.updateCameraOrbit();
    const hit = model.getScreenHitBox();
    const x = hit.x + hit.width / 2, y = hit.y + hit.height / 2;
    assert(model.isPointOverModel(x, y));
    const canvas = manager.canvas;
    const start = { ...model.viewRect };
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0 }));
    assert(controller.isDragging, 'Drag failed to start');
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 35, clientY: y + 20 }));
    assert.equal(model.viewRect.x, start.x + 35);
    assert.equal(model.viewRect.y, start.y + 20);
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 35, clientY: y + 20, button: 0 }));
    assert(!controller.isDragging);
    const width = model.viewRect.width;
    canvas.dispatchEvent(new WheelEvent('wheel', { clientX: x + 35, clientY: y + 20, deltaY: -100, cancelable: true, bubbles: true }));
    assert(model.viewRect.width > width, 'Scroll zoom failed');
    const mouthIndex = model.mesh.morphTargetDictionary['あ'];
    avatarFacade.setMouth(1);
    assert(model.mesh.morphTargetInfluences[mouthIndex] > 0.9);
    avatarFacade.setMouth(0);
    assert.equal(model.mesh.morphTargetInfluences[mouthIndex], 0);

    // Exercise the actual TTS WebAudio analyser -> facade -> PMX morph chain.
    const rate = 22050, count = rate * 3;
    const wav = new ArrayBuffer(44 + count * 2), view = new DataView(wav);
    const str = (offset, text) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++) view.setInt16(44 + i * 2,
        i > count * 0.1 && i < count * 0.9 ? Math.sin(i * 2 * Math.PI * 220 / rate) * 20000 : 0, true);
    let maximum = 0;
    const callback = playback.onAudioDataCallback;
    playback.onAudioDataCallback = value => { callback(value); maximum = Math.max(maximum, model.mesh.morphTargetInfluences[mouthIndex]); };
    const audioResult = await playback.playAudio(new Blob([wav], { type: 'audio/wav' }), 'PMX audio test');
    assert(!audioResult?.error, 'Audio playback failed');
    assert(maximum > 0.05, 'Audio analyser did not open the mouth');
    assert.equal(model.mesh.morphTargetInfluences[mouthIndex], 0, 'Mouth did not close after audio');
    const reload = await avatarFacade.reloadActiveModel();
    assert(reload.success, reload.message);
    assert(model._disposed, 'Old model not disposed on reload');
    await frame(); await frame();
    const renderer = manager.renderer;
    assert.equal(manager._frameErrorCount, 0);
    assert(renderer.info.render.triangles > 0, 'No geometry rendered');
    assert(renderer.info.programs.every(program => program.diagnostics?.runnable !== false), 'Shader compilation failed');
    const activeModel = avatarFacade.getModel();
    global.__pmxTestState = { model: activeModel, manager };
    for (const material of activeModel.mesh.material) {
        if (material.map) assert.equal(material.map.colorSpace, 'srgb');
        if (material.gradientMap) assert.equal(material.gradientMap.colorSpace, '');
        assert(material.isMeshToonMaterial || material.isMeshBasicMaterial, 'Unexpected specular PMX material');
    }
    return { model: selected.name, triangles: renderer.info.render.triangles, maxAudioMouth: maximum,
        viewport: { width: window.innerWidth, height: window.innerHeight }, face: activeModel._getHeadScreenPos(),
        checks: ['textures', 'render', 'drag', 'zoom', 'audio mouth', 'close mouth', 'reload'] };
}
