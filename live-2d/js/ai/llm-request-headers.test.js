const test = require('node:test');
const assert = require('node:assert/strict');
const { llmRequestHeaders } = require('./llm-request-headers');

test('OpenCode Go uses a stable session across requests and both endpoint generations', () => {
    const current = llmRequestHeaders('https://opencode.ai/inference/go/openai/v1', 'fixture');
    const legacy = llmRequestHeaders('https://opencode.ai/zen/go/v1', 'fixture');
    assert.match(current['x-opencode-session'], /^ses_/);
    assert.equal(current['x-opencode-session'], legacy['x-opencode-session']);
    assert.equal(current.Authorization, 'Bearer fixture');
});

test('other providers and lookalike hostnames retain standard OpenAI headers', () => {
    for (const url of ['https://api.deepseek.com/v1', 'https://opencode.ai/inference/openai/v1', 'https://opencode.ai.evil.example/inference/go/v1']) {
        assert.equal('x-opencode-session' in llmRequestHeaders(url, 'fixture'), false);
    }
});
