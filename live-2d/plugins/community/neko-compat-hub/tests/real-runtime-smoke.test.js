'use strict';

const test = require('node:test');

const checkout = process.env.NEKO_HUB_CHECKOUT;
const runSmoke = Boolean(checkout) && process.env.NEKO_HUB_SMOKE === '1';
const pythonPath = process.env.NEKO_HUB_PYTHON || '';

test('真实 Runtime 冒烟：需设置 NEKO_HUB_CHECKOUT 与 NEKO_HUB_SMOKE=1 才会运行', { skip: !runSmoke }, async (t) => {
    const { runPreflight, loadRuntimeLock } = require('../lib/preflight.js');
    const { RuntimeManager } = require('../lib/runtime-manager.js');
    const { LocalClient } = require('../lib/local-client.js');
    const { discoverPlugins, activatePluginCatalog } = require('../lib/plugin-discovery.js');
    const { RunClient } = require('../lib/run-client.js');
    const { normalizeExport } = require('../lib/result-normalizer.js');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const assert = require('node:assert/strict');

    const lock = loadRuntimeLock();
    const preflight = await runPreflight({
        checkoutPath: checkout,
        pythonPath,
        preferredPort: Number(process.env.NEKO_HUB_PORT) || 48916,
        lock
    });
    assert.equal(preflight.ok, true, preflight.reason);
    t.diagnostic(`kind=${preflight.kind || (preflight.packaged ? 'packaged' : 'source')} tag=${preflight.tag} port=${preflight.port}`);

    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-hub-rt-'));
    const manager = new RuntimeManager({
        runtimeDir,
        log(level, message) { t.diagnostic(`[${level}] ${message}`); }
    });
    const started = await manager.start({
        pythonPath: preflight.pythonPath,
        pythonArgsPrefix: preflight.pythonArgsPrefix,
        checkoutPath: preflight.checkoutPath,
        entryPath: preflight.entryPath,
        port: preflight.port,
        startTimeoutSeconds: preflight.packaged ? 180 : 90,
        commit: preflight.commit,
        tag: preflight.tag,
        packaged: Boolean(preflight.packaged)
    });
    assert.equal(started.ok, true, started.reason);
    const client = new LocalClient({ port: started.port, timeoutMs: 20000 });
    try {
        const health = await client.get('/health');
        assert.equal(health.data.status, 'ok');
        const catalog = await activatePluginCatalog(client, {
            agentClient: started.agentPort
                ? new LocalClient({ port: started.agentPort, timeoutMs: 8000 })
                : null,
            timeoutMs: preflight.packaged ? 90000 : 20000,
            log: (message) => t.diagnostic(message)
        });
        t.diagnostic(`plugins=${catalog.pluginCount} entries=${catalog.entryCount} ids=${catalog.plugins.map((p) => p.id).join(',')}`);
        assert.ok(catalog.pluginCount >= 1, `GET /plugins 仍为空: ${JSON.stringify(catalog.raw)}`);
        const webSearch = catalog.plugins.find((plugin) => plugin.id === 'web_search');
        assert.ok(webSearch, `未发现 web_search。已发现: ${catalog.plugins.map((p) => p.id).join(', ')}`);

        await client.post('/plugin/web_search/start');
        const run = new RunClient({
            client,
            pollIntervalMs: 400,
            totalTimeoutSeconds: 60,
            maxConcurrent: 1
        });
        let success = 0;
        for (let i = 0; i < 10; i += 1) {
            const result = await run.execute({
                pluginId: 'web_search',
                entryId: 'search',
                args: { query: 'N.E.K.O plugin server' }
            });
            if (!result.ok) {
                t.diagnostic(`run ${i + 1} failed: ${result.reason} ${JSON.stringify(result.error || {})}`);
                continue;
            }
            const normalized = normalizeExport({
                items: result.items,
                pluginId: 'web_search',
                entryId: 'search',
                llmResultFields: ['summary']
            });
            t.diagnostic(`run ${i + 1} usedItems=${normalized.usedItems} source=${normalized.source} textLen=${normalized.text.length}`);
            if (normalized.usedItems === 0) {
                t.diagnostic(`run ${i + 1} items=${JSON.stringify(result.items).slice(0, 1500)}`);
            }
            assert.match(normalized.text, /来自 N\.E\.K\.O 插件/);
            assert.ok(normalized.usedItems > 0, '空 ExportItem 不能算成功');
            assert.doesNotMatch(normalized.text, /没有可转述给主 LLM/);
            success += 1;
        }
        t.diagnostic(`smoke success ${success}/10`);
        assert.ok(success >= 8, `真实 Runtime 成功率 ${success}/10 低于 8`);
    } finally {
        await manager.stop();
        assert.equal(manager.getState().pid, null);
    }
});
