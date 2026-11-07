'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const http = require('http');
const https = require('https');
const { PluginManager } = require('../../../js/core/plugin-manager.js');
const { ConversationCore } = require('../../../js/ai/conversation/ConversationCore.js');
const { ToolExecutor } = require('../../../js/ai/tool-executor.js');
const { getMergedToolsList } = require('../../../js/api-utils.js');
const { eventBus } = require('../../../js/core/event-bus.js');
const { Events } = require('../../../js/core/events.js');

const originalHttpsRequest = https.request;
const originalAdapter = axios.defaults.adapter;
const proxyVariables = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];
const originalProxy = Object.fromEntries(proxyVariables.map(name => [name, process.env[name]]));
let temporary, managers, requests, mode, server;
const config = { context: { max_messages: 20, enable_limit: true }, tools: { enabled: true } };

// Exercise the real SDK and Node HTTP adapter, observing headers at the server.
// Only Node HTTP routing is local; the production endpoint stays fixed.
async function installMCPFixture() {
    server = http.createServer((request, response) => {
        let raw = '';
        request.on('data', chunk => { raw += chunk; });
        request.on('end', () => {
            const body = raw ? JSON.parse(raw) : null;
            requests.push({ url: `https://${request.headers.host}${request.url}`,
                method: request.method, headers: new Headers(request.headers), body, response });
            if (request.method === 'GET') { response.writeHead(405).end(); return; }
            if (body?.id === undefined) { response.writeHead(202).end(); return; }
            if (mode === 'http-error') { response.writeHead(503).end('unavailable'); return; }
            if (mode === 'hang' || (mode === 'hang-call' && body.method === 'tools/call')) return;
            let result;
            if (body.method === 'initialize') {
                result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} },
                    serverInfo: { name: 'fixture', version: '1.0' } };
            } else if (body.method === 'tools/list') {
                result = { tools: ['web_search', 'web_fetch'].map(name => ({ name,
                    inputSchema: { type: 'object' } })) };
            } else if (body.method === 'tools/call') {
                result = mode === 'tool-error'
                    ? { isError: true, content: [{ type: 'text', text: 'quota fixture' }] }
                    : { content: [{ type: 'text', text: 'Source: https://example.com/current' },
                        { type: 'text', text: 'Useful current information.' }] };
            }
            if (mode === 'partial-body' && body.method === 'tools/call') {
                response.setHeader('Content-Type', 'application/json');
                response.write('{"jsonrpc":');
                return;
            }
            if (mode === 'sse' && body.method === 'tools/call') {
                response.setHeader('Content-Type', 'text/event-stream');
                response.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`);
                return;
            }
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    https.request = (options, callback) => {
        assert.equal(options.hostname, 'search.parallel.ai');
        return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1',
            port: server.address().port, headers: { ...options.headers, host: 'search.parallel.ai' }
        }, callback);
    };
}

async function assertConnectionClosed(request) {
    const until = Date.now() + 2000;
    while (!request.response.destroyed && Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(request.response.destroyed);
}

async function loadPlugin(values = {}, { enabled = true, toolsEnabled = true, shipped = false } = {}) {
    const root = fs.mkdtempSync(path.join(temporary, 'runtime-'));
    const plugins = path.join(root, 'plugins');
    const dir = path.join(plugins, 'built-in/web-search');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'metadata.json'), path.join(dir, 'metadata.json'));
    // Resolve executable code/dependencies at its production location; config is isolated.
    fs.symlinkSync(path.join(__dirname, 'index.js'), path.join(dir, 'index.js'));
    const schema = shipped ? JSON.parse(fs.readFileSync(path.join(__dirname, 'plugin_config.json'))) : values;
    fs.writeFileSync(path.join(dir, 'plugin_config.json'), JSON.stringify(schema));
    fs.writeFileSync(path.join(plugins, 'enabled_plugins.json'), JSON.stringify({
        plugins: enabled ? ['built-in/web-search'] : []
    }));
    const manager = new PluginManager({ ...config, tools: { enabled: toolsEnabled } });
    manager._pluginsDir = plugins;
    manager._builtinDir = path.join(plugins, 'built-in');
    manager._communityDir = path.join(plugins, 'community');
    managers.push(manager);
    await manager.loadAll();
    global.pluginManager = manager;
    return manager;
}

function conversation() {
    const core = new ConversationCore('system', [], config);
    return { conversationCore: core, messages: core.getMessages() };
}

async function dispatch(name = 'web_search', args = { query: 'current research news' }) {
    return await new ToolExecutor().executeToolCalls([{
        id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) }
    }]);
}

const calls = () => requests.filter(request => request.body?.method === 'tools/call');

beforeEach(async () => {
    proxyVariables.forEach(name => { delete process.env[name]; });
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'my-neuro-search-'));
    managers = []; requests = []; mode = 'success';
    global.voiceChat = conversation();
    global.mcpManager = null;
    await installMCPFixture();
});

afterEach(async () => {
    for (const manager of managers) await manager.stopAll();
    https.request = originalHttpsRequest;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    axios.defaults.adapter = originalAdapter;
    proxyVariables.forEach(name => {
        if (originalProxy[name] === undefined) delete process.env[name];
        else process.env[name] = originalProxy[name];
    });
    delete global.pluginManager; delete global.voiceChat; delete global.mcpManager;
    fs.rmSync(temporary, { recursive: true, force: true });
});

test('fresh shipped config loads keyless search/fetch and dispatcher consumes all text blocks', async () => {
    await loadPlugin({}, { shipped: true });
    assert.deepEqual(getMergedToolsList().map(tool => tool.function.name), ['web_search', 'web_fetch']);
    const result = await dispatch();
    assert.match(result, /https:\/\/example.com\/current\nUseful current information/);
    assert.deepEqual(calls()[0].body.params.arguments.search_queries, ['current research news']);
    await dispatch('web_fetch', { urls: ['https://example.com/current'], objective: 'Verify the news' });
    assert.equal(calls()[1].body.params.name, 'web_fetch');
    for (const request of requests) {
        assert.equal(request.url, 'https://search.parallel.ai/mcp');
        assert.equal(request.headers.get('user-agent'), 'my-neuro/1.0 (https://github.com/morettt/my-neuro)');
        assert.equal(request.headers.has('authorization'), false);
    }
    assert.ok(requests.some(request => request.body?.method === 'initialize'));
    assert.ok(requests.some(request => request.body?.method === 'tools/list'));
});

test('scripted model drives the real LLM handler through search, fetch and a source-based reply', async () => {
    await loadPlugin();
    const { LLMHandler } = require('../../../js/ai/llm-handler.js');
    const { LLMClient } = require('../../../js/ai/llm-client.js');
    const originalCompletion = LLMClient.prototype.chatCompletion;
    let turn = 0;
    const voiceChat = global.voiceChat;
    voiceChat.shouldTakeScreenshot = async () => false;
    voiceChat.saveConversationHistory = () => {};
    voiceChat.showSubtitle = error => assert.fail(error);
    voiceChat.hideSubtitle = () => {};
    const spoken = [];
    const tts = { reset() {}, processTextToSpeech: text => spoken.push(text) };
    LLMClient.prototype.chatCompletion = async function(messages, tools) {
        assert.deepEqual(tools.map(tool => tool.function.name), ['web_search', 'web_fetch']);
        const toolMessages = messages.filter(message => message.role === 'tool');
        assert.equal(toolMessages.length, turn);
        if (turn > 0) assert.match(toolMessages.at(-1).content, /Useful current information/);
        if (turn === 2) {
            turn++;
            return { content: 'Answer with source: https://example.com/current' };
        }
        const name = turn++ === 0 ? 'web_search' : 'web_fetch';
        const args = name === 'web_search' ? { query: 'current research news' }
            : { urls: ['https://example.com/current'] };
        return { tool_calls: [{ id: `call-${turn}`, type: 'function',
            function: { name, arguments: JSON.stringify(args) } }] };
    };
    try {
        const send = LLMHandler.createEnhancedSendToLLM(voiceChat, tts, false, {
            ...config, llm: { api_url: 'https://model.invalid', model: 'scripted-test' },
            vision: { enabled: false }, tts: { enabled: false }
        });
        await send('Find current news and read its source');
        assert.equal(turn, 3);
        assert.equal(calls().length, 2);
        assert.equal(voiceChat.messages.at(-1).role, 'assistant');
        assert.match(voiceChat.messages.at(-1).content, /https:\/\/example.com\/current/);
        assert.deepEqual(spoken, ['Answer with source: https://example.com/current']);
    } finally { LLMClient.prototype.chatCompletion = originalCompletion; }
});

test('legacy plain/schema Tavily keys keep Tavily; explicit Parallel overrides a saved key', async () => {
    const tavilyCalls = [];
    axios.defaults.adapter = async request => {
        tavilyCalls.push(request);
        return { data: { answer: 'Tavily answer', results: [{ title: 'Source', content: 'Content',
            url: 'https://example.com/tavily' }] }, status: 200, headers: {}, config: request };
    };
    for (const key of ['saved-test-key', { type: 'string', value: 'saved-test-key' }]) {
        const manager = await loadPlugin({ tavily_api_key: key });
        assert.deepEqual(manager.getAllTools().map(tool => tool.function.name), ['web_search']);
        assert.match(await dispatch(), /Tavily answer/);
    }
    assert.equal(calls().length, 0);
    assert.equal(tavilyCalls.length, 2);
    assert.equal(tavilyCalls[0].url, 'https://api.tavily.com/search');
    assert.equal(JSON.parse(tavilyCalls[0].data).api_key, 'saved-test-key');
    await loadPlugin({ provider: 'parallel', tavily_api_key: 'saved-test-key' });
    assert.match(await dispatch(), /Useful current information/);
    assert.equal(tavilyCalls.length, 2);
});

test('Parallel HTTP transport does not inherit global Axios credentials or adapters', async () => {
    const originalAuth = axios.defaults.auth;
    const originalHeader = axios.defaults.headers.common.Authorization;
    axios.defaults.auth = { username: 'other-service', password: 'test-only' };
    axios.defaults.headers.common.Authorization = 'Bearer other-service-test';
    axios.defaults.adapter = () => { throw new Error('Unrelated global adapter'); };
    try {
        await loadPlugin();
        assert.match(await dispatch(), /Useful current information/);
        requests.forEach(request => assert.equal(request.headers.has('authorization'), false));
    } finally {
        if (originalAuth === undefined) delete axios.defaults.auth;
        else axios.defaults.auth = originalAuth;
        if (originalHeader === undefined) delete axios.defaults.headers.common.Authorization;
        else axios.defaults.headers.common.Authorization = originalHeader;
    }
});

test('disabled plugin, global tools, disabled/invalid provider and explicit Tavily without key fail closed', async () => {
    for (const [values, options] of [
        [{}, { enabled: false }], [{}, { toolsEnabled: false }],
        [{ provider: 'disabled' }, {}], [{ provider: 'unknown' }, {}],
        [{ provider: 'tavily', tavily_api_key: '' }, {}]
    ]) {
        const manager = await loadPlugin(values, options);
        assert.deepEqual(manager.getAllTools(), []);
        assert.equal(await dispatch(), null);
    }
    assert.equal(requests.length, 0);
});

test('conversation IDs survive follow-up, trimming and quota retry; interleaved cores stay isolated', async () => {
    await loadPlugin();
    const first = global.voiceChat;
    await dispatch();
    const id = calls()[0].body.params.arguments.session_id;
    assert.match(id, /^[0-9a-f-]{36}$/);
    first.conversationCore.setMessages([{ role: 'system', content: 'trimmed' }]);
    await dispatch('web_fetch', { urls: ['https://example.com/current'] });
    mode = 'tool-error';
    assert.match(await dispatch(), /quota fixture/);
    mode = 'success';
    const second = conversation();
    global.voiceChat = second;
    const secondCall = dispatch();
    global.voiceChat = first;
    const firstCall = dispatch();
    await Promise.all([secondCall, firstCall]);
    const ids = calls().map(request => request.body.params.arguments.session_id);
    assert.deepEqual(ids.slice(0, 3), [id, id, id]);
    assert.ok(ids.includes(second.conversationCore.sessionId));
    assert.notEqual(second.conversationCore.sessionId, id);
    assert.equal(ids.filter(value => value === id).length, 4);
    global.voiceChat = conversation(); // 新对话/重启创建新的 ConversationCore。
    await dispatch();
    assert.notEqual(calls().at(-1).body.params.arguments.session_id, id);
});

test('bad queries/URLs do not send requests; HTTPS pages and objective reach MCP unchanged', async () => {
    await loadPlugin();
    for (const args of [{ urls: [] }, { urls: ['file:///etc/passwd'] },
        { urls: ['https://user:password@example.com'] }, { urls: ['not a URL'] },
        { urls: Array(21).fill('https://example.com') },
        { urls: ['https://example.com'], objective: 'x'.repeat(201) }]) {
        assert.match(await dispatch('web_fetch', args), /搜索过程中出现错误/);
    }
    assert.match(await dispatch('web_search', { query: ' ' }), /关键词不能为空/);
    assert.equal(requests.length, 0);
    await dispatch('web_fetch', { urls: ['https://example.com/page?x=1#section'], objective: 'Find details' });
    assert.deepEqual(calls()[0].body.params.arguments.urls, ['https://example.com/page?x=1#section']);
    assert.equal(calls()[0].body.params.arguments.objective, 'Find details');
});

test('HTTP and MCP errors remain visible without provider fallback', async () => {
    await loadPlugin({ provider: 'parallel', tavily_api_key: 'saved-test-key' });
    axios.defaults.adapter = () => { throw new Error('Must not fallback to Tavily'); };
    mode = 'http-error';
    assert.match(await dispatch(), /unavailable/);
    mode = 'tool-error';
    assert.match(await dispatch(), /quota fixture/);
});

test('SDK consumes SSE tool responses through the current-realm stream adapter', async () => {
    await loadPlugin();
    mode = 'sse';
    assert.match(await dispatch(), /Useful current information/);
    assert.match(await dispatch('web_fetch', { urls: ['https://example.com/current'] }), /Useful current information/);
});

test('total deadline cancels a partially received response body', async () => {
    await loadPlugin({ timeout_ms: 250 });
    mode = 'partial-body';
    assert.match(await dispatch(), /超时/);
    assert.equal(calls().length, 1);
    await assertConnectionClosed(calls()[0]);
});

test('total timeout cancels SDK connection requests', async () => {
    await loadPlugin({ timeout_ms: 25 });
    mode = 'hang';
    const keepAlive = setInterval(() => {}, 1000);
    try {
        assert.match(await dispatch(), /超时/);
        await assertConnectionClosed(requests[0]);
    } finally { clearInterval(keepAlive); }
});

test('user interruption and plugin unload abort in-flight tool calls', async () => {
    const manager = await loadPlugin();
    for (const stop of [() => eventBus.emit(Events.TTS_INTERRUPTED), () => manager.stopAll()]) {
        mode = 'hang-call';
        const before = calls().length;
        const pending = dispatch();
        while (calls().length === before) await new Promise(resolve => setImmediate(resolve));
        await stop();
        assert.match(await pending, /搜索已取消/);
        await assertConnectionClosed(calls().at(-1));
    }
    assert.deepEqual(manager.getAllTools(), []);
});
