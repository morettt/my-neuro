const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BodyActionsPlugin = require('../index');
const { RuntimeHooks } = require('../runtime-hooks');
const root = path.resolve(__dirname, '../../../..');

async function runPipeline(withPlugin, answer = '你好！[raise left hand] 我举手啦。') {
    const streamed = [], spoken = [];
    let finalized = 0, requestedMessages;
    const plugin = new BodyActionsPlugin({}, { log() {} });
    plugin.config = {}; plugin.epoch = 0;
    plugin.run = async () => {};
    class Client {
        async chatCompletion(messages, _tools, _stream, onChunk) {
            requestedMessages = messages;
            for (const chunk of ['你好！[rai', 'se left hand', '] 我举手啦。']) onChunk?.(chunk);
            return { content: answer };
        }
    }
    const noop = () => {};
    const deps = {
        '../api-utils.js': { logToTerminal: noop, logToolAction: noop, getMergedToolsList: () => [] },
        '../core/event-bus.js': { eventBus: { emit: noop, on: noop, off: noop } },
        '../core/events.js': { Events: {} },
        '../core/app-state.js': { appState: { isPlayingTTS: () => false, clearInterrupted: noop, isInterrupted: () => false } },
        './llm-client.js': { LLMClient: Client },
        './tool-executor.js': { toolExecutor: {} },
        '../avatar/motion-mode.js': { getAvatarMotionMode: () => 'legacy' },
        './motion-director.js': { motionDirector: { cancel: noop }, isChoreographyConfigEnabled: () => false },
        '../core/llm-provider.js': { llmProviderManager: { resolveProviderOrFallback: () => null } }
    };
    const globalState = withPlugin ? { pluginManager: {
        runLLMRequestHooks: request => plugin.onLLMRequest(request),
        runLLMResponseHooks: response => plugin.onLLMResponse(response),
        runTTSStartHooks: async () => {}
    } } : {};
    const context = {
        require: name => deps[name] || require(name), module: { exports: {} },
        __dirname: path.join(root, 'js/ai'), global: globalState,
        console: { log: noop, error: noop, warn: noop }, setTimeout, clearTimeout,
        document: { getElementById: () => null }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/ai/llm-handler.js'), 'utf8'), context);
    const voice = { messages: [{ role: 'system', content: 'Original persona' }], shouldTakeScreenshot: () => false,
        saveConversationHistory: noop, showSubtitle: message => { throw Error(message); } };
    const tts = { reset: noop, addStreamingText: chunk => streamed.push(chunk),
        finalizeStreamingText: () => finalized++, processTextToSpeech: text => spoken.push(text) };
    globalState.ttsProcessor = tts;
    if (withPlugin) plugin.runtime = new RuntimeHooks(plugin, globalState);
    const send = context.module.exports.LLMHandler.createEnhancedSendToLLM(voice, tts, false, {
        llm: { api_key: 'test', api_url: 'http://example.invalid', model: 'test' }, ui: {}, vision: { enabled: false }
    });
    try { await send('请举起左手'); }
    finally { plugin.runtime?.dispose(); }
    return { streamed, spoken, finalized, requestedMessages };
}

test('real LLM handler with plugin withholds split tags and sends only clean full text to TTS/subtitles', async () => {
    const result = await runPipeline(true);
    assert.deepEqual(result.streamed, []);
    assert.deepEqual(result.spoken, ['你好！ 我举手啦。']);
    assert.equal(result.finalized, 0);
    assert(result.requestedMessages.some(message => message.content.includes('每对 [] 必须且只能包含一个')));
});

test('without the body plugin the existing incremental TTS path remains active', async () => {
    const result = await runPipeline(false);
    assert.equal(result.streamed.length, 3);
    assert.equal(result.finalized, 1);
    assert.deepEqual(result.spoken, []);
});

test('reported and unrecognized English control tags are absent from final subtitle/TTS input', async () => {
    const result = await runPipeline(true, '看好啦！[cross arms][backflip][land][cartwheel][sigh]');
    assert.deepEqual(result.spoken, ['看好啦！']);
    assert.deepEqual(result.streamed, []);
});
