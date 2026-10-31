const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { applyRuntimeConfig } = require('./runtime-llm-config');

test('saving a first provider and replacing it rebinds both dialogue entry points without losing history', () => {
    const shared = { llm: {} };
    const history = [{ role: 'user', content: 'Keep this conversation' }];
    const voiceChat = { messages: history, config: shared, asrEnabled: true,
        inputRouter: { setLLMHandler(handler) { this.handler = handler; } } };
    const tts = {};
    let provider = { api_url: 'https://first.example/v1', api_key: 'first', model: 'model-one' };
    const options = { voiceChat, ttsProcessor: tts, resolveProvider: () => provider,
        createHandler: (voice, processor, asr, config) => {
            assert.equal(processor, tts); assert.equal(asr, true); assert.equal(config, shared);
            const endpoint = voice.API_URL;
            return () => endpoint;
        } };
    assert.equal(applyRuntimeConfig(shared, { llm: { provider_id: 'main' } }, options), shared);
    assert.equal(voiceChat.sendToLLM(), 'https://first.example/v1');
    assert.equal(voiceChat.inputRouter.handler, voiceChat.sendToLLM);
    provider = { api_url: 'https://second.example/v1', api_key: 'second', model: 'model-two' };
    applyRuntimeConfig(shared, { llm: { provider_id: 'other' } }, options);
    assert.equal(voiceChat.sendToLLM(), 'https://second.example/v1');
    assert.equal(voiceChat.inputRouter.handler, voiceChat.sendToLLM);
    assert.equal(voiceChat.MODEL, 'model-two'); assert.equal(voiceChat.API_KEY, 'second');
    assert.equal(voiceChat.messages, history); assert.equal(history.length, 1);
    assert.equal(voiceChat.config, shared);
});

test('config can reload before voice initialization and removed keys do not survive', () => {
    const config = { llm: {}, removed: true };
    assert.equal(applyRuntimeConfig(config, { llm: { provider_id: 'main' } }), config);
    assert.equal('removed' in config, false);
});

test('control-panel saves notify the pet even when no cloud TTS is enabled', async () => {
    const source = fs.readFileSync(require.resolve('../../control-main.js'), 'utf8');
    const start = source.indexOf("ipcMain.handle('control:save-config'");
    const end = source.indexOf("ipcMain.handle('control:list-live2d-models'", start);
    let handler; const calls = [];
    vm.runInNewContext(source.slice(start, end), {
        ipcMain: { handle: (_channel, value) => { handler = value; } },
        saveControlConfig: () => calls.push('saved'),
        notifyDesktopReload: async () => calls.push('reloaded')
    });
    const result = await handler({}, { llm: {}, cloud: {} });
    assert.equal(result.ok, true); assert.deepEqual(calls, ['saved', 'reloaded']);
});
