const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function clock() {
    let now = 0;
    let id = 0;
    const timers = new Map();
    return {
        Date: { now: () => now },
        setTimeout(fn, delay) { const key = ++id; timers.set(key, { at: now + delay, fn }); return key; },
        clearTimeout(key) { timers.delete(key); },
        advance(ms) {
            const until = now + ms;
            for (;;) {
                const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                timers.delete(next[0]); now = next[1].at; next[1].fn();
            }
            now = until;
        }
    };
}

function load(relative, time, overrides = {}, globals = {}) {
    const file = path.resolve(__dirname, relative);
    const module = { exports: {} };
    const actualRequire = createRequire(file);
    const context = vm.createContext({ module, exports: module.exports, console: { log() {}, error() {} },
        global: {}, window: {}, ...time,
        require: name => Object.hasOwn(overrides, name) ? overrides[name] : actualRequire(name), ...globals });
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return module.exports;
}

function textOnly() {
    const time = clock();
    const { TextMouthDriver } = load('text-mouth-driver.js', time);
    const values = [];
    const captions = [];
    const { TTSFactory } = load('tts-factory.js', time, {
        './text-mouth-driver': { TextMouthDriver },
        './tts-processor.js': { EnhancedTextProcessor: class { constructor() { throw new Error('TTS must remain disabled'); } } },
        '../api-utils.js': { logToTerminal() {} }, '../core/event-bus.js': { eventBus: { emit() {} } }
    }, { document: { getElementById: () => null } });
    const processor = TTSFactory.create({ tts: { enabled: false } }, { setMouthOpenY: value => values.push(value) }, null,
        { showSubtitle: text => captions.push(text), hideSubtitle() {} }, () => {});
    return { time, processor, values, captions };
}

test('a text-only full reply animates the mouth and closes it without creating TTS', () => {
    const h = textOnly();
    h.processor.processTextToSpeech('你好，这是纯文本回复。');
    assert.ok(h.values.some(value => value > 0));
    assert.match(h.captions[0], /纯文本回复/);
    assert.equal(h.processor.isPlaying(), false);
    h.time.advance(4000);
    assert.equal(h.values.at(-1), 0);
});

test('a text-only streaming reply keeps mouth animation and final subtitles', () => {
    const h = textOnly();
    h.processor.addStreamingText('你好');
    h.time.advance(100);
    h.processor.addStreamingText('，我在回复。');
    h.processor.finalizeStreamingText();
    assert.ok(h.values.some(value => value > 0));
    assert.match(h.captions.at(-1), /你好，我在回复/);
    h.time.advance(4000);
    assert.equal(h.values.at(-1), 0);
});

test('reset and interruption close the text-only mouth and cancel further animation', () => {
    for (const action of ['reset', 'interrupt']) {
        const h = textOnly();
        h.processor.addStreamingText('你好世界');
        h.processor[action]();
        assert.equal(h.values.at(-1), 0);
        const count = h.values.length;
        h.time.advance(4000);
        assert.equal(h.values.length, count);
    }
});

test('text-only mouth values route through the active VRM and follow model switches', () => {
    const h = textOnly();
    const { avatarFacade } = load('../avatar/avatar-facade.js', h.time, {
        electron: { ipcRenderer: {} }, '../api-utils.js': { logToTerminal() {} }, './transition-overlay.js': {}
    });
    const { VRMModelAdapter } = load('../avatar/vrm/model-adapter.js', h.time, { three: {}, '../../services/vmc-sender.js': {} });
    const expressions = new Map();
    const target = { vrm: { expressionManager: { setValue: (name, value) => expressions.set(name, value) } } };
    avatarFacade._context = { ttsProcessor: h.processor };
    avatarFacade._activeDriver = { setMouth: value => VRMModelAdapter.prototype._setVRMParameter.call(target, 'ParamMouthOpenY', value) };
    avatarFacade._wireMouthSink();
    h.processor.addStreamingText('纯文本口型');
    assert.ok(expressions.get('aa') > 0);
    assert.deepEqual(h.values, []);
    const nextModel = [];
    avatarFacade._activeDriver = { setMouth: value => nextModel.push(value) };
    avatarFacade._wireMouthSink();
    h.time.advance(100);
    assert.ok(nextModel.some(value => value > 0));
    h.processor.interrupt();
    assert.equal(nextModel.at(-1), 0);
});

test('TTS failure fallback also drives the mouth and stops on completion, reset or interrupt', () => {
    for (const action of ['complete', 'reset', 'interrupt']) {
        const time = clock();
        const { TextMouthDriver } = load('text-mouth-driver.js', time);
        const values = [];
        class PlaybackEngine {
            constructor(_config, sink) { this.onAudioDataCallback = sink; }
            reset() {}
            stop() {}
        }
        class RequestHandler { reset() {} abortAllRequests() {} }
        const { EnhancedTextProcessor } = load('tts-processor.js', time, {
            './text-mouth-driver': { TextMouthDriver },
            './tts-playback-engine.js': { TTSPlaybackEngine: PlaybackEngine },
            './tts-request-handler.js': { TTSRequestHandler: RequestHandler },
            '../core/event-bus.js': { eventBus: { emit() {} } }
        });
        EnhancedTextProcessor.prototype.startProcessingThread = () => {};
        EnhancedTextProcessor.prototype.startPlaybackThread = () => {};
        const processor = new EnhancedTextProcessor('', value => values.push(value), null, null, {});
        processor.appendFallbackText('你好');
        time.advance(180);
        assert.ok(values.some(value => value > 0));
        if (action !== 'complete') processor[action]();
        time.advance(1500);
        assert.equal(values.at(-1), 0);
    }
});

test('emotion tags alone do not create mouth movement', () => {
    const h = textOnly();
    h.processor.processTextToSpeech('<开心>');
    h.processor.addStreamingText('<难过>');
    h.time.advance(4000);
    assert.deepEqual(h.values, []);
});
