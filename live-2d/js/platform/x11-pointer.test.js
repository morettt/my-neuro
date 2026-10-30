const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { startX11PointerPolling } = require('./x11-pointer');

test('ignored X11 windows receive DIP cursor positions, refresh stationary hit tests, and stop on close', () => {
    const win = new EventEmitter();
    let destroyed = false, visible = true, time = 0, tick, cleared = 0;
    const messages = [];
    win.isDestroyed = () => destroyed;
    win.isVisible = () => visible;
    win.getContentBounds = () => ({ x: -100, y: 50, width: 1600, height: 900 });
    win.webContents = { isDestroyed: () => false, isLoadingMainFrame: () => false,
        send: (name, point) => messages.push({ name, ...point }) };
    let cursor = { x: -50, y: 100 };
    const stop = startX11PointerPolling(win, { getCursorScreenPoint: () => cursor }, {
        setIntervalFn: (callback, interval) => { tick = callback; assert.equal(interval, 33); return 123; },
        clearIntervalFn: id => { assert.equal(id, 123); cleared++; }, now: () => time
    });
    tick();
    assert.deepEqual(messages[0], { name: 'linux-pointer-position', clientX: 50, clientY: 50, screenX: -50, screenY: 100 });
    time = 100; tick(); assert.equal(messages.length, 1);
    cursor = { x: -40, y: 110 }; tick(); assert.equal(messages.length, 2);
    time = 400; tick(); assert.equal(messages.length, 3);
    visible = false; time = 800; tick(); assert.equal(messages.length, 3);
    destroyed = true; tick(); assert.equal(messages.length, 3);
    win.emit('closed'); stop(); assert.equal(cleared, 1);
});

function uiHarness() {
    const calls = [];
    const controller = { isPointOverInteractive: (x, y) => x >= 100 && x <= 200 && y >= 100 && y <= 200 };
    let overUI = false;
    const context = { module: { exports: {} }, window: {}, global: {
        currentModel: {}, avatarFacade: { getController: () => controller, getModel: () => ({}) }
    }, document: {
        elementFromPoint: () => overUI ? { closest: () => true } : null,
        addEventListener: () => {}
    }, require: name => name === 'electron'
        ? { ipcRenderer: { send: (_channel, payload) => calls.push(payload.ignore) } }
        : { logToTerminal: () => {} } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/ui-controller.js'), 'utf8'), context);
    const ui = new context.module.exports.UIController({});
    ui.setupMouseIgnore();
    return { ui, calls, controller, setOverUI: value => { overUI = value; } };
}

test('Linux samples restore clicks over models/UI and release blank desktop input', () => {
    const { ui, calls, setOverUI } = uiHarness();
    ui.updateMouseIgnore({ clientX: 10, clientY: 10 });
    ui.updateMouseIgnore({ clientX: 150, clientY: 150 });
    setOverUI(true);
    ui.updateMouseIgnore({ clientX: 10, clientY: 10 });
    assert.deepEqual(calls, [true, false, false]);
});

test('left drag, right orbit and chat dragging retain mouse-up outside the hit box', () => {
    const { ui, calls, controller } = uiHarness();
    for (const key of ['isDragging', 'isRightDragging', 'isDraggingChat']) {
        controller[key] = true;
        ui.updateMouseIgnore({ clientX: 10, clientY: 10 });
        controller[key] = false;
    }
    ui.updateMouseIgnore({ clientX: 10, clientY: 10 });
    assert.deepEqual(calls, [false, false, false, true]);
});
