'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { llmProviderManager } = require(path.join(ROOT, 'js/core/llm-provider.js'));
const {
    resolveChoreographyApi,
    isChoreographyConfigEnabled,
    isUsableChoreographyApi,
    summarizeChoreographyApi,
    readPairedIds
} = require(path.join(ROOT, 'js/ai/motion-director.js'));
const {
    shouldRunMotionChoreography,
    describeChoreographySkip
} = require(path.join(ROOT, 'js/ai/llm-handler.js'));

const FAKE_MAIN_KEY = 'sk-test-main';
const FAKE_CHOREO_KEY = 'sk-test-choreo';

function initProviders() {
    llmProviderManager.init({
        llm: {
            provider_id: 'main',
            model_id: 'chat-model'
        },
        llm_providers: [
            {
                id: 'main',
                name: 'Main',
                api_url: 'https://api.example.com/v1',
                api_key: FAKE_MAIN_KEY,
                enabled: true,
                models: [{ model_id: 'chat-model', enabled: true }]
            },
            {
                id: 'choreo',
                name: 'Choreo',
                api_url: 'https://choreo.example.com/v1',
                api_key: FAKE_CHOREO_KEY,
                enabled: true,
                models: [{ model_id: 'choreo-model', enabled: true }]
            },
            {
                id: 'disabled-provider',
                name: 'Disabled',
                api_url: 'https://disabled.example.com/v1',
                api_key: 'sk-disabled',
                enabled: false,
                models: [{ model_id: 'disabled-model', enabled: true }]
            }
        ]
    });
}

function baseConfig(overrides = {}) {
    return {
        llm: {
            provider_id: 'main',
            model_id: 'chat-model'
        },
        motion_director: {
            enabled: true,
            provider_id: '',
            model_id: '',
            body: { provider_id: null, model_id: null },
            face: { provider_id: null, model_id: null }
        },
        ui: {
            avatar_motion_mode: 'blend'
        },
        tts: { enabled: true },
        ...overrides
    };
}

let failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`ok  ${name}`);
    } catch (error) {
        failed += 1;
        console.error(`fail  ${name}`);
        console.error(`      ${error && error.stack || error}`);
    }
}

initProviders();

test('empty dedicated fields use main dialogue model', () => {
    const config = baseConfig();
    const body = resolveChoreographyApi(config, 'body');
    const face = resolveChoreographyApi(config, 'face');
    assert.strictEqual(body.source, 'dialogue');
    assert.strictEqual(face.source, 'dialogue');
    assert.strictEqual(body.model, 'chat-model');
    assert.strictEqual(face.model, 'chat-model');
    assert.strictEqual(body.provider_id, 'main');
    assert.ok(isUsableChoreographyApi(body));
});

test('paired top-level dedicated fields stay dedicated', () => {
    const config = baseConfig({
        motion_director: {
            enabled: true,
            provider_id: 'choreo',
            model_id: 'choreo-model'
        }
    });
    const resolved = resolveChoreographyApi(config, 'body');
    assert.strictEqual(resolved.source, 'dedicated');
    assert.strictEqual(resolved.model, 'choreo-model');
    assert.strictEqual(resolved.provider_id, 'choreo');
    assert.ok(isUsableChoreographyApi(resolved));
});

test('half-filled dedicated pair still uses dialogue', () => {
    const config = baseConfig({
        motion_director: {
            enabled: true,
            provider_id: 'choreo',
            model_id: ''
        }
    });
    const resolved = resolveChoreographyApi(config, 'face');
    assert.strictEqual(resolved.source, 'dialogue');
    assert.strictEqual(resolved.model, 'chat-model');
});

