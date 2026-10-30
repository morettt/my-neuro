const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { isWayland, linuxDisplayMode, projectPython, spawnManaged, stopManaged } = require('./runtime');
const { captureScreen } = require('./screen-capture');

test('desktop overlays stay the default and incomplete native windows require explicit selection', () => {
    assert.equal(isWayland({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), true);
    assert.equal(isWayland({ XDG_SESSION_TYPE: 'wayland' }, 'win32'), false);
    assert.equal(linuxDisplayMode({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }), 'x11');
    assert.equal(linuxDisplayMode({ DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }), 'x11');
    assert.equal(linuxDisplayMode({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', MY_NEURO_DISPLAY_MODE: 'x11' }), 'x11');
    assert.throws(() => linuxDisplayMode({ WAYLAND_DISPLAY: 'wayland-0' }), /desktop overlay/);
    assert.equal(linuxDisplayMode({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', MY_NEURO_DISPLAY_MODE: 'wayland' }), 'wayland');
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

test('Electron receives Ozone and GL switches before the app entry, for both control and pet', () => {
    const { electronLaunchArgs } = require('./runtime');
    const env = { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' };
    for (const entry of ['control-main.js', '.']) {
        const args = electronLaunchArgs(entry, ['--start-pet'], env, 'linux', { softwareRendering: true });
        assert.equal(args[0], '--ozone-platform=x11');
        assert.ok(args.indexOf('--use-angle=swiftshader') < args.indexOf(entry));
        assert.ok(args.includes('--enable-features=WebRTCPipeWireCapturer,GlobalShortcutsPortal'));
        assert.equal(args.at(-1), '--start-pet');
    }
    const native = electronLaunchArgs('.', [], { WAYLAND_DISPLAY: 'wayland-0', MY_NEURO_DISPLAY_MODE: 'wayland' }, 'linux', {});
    assert.equal(native[0], '--ozone-platform=wayland');
    assert.ok(!native.includes('--use-angle=swiftshader'));
    assert.deepEqual(electronLaunchArgs('.', ['--test'], {}, 'win32', {}), ['.', '--test']);
});

test('software rendering persists locally but an explicit environment override wins', t => {
    const fs = require('node:fs');
    const os = require('node:os');
    const { readLinuxSettings, softwareRendering } = require('./runtime');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuro-linux-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'settings.json');
    assert.deepEqual(readLinuxSettings(file), {});
    fs.writeFileSync(file, JSON.stringify({ softwareRendering: true }));
    assert.equal(softwareRendering({}, readLinuxSettings(file)), true);
    assert.equal(softwareRendering({ MY_NEURO_SOFTWARE_RENDERING: '0' }, readLinuxSettings(file)), false);
    assert.equal(softwareRendering({ MY_NEURO_SOFTWARE_RENDERING: '1' }, {}), true);
});

test('hardware ANGLE backend uses GL/GLES without enabling SwiftShader and supports an override', () => {
    const { electronLaunchArgs } = require('./runtime');
    const settings = { softwareRendering: false, angleBackend: 'gles' };
    const args = electronLaunchArgs('.', [], { DISPLAY: ':0' }, 'linux', settings);
    assert.ok(args.includes('--use-angle=gles'));
    assert.ok(!args.includes('--enable-unsafe-swiftshader'));
    const override = electronLaunchArgs('.', [], { DISPLAY: ':0', MY_NEURO_ANGLE_BACKEND: 'gl' }, 'linux', settings);
    assert.ok(override.includes('--use-angle=gl'));
    assert.throws(() => electronLaunchArgs('.', [], { DISPLAY: ':0', MY_NEURO_ANGLE_BACKEND: 'invalid' }, 'linux', settings), /ANGLE_BACKEND/);
});
