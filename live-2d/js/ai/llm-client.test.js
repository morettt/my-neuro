const test = require('node:test');
const assert = require('node:assert/strict');
const { LLMClient } = require('./llm-client');

test('missing and relative API URLs report configuration errors before any fetch', async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
    for (const api_url of [undefined, '', '  ']) {
        await assert.rejects(new LLMClient({ api_url, model: 'chat' }).chatCompletion([]), /未配置.*API 地址/);
    }
    for (const api_url of ['undefined', '/v1', 'file:///tmp/api', 'ftp://example.com']) {
        await assert.rejects(new LLMClient({ api_url, model: 'chat' }).chatCompletion([]), /API 地址无效/);
    }
    await assert.rejects(new LLMClient({ api_url: 'https://example.com/v1' }).chatCompletion([]), /未选择对话模型/);
    assert.equal(fetch.mock.calls.length, 0);
});

test('chat uses a normalized HTTP endpoint and retains the provider authorization', async t => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        requests.push({ url, init });
        return Response.json({ choices: [{ message: { content: 'OK' } }] });
    });
    for (const api_url of [' https://example.com/v1/ ', 'https://example.com/v1/chat/completions', 'https://example.com/v1/models']) {
        const result = await new LLMClient({ api_url, api_key: 'fixture', model: 'chat' }).chatCompletion([]);
        assert.equal(result.content, 'OK');
    }
    assert.equal(requests.length, 3);
    for (const { url, init } of requests) {
        assert.equal(url, 'https://example.com/v1/chat/completions');
        assert.equal(init.headers.Authorization, 'Bearer fixture');
        assert.equal(JSON.parse(init.body).model, 'chat');
    }
});
