const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function setup() {
    let now = 0;
    let sequence = 0;
    const timers = new Map();
    const time = {
        Date: { now: () => now },
        setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        advance(duration) {
            const until = now + duration;
            for (;;) {
                const next = [...timers].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                timers.delete(next[0]); now = next[1].at; next[1].fn();
            }
            now = until;
        }
    };
    const container = { style: {}, scrollHeight: 0 };
    const text = { textContent: '' };
    const document = { getElementById: id => id === 'subtitle-container' ? container : id === 'subtitle-text' ? text : null };
    function load(relative, overrides = {}, globals = {}) {
        const file = path.resolve(__dirname, relative);
        const module = { exports: {} };
        const actualRequire = createRequire(file);
        const context = vm.createContext({ module, exports: module.exports, document,
            console: { log() {}, error() {} }, ...time,
            require: name => Object.hasOwn(overrides, name) ? overrides[name] : actualRequire(name), ...globals });
        vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
        return module.exports;
    }
    const { UIController } = load('../ui/ui-controller.js', { electron: {}, '../api-utils.js': {} });
    const ui = Object.create(UIController.prototype);
    Object.assign(ui, { config: {}, subtitleTimeout: null, applySubtitlePosition() {} });
    const { TextMouthDriver } = load('text-mouth-driver.js');
    class PlaybackEngine { constructor() { this.onAudioDataCallback = () => {}; } reset() {} stop() {} }
    class RequestHandler { reset() {} abortAllRequests() {} segmentStreamingText() {} }
    const { EnhancedTextProcessor } = load('tts-processor.js', {
        './text-mouth-driver': { TextMouthDriver }, './tts-playback-engine.js': { TTSPlaybackEngine: PlaybackEngine },
        './tts-request-handler.js': { TTSRequestHandler: RequestHandler }, '../core/event-bus.js': { eventBus: { emit() {} } }
    }, { showSubtitle: ui.showSubtitle.bind(ui), hideSubtitle: ui.hideSubtitle.bind(ui) });
    EnhancedTextProcessor.prototype.startProcessingThread = () => {};
    EnhancedTextProcessor.prototype.startPlaybackThread = () => {};
    const processor = new EnhancedTextProcessor('', null, null, null, {});
    const { TTSFactory } = load('tts-factory.js', {
        './text-mouth-driver': { TextMouthDriver }, './tts-processor.js': {},
        '../api-utils.js': { logToTerminal() {} }, '../core/event-bus.js': { eventBus: { emit() {} } }
    });
    const virtual = TTSFactory.create({ tts: { enabled: false } }, { setMouthOpenY() {} }, null, ui, () => {});
    return { time, ui, container, text, processor, virtual };
}

test('fallback subtitles expire three seconds after the last character without a completion Promise', () => {
    const h = setup();
    h.processor.appendFallbackText('你好');
    h.time.advance(540);
    assert.equal(h.processor.completionPromise, null);
    assert.equal(h.container.style.display, 'block');
    assert.match(h.text.textContent, /你好/);
    h.time.advance(2999);
    assert.equal(h.container.style.display, 'block');
    h.time.advance(1);
    assert.equal(h.container.style.display, 'none');
});

test('new fallback text replaces the previous subtitle expiry timer', () => {
    const h = setup();
    h.processor.appendFallbackText('你');
    h.time.advance(360);
    h.time.advance(1000);
    h.processor.appendFallbackText('好');
    h.time.advance(360);
    h.time.advance(1640);
    assert.equal(h.container.style.display, 'block');
    assert.match(h.text.textContent, /你好/);
    h.time.advance(1360);
    assert.equal(h.container.style.display, 'none');
});

test('an old completion timeout cannot hide a subsequent reply after reset or new stream text', () => {
    for (const action of ['reset', 'new-stream']) {
        const h = setup();
        h.ui.showSubtitle('old reply');
        h.processor.handleAllComplete();
        h.time.advance(500);
        if (action === 'reset') h.processor.reset();
        else h.processor.addStreamingText('next reply');
        h.ui.showSubtitle('next reply');
        h.time.advance(2000);
        assert.equal(h.container.style.display, 'block');
        assert.equal(h.text.textContent, 'next reply');
    }
});

test('disabled TTS full and streaming replies both expire using the real subtitle controller', () => {
    for (const streaming of [false, true]) {
        const h = setup();
        if (streaming) { h.virtual.addStreamingText('你好'); h.virtual.finalizeStreamingText(); }
        else h.virtual.processTextToSpeech('你好');
        assert.equal(h.container.style.display, 'block');
        h.time.advance(3000);
        assert.equal(h.container.style.display, 'none');
    }
});
