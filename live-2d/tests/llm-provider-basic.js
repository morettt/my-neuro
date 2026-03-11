const assert = require('assert');

const { llmProviderManager } = require('../js/core/llm-provider.js');
const { configLoader } = require('../js/core/config-loader.js');
const { LLMClient } = require('../js/ai/llm-client.js');
const { PluginContext } = require('../js/core/plugin-context.js');
const { VoiceChatFacade } = require('../js/ai/conversation/VoiceChatFacade.js');
const { BarrageManager } = require('../js/live/barrage-manager.js');
const { LLMHandler } = require('../js/ai/llm-handler.js');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createConfig() {
    return {
        llm_providers: [
            {
                id: 'main',
                name: '主模型',
                api_key: 'main-key',
                api_url: 'https://main.example/v1',
                temperature: 0.7,
                enabled: true,
                models: [
                    { model_id: 'main/deepseek-chat', name: 'deepseek-chat', enabled: true },
                    { model_id: 'main/deepseek-reasoner', name: 'deepseek-reasoner', enabled: true }
                ]
            },
            {
                id: 'vision',
                name: '视觉',
                api_key: 'vision-key',
                api_url: 'https://vision.example/v1',
                enabled: true,
                models: [
                    { model_id: 'vision/qwen-vl-plus', name: 'qwen-vl-plus', enabled: true },
                    { model_id: 'vision/qwen-vl-max', name: 'qwen-vl-max', enabled: false }
                ]
            }
        ],
        llm: {
            provider_id: 'main',
            model_id: 'main/deepseek-reasoner',
            model: 'main/deepseek-reasoner',
            system_prompt: 'You are a test assistant.'
        },
        context: {
            max_messages: 18,
            enable_limit: true
        },
        vision: {
            enabled: true,
            use_vision_model: true,
            provider_id: 'vision',
            model_id: 'vision/qwen-vl-plus',
            vision_model: {}
        },
        asr: { enabled: true },
        cloud: {}
    };
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`PASS ${name}`);
    } catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error.stack || error.message || error);
    }
}

