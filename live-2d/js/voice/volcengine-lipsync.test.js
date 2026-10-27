const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadModule(relative, overrides = {}, globals = {}) {
  const file = path.resolve(__dirname, relative);
  const module = { exports: {} };
  const actualRequire = createRequire(file);
  const context = vm.createContext({ module, exports: module.exports, Buffer, console,
    setTimeout: () => 0, clearTimeout() {}, global: {}, window: {},
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : actualRequire(name), ...globals });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return module.exports;
}

async function setup() {
  const frames = [];
  const { VolcengineStreamingSession } = loadModule('volcengine-streaming.js', {}, {
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {}
  });
  VolcengineStreamingSession.prototype.open = async () => {};
  VolcengineStreamingSession.prototype.sendToken = async () => {};
  class PlaybackEngine {
    constructor(_config, mouth) { this.onAudioDataCallback = mouth; }
  }
  class RequestHandler { constructor() { this.volcTtsEnabled = true; } }
  const { EnhancedTextProcessor } = loadModule('tts-processor.js', {
    './tts-playback-engine.js': { TTSPlaybackEngine: PlaybackEngine },
    './tts-request-handler.js': { TTSRequestHandler: RequestHandler },
    './volcengine-streaming.js': { VolcengineStreamingSession }
  });
  EnhancedTextProcessor.prototype.startProcessingThread = () => {};
  EnhancedTextProcessor.prototype.startPlaybackThread = () => {};
  const staleControllerValues = [];
  const processor = new EnhancedTextProcessor('', value => staleControllerValues.push(value), null, null, {});
  const { avatarFacade } = loadModule('../avatar/avatar-facade.js', {
    electron: { ipcRenderer: {} }, '../api-utils.js': { logToTerminal() {} }, './transition-overlay.js': {}
  });
  const { VRMModelAdapter } = loadModule('../avatar/vrm/model-adapter.js', {
    three: {}, '../../services/vmc-sender.js': {}
  });
  const expressions = new Map();
  const vrmTarget = { vrm: { expressionManager: { setValue: (name, value) => expressions.set(name, value) } } };
  avatarFacade._context = { ttsProcessor: processor };
  avatarFacade._activeDriver = { setMouth: value => VRMModelAdapter.prototype._setVRMParameter.call(vrmTarget, 'ParamMouthOpenY', value) };
  avatarFacade._wireMouthSink();
  processor.addStreamingText('hello');
  await processor._volcChain;
  const session = processor.volcSession;
  session.analyser = { frequencyBinCount: 16, getByteFrequencyData: values => values.fill(90) };
  session._startAnimLoop();
  return { frames, session, processor, avatarFacade, expressions, staleControllerValues };
}

test('Volcengine audio analysis drives VRM vowel expressions through the active avatar route', async () => {
  const h = await setup();
  h.frames.shift()();
  assert.ok(h.expressions.get('aa') > 0);
  assert.ok(h.expressions.get('oh') > 0);
  assert.ok(h.expressions.get('ou') > 0);
  assert.deepEqual(h.staleControllerValues, []);
  h.session.stop();
});

test('an existing streaming session follows avatar callback rebinding and model switches', async () => {
  const h = await setup();
  h.frames.shift()();
  const nextModel = [];
  h.avatarFacade._activeDriver = { setMouth: value => nextModel.push(value) };
  h.avatarFacade._wireMouthSink();
  h.frames.shift()();
  assert.ok(nextModel[0] > 0);
  h.session.stop();
  assert.equal(nextModel.at(-1), 0);
  assert.deepEqual(h.staleControllerValues, []);
});

test('normal completion and interruption both close the VRM mouth', async () => {
  for (const finish of ['_handleEnd', 'stop']) {
    const h = await setup();
    h.frames.shift()();
    assert.ok(h.expressions.get('aa') > 0);
    h.session[finish]();
    assert.equal(h.expressions.get('aa'), 0);
    assert.equal(h.expressions.get('oh'), 0);
    assert.equal(h.expressions.get('ou'), 0);
  }
});
