const test = require('node:test');
const assert = require('node:assert/strict');
const { windowScreenInfo, fitViewRect } = require('./window-layout');

test('native Wayland layout uses client dimensions instead of unknowable global coordinates', () => {
    const primaryDisplay = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5 };
    const info = windowScreenInfo({ nativeWayland: true,
        contentBounds: { x: 700, y: 300, width: 640, height: 720 }, primaryDisplay, displays: [primaryDisplay] });
    assert.deepEqual(info.primaryDisplay.bounds, { x: 0, y: 0, width: 640, height: 720 });
    assert.deepEqual(info.windowBounds, info.primaryDisplay.bounds);
    assert.equal(info.primaryDisplay.scaleFactor, 1.5);
    assert.equal(primaryDisplay.bounds.width, 1920);
});

test('X11 overlay keeps desktop coordinates for multiple monitors', () => {
    const primaryDisplay = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
    const bounds = { x: -1920, y: 0, width: 3840, height: 1080 };
    const info = windowScreenInfo({ nativeWayland: false, windowBounds: bounds, primaryDisplay, displays: [primaryDisplay] });
    assert.equal(info.windowBounds, bounds);
    assert.equal(info.primaryDisplay, primaryDisplay);
});

test('native centering fits the model hit box into the client surface without changing the source viewport', () => {
    const view = { x: -100, y: -200, width: 1000, height: 1500 };
    const hit = { x: 200, y: 200, width: 600, height: 800 };
    const next = fitViewRect(view, hit, 640, 720);
    const scale = next.width / view.width;
    const centerX = next.x + (hit.x + hit.width / 2 - view.x) * scale;
    const centerY = next.y + (hit.y + hit.height / 2 - view.y) * scale;
    assert.equal(centerX, 320);
    assert.equal(centerY, 372);
    assert.ok(hit.width * scale <= 540);
    assert.ok(hit.height * scale <= 580);
    assert.equal(view.width, 1000);
    assert.equal(fitViewRect(view, { width: 0, height: 1 }, 640, 720), null);
});

test('Linux overlay reserves the shell top bar and dock instead of covering the monitor', () => {
    const { overlayDisplayBounds, overlayTopmostLevel } = require('./window-layout');
    const display = { bounds: { x: 0, y: 0, width: 1536, height: 1024 }, workArea: { x: 0, y: 32, width: 1536, height: 944 } };
    assert.deepEqual(overlayDisplayBounds(display, 'linux'), display.workArea);
    assert.equal(overlayTopmostLevel('linux'), 'floating');
    assert.deepEqual(overlayDisplayBounds(display, 'win32'), display.bounds);
    assert.equal(overlayTopmostLevel('win32'), 'screen-saver');
});

test('Linux borderless overlays cannot exactly match a monitor, including negative-offset monitors', () => {
    const { overlayDisplayBounds } = require('./window-layout');
    const bounds = { x: -1920, y: -200, width: 1920, height: 1080 };
    assert.deepEqual(overlayDisplayBounds({ bounds, workArea: bounds }, 'linux'), { x: -1919, y: -199, width: 1918, height: 1078 });
    assert.deepEqual(overlayDisplayBounds({ bounds }, 'linux'), { x: -1919, y: -199, width: 1918, height: 1078 });
});
