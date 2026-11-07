// Run with: npx electron scripts/test-web-search-renderer.js
// Linux CI: xvfb-run -a npx electron scripts/test-web-search-renderer.js --no-sandbox
// Local MCP fixture only; no search credentials, model or external requests.
const { app, BrowserWindow } = require('electron');
const assert = require('assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
// 仅测试进程：网络固定路由到本地 fixture，不使用环境代理。
for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete process.env[name];
}

const runtime = path.resolve(__dirname, '..');
const seen = [];
let partialBodyClosed = false;
let server, window, scratch;
app.commandLine.appendSwitch('disable-gpu');
const timer = setTimeout(() => { console.error('Renderer search test timed out'); finish(1); }, 60000);

app.whenReady().then(async () => {
    server = http.createServer((request, response) => {
        let raw = '';
        request.on('data', chunk => { raw += chunk; });
        request.on('end', () => {
            const body = raw ? JSON.parse(raw) : null;
            seen.push({ headers: request.headers, body });
            if (request.method === 'GET') { response.writeHead(405).end(); return; }
            if (body?.id === undefined) { response.writeHead(202).end(); return; }
            let result;
            if (body.method === 'initialize') {
                result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} },
                    serverInfo: { name: 'fixture', version: '1' } };
            } else if (body.method === 'tools/list') {
                result = { tools: ['web_search', 'web_fetch'].map(name => ({ name,
                    inputSchema: { type: 'object' } })) };
            } else if (body.method === 'tools/call') {
                result = { content: [{ type: 'text', text: 'Useful source https://example.com/current' }] };
                if (body.params.arguments.urls?.includes('https://example.com/hang')) {
                    response.on('close', () => { partialBodyClosed = true; });
                    response.setHeader('Content-Type', 'application/json');
                    response.write('{"jsonrpc":');
                    window.webContents.send('web-search-test-body-started');
                    return;
                }
                if (body.params.name === 'web_fetch') {
                    response.setHeader('Content-Type', 'text/event-stream');
                    response.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`);
                    return;
                }
            }
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neuro-renderer-search-'));
    const plugins = path.join(scratch, 'plugins');
    const dir = path.join(plugins, 'built-in/web-search');
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['metadata.json', 'plugin_config.json']) {
        fs.copyFileSync(path.join(runtime, 'plugins/built-in/web-search', name), path.join(dir, name));
    }
    fs.symlinkSync(path.join(runtime, 'plugins/built-in/web-search/index.js'), path.join(dir, 'index.js'));
    fs.writeFileSync(path.join(plugins, 'enabled_plugins.json'), JSON.stringify({ plugins: ['built-in/web-search'] }));
    // Match the desktop app's renderer, not ELECTRON_RUN_AS_NODE.
    window = new BrowserWindow({ show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, backgroundThrottling: false
    } });
    window.webContents.on('console-message', (_, level, message) => console.log('Renderer:', message));
    await window.loadURL('about:blank');
    const result = await window.webContents.executeJavaScript(`(async () => {
        const runtime = ${JSON.stringify(runtime)};
        const plugins = ${JSON.stringify(plugins)};
        const path = require('path');
        const http = require('http');
        const https = require('https');
        const originalRequest = https.request;
        https.request = (options, callback) => {
            if (options.hostname !== 'search.parallel.ai') throw new Error('Unexpected destination');
            return http.request({ ...options, protocol:'http:', hostname:'127.0.0.1',
                port:${server.address().port}, headers:{...options.headers,host:'search.parallel.ai'}
            }, callback);
        };
        const browserFetch = global.fetch;
        global.fetch = () => { throw new Error('MCP must use Node HTTP, not browser fetch'); };
        const { PluginManager } = require(path.join(runtime, 'js/core/plugin-manager.js'));
        const { ConversationCore } = require(path.join(runtime, 'js/ai/conversation/ConversationCore.js'));
        const { ToolExecutor } = require(path.join(runtime, 'js/ai/tool-executor.js'));
        const config = { tools: { enabled: true }, context: { max_messages: 20, enable_limit: false } };
        const core = new ConversationCore('fixture', [], config);
        global.voiceChat = { conversationCore: core, messages: core.getMessages() };
        const manager = new PluginManager(config);
        manager._pluginsDir = plugins;
        manager._builtinDir = path.join(plugins, 'built-in');
        manager._communityDir = path.join(plugins, 'community');
        global.pluginManager = manager;
        try {
            await manager.loadAll();
            const results = [];
            for (const [name, args] of [['web_search', {query:'current research news'}],
                ['web_fetch', {urls:['https://example.com/current']}]]) {
                results.push(await new ToolExecutor().executeToolCalls([{ id:name, type:'function',
                    function:{name, arguments:JSON.stringify(args)} }]));
            }
            const { eventBus } = require(path.join(runtime, 'js/core/event-bus.js'));
            const { Events } = require(path.join(runtime, 'js/core/events.js'));
            const { ipcRenderer } = require('electron');
            let cancel;
            const interrupt = () => { cancel = setTimeout(() => eventBus.emit(Events.TTS_INTERRUPTED), 50); };
            ipcRenderer.once('web-search-test-body-started', interrupt);
            try {
                results.push(await new ToolExecutor().executeToolCalls([{id:'cancel', type:'function',
                    function:{name:'web_fetch', arguments:JSON.stringify({urls:['https://example.com/hang']})}}]));
            } finally {
                clearTimeout(cancel);
                ipcRenderer.removeListener('web-search-test-body-started', interrupt);
            }
            return { tools: manager.getAllTools().map(tool => tool.function.name), results };
        } finally {
            await manager.stopAll();
            global.fetch = browserFetch;
            https.request = originalRequest;
        }
    })()`);
    assert.deepEqual(result.tools, ['web_search', 'web_fetch']);
    result.results.slice(0, 2).forEach(text => assert.match(text, /Useful source https:\/\/example.com\/current/));
    assert.match(result.results[2], /搜索已取消/);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(partialBodyClosed, 'interruption must close the partial response stream');
    assert.ok(seen.length >= 8);
    seen.forEach(request => {
        assert.equal(request.headers['user-agent'], 'my-neuro/1.0 (https://github.com/morettt/my-neuro)');
        assert.equal(request.headers.authorization, undefined);
        assert.equal(request.headers.host, 'search.parallel.ai');
    });
    const calls = seen.filter(request => request.body?.method === 'tools/call');
    assert.deepEqual(calls.map(request => request.body.params.name), ['web_search', 'web_fetch', 'web_fetch']);
    assert.equal(calls[0].body.params.arguments.session_id, calls[1].body.params.arguments.session_id);
    assert.equal(calls[0].body.params.arguments.session_id, calls[2].body.params.arguments.session_id);
    console.log(`Renderer loader/dispatcher JSON, SSE and cancellation passed; ${seen.length} requests verified at server.`);
}).then(() => finish(0)).catch(error => { console.error(error); finish(1); });

function finish(code) {
    clearTimeout(timer);
    if (window && !window.isDestroyed()) window.destroy();
    if (server) { server.closeAllConnections(); server.close(); }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    app.exit(code);
}