test('body dedicated and face empty split sources', () => {
    const config = baseConfig({
        motion_director: {
            enabled: true,
            body: { provider_id: 'choreo', model_id: 'choreo-model' },
            face: { provider_id: '', model_id: '' }
        }
    });
    const body = resolveChoreographyApi(config, 'body');
    const face = resolveChoreographyApi(config, 'face');
    assert.strictEqual(body.source, 'dedicated');
    assert.strictEqual(body.model, 'choreo-model');
    assert.strictEqual(face.source, 'dialogue');
    assert.strictEqual(face.model, 'chat-model');
});

test('missing dedicated provider is not silently swapped to dialogue', () => {
    const config = baseConfig({
        motion_director: {
            enabled: true,
            provider_id: 'missing-provider',
            model_id: 'missing-model'
        }
    });
    const resolved = resolveChoreographyApi(config, 'body');
    assert.strictEqual(resolved.source, 'dedicated');
    assert.strictEqual(isUsableChoreographyApi(resolved), false);
});

test('disabled dedicated provider is not usable', () => {
    const config = baseConfig({
        motion_director: {
            enabled: true,
            provider_id: 'disabled-provider',
            model_id: 'disabled-model'
        }
    });
    const resolved = resolveChoreographyApi(config, 'body');
    assert.strictEqual(isUsableChoreographyApi(resolved), false);
});

test('legacy mode disables choreography config', () => {
    const config = baseConfig({
        ui: { avatar_motion_mode: 'legacy' }
    });
    assert.strictEqual(isChoreographyConfigEnabled(config), false);
});

test('blend with enabled false still allows choreography', () => {
    const config = baseConfig({
        motion_director: { enabled: false },
        ui: { avatar_motion_mode: 'blend' }
    });
    assert.strictEqual(isChoreographyConfigEnabled(config), true);
});

test('director with missing enabled allows choreography', () => {
    const config = baseConfig({
        motion_director: {},
        ui: { avatar_motion_mode: 'director' }
    });
    assert.strictEqual(isChoreographyConfigEnabled(config), true);
});

test('summary never includes api key', () => {
    const config = baseConfig();
    const resolved = resolveChoreographyApi(config, 'body');
    const summary = summarizeChoreographyApi(resolved);
    const text = JSON.stringify(summary);
    assert.strictEqual(summary.has_api_key, true);
    assert.ok(!text.includes(FAKE_MAIN_KEY));
    assert.ok(!text.includes(FAKE_CHOREO_KEY));
    assert.ok(!Object.prototype.hasOwnProperty.call(summary, 'api_key'));
    assert.ok(!Object.prototype.hasOwnProperty.call(summary, 'api_url'));
});

test('readPairedIds rejects incomplete pairs', () => {
    assert.strictEqual(readPairedIds({ provider_id: 'choreo' }), null);
    assert.strictEqual(readPairedIds({ model_id: 'choreo-model' }), null);
    assert.strictEqual(readPairedIds({ provider_id: '', model_id: 'choreo-model' }), null);
    assert.deepStrictEqual(
        readPairedIds({ provider_id: 'choreo', model_id: 'choreo-model' }),
        { providerId: 'choreo', modelId: 'choreo-model' }
    );
});

test('shouldRunMotionChoreography respects live runtime gates', () => {
    const previous = global.paramDirector;
    try {
        global.paramDirector = { attached: true };
        const blend = baseConfig({
            motion_director: { enabled: false },
            ui: { avatar_motion_mode: 'blend' }
        });
        assert.strictEqual(shouldRunMotionChoreography(blend), true);

        const legacy = baseConfig({
            ui: { avatar_motion_mode: 'legacy' }
        });
        assert.strictEqual(describeChoreographySkip(legacy), 'legacy-or-paths-disabled');
        assert.strictEqual(shouldRunMotionChoreography(legacy), false);

        const noTts = baseConfig({ tts: { enabled: false } });
        assert.strictEqual(describeChoreographySkip(noTts), 'tts-disabled');

        delete global.paramDirector;
        assert.strictEqual(describeChoreographySkip(blend), 'no-param-director');
    } finally {
        global.paramDirector = previous;
    }
});

if (failed) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
}

console.log('\nall tests passed');
