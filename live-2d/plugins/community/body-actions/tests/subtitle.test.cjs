const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripMotionTags, parseActions } = require('../protocol');
const BodyActionsPlugin = require('../index');
const { RuntimeHooks } = require('../runtime-hooks');
const root = path.resolve(__dirname, '../../../..');

function displayHarness() {
    const plugin = new BodyActionsPlugin({}, { getConfig: () => ({ subtitle_labels: { user: '主人' } }) });
    plugin.config = {};
    plugin.adapter = () => ({ modelType: 'vrm' });
    const common = { console, setTimeout, clearTimeout, __dirname: path.join(root, 'js/core') };
    const globalState = {};
    const container = { style: {}, scrollHeight: 100 }, subtitle = { textContent: '' };
    const document = { getElementById: id => id === 'subtitle-container' ? container : id === 'subtitle-text' ? subtitle : null };
    const uiContext = { ...common, global: globalState, document, module: { exports: {} },
        require: () => ({ ipcRenderer: {}, logToTerminal() {} }) };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/ui/ui-controller.js'), 'utf8'), uiContext);
    const controller = { config: {}, applySubtitlePosition() {},
        showSubtitle(text) { uiContext.module.exports.UIController.prototype.showSubtitle.call(this, text); } };
    globalState.uiController = controller;
    const hooks = new RuntimeHooks(plugin, globalState);
    hooks.refresh();
    const show = text => {
        controller.showSubtitle(text);
        return subtitle.textContent;
    };
    return { plugin, hooks, globalState, document, show, subtitle };
}

test('actual subtitle DOM never receives the reported valid or unknown action tags', () => {
    const { show } = displayHarness();
    const actualReply = 'Fake Neuro: 好啦。[shake head][cross arms][sigh] 看好了！[jump backward][land][backflip][cartwheel]';
    const result = show(actualReply);
    assert(!result.includes('['));
    assert(!/sigh|land|backflip|cartwheel|shake|cross/.test(result));
    assert(result.includes('好啦。') && result.includes('看好了！'));
});

test('every streamed prefix hides the opening bracket and unfinished unknown action', () => {
    const { show } = displayHarness();
    const text = '你好[cartwheel]再见[sigh]';
    for (let end = 0; end <= text.length; end++) {
        const visible = show('Fake Neuro: ' + text.slice(0, end));
        assert(!/[\[\]]|cart|sigh/.test(visible), visible);
    }
});

test('assistant brackets are hidden while user input and disabled plugin display remain intact', () => {
    const { show, hooks } = displayHarness();
    assert.equal(show('Fake Neuro: 请看 [OpenAI] 和 [说明]。'), 'Fake Neuro: 请看 和 。');
    assert.equal(show('主人: 我输入 [backflip]'), '主人: 我输入 [backflip]');
    hooks.dispose();
    assert.equal(show('Fake Neuro: [backflip]'), 'Fake Neuro: [backflip]');
});

test('reported new verbs execute as single actions, while unknown controls still never become speech', async () => {
    const { plugin } = displayHarness();
    const text = '你好[spin around][sigh][backflip][land][cartwheel]';
    assert.deepEqual(parseActions(text, 5).actions, ['spin around', 'sigh', 'backflip', 'land', 'cartwheel']);
    assert.equal(stripMotionTags(text), '你好');
    assert.equal(await plugin.onTTSText(text), '你好');
});

test('real virtual-TTS factory filters both direct and streamed subtitle paths', () => {
    const { globalState, document, show, subtitle, hooks } = displayHarness();
    const context = { global: globalState, document, module: { exports: {} }, console: { log() {} },
        setTimeout: () => 0, require: name => {
            if (name.includes('tts-processor')) return {};
            if (name.includes('api-utils')) return { logToTerminal() {} };
            if (name.includes('event-bus')) return { eventBus: { emit() {} } };
            return { Events: {} };
        } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/voice/tts-factory.js'), 'utf8'), context);
    const tts = context.module.exports.TTSFactory.create({ tts: { enabled: false } }, {}, null,
        { showSubtitle: show, hideSubtitle() {} }, () => {});
    globalState.ttsProcessor = tts;
    hooks.refresh();
    tts.processTextToSpeech('你好[backflip][land][cartwheel]');
    assert.equal(subtitle.textContent, 'Fake Neuro: 你好');
    hooks.beginRequest(true);
    for (const token of ['再见[', 'cart', 'wheel', ']']) {
        tts.addStreamingText(token);
        assert(!/[\[\]]|cart|wheel/.test(subtitle.textContent));
    }
    tts.finalizeStreamingText();
    assert.equal(subtitle.textContent, 'Fake Neuro: 再见');
});
