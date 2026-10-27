const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { enrollmentUrl, uploadAudio, enrollVoice, queryVoice } = require('./aliyun-voice-clone');

const options = { api_key: 'test-key', model: 'cosyvoice-v3-flash', prefix: 'test1', audio_url: 'https://example.com/reference.wav' };
const response = output => ({ ok: true, status: 200, json: async () => ({ output }) });

test('enrollment binds the reference audio to the selected model', async () => {
  const result = await enrollVoice({ ...options, workspace_id: 'llm-test' }, async (url, init) => {
    assert.equal(url, 'https://llm-test.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization');
    assert.equal(init.headers.Authorization, 'Bearer test-key');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { model: 'voice-enrollment', input: {
      action: 'create_voice', target_model: options.model, prefix: 'test1', audio: options.audio_url
    } });
    return response({ voice_id: 'created-voice' });
  });
  assert.equal(result.voice_id, 'created-voice');
});

test('invalid options never send credentials to a service', async () => {
  const never = () => { throw new Error('unexpected network request'); };
  await assert.rejects(enrollVoice({ ...options, prefix: 'bad prefix' }, never), /音色名称/);
  await assert.rejects(enrollVoice({ ...options, model: 'unsupported' }, never), /CosyVoice/);
  await assert.rejects(enrollVoice({ ...options, audio_url: 'file:///secret' }, never), /HTTP/);
  assert.throws(() => enrollmentUrl('evil.com/path'), /业务空间/);
});

test('query preserves processing status and reports API errors', async () => {
  const result = await queryVoice({ ...options, voice_id: 'created-voice' }, async (_url, init) => {
    assert.equal(JSON.parse(init.body).input.action, 'query_voice');
    return response({ status: 'DEPLOYING', target_model: options.model });
  });
  assert.equal(result.status, 'DEPLOYING');
  await assert.rejects(enrollVoice(options, async () => ({ ok: false, status: 401, json: async () => ({ code: 'InvalidApiKey', message: 'key rejected' }) })), /key rejected/);
});

test('upload sends only the audio and upload token, using HTTPS', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-upload-test-'));
  const file = path.join(dir, 'reference.wav');
  fs.writeFileSync(file, Buffer.from('RIFF0000WAVE'));
  try {
    const result = await uploadAudio(file, { upload_token: 'upload-only-token' }, async (url, init) => {
      assert.equal(url, 'https://mynewbot.com/api/voice-audio?format=wav');
      assert.equal(init.headers.Authorization, 'Bearer upload-only-token');
      assert.equal(init.body.toString(), 'RIFF0000WAVE');
      return { ok: true, status: 200, json: async () => ({ ok: true, url: 'https://mynewbot.com/api/voice-audio/abc.wav' }) };
    });
    assert.equal(result.filename, 'reference.wav');
    await assert.rejects(uploadAudio(file, { upload_url: 'http://example.com/upload', upload_token: 'secret' }), /HTTPS/);
    await assert.rejects(uploadAudio(file, {}), /上传密钥/);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});

test('switching to a named voice updates synthesis without losing active request tracking', () => {
  const vm = require('node:vm');
  const file = path.join(__dirname, 'tts-request-handler.js');
  const context = vm.createContext({ module: { exports: {} }, require: id => id === '../api-utils.js'
    ? { logToTerminal() {} } : require(id) });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  const { TTSRequestHandler } = context.module.exports;
  const handler = new TTSRequestHandler({ cloud: { volcengine_tts: { enabled: true } } }, 'http://localhost:5000');
  const activeRequests = handler.activeRequests;
  activeRequests.add('in-flight-request');
  handler.useAliyunVoice({ cloud: { aliyun_tts: { api_key: 'test-key', model: 'cosyvoice-v3.5-plus', voice: 'saved-voice' } } });
  assert.equal(handler.aliyunVoice, 'saved-voice');
  assert.equal(handler.aliyunModel, 'cosyvoice-v3.5-plus');
  assert.equal(handler.aliyunTtsEnabled, true);
  assert.equal(handler.volcTtsEnabled, false);
  assert.equal(handler.useGateway, false);
  assert.equal(handler.activeRequests, activeRequests);
  assert.equal(handler.activeRequests.size, 1);
});
