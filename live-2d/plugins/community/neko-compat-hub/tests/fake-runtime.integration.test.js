'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LocalClient } = require('../lib/local-client.js');
const { discoverPlugins } = require('../lib/plugin-discovery.js');
const { classifyAll } = require('../lib/compatibility-classifier.js');
const { parseEntryList, decideExposure } = require('../lib/authorization.js');
const { registerTools } = require('../lib/tool-registry.js');
const { RunClient } = require('../lib/run-client.js');
const { normalizeExport } = require('../lib/result-normalizer.js');
const { isFixturePlugin } = require('../lib/constants.js');
const { createFakeRuntime } = require('./helpers/fake-runtime.js');

test('假 Runtime: 健康检查、发现、未知字段不崩', async () => {
    const runtime = await createFakeRuntime();
    const client = new LocalClient({ port: runtime.port, timeoutMs: 3000 });
    try {
        const health = await client.get('/health');
        assert.equal(health.status, 200);
        assert.equal(health.data.status, 'ok');
        const discovered = await discoverPlugins(client);
        assert.equal(discovered.pluginCount, 2);
        assert.equal(discovered.plugins[0].extra_unknown_field, 'keep-me');
        const rows = classifyAll(discovered.plugins, { sdkVersion: '0.1.0' });
        const search = rows.find((row) => row.plugin_id === 'web_search' && row.entry_id === 'search');
        const adapter = rows.find((row) => row.plugin_id === 'mcp_adapter');
        assert.equal(search.level, 'C2');
        assert.equal(adapter.level, 'C5');
    } finally {
        await runtime.close();
    }
});

test('假 Runtime: 正常三步闭环 + llm_result_fields 裁剪', async () => {
    const runtime = await createFakeRuntime();
    const client = new LocalClient({ port: runtime.port, timeoutMs: 3000 });
    const run = new RunClient({
        client,
        pollIntervalMs: 10,
        totalTimeoutSeconds: 5,
        maxConcurrent: 1
    });
    try {
        const result = await run.execute({ pluginId: 'web_search', entryId: 'search', args: { query: '肥牛' } });
        assert.equal(result.ok, true);
        const normalized = normalizeExport({
            items: result.items,
            pluginId: 'web_search',
            entryId: 'search',
            llmResultFields: ['summary']
        });
        assert.match(normalized.text, /hello from stub/);
        assert.doesNotMatch(normalized.text, /ignore-me/);
        assert.match(normalized.text, /来自 N\.E\.K\.O 插件/);
    } finally {
        await runtime.close();
    }
});

test('假 Runtime: run 失败', async () => {
    const runtime = await createFakeRuntime({ runBehavior: 'fail' });
    const client = new LocalClient({ port: runtime.port, timeoutMs: 3000 });
    const run = new RunClient({ client, pollIntervalMs: 10, totalTimeoutSeconds: 5 });
    try {
        const result = await run.execute({ pluginId: 'web_search', entryId: 'search', args: {} });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'run_failed');
    } finally {
        await runtime.close();
    }
});

test('假 Runtime: 超时并 cancel', async () => {
    const runtime = await createFakeRuntime({ runBehavior: 'timeout' });
    const client = new LocalClient({ port: runtime.port, timeoutMs: 3000 });
    const run = new RunClient({
        client,
        pollIntervalMs: 20,
        totalTimeoutSeconds: 1
    });
    try {
        const result = await run.execute({ pluginId: 'web_search', entryId: 'search', args: {} });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'timeout');
        assert.equal(runtime.state.canceled, result.runId);
    } finally {
        await runtime.close();
    }
});

test('假 Runtime: export 为空', async () => {
    const runtime = await createFakeRuntime({ runBehavior: 'empty-export' });
    const client = new LocalClient({ port: runtime.port, timeoutMs: 3000 });
    const run = new RunClient({ client, pollIntervalMs: 10, totalTimeoutSeconds: 5 });
    try {
        const result = await run.execute({ pluginId: 'web_search', entryId: 'search', args: {} });
        assert.equal(result.ok, true);
        assert.equal(result.items.length, 0);
        const normalized = normalizeExport({ items: result.items, pluginId: 'web_search', entryId: 'search' });
        assert.match(normalized.text, /没有可转述给主 LLM/);
        assert.equal(normalized.source, 'none');
    } finally {
        await runtime.close();
    }
});

test('假 Runtime: export 分页', async () => {
    const runtime = await createFakeRuntime({
        exportPages: [
            { after: '', items: [{ export_item_id: 'a', type: 'text', category: 'user', text: 'page-1' }], next_after: 'a' },
            { after: 'a', items: [{ export_item_id: 'b', type: 'text', category: 'user', text: 'page-2' }], next_after: null }
        ]
    });
    const client = new LocalClient({ port: runtime.port, timeoutMs: 3000 });
    const run = new RunClient({ client, pollIntervalMs: 10, totalTimeoutSeconds: 5 });
    try {
        const result = await run.execute({ pluginId: 'web_search', entryId: 'search', args: {} });
        assert.equal(result.items.length, 2);
        assert.equal(result.items[1].text, 'page-2');
    } finally {
        await runtime.close();
    }
});

test('假 Runtime: 授权映射 deny-by-default，夹具默认不暴露', async () => {
    const runtime = await createFakeRuntime();
    const client = new LocalClient({ port: runtime.port, timeoutMs: 3000 });
    try {
        const discovered = await discoverPlugins(client);
        const rows = classifyAll(discovered.plugins, { sdkVersion: '0.1.0' });
        const approved = parseEntryList('');
        const forceAllow = parseEntryList('', { allowWildcard: false });
        const exposable = rows.filter((row) => decideExposure(row, {
            approved,
            forceAllow,
            exposeFixture: false,
            isFixture: isFixturePlugin(row.plugin_id)
        }).ok);
        assert.equal(exposable.length, 0);

        const approvedOne = parseEntryList('web_search:search');
        const stillHidden = rows.filter((row) => decideExposure(row, {
            approved: approvedOne,
            forceAllow,
            exposeFixture: false,
            isFixture: isFixturePlugin(row.plugin_id)
        }).ok);
        assert.equal(stillHidden.length, 0);

        const shown = rows.filter((row) => decideExposure(row, {
            approved: approvedOne,
            forceAllow,
            exposeFixture: true,
            isFixture: isFixturePlugin(row.plugin_id)
        }).ok);
        const registered = registerTools(shown);
        assert.equal(registered.accepted.length, 1);
        assert.equal(registered.accepted[0].name, 'neko__web_search__search');
    } finally {
        await runtime.close();
    }
});
