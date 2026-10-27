const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness({ voices = [], draft, failSave = false, saveWait } = {}) {
  const elements = new Map();
  class Element {
    constructor() { this.value = ''; this.hidden = false; this.disabled = false; this.dataset = {}; this.children = []; this.listeners = {}; this.duration = 12; this.classes = new Set(); this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c), toggle: (c, on) => on ? this.classes.add(c) : this.classes.delete(c) }; }
    addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); }
    async emit(event, data = {}) { if (event === 'click' && this.disabled) return; for (const fn of this.listeners[event] || []) await fn(data); }
    setAttribute(key, value) { this[key] = value; }
    replaceChildren() { this.children = []; }
    append(child) { this.children.push(child); }
    pause() {}
    focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    setCustomValidity(value) { this.validityMessage = value; }
    reportValidity() {}
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  $('aliyun-key').value = 'test-key'; $('aliyun-model').value = 'cosyvoice-v3-flash'; $('aliyun-voice').value = 'original-voice';
  const stages = ['upload', 'clone', 'save'].map(name => { const element = new Element(); element.dataset.voiceStep = name; return element; });
  const storage = new Map();
  const cacheKey = 'feiniu.aliyun.pending-voice.v1';
  if (draft) storage.set(cacheKey, JSON.stringify(draft));
  const settings = { voices };
  const calls = { upload: 0, enroll: 0, save: [] };
  const api = {
    selectAliyunAudio: async () => ({ ok: true, filename: 'reference.wav', size: 2048, preview: 'data:audio/wav;base64,AA==' }),
    uploadAliyunAudio: async () => { calls.upload++; return { ok: true, url: 'https://example.com/sample.wav', expires_at: Date.now() / 1000 + 86400 }; },
    enrollAliyunVoice: async () => { calls.enroll++; return { ok: true, voice_id: 'new-voice', model: 'cosyvoice-v3-flash' }; },
    queryAliyunVoice: async () => ({ ok: true, status: 'OK', model: 'cosyvoice-v3-flash' })
  };
  const context = vm.createContext({
    window: { controlApi: api }, document: { getElementById: $, querySelectorAll: () => stages, createElement: () => new Element() },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout: fn => { fn(); }, console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'aliyun-clone-ui.js'), 'utf8'), context);
  const initialize = () => context.window.initAliyunCloneUI({
    getSettings: () => settings,
    persistSelection: async (voice, entries) => {
      if (failSave) throw new Error('disk unavailable');
      if (saveWait) await saveWait;
      calls.save.push(JSON.parse(JSON.stringify(voice)));
      if (entries) settings.voices = entries;
      $('aliyun-voice').value = voice.voice_id; $('aliyun-model').value = voice.model;
    }
  });
  const ui = initialize(); ui.renderLibrary();
  return { $, ui, api, calls, settings, storage, cacheKey, stages, initialize, allowSave: () => { failSave = false; } };
}

test('selecting audio opens naming; confirming automatically uploads, clones, saves and uses it', async () => {
  const h = harness();
  await h.$('aliyun-select-audio').emit('click');
  await h.$('aliyun-audio-preview').emit('loadedmetadata');
  assert.equal(h.calls.upload, 0);
  assert.equal(h.$('aliyun-name-dialog').open, true);
  assert.equal(h.calls.enroll, 0);
  assert.equal(h.$('aliyun-voice').value, 'original-voice');
  h.$('aliyun-voice-name').value = '小雨';
  await h.$('aliyun-name-form').emit('submit', { preventDefault() {} });
  assert.equal(h.calls.upload, 1); assert.equal(h.calls.enroll, 1);
  assert.deepEqual(h.calls.save, [{ name: '小雨', voice_id: 'new-voice', model: 'cosyvoice-v3-flash' }]);
  assert.equal(h.settings.voices.length, 1);
  assert.equal(h.storage.has(h.cacheKey), false);
  assert.equal(h.$('aliyun-voice-library').hidden, false);
  assert.equal(h.$('aliyun-name-dialog').open, false);
  assert.equal(h.$('aliyun-saved-voices').children.some(option => option.selected && option.textContent === '小雨'), true);
});

test('a duplicate role name is rejected before any upload or cloning', async () => {
  const h = harness({ voices: [{ name: '小雨', voice_id: 'old-voice', model: 'cosyvoice-v3-flash' }] });
  await h.$('aliyun-select-audio').emit('click');
  await h.$('aliyun-audio-preview').emit('loadedmetadata');
  h.$('aliyun-voice-name').value = '小雨';
  await h.$('aliyun-name-form').emit('submit', { preventDefault() {} });
  assert.equal(h.calls.save.length, 0);
  assert.equal(h.calls.upload, 0); assert.equal(h.calls.enroll, 0);
  assert.match(h.$('aliyun-voice-name').validityMessage, /同名/);
  assert.equal(h.$('aliyun-name-dialog').open, true);
});

test('a failed save keeps the draft so saving can be retried without cloning again', async () => {
  const h = harness({ failSave: true, draft: { voice_id: 'new-voice', model: 'cosyvoice-v3-flash', ready: true, name: '温柔' } });
  await h.$('aliyun-query-voice').emit('click');
  assert.equal(h.storage.has(h.cacheKey), true);
  assert.match(h.$('aliyun-clone-status').textContent, /保存失败/);
  h.allowSave(); await h.$('aliyun-query-voice').emit('click');
  assert.equal(h.calls.save.length, 1); assert.equal(h.calls.enroll, 0);
});

