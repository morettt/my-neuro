'use strict';

const http = require('http');

function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    });
    res.end(payload);
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch {
                resolve({});
            }
        });
    });
}

function defaultPlugins() {
    return {
        plugins: [
            {
                id: 'web_search',
                type: 'plugin',
                name: '网络搜索',
                sdk_supported: '>=0.1.0,<0.3.0',
                store: { enabled: false },
                ui: { enabled: false },
                extra_unknown_field: 'keep-me',
                entries: [
                    {
                        id: 'search',
                        name: '搜索',
                        description: '联网搜索',
                        timeout: 30,
                        input_schema: {
                            type: 'object',
                            properties: { query: { type: 'string' } },
                            required: ['query']
                        },
                        llm_result_fields: ['summary']
                    }
                ]
            },
            {
                id: 'mcp_adapter',
                type: 'adapter',
                sdk_supported: '>=0.1.0,<0.3.0',
                entries: [{ id: 'list_servers', name: 'list', timeout: 10, input_schema: { type: 'object', properties: {} } }]
            }
        ]
    };
}

function createFakeRuntime(options = {}) {
    const state = {
        plugins: options.emptyUntilRefresh ? { plugins: [], message: 'no plugins registered' } : (options.plugins || defaultPlugins()),
        pendingPlugins: options.emptyUntilRefresh ? (options.plugins || defaultPlugins()) : null,
        runs: new Map(),
        runBehavior: options.runBehavior || 'succeed',
        exportPages: options.exportPages || null,
        started: new Set()
    };

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (req.method === 'GET' && url.pathname === '/health') {
            return json(res, 200, { status: 'ok', time: new Date().toISOString(), extra: 'unknown' });
        }
        if (req.method === 'GET' && url.pathname === '/plugins') {
            return json(res, 200, state.plugins);
        }
        if (req.method === 'POST' && url.pathname === '/plugins/refresh') {
            if (state.pendingPlugins) {
                state.plugins = state.pendingPlugins;
                state.pendingPlugins = null;
            }
            return json(res, 200, { success: true, added: ['web_search'] });
        }
        if (req.method === 'POST' && url.pathname === '/agent/flags') {
            state.flags = await readBody(req);
            if (state.pendingPlugins) {
                state.plugins = state.pendingPlugins;
                state.pendingPlugins = null;
            }
            return json(res, 200, { success: true, flags: state.flags });
        }
        if (req.method === 'GET' && url.pathname === '/plugin/status') {
            return json(res, 200, { plugins: {}, time: new Date().toISOString() });
        }
        if (req.method === 'POST' && url.pathname.startsWith('/plugin/') && url.pathname.endsWith('/start')) {
            const pluginId = decodeURIComponent(url.pathname.split('/')[2]);
            state.started.add(pluginId);
            return json(res, 200, { ok: true, plugin_id: pluginId });
        }
        if (req.method === 'POST' && url.pathname === '/runs') {
            const body = await readBody(req);
            const runId = `run_${state.runs.size + 1}`;
            const record = {
                run_id: runId,
                plugin_id: body.plugin_id,
                entry_id: body.entry_id,
                status: 'queued',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                result_refs: [],
                extra_field: 'ignored'
            };
            state.runs.set(runId, { record, args: body.args, polls: 0 });
            return json(res, 200, { run_id: runId, status: 'queued' });
        }
        const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
        if (req.method === 'GET' && runMatch) {
            const item = state.runs.get(runMatch[1]);
            if (!item) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'missing' } });
            item.polls += 1;
            if (state.runBehavior === 'timeout') {
                item.record.status = 'running';
            } else if (state.runBehavior === 'fail') {
                item.record.status = 'failed';
                item.record.error = { code: 'ENTRY_FAILED', message: 'boom' };
            } else if (item.polls >= 2) {
                item.record.status = 'succeeded';
            } else {
                item.record.status = 'running';
            }
            return json(res, 200, item.record);
        }
        if (req.method === 'POST' && url.pathname.match(/^\/runs\/[^/]+\/cancel$/)) {
            const runId = url.pathname.split('/')[2];
            const item = state.runs.get(runId);
            if (item) item.record.status = 'canceled';
            state.canceled = runId;
            return json(res, 200, item ? item.record : { run_id: runId, status: 'canceled' });
        }
        if (req.method === 'GET' && url.pathname.match(/^\/runs\/[^/]+\/export$/)) {
            const runId = url.pathname.split('/')[2];
            if (state.exportPages) {
                const after = url.searchParams.get('after') || '';
                const page = state.exportPages.find((entry) => (entry.after || '') === after) || { items: [], next_after: null };
                return json(res, 200, { items: page.items, next_after: page.next_after || null });
            }
            if (state.runBehavior === 'empty-export') {
                return json(res, 200, { items: [], next_after: null });
            }
            return json(res, 200, {
                items: [
                    {
                        export_item_id: 'e1',
                        run_id: runId,
                        type: 'json',
                        category: 'user',
                        json_data: { summary: 'hello from stub', noise: 'ignore-me' },
                        extra: true
                    }
                ],
                next_after: null
            });
        }
        json(res, 404, { error: 'not found' });
    });

    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                port: address.port,
                state,
                close: () => new Promise((done) => server.close(() => done()))
            });
        });
        server.on('error', reject);
    });
}

module.exports = { createFakeRuntime, defaultPlugins };
