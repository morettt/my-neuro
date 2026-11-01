const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function controller(width, height, ui = {}, platform = 'linux') {
    const messages = [];
    const context = { module: { exports: {} }, process: { platform },
        window: { innerWidth: width, innerHeight: height },
        require: () => ({ ipcRenderer: { send: (...args) => messages.push(args) } }) };
    vm.runInNewContext(fs.readFileSync(require.resolve('./interaction'), 'utf8'), context);
    const result = new context.module.exports.VRMInteractionController();
    result.config = { ui: { model_scale: 0.6932977,
        model_position: { x: 1, y: 0.8, remember_position: true }, ...ui } };
    result.model = { viewRect: {} };
    return { result, messages };
}

test('Linux migrates the shared Live2D scale to a usable VRM desktop size', () => {
    const { result, messages } = controller(1920, 1048);
    result.setupInitialModelProperties();
    assert.equal(result.model.viewRect.width, 420);
    assert.equal(result.model.viewRect.height, 630);
    assert.equal(messages[0][1].vrmViewportWidth, 420);
});

test('VRM size survives native Wayland to XWayland and multi-monitor restarts', () => {
    const native = controller(640, 720).result;
    native.setupInitialModelProperties();
    const savedWidth = native.config.ui.vrm_viewport_width;
    for (const width of [1920, 3840, 640]) {
        const next = controller(width, 1048, { vrm_viewport_width: savedWidth }).result;
        next.setupInitialModelProperties();
        assert.ok(Math.abs(next.model.viewRect.width - savedWidth) < 1e-9);
    }
});

test('explicit VRM zoom remains intact and Windows keeps its existing scale', () => {
    const zoomed = controller(1920, 1080, { vrm_viewport_width: 700 }).result;
    zoomed.setupInitialModelProperties();
    assert.ok(Math.abs(zoomed.model.viewRect.width - 700) < 1e-9);
    const windows = controller(1920, 1080, {}, 'win32').result;
    windows.setupInitialModelProperties();
    assert.equal(windows.model.viewRect.width, 0.6932977 * 0.896 * 1920);
});