test('an interrupted named clone resumes and saves automatically without creating another voice', async () => {
  const h = harness({ draft: { voice_id: 'new-voice', model: 'cosyvoice-v3-flash', name: '小雨', ready: false } });
  assert.equal(h.$('aliyun-query-voice').hidden, false);
  await h.$('aliyun-query-voice').emit('click');
  assert.equal(h.calls.save.length, 1);
  assert.equal(h.calls.enroll, 0);
  assert.equal(h.storage.has(h.cacheKey), false);
});

test('selecting a saved voice also selects its bound model', async () => {
  const h = harness({ voices: [{ name: '另一个声线', voice_id: 'v35-voice', model: 'cosyvoice-v3.5-plus' }] });
  h.$('aliyun-saved-voices').value = 'v35-voice';
  await h.$('aliyun-saved-voices').emit('change');
  assert.equal(h.$('aliyun-model').value, 'cosyvoice-v3.5-plus');
  assert.equal(h.$('aliyun-voice').value, 'v35-voice');
});

test('an unsuitable recording cannot be submitted', async () => {
  const h = harness();
  await h.$('aliyun-select-audio').emit('click');
  h.$('aliyun-audio-preview').duration = 2;
  await h.$('aliyun-audio-preview').emit('loadedmetadata');
  assert.notEqual(h.$('aliyun-name-dialog').open, true);
  await h.$('aliyun-name-form').emit('submit', { preventDefault() {} });
  assert.equal(h.calls.upload, 0);
});

test('cancelling the name dialog does not upload or clone the audio', async () => {
  const h = harness();
  await h.$('aliyun-select-audio').emit('click');
  await h.$('aliyun-audio-preview').emit('loadedmetadata');
  await h.$('aliyun-cancel-name').emit('click');
  assert.equal(h.$('aliyun-name-dialog').open, false);
  assert.equal(h.calls.upload, 0); assert.equal(h.calls.enroll, 0);
});

test('the voice role control remains visible even before a role is saved', () => {
  const h = harness();
  assert.equal(h.$('aliyun-voice-library').hidden, false);
  assert.equal(h.$('aliyun-saved-voices').children[0].textContent, '当前声线');
});

test('dropping an audio file uses the same name-first flow', async () => {
  const h = harness();
  let selectedPath;
  h.api.selectAliyunAudio = async filePath => {
    selectedPath = filePath;
    return { ok: true, filename: 'dropped.wav', size: 2048, preview: 'data:audio/wav;base64,AA==' };
  };
  await h.$('aliyun-select-audio').emit('drop', { preventDefault() {}, dataTransfer: { files: [{ path: 'D:/audio/dropped.wav' }] } });
  await h.$('aliyun-audio-preview').emit('loadedmetadata');
  assert.equal(selectedPath, 'D:/audio/dropped.wav');
  assert.equal(h.$('aliyun-name-dialog').open, true);
  assert.equal(h.calls.upload, 0);
  h.$('aliyun-voice-name').value = '拖入的角色';
  await h.$('aliyun-name-form').emit('submit', { preventDefault() {} });
  assert.equal(h.calls.upload, 1);
  assert.equal(h.calls.save[0].name, '拖入的角色');
});

test('processing indicator follows upload, cloning and saving, then disappears on success', async () => {
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  const upload = deferred(); const clone = deferred(); const save = deferred();
  const h = harness({ saveWait: save.promise });
  h.api.uploadAliyunAudio = () => upload.promise;
  h.api.enrollAliyunVoice = () => clone.promise;
  await h.$('aliyun-select-audio').emit('click');
  await h.$('aliyun-audio-preview').emit('loadedmetadata');
  h.$('aliyun-voice-name').value = '测试角色';
  const processing = h.$('aliyun-name-form').emit('submit', { preventDefault() {} });
  assert.equal(h.$('aliyun-processing').hidden, false);
  assert.equal(h.$('aliyun-processing-text').textContent, '上传中……');
  assert.equal(h.$('aliyun-select-audio').disabled, true);
  upload.resolve({ ok: true, url: 'https://example.com/a.wav', expires_at: Date.now() / 1000 + 86400 });
  await new Promise(setImmediate);
  assert.equal(h.$('aliyun-processing-text').textContent, '克隆中……');
  clone.resolve({ ok: true, voice_id: 'new-voice', model: 'cosyvoice-v3-flash' });
  await new Promise(setImmediate);
  assert.equal(h.$('aliyun-processing-text').textContent, '保存中……');
  save.resolve(); await processing;
  assert.equal(h.$('aliyun-processing').hidden, true);
  assert.equal(h.$('aliyun-select-audio').disabled, false);
});

test('a processing failure stops the spinner and shows an error', async () => {
  const h = harness();
  h.api.uploadAliyunAudio = async () => { throw new Error('upload failed'); };
  await h.$('aliyun-select-audio').emit('click');
  await h.$('aliyun-audio-preview').emit('loadedmetadata');
  h.$('aliyun-voice-name').value = '测试角色';
  await h.$('aliyun-name-form').emit('submit', { preventDefault() {} });
  assert.equal(h.$('aliyun-processing').hidden, true);
  assert.equal(h.$('aliyun-clone-status').hidden, false);
  assert.equal(h.$('aliyun-clone-status').dataset.kind, 'error');
  assert.equal(h.$('aliyun-select-audio').disabled, false);
});
