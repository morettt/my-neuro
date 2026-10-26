const test = require('node:test');
const assert = require('node:assert/strict');
const { isSingleAction, parseActions } = require('../protocol');
const BodyActionsPlugin = require('../index');

test('single actions are separate, ordered and removed from spoken/display text', () => {
    const result = parseActions('你好！[wave right hand] 看这里。[raise left hand]');
    assert.deepEqual(result.actions, ['wave right hand', 'raise left hand']);
    assert.equal(result.text, '你好！ 看这里。');
    assert.deepEqual(result.rejected, []);
});

test('compound actions and malformed commands cannot reach the motion backend', () => {
    for (const text of ['raise left hand and turn around', 'wave then bow', 'walk while waving', 'bow, raise hand', 'raise 左手', 'raise hand/turn around']) {
        assert.equal(isSingleAction(text), false, text);
        assert.equal(parseActions(`[${text}]`).actions.length, 0);
    }
    assert.equal(parseActions('你好[raise left hand').text, '你好');
});

test('all control brackets are hidden regardless of validity; action counts are bounded', () => {
    assert.equal(parseActions('请看 [OpenAI] 和 [说明]。').text, '请看 和 。');
    assert.deepEqual(parseActions('[bow][nod head][wave right hand]', 2).actions, ['bow', 'nod head']);
    assert(isSingleAction('walk in place'));
    assert(isSingleAction('raise both hands'));
});

test('the six reference actions and arbitrary English descriptions need no verb whitelist', () => {
    const examples = ['Backflip', 'raise your hands', 'Dance', 'Spin in place', 'lying on the ground', 'Standing high jump', 'cartwheel', 'a person salutes'];
    const result = parseActions(examples.map(text => `[${text}]`).join(''), examples.length);
    assert.deepEqual(result.actions, examples);
    assert.equal(result.text, '');
    assert.deepEqual(result.rejected, []);
});

test('prompt injection uses existing hooks without adding any core request fields', async () => {
    const saved = global.avatarFacade;
    try {
        const plugin = new BodyActionsPlugin({}, {});
        plugin.config = {};
        global.avatarFacade = { getActiveType: () => 'vrm', getModel: () => ({ modelType: 'vrm' }) };
        const request = { messages: [{ role: 'system', content: '用户人设' }] };
        await plugin.onLLMRequest(request);
        assert.equal(request.messages[0].content, '用户人设');
        assert(request.messages[1].content.includes('每对 [] 必须且只能包含一个'));
        assert(!('deferTTSUntilResponse' in request));
        global.avatarFacade.getActiveType = () => 'live2d';
        const next = { messages: [] };
        await plugin.onLLMRequest(next);
        assert(next.messages[0].content.includes('每对 [] 必须且只能包含一个'));
    } finally { global.avatarFacade = saved; }
});

test('interrupted generation never plays a late response', async () => {
    const plugin = new BodyActionsPlugin({}, { log() {} });
    plugin.config = {}; plugin.epoch = 0; plugin.cache = new Map();
    const model = {};
    plugin.adapter = () => model;
    let done;
    plugin.service = { generate: () => new Promise(resolve => { done = resolve; }) };
    const response = { text: '你好[raise left hand]' };
    await plugin.onLLMResponse(response);
    assert.equal(response.text, '你好');
    await plugin.onUserInput();
    done({ fps: 20, joints: Array.from({ length: 2 }, () => Array.from({ length: 22 }, () => [0, 0, 0])) });
    await plugin.work;
    assert.equal(plugin.cache.size, 0);
    assert(!plugin.player);
});

test('editable body prompt takes effect on the next request and blank falls back to defaults', async () => {
    let bodyPrompt = 'Use [bow] to greet.';
    const plugin = new BodyActionsPlugin({}, { getPluginConfig: () => ({ body_prompt: bodyPrompt }) });
    plugin.config = {};
    const request = { messages: [] };
    await plugin.onLLMRequest(request);
    assert(request.messages[0].content.startsWith(bodyPrompt));
    assert(!request.messages[0].content.includes('[Backflip]'));
    bodyPrompt = 'Use [wave right hand] to greet.';
    const next = { messages: [] };
    await plugin.onLLMRequest(next);
    assert(next.messages[0].content.startsWith(bodyPrompt));
    bodyPrompt = '   ';
    const fallback = { messages: [] };
    await plugin.onLLMRequest(fallback);
    assert(fallback.messages[0].content.includes('[Backflip]'));
});

test('prompt injection works before model readiness and without the avatar facade', async () => {
    const facade = global.avatarFacade, model = global.currentModel;
    try {
        delete global.avatarFacade;
        delete global.currentModel;
        const plugin = new BodyActionsPlugin({}, { log() {} });
        plugin.config = {};
        const request = { messages: [] };
        await plugin.onLLMRequest(request);
        assert(request.messages[0].content.includes('[Backflip]'));
        assert.equal(plugin.adapter(), null);
        global.currentModel = { modelType: 'vrm' };
        assert.equal(plugin.adapter(), global.currentModel);
        global.currentModel._disposed = true;
        assert.equal(plugin.adapter(), null);
        plugin.stopped = true;
        const stoppedRequest = { messages: [] };
        await plugin.onLLMRequest(stoppedRequest);
        assert.deepEqual(stoppedRequest.messages, []);
    } finally {
        global.avatarFacade = facade;
        global.currentModel = model;
    }
});

test('unavailable VRM reports why a received action was not played', async () => {
    const logs = [];
    const plugin = new BodyActionsPlugin({}, { log: (level, text) => logs.push(text) });
    plugin.config = {}; plugin.epoch = 0;
    plugin.adapter = () => null;
    await plugin.onLLMRequest({ messages: [] });
    const reply = { text: '你好[raise left hand]' };
    await plugin.onLLMResponse(reply);
    assert.equal(reply.text, '你好');
    assert(logs.some(text => text.includes('当前没有可播放的 VRM 或 PMX 模型')));
});
