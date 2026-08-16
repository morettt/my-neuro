'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PluginContext } = require('../../../../js/core/plugin-context.js');
const { PluginManager } = require('../../../../js/core/plugin-manager.js');
const NekoCompatHubPlugin = require('../index.js');

const pluginDir = path.resolve(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(pluginDir, 'metadata.json'), 'utf8'));

test('upstream host can load and unload a disabled Hub without starting Runtime', async (t) => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-hub-host-contract-'));
    t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
    fs.copyFileSync(
        path.join(pluginDir, 'plugin_config.json'),
        path.join(configDir, 'plugin_config.json')
    );

    const manager = new PluginManager({});
    const context = new PluginContext('neko_compat_hub', {}, manager, configDir);
    assert.equal(typeof context.getPluginConfig, 'function');
    assert.equal(typeof context.registerTool, 'function');

    const plugin = new NekoCompatHubPlugin(metadata, context);
    await plugin.onInit();
    await plugin.onStart();

    assert.equal(plugin._state, 'idle');
    assert.equal(plugin._runtime, null);
    assert.equal(plugin.getTools().length, 0);

    context.registerTool({
        name: 'neko__host_contract__probe',
        function: {
            name: 'neko__host_contract__probe',
            description: 'Host contract probe',
            parameters: { type: 'object', properties: {} }
        }
    });
    assert.equal(manager._dynamicTools.get('neko_compat_hub').length, 1);

    await plugin.onStop();
    assert.deepEqual(manager._dynamicTools.get('neko_compat_hub'), []);
    await plugin.onDestroy();
});
