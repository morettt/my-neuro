'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LocalClient } = require('../lib/local-client.js');
const { discoverPlugins, activatePluginCatalog, normalizePlugin } = require('../lib/plugin-discovery.js');
const { createFakeRuntime } = require('./helpers/fake-runtime.js');

test('GET /plugins 条目缺 timeout 时按上游默认 30 秒补齐', () => {
    const plugin = normalizePlugin({
        id: 'web_search',
        type: 'plugin',
        entries: [{ id: 'search', name: '搜索' }]
    });
    assert.equal(plugin.entries[0].timeout, 30);
});

test('activatePluginCatalog：refresh 后才出现插件', async () => {
    const runtime = await createFakeRuntime({ emptyUntilRefresh: true });
    const client = new LocalClient({ port: runtime.port, timeoutMs: 3000 });
    try {
        const before = await discoverPlugins(client);
        assert.equal(before.pluginCount, 0);
        const activated = await activatePluginCatalog(client, { timeoutMs: 5000, pollIntervalMs: 50 });
        assert.ok(activated.pluginCount >= 1);
        assert.equal(activated.plugins[0].id, 'web_search');
    } finally {
        await runtime.close();
    }
});

test('activatePluginCatalog：会请求 Agent flags 且不持久化意图', async () => {
    const runtime = await createFakeRuntime({ emptyUntilRefresh: true });
    const client = new LocalClient({ port: runtime.port, timeoutMs: 3000 });
    try {
        await activatePluginCatalog(client, {
            agentClient: client,
            timeoutMs: 5000,
            pollIntervalMs: 50
        });
        assert.equal(runtime.state.flags.user_plugin_enabled, true);
        assert.equal(runtime.state.flags._persist_intent, false);
    } finally {
        await runtime.close();
    }
});
