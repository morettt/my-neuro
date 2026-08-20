'use strict';

const assert = require('assert');
const { PluginContext } = require('../js/core/plugin-context.js');
const { llmProviderManager } = require('../js/core/llm-provider.js');

function jsonResponse(content = 'ok') {
    return {
        ok: true,
        status: 200,
        async json() {
            return {
                choices: [{ message: { content } }],
                usage: {}
            };
        }
    };
}

async function withFetch(fetchImpl, run) {
    const originalFetch = global.fetch;
    global.fetch = fetchImpl;
    try {
        await run();
    } finally {
        global.fetch = originalFetch;
    }
}

async function main() {
    llmProviderManager.init({
        llm: {
            provider_id: 'main',
            model_id: 'model-a'
        },
        llm_providers: [{
            id: 'main',
            api_url: 'https://provider.example/v1/',
            api_key: 'provider-key',
            models: [{
                model_id: 'model-a',
                enabled: true,
                temperature_enabled: true,
                temperature: 0,
                reasoning_enabled: true,
                reasoning_effort: 'high'
            }, {
                model_id: 'model-b',
                enabled: true,
                temperature_enabled: false,
                reasoning_enabled: false
            }]
        }]
    });

    const context = new PluginContext('plugin-context-llm-test', {}, null);
    const resolved = context.resolveLLM('main', 'model-a');
    assert.strictEqual(resolved.model, 'model-a');
    assert.strictEqual(resolved.temperature, 0);

    await withFetch(async (url, init) => {
        const body = JSON.parse(init.body);
        assert.strictEqual(url, 'https://provider.example/v1/chat/completions');
        assert.strictEqual(init.headers.Authorization, 'Bearer provider-key');
        assert.strictEqual(body.model, 'model-a');
        assert.strictEqual(body.temperature, 0);
        assert.strictEqual(body.reasoning_effort, 'high');
        assert.strictEqual('provider_id' in body, false);
        assert.strictEqual('timeout_ms' in body, false);
        return jsonResponse('provider');
    }, async () => {
        const result = await context.callLLM('hello', {
            provider_id: 'main',
            model_id: 'model-a',
            timeout_ms: 1000
        });
        assert.strictEqual(result, 'provider');
    });

    await withFetch(async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.strictEqual(body.temperature, 0.25);
        assert.strictEqual(body.reasoning_effort, 'low');
        return jsonResponse();
    }, async () => {
        await context.callLLM('hello', {
            provider_id: 'main',
            model: 'model-a',
            temperature: 0.25,
            reasoning_effort: 'low'
        });
    });

    await withFetch(async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.strictEqual(body.model, 'model-b');
        assert.strictEqual('temperature' in body, false);
        assert.strictEqual('reasoning_effort' in body, false);
        return jsonResponse();
    }, async () => {
        await context.callLLM('hello', {
            provider_id: 'main',
            model: 'model-b'
        });
    });

    await withFetch(async (url, init) => {
        const body = JSON.parse(init.body);
        assert.strictEqual(url, 'https://legacy.example/v1/chat/completions');
        assert.strictEqual(init.headers.Authorization, 'Bearer legacy-key');
        assert.strictEqual(body.model, 'legacy-model');
        assert.strictEqual('api_url' in body, false);
        assert.strictEqual('api_key' in body, false);
        return jsonResponse('legacy');
    }, async () => {
        const result = await context.callLLM('hello', {
            api_url: 'https://legacy.example/v1',
            api_key: 'legacy-key',
            model: 'legacy-model'
        });
        assert.strictEqual(result, 'legacy');
    });

    await withFetch((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
            reject(init.signal.reason || new Error('aborted'));
        }, { once: true });
    }), async () => {
        await assert.rejects(
            context.callLLM('hello', {
                provider_id: 'main',
                timeout_ms: 20
            }),
            error => error?.name === 'TimeoutError' &&
                error?.code === 'PLUGIN_LLM_TIMEOUT'
        );
    });

    console.log('plugin-context LLM tests passed');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
