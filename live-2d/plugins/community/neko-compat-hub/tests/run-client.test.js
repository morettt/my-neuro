'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RunClient, isTerminalStatus } = require('../lib/run-client.js');

test('七种 RunStatus 的终态判定', () => {
    assert.equal(isTerminalStatus('queued'), false);
    assert.equal(isTerminalStatus('running'), false);
    assert.equal(isTerminalStatus('cancel_requested'), false);
    assert.equal(isTerminalStatus('succeeded'), true);
    assert.equal(isTerminalStatus('failed'), true);
    assert.equal(isTerminalStatus('canceled'), true);
    assert.equal(isTerminalStatus('timeout'), true);
});

function mockClient(script) {
    const calls = [];
    return {
        calls,
        async post(path, body) {
            calls.push({ method: 'POST', path, body });
            if (path === '/runs') return { status: 200, data: { run_id: 'r1', status: 'queued' } };
            if (path.endsWith('/cancel')) return { status: 200, data: { run_id: 'r1', status: 'canceled' } };
            return { status: 404, data: null };
        },
        async get(path, query) {
            calls.push({ method: 'GET', path, query });
            const next = script.shift();
            if (!next) return { status: 500, data: null };
            return next;
        }
    };
}

test('轮询超时触发 cancel', async () => {
    const client = mockClient([
        { status: 200, data: { run_id: 'r1', status: 'running' } },
        { status: 200, data: { run_id: 'r1', status: 'running' } }
    ]);
    let now = 0;
    const run = new RunClient({
        client,
        pollIntervalMs: 1,
        totalTimeoutSeconds: 1,
        maxConcurrent: 1,
        sleep: async () => {},
        now: () => {
            now += 600;
            return now;
        }
    });
    const result = await run.execute({ pluginId: 'web_search', entryId: 'search', args: { query: 'q' } });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'timeout');
    assert.equal(client.calls.some((call) => String(call.path).endsWith('/cancel')), true);
});

test('export 分页取完', async () => {
    const client = mockClient([
        { status: 200, data: { run_id: 'r1', status: 'succeeded' } },
        { status: 200, data: { items: [{ export_item_id: 'a', type: 'text', category: 'user', text: '1' }], next_after: 'a' } },
        { status: 200, data: { items: [{ export_item_id: 'b', type: 'text', category: 'user', text: '2' }], next_after: null } }
    ]);
    const run = new RunClient({
        client,
        pollIntervalMs: 1,
        totalTimeoutSeconds: 30,
        sleep: async () => {},
        now: () => 0
    });
    const result = await run.execute({ pluginId: 'p', entryId: 'e', args: {} });
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 2);
});

test('并发上限为 2', async () => {
    let active = 0;
    let peak = 0;
    const client = {
        async post() {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 30));
            active -= 1;
            return { status: 200, data: { run_id: `r${Math.random()}`, status: 'queued' } };
        },
        async get(path) {
            if (String(path).endsWith('/export')) {
                return { status: 200, data: { items: [], next_after: null } };
            }
            return { status: 200, data: { run_id: 'r', status: 'succeeded' } };
        }
    };
    const run = new RunClient({ client, pollIntervalMs: 1, totalTimeoutSeconds: 10, maxConcurrent: 2, now: () => 0, sleep: async () => {} });
    await Promise.all([
        run.execute({ pluginId: 'p', entryId: 'a' }),
        run.execute({ pluginId: 'p', entryId: 'b' }),
        run.execute({ pluginId: 'p', entryId: 'c' })
    ]);
    assert.ok(peak <= 2);
});
