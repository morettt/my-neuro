'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const NekoCompatHubPlugin = require('../index.js');

function fakeContext(pluginDir) {
    const tools = [];
    return {
        _pluginDir: pluginDir,
        _pluginName: 'neko_compat_hub',
        _pluginManager: { _dynamicTools: new Map() },
        logs: [],
        getPluginConfig() {
            const raw = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin_config.json'), 'utf8'));
            const flat = {};
            for (const [key, def] of Object.entries(raw)) {
                flat[key] = def && typeof def === 'object' && 'value' in def ? def.value : def;
            }
            return flat;
        },
        log(level, message) { this.logs.push({ level, message }); },
        registerTool(tool) { tools.push(tool); },
        pauseHotReloadFor() {},
        resumeHotReloadFor() {},
        tools
    };
}

function makeTempHub(overrides = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-hub-'));
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin_config.json'), 'utf8'));
    cfg.enabled.value = false;
    cfg.runtime_checkout_path.value = '';
    for (const [key, value] of Object.entries(overrides)) {
        if (cfg[key] && typeof cfg[key] === 'object' && 'value' in cfg[key]) {
            cfg[key].value = value;
        }
    }
    fs.writeFileSync(path.join(dir, 'plugin_config.json'), JSON.stringify(cfg, null, 2));
    return dir;
}

test('onInit / onStart 在未启用时不启动进程、不注册工具', async () => {
    const dir = makeTempHub();
    const context = fakeContext(dir);
    const plugin = new NekoCompatHubPlugin({ name: 'neko-compat-hub' }, context);
    await plugin.onInit();
    await plugin.onStart();
    assert.equal(plugin.getTools().length, 0);
    assert.equal(plugin._state, 'idle');
    assert.equal(plugin._runtime, null);
    await plugin.onStop();
});

test('默认不勾选任何 Steam 套装', async () => {
    const { STEAM_OFFICIAL_PACKS } = require('../lib/steam-official-packs.js');
    const dir = makeTempHub();
    const context = fakeContext(dir);
    const plugin = new NekoCompatHubPlugin({ name: 'neko-compat-hub' }, context);
    plugin._readConfig();
    for (const pack of STEAM_OFFICIAL_PACKS) {
        assert.equal(plugin._cfg[pack.field], false, pack.field);
    }
    await plugin.onStop();
});

test('enabled 但 checkout 为空时仍惰性', async () => {
    const dir = makeTempHub({ enabled: true, runtime_checkout_path: '' });
    const context = fakeContext(dir);
    const plugin = new NekoCompatHubPlugin({ name: 'neko-compat-hub' }, context);
    await plugin.onInit();
    await plugin.onStart();
    assert.equal(plugin.getTools().length, 0);
    assert.equal(plugin._runtime, null);
    await plugin.onStop();
});
