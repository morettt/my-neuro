const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { DEFAULT_SPEAKER, readVolcengineConfig, volcengineHeaders } = require('./volcengine-config');

test('new API key configuration defaults to the requested replica 2.0 voice', () => {
  const settings = readVolcengineConfig({ cloud: { volcengine_tts: {
    api_key: ' test-key ', appid: 'old-app', access_token: 'old-token',
    voice_type: 'zh_female_vv_uranus_bigtts', resource_id: 'seed-tts-2.0'
  } } });
  assert.equal(settings.apiKey, 'test-key');
  assert.equal(settings.voiceType, 'S_RCbi2PGQ1');
  assert.equal(settings.resourceId, 'seed-icl-2.0');
});

test('authentication headers use only the new API key and replica 2.0 resource', () => {
  const headers = volcengineHeaders('test-key');
  assert.equal(headers['X-Api-Key'], 'test-key');
  assert.equal(headers['X-Api-Resource-Id'], 'seed-icl-2.0');
  assert.equal(headers['X-Api-App-Key'], undefined);
  assert.equal(headers['X-Api-Access-Key'], undefined);
  assert.notEqual(headers['X-Api-Connect-Id'], volcengineHeaders('test-key')['X-Api-Connect-Id']);
  assert.throws(() => volcengineHeaders(''), /API Key/);
});

test('buffered synthesis reconnects when the API key changes', async () => {
  const connections = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    constructor(url, options) { super(); this.url = url; this.options = options; this.readyState = 1; connections.push(this); queueMicrotask(() => this.emit('open')); }
    close() { this.closed = true; this.emit('close'); }
  }
  const module = { exports: {} };
  const context = vm.createContext({ module, require: id => {
    if (id === 'ws') return Socket;
    if (id === '../api-utils.js') return { logToTerminal() {} };
    if (id === './volcengine-protocols.js') return { EventType: {}, MsgType: {}, startConnection: async () => {}, waitForEvent: async () => {} };
    return require(id);
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'tts-request-handler.js'), 'utf8'), context);
  const handler = new module.exports.TTSRequestHandler({ cloud: { volcengine_tts: { enabled: true, api_key: 'first-key' } } }, '');
  await handler._ensureVolcConnection();
  assert.equal(connections[0].options.headers['X-Api-Key'], 'first-key');
  assert.equal(handler.volcVoiceType, DEFAULT_SPEAKER);
  await handler._ensureVolcConnection();
  assert.equal(connections.length, 1);
  handler.useVolcengineVoice({ cloud: { volcengine_tts: { api_key: 'second-key' } } });
  await handler._ensureVolcConnection();
  assert.equal(connections[0].closed, true);
  assert.equal(connections[1].options.headers['X-Api-Key'], 'second-key');
  assert.equal(handler.aliyunTtsEnabled, false);
  handler._closeVolcConnection();
});

test('streaming sessions use the same default replica and authentication settings', () => {
  const { VolcengineStreamingSession } = require('./volcengine-streaming');
  const session = new VolcengineStreamingSession({ cloud: { volcengine_tts: { api_key: 'test-key' } } }, {});
  assert.equal(session.apiKey, 'test-key');
  assert.equal(session.voiceType, DEFAULT_SPEAKER);
  assert.equal(session.resourceId, 'seed-icl-2.0');
});

test('a saved custom replica ID is used by both synthesis paths', () => {
  const config = { cloud: { volcengine_tts: { api_key: 'test-key', voice_type: ' S_CustomVoice2 ' } } };
  const { TTSRequestHandler } = require('./tts-request-handler');
  const { VolcengineStreamingSession } = require('./volcengine-streaming');
  assert.equal(readVolcengineConfig(config).voiceType, 'S_CustomVoice2');
  const handler = new TTSRequestHandler(config, '');
  assert.equal(handler.volcVoiceType, 'S_CustomVoice2');
  const session = new VolcengineStreamingSession(config, {});
  assert.equal(session.voiceType, 'S_CustomVoice2');
  handler.useVolcengineVoice({ cloud: { volcengine_tts: { api_key: 'test-key', voice_type: 'S_OtherVoice3' } } });
  assert.equal(handler.volcVoiceType, 'S_OtherVoice3');
});
