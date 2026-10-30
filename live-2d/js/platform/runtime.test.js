const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { isWayland, linuxDisplayMode, projectPython, spawnManaged, stopManaged } = require('./runtime');
const { captureScreen } = require('./screen-capture');

test('Wayland sessions select XWayland overlays when available and a native window otherwise', () => {
    assert.equal(isWayland({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), true);
    assert.equal(isWayland({ XDG_SESSION_TYPE: 'wayland' }, 'win32'), false);
    assert.equal(linuxDisplayMode({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }), 'x11');
    assert.equal(linuxDisplayMode({ WAYLAND_DISPLAY: 'wayland-0' }), 'wayland');
    assert.equal(linuxDisplayMode({ DISPLAY: ':0', MY_NEURO_DISPLAY_MODE: 'wayland' }), 'wayland');
    assert.throws(() => linuxDisplayMode({ MY_NEURO_DISPLAY_MODE: 'x11' }), /XWayland/);
    assert.throws(() => linuxDisplayMode({ MY_NEURO_DISPLAY_MODE: 'invalid' }), /must be/);
});

test('Python selects platform environment or explicit interpreter', () => {
    assert.equal(projectPython('/project', {}, 'linux'), path.join('/project', 'env/bin/python'));
    assert.equal(projectPython('/project', {}, 'win32'), path.join('/project', 'env/python.exe'));
    assert.equal(projectPython('/project', { MY_NEURO_PYTHON: '/venv/bin/python' }), '/venv/bin/python');
});

test('Wayland capture respects portal cancellation and never queries X11 cursor/screens', async () => {
    const thumbnail = { isEmpty: () => false };
    const desktopCapturer = { getSources: async options => {
        assert.deepEqual(options.types, ['screen']); return [{ thumbnail }];
    } };
    assert.equal(await captureScreen({ wayland: true, desktopCapturer }), thumbnail);
    await assert.rejects(captureScreen({ wayland: true, desktopCapturer: { getSources: async () => [] } }), /取消/);
    await assert.rejects(captureScreen({ wayland: true, desktopCapturer: { getSources: async () => { throw new Error('denied'); } } }), /denied/);
});

test('X11 capture matches the cursor display after sorting monitor positions', async () => {
    const screenshot = async options => { assert.equal(options.screen, 'right'); return Buffer.from('jpeg'); };
    screenshot.listDisplays = async () => [{ id: 'right', left: 0 }, { id: 'left', left: -100 }];
    const screen = {
        getCursorScreenPoint: () => ({ x: 10, y: 10 }),
        getDisplayNearestPoint: () => ({ id: 2 }),
        getAllDisplays: () => [{ id: 2, bounds: { x: 0 } }, { id: 1, bounds: { x: -100 } }]
    };
    assert.equal((await captureScreen({ wayland: false, screen, screenshot })).toString(), 'jpeg');
});

test('Linux stop terminates the owned process group and leaves unrelated processes alive', { skip: process.platform === 'win32' }, async t => {
    const child = spawnManaged(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const unrelated = spawnManaged(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    t.after(async () => { await stopManaged(child); await stopManaged(unrelated); });
    await Promise.all([once(child, 'spawn'), once(unrelated, 'spawn')]);
    await stopManaged(child);
    assert.equal(child.signalCode, 'SIGTERM');
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
    await stopManaged(child);
});