async function main() {
    await test('llmProviderManager resolves explicit llm model', () => {
        const config = createConfig();
        llmProviderManager.init(config);

        const provider = llmProviderManager.resolveProvider(
            config.llm.provider_id,
            config.llm,
            config.llm.model_id
        );

        assert.equal(provider.id, 'main');
        assert.equal(provider.model, 'main/deepseek-reasoner');
        assert.equal(provider.api_key, 'main-key');
    });

    await test('configLoader compatibility fill respects llm and vision model_id', () => {
        const config = createConfig();
        config.llm.api_key = '';
        config.llm.api_url = '';
        config.llm.model = '';
        config.vision.vision_model = {};

        llmProviderManager.init(config);
        configLoader.config = config;
        configLoader.ensureLLMCompat();

        assert.equal(config.llm.api_key, 'main-key');
        assert.equal(config.llm.api_url, 'https://main.example/v1');
        assert.equal(config.llm.model, 'main/deepseek-reasoner');
        assert.equal(config.vision.vision_model.api_key, 'vision-key');
        assert.equal(config.vision.vision_model.api_url, 'https://vision.example/v1');
        assert.equal(config.vision.vision_model.model, 'vision/qwen-vl-plus');
    });

    await test('LLMClient updateConfig keeps provider-selected model', () => {
        const config = createConfig();
        llmProviderManager.init(config);

        const client = new LLMClient({
            llm: {
                api_key: 'old-key',
                api_url: 'https://old.example/v1',
                model: 'old-model',
                temperature: 0.1
            }
        });

        client.updateConfig({
            llm: {
                provider_id: 'main',
                model_id: 'main/deepseek-chat'
            }
        });

        assert.equal(client.apiKey, 'main-key');
        assert.equal(client.apiUrl, 'https://main.example/v1');
        assert.equal(client.model, 'main/deepseek-chat');
        assert.equal(client.temperature, 0.7);
    });

    await test('llmProviderManager falls back to first enabled model when selected model is disabled', () => {
        const config = createConfig();
        config.llm.model_id = 'main/deepseek-reasoner';
        config.llm.model = 'main/deepseek-reasoner';
        config.llm_providers[0].models[1].enabled = false;
        llmProviderManager.init(config);

        const provider = llmProviderManager.resolveProvider(
            config.llm.provider_id,
            config.llm,
            config.llm.model_id
        );

        assert.equal(provider.model, 'main/deepseek-chat');
    });

    await test('PluginContext callLLM uses provider_id plus explicit model override', async () => {
        const config = createConfig();
        llmProviderManager.init(config);

        const pluginContext = new PluginContext('test-plugin', config, null, null);
        const originalFetch = global.fetch;
        let capturedBody = null;

        global.fetch = async (_url, options) => {
            capturedBody = JSON.parse(options.body);
            return {
                ok: true,
                async json() {
                    return { choices: [{ message: { content: 'plugin-ok' } }] };
                }
            };
        };

        try {
            const result = await pluginContext.callLLM('hello', {
                provider_id: 'main',
                model: 'main/deepseek-chat',
                temperature: 0.55
            });

            assert.equal(result, 'plugin-ok');
            assert.equal(capturedBody.model, 'main/deepseek-chat');
            assert.equal(capturedBody.temperature, 0.55);
        } finally {
            global.fetch = originalFetch;
        }
    });

    await test('VoiceChatFacade exposes selected provider model to old callers', () => {
        const config = createConfig();
        llmProviderManager.init(config);

        const originalInitializeSync = VoiceChatFacade.prototype.initializeSync;
        VoiceChatFacade.prototype.initializeSync = function noop() {};

        try {
            const facade = new VoiceChatFacade(null, null, null, () => {}, () => {}, config);

            assert.equal(facade.API_KEY, 'main-key');
            assert.equal(facade.API_URL, 'https://main.example/v1');
            assert.equal(facade.MODEL, 'main/deepseek-reasoner');
        } finally {
            VoiceChatFacade.prototype.initializeSync = originalInitializeSync;
        }
    });

    await test('configLoader compatibility keeps legacy llm fields usable for direct readers', () => {
        const config = createConfig();
        config.llm.api_key = '';
        config.llm.api_url = '';
        config.llm.model = '';

        llmProviderManager.init(config);
        configLoader.config = config;
        configLoader.ensureLLMCompat();

        // Legacy modules like ContextCompressor read these direct fields.
        assert.equal(config.llm.api_key, 'main-key');
        assert.equal(config.llm.api_url, 'https://main.example/v1');
        assert.equal(config.llm.model, 'main/deepseek-reasoner');
    });

    await test('BarrageManager reuses resolved provider model', () => {
        const config = createConfig();
        llmProviderManager.init(config);

        const originalStartQueueProcessor = BarrageManager.prototype.startQueueProcessor;
        BarrageManager.prototype.startQueueProcessor = function noop() {};

        try {
            const barrageManager = new BarrageManager(config);
            assert.equal(barrageManager.llmClient.apiKey, 'main-key');
            assert.equal(barrageManager.llmClient.apiUrl, 'https://main.example/v1');
            assert.equal(barrageManager.llmClient.model, 'main/deepseek-reasoner');
        } finally {
            BarrageManager.prototype.startQueueProcessor = originalStartQueueProcessor;
        }
    });

    await test('LLMHandler builds main and vision clients from provider registry', () => {
        const config = createConfig();
        llmProviderManager.init(config);

        const capturedProviders = [];
        const originalFromProviderConfig = LLMClient.fromProviderConfig;

        LLMClient.fromProviderConfig = (provider) => {
            capturedProviders.push({ id: provider.id, model: provider.model });
            return {
                chatCompletion: async () => ({ content: 'ok', tool_calls: [] })
            };
        };

        try {
            const sendToLLM = LLMHandler.createEnhancedSendToLLM(
                {
                    messages: [],
                    enableContextLimit: false,
                    trimMessages() {},
                    shouldTakeScreenshot: async () => false,
                    takeScreenshotBase64: async () => null
                },
                null,
                false,
                config
            );

            assert.equal(typeof sendToLLM, 'function');
            assert.deepEqual(capturedProviders, [
                { id: 'main', model: 'main/deepseek-reasoner' },
                { id: 'vision', model: 'vision/qwen-vl-plus' }
            ]);
        } finally {
            LLMClient.fromProviderConfig = originalFromProviderConfig;
        }
    });

    console.log(`\nSummary: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
});
