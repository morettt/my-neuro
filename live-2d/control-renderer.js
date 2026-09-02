let config = {};
let live2dRunning = false;
let environment = { edition: 'cloud', editionLabel: '云端', version: '' };
let previewEdition = null;
let activeServiceLog = 'tts';
let configDirty = false;
let pluginConfigDirty = false;
let loadingConfigUi = true;
let closePromptOpen = false;
const serviceLogs = { tts: '', asr: '', bert: '' };

const $ = id => document.getElementById(id);
document.documentElement.spellcheck = false;
document.querySelectorAll('input, textarea, [contenteditable="true"]').forEach(element => { element.spellcheck = false; });
const sidebarHoverSound = new Audio('assets/audio/sidebar-hover.wav');
sidebarHoverSound.volume = 0.3;
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.hidden || button.disabled) return;
  sidebarHoverSound.currentTime = 0;
  sidebarHoverSound.play().catch(() => {});
}, true);
const get = (obj, path, fallback = '') => path.split('.').reduce((value, key) => value?.[key], obj) ?? fallback;
const set = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((value, key) => value[key] ??= {}, obj);
  target[last] = value;
};

function setConfigDirty(dirty) {
  configDirty = Boolean(dirty);
  updateSaveDirtyState();
}

function setPluginConfigDirty(dirty) {
  pluginConfigDirty = Boolean(dirty);
  updateSaveDirtyState();
}

function updateSaveDirtyState() {
  const dirty = configDirty || pluginConfigDirty;
  const button = $('save-config');
  button?.classList.toggle('config-dirty', dirty);
  if (button) button.title = dirty ? '当前有未保存的修改，请先保存配置' : '';
  window.controlApi.setConfigDirty(dirty);
}

function applyEdition(edition = environment.edition) {
  const label = edition === 'local' ? '本地' : '云端';
  $('brand-title').textContent = `My-Neuro (${label})${environment.version ? `  ${environment.version}` : ''}`;
  $('edition-status').textContent = `${label}版本${environment.version ? ` · ${environment.version}` : ''}`;
  $('voice-clone-nav').hidden = edition === 'cloud';
  if (edition === 'cloud' && $('voice').classList.contains('active')) {
    $('voice').classList.remove('active');
    $('home').classList.add('active');
    document.querySelector('.nav.active')?.classList.remove('active');
    document.querySelector('[data-page="home"]').classList.add('active');
  }
  $('toggle-edition-preview').textContent = edition === 'local' ? '切回云端样式' : '预览本地样式';
  $('tutorial-content').innerHTML = edition === 'cloud'
    ? '<h2>云端版本教程</h2><p>云端版本教程还没有制作好，请耐心等待。</p>'
    : '<h2>首次使用</h2><p>在“模型配置”填写 API KEY、API URL，点击“获取模型”选择模型并保存。</p><p>回到“启动”选择 Live2D 或 VRM 角色，然后点击“启动桌宠”。</p><h2>语音功能</h2><p>在“对话设置”启用 ASR、TTS，并在“终端控制室”启动对应服务。</p><h2>插件与工具</h2><p>插件在“插件”页面启用和配置；MCP 工具在“工具屋”启用。</p>';
}

$('toggle-edition-preview').addEventListener('click', () => {
  const shown = previewEdition || environment.edition;
  previewEdition = shown === 'local' ? 'cloud' : 'local';
  applyEdition(previewEdition);
});

document.querySelectorAll('#cloud h3, #cloud button').forEach(element => {
  element.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) node.textContent = node.textContent.replace(/[🐂🔊🎤🔗]/gu, '').trimStart();
  });
});

document.querySelectorAll('[data-window]').forEach(button => {
  button.addEventListener('click', () => window.controlApi.windowAction(button.dataset.window));
});

$('github-link').addEventListener('click', () => window.controlApi.openGithub());
$('gateway-website').addEventListener('click', () => window.controlApi.openExternal('http://mynewbot.com'));
$('volcengine-tutorial').addEventListener('click', () => window.controlApi.openExternal('http://mynewbot.com/tutorials/ByteDance-TTS'));
$('reset-model-position').addEventListener('click', async () => {
  const result = await window.controlApi.resetModelPosition(); showToast(result.message);
});
$('adjust-subtitle-position').addEventListener('click', async () => {
  const result = await window.controlApi.adjustSubtitlePosition(); showToast(result.message);
});
$('select-voice-model').addEventListener('click', async () => {
  const result = await window.controlApi.selectVoiceFile('model');
  if (result.ok) { $('voice-model-status').textContent = result.filename; showToast('模型文件已保存'); }
});
$('select-voice-audio').addEventListener('click', async () => {
  const result = await window.controlApi.selectVoiceFile('audio');
  if (result.ok) { $('voice-audio-status').textContent = result.filename; showToast('参考音频已保存'); }
});
$('generate-voice-bat').addEventListener('click', async () => {
  const result = await window.controlApi.generateVoiceBat({ character: $('voice-character-name').value, text: $('voice-reference-text').value, language: $('voice-language').value });
  $('voice-bat-status').textContent = result.message;
  showToast(result.message);
});

let pageTransition = null;
function switchPage(pageId, navButton = null) {
  const change = () => {
    document.querySelector('.nav.active')?.classList.remove('active');
    document.querySelector('.page.active')?.classList.remove('active');
    navButton?.classList.add('active');
    $(pageId).classList.add('active');
  };
  if (!document.startViewTransition) {
    change();
    return;
  }
  pageTransition?.skipTransition();
  const transition = document.startViewTransition(change);
  pageTransition = transition;
  transition.finished.finally(() => {
    if (pageTransition === transition) pageTransition = null;
  });
}

function closeQqModal() { $('qq-modal').hidden = true; }
$('qq-group-link').addEventListener('click', () => { $('qq-modal').hidden = false; $('qq-modal-close').focus(); });
$('qq-modal-close').addEventListener('click', closeQqModal);
$('qq-modal').addEventListener('click', event => { if (event.target === $('qq-modal')) closeQqModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('qq-modal').hidden) closeQqModal(); });

document.querySelectorAll('.nav').forEach(button => {
  button.addEventListener('click', () => {
    if (button.hidden) return;
    switchPage(button.dataset.page, button);
    if (button.dataset.page === 'prompts') refreshPrompts();
    if (button.dataset.page === 'history') loadChatHistory();
  });
});

document.querySelectorAll('[data-go]').forEach(button => {
  button.addEventListener('click', () => {
    switchPage(button.dataset.go, document.querySelector(`[data-page="${button.dataset.go}"]`));
  });
});

document.querySelectorAll('.dropdown-option[data-target]').forEach(button => {
  button.addEventListener('click', () => {
    const input = $(button.dataset.target);
    input.value = button.dataset.value;
    const dropdown = button.closest('.dropdown');
    button.closest('.model-field').querySelector('.dropdown-text').textContent = button.textContent;
    dropdown.querySelectorAll('.dropdown-option').forEach(option => {
      const selected = option === button;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
    });
    dropdown.querySelector('.sr-only').checked = false;
    setConfigDirty(true);
  });
});

function enhanceSelect(id) {
  const select = $(id);
  if (!select || select.dataset.enhanced === 'true') return;
  select.dataset.enhanced = 'true';
  select.classList.add('native-select-hidden');
  const dropdown = document.createElement('div');
  dropdown.className = 'dropdown provider-dropdown';
  const state = document.createElement('input');
  state.type = 'checkbox';
  state.hidden = true;
  state.className = 'sr-only';
  state.id = `${id}-state`;
  const trigger = document.createElement('label');
  trigger.className = 'trigger';
  trigger.htmlFor = state.id;
  const text = document.createElement('span');
  text.className = 'dropdown-text';
  trigger.append(text);
  const list = document.createElement('ul');
  list.className = 'list webkit-scrollbar';
  for (const option of select.options) {
    const item = document.createElement('li');
    item.className = 'listitem';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'article dropdown-option';
    button.dataset.value = option.value;
    button.textContent = option.textContent;
    button.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      state.checked = false;
    });
    item.append(button);
    list.append(item);
  }
  const refreshText = () => {
    text.textContent = select.options[select.selectedIndex]?.textContent || '请选择';
    list.querySelectorAll('.dropdown-option').forEach(button => {
      const selected = button.dataset.value === select.value;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  };
  select.addEventListener('change', refreshText);
  dropdown.append(state, trigger, list);
  select.insertAdjacentElement('afterend', dropdown);
  refreshText();
}

enhanceSelect('cloud-tts-provider');
enhanceSelect('cloud-asr-provider');

document.querySelectorAll('[data-cloud-tab]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelector('[data-cloud-tab].active')?.classList.remove('active');
    document.querySelector('[data-cloud-panel].active')?.classList.remove('active');
    button.classList.add('active');
    document.querySelector(`[data-cloud-panel="${button.dataset.cloudTab}"]`)?.classList.add('active');
  });
});

function syncCloudProviders() {
  const ttsProvider = $('cloud-tts-provider')?.value || 'aliyun';
  const ttsText = $('cloud-tts-provider')?.nextElementSibling?.querySelector('.dropdown-text');
  if (ttsText) ttsText.textContent = $('cloud-tts-provider').options[$('cloud-tts-provider').selectedIndex]?.textContent || '请选择';
  document.querySelectorAll('[data-tts-provider]').forEach(panel => panel.classList.toggle('active', panel.dataset.ttsProvider === ttsProvider));
  const ttsEnabled = $('cloud-tts-master-enabled')?.checked === true;
  if ($('aliyun-enabled')) $('aliyun-enabled').checked = ttsEnabled && ttsProvider === 'aliyun';
  if ($('volc-enabled')) $('volc-enabled').checked = ttsEnabled && ttsProvider === 'volcengine';
  if ($('cloud-tts-enabled')) $('cloud-tts-enabled').checked = ttsEnabled && ttsProvider === 'siliconflow';

  const asrProvider = $('cloud-asr-provider')?.value || 'baidu';
  const asrText = $('cloud-asr-provider')?.nextElementSibling?.querySelector('.dropdown-text');
  if (asrText) asrText.textContent = $('cloud-asr-provider').options[$('cloud-asr-provider').selectedIndex]?.textContent || '请选择';
  document.querySelectorAll('[data-asr-provider]').forEach(panel => panel.classList.toggle('active', panel.dataset.asrProvider === asrProvider));
  const asrEnabled = $('cloud-asr-master-enabled')?.checked === true;
  if ($('cloud-asr-enabled')) $('cloud-asr-enabled').checked = asrEnabled && asrProvider === 'baidu';
  if ($('silicon-asr-enabled')) $('silicon-asr-enabled').checked = asrEnabled && asrProvider === 'siliconflow';
}

['cloud-tts-provider','cloud-tts-master-enabled','cloud-asr-provider','cloud-asr-master-enabled'].forEach(id => $(id)?.addEventListener('change', syncCloudProviders));

$('fetch-llm-models').addEventListener('click', async () => {
  const button = $('fetch-llm-models');
  const apiUrl = $('llm-url').value.trim();
  if (!apiUrl) { $('llm-url').focus(); showToast('请先填写 API URL'); return; }
  button.disabled = true; button.textContent = '正在获取…';
  try {
    const models = await window.controlApi.fetchLlmModels(apiUrl, $('llm-key').value);
    const options = $('llm-model-options');
    options.innerHTML = models.map(name => `<button type="button" data-llm-model="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('');
    options.hidden = false;
    options.querySelectorAll('[data-llm-model]').forEach(option => option.addEventListener('click', () => {
      $('llm-model').value = option.dataset.llmModel;
      set(config, 'llm.model', option.dataset.llmModel);
      setConfigDirty(true);
      options.hidden = true;
    }));
    showToast(`已获取 ${models.length} 个模型`);
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; button.textContent = '获取模型'; }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.llm-model-control')) $('llm-model-options').hidden = true;
});

const fields = {
  'llm-url': ['llm.api_url', 'value'], 'llm-key': ['llm.api_key', 'value'],
  'llm-model': ['llm.model', 'value'], 'llm-prompt': ['llm.system_prompt', 'value'],
  temperature: ['llm.temperature', 'number'], 'tts-language': ['tts.language', 'value'],
  'opening-text': ['ui.intro_text', 'value'], 'max-messages': ['context.max_messages', 'number'],
  'text-input-enabled': ['ui.show_chat_box', 'checked'], 'ptt-enabled': ['asr.ptt_enabled', 'checked'],
  'context-limit': ['context.enable_limit', 'checked'], 'history-enabled': ['context.persistent_history', 'checked'],
  'temperature-enabled': ['llm.temperature_enabled', 'checked'],
  'tts-enabled': ['tts.enabled', 'checked'], 'asr-enabled': ['asr.enabled', 'checked'],
  'rag-enabled': ['rag.enabled', 'checked'], 'vision-enabled': ['vision.use_vision_model', 'checked'],
  'vision-key': ['vision.vision_model.api_key', 'value'], 'vision-url': ['vision.vision_model.api_url', 'value'],
  'vision-model': ['vision.vision_model.model', 'value'],
  'barge-enabled': ['asr.voice_barge_in', 'checked'], 'mcp-enabled': ['mcp.enabled', 'checked'],
  'auto-vision': ['vision.auto_screenshot', 'checked'],
  'user-name': ['subtitle_labels.user', 'value'], 'ai-name': ['subtitle_labels.ai', 'value'],
  'subtitle-enabled': ['subtitle_labels.enabled', 'checked'],
  'auto-close-services': ['auto_close_services.enabled', 'checked'],
  'gateway-enabled': ['api_gateway.use_gateway', 'checked'], 'gateway-url': ['api_gateway.base_url', 'value'],
  'gateway-key': ['api_gateway.api_key', 'value'], 'cloud-provider': ['cloud.provider', 'value'],
  'cloud-key': ['cloud.api_key', 'value'], 'cloud-tts-enabled': ['cloud.tts.enabled', 'checked'],
  'cloud-tts-url': ['cloud.tts.url', 'value'], 'cloud-tts-model': ['cloud.tts.model', 'value'],
  'cloud-tts-voice': ['cloud.tts.voice', 'value'], 'cloud-tts-format': ['cloud.tts.response_format', 'value'],
  'cloud-tts-speed': ['cloud.tts.speed', 'number'], 'volc-enabled': ['cloud.volcengine_tts.enabled', 'checked'],
  'aliyun-enabled': ['cloud.aliyun_tts.enabled', 'checked'], 'aliyun-key': ['cloud.aliyun_tts.api_key', 'value'],
  'aliyun-model': ['cloud.aliyun_tts.model', 'value'], 'aliyun-voice': ['cloud.aliyun_tts.voice', 'value'],
  'volc-appid': ['cloud.volcengine_tts.appid', 'value'], 'volc-token': ['cloud.volcengine_tts.access_token', 'value'],
  'volc-voice': ['cloud.volcengine_tts.voice_type', 'value'], 'cloud-asr-enabled': ['cloud.baidu_asr.enabled', 'checked'],
  'cloud-asr-url': ['cloud.baidu_asr.url', 'value'], 'cloud-asr-appid': ['cloud.baidu_asr.appid', 'value'],
  'cloud-asr-appkey': ['cloud.baidu_asr.appkey', 'value'], 'cloud-asr-pid': ['cloud.baidu_asr.dev_pid', 'value']
  ,'silicon-asr-enabled': ['cloud.siliconflow_asr.enabled', 'checked'], 'silicon-asr-api': ['cloud.siliconflow_asr.api', 'value'],
  'silicon-asr-key': ['cloud.siliconflow_asr.key', 'value'], 'silicon-asr-model': ['cloud.siliconflow_asr.model', 'value']
};

const trackedConfigIds = new Set([
  ...Object.keys(fields), 'hide-model', 'cloud-tts-provider', 'cloud-tts-master-enabled',
  'cloud-asr-provider', 'cloud-asr-master-enabled'
]);
document.addEventListener('input', event => {
  if (!loadingConfigUi && trackedConfigIds.has(event.target.id)) setConfigDirty(true);
});
document.addEventListener('change', event => {
  if (!loadingConfigUi && trackedConfigIds.has(event.target.id)) setConfigDirty(true);
});

function render() {
  for (const [id, [path, type]] of Object.entries(fields)) {
    const el = $(id);
    if (!el) continue;
    const value = get(config, path, type === 'checked' ? false : '');
    if (type === 'checked') el.checked = Boolean(value);
    else el.value = value;
    if (id === 'tts-language') {
      const field = el.closest('.model-field');
      const selected = field?.querySelector(`[data-value="${value}"]`);
      if (selected) {
        field.querySelector('.dropdown-text').textContent = selected.textContent;
        field.querySelectorAll('.dropdown-option').forEach(option => {
          const active = option === selected;
          option.classList.toggle('selected', active);
          option.setAttribute('aria-selected', String(active));
        });
      }
    }
  }
  $('hide-model').checked = !Boolean(get(config, 'ui.show_model', true));
  const ttsProvider = get(config, 'cloud.aliyun_tts.enabled', false) ? 'aliyun' : get(config, 'cloud.volcengine_tts.enabled', false) ? 'volcengine' : 'siliconflow';
  $('cloud-tts-provider').value = ttsProvider;
  $('cloud-tts-master-enabled').checked = Boolean(get(config, 'cloud.aliyun_tts.enabled', false) || get(config, 'cloud.volcengine_tts.enabled', false) || get(config, 'cloud.tts.enabled', false));
  const asrProvider = get(config, 'cloud.siliconflow_asr.enabled', false) ? 'siliconflow' : 'baidu';
  $('cloud-asr-provider').value = asrProvider;
  $('cloud-asr-master-enabled').checked = Boolean(get(config, 'cloud.baidu_asr.enabled', false) || get(config, 'cloud.siliconflow_asr.enabled', false));
  syncCloudProviders();
}

function paintServiceLog() {
  $('service-log-output').textContent = serviceLogs[activeServiceLog];
  $('service-log-output').scrollTop = $('service-log-output').scrollHeight;
}

async function refreshServiceStatus() {
  try {
    const services = await window.controlApi.serviceStatus();
    $('service-list').innerHTML = services.map(service => `<article class="service card" data-service="${service.id}"><div class="service-info"><b>${service.name}</b><small class="${service.running ? 'running' : ''}">${service.downloading ? '正在下载' : service.running ? '运行中' : service.installed ? '未启动' : '未安装'} · 端口 ${service.port}</small></div><div class="service-actions">${service.installed ? `<button data-service-action="start" ${service.running ? 'disabled' : ''}>启动</button><button data-service-action="stop" ${service.running ? '' : 'disabled'}>停止</button>` : `<button data-service-action="download" ${service.downloading ? 'disabled' : ''}>${service.downloading ? '下载中' : '下载模块'}</button>`}</div></article>`).join('');
    document.querySelectorAll('[data-service-action]').forEach(button => button.addEventListener('click', async () => {
      const id = button.closest('[data-service]').dataset.service;
      button.disabled = true;
      const action = button.dataset.serviceAction;
      const result = action === 'start' ? await window.controlApi.startService(id) : action === 'stop' ? await window.controlApi.stopService(id) : await window.controlApi.downloadService(id);
      showToast(result.message);
      setTimeout(refreshServiceStatus, action === 'start' ? 1200 : 250);
    }));
  } catch (error) { showToast(`服务状态读取失败：${error.message}`); }
}

document.querySelectorAll('[data-service-log]').forEach(button => button.addEventListener('click', () => {
  document.querySelector('[data-service-log].active')?.classList.remove('active');
  button.classList.add('active');
  activeServiceLog = button.dataset.serviceLog;
  paintServiceLog();
}));
$('clear-service-log').addEventListener('click', () => { serviceLogs[activeServiceLog] = ''; paintServiceLog(); });
window.controlApi.onServiceLog(({ service, text }) => {
  serviceLogs[service] = (serviceLogs[service] + text).slice(-120000);
  if (service === activeServiceLog) paintServiceLog();
});
window.controlApi.onServiceState(refreshServiceStatus);

function historyContent(content) {
  const formatText = value => escapeHtml(value).replace(/&lt;([\u4e00-\u9fa5]+)&gt;/g, '<span class="emotion-tag">&lt;$1&gt;</span>');
  if (typeof content === 'string') return `<p>${formatText(content)}</p>`;
  if (!Array.isArray(content)) return `<p>${escapeHtml(content == null ? '' : JSON.stringify(content))}</p>`;
  return content.map(item => {
    if (typeof item === 'string') return `<p>${formatText(item)}</p>`;
    if (item?.type === 'text') return `<p>${formatText(item.text || '')}</p>`;
    const url = item?.image_url?.url || item?.image_url;
    if (typeof url === 'string' && (url.startsWith('data:image/') || /^https?:\/\//i.test(url))) {
      return `<img class="history-image" src="${escapeHtml(url)}" alt="对话图片">`;
    }
    return '';
  }).join('');
}

function historyToolCalls(toolCalls) {
  return (Array.isArray(toolCalls) ? toolCalls : []).map(call => {
    const fn = call?.function || {};
    let args = fn.arguments || '';
    try { args = Object.values(JSON.parse(args)).join('，'); } catch {}
    return `<div class="history-tool">调用工具：${escapeHtml(fn.name || 'unknown')}${args ? `<span>${escapeHtml(args)}</span>` : ''}</div>`;
  }).join('');
}

function historyImages(images) {
  return (Array.isArray(images) ? images : [])
    .filter(url => typeof url === 'string' && url.startsWith('data:image/'))
    .map(url => `<img class="history-image" src="${escapeHtml(url)}" alt="对话截图" title="点击查看大图" tabindex="0" role="button">`)
    .join('');
}

function closeHistoryImagePreview() {
  $('history-image-modal').hidden = true;
  $('history-image-preview').removeAttribute('src');
}

function openHistoryImagePreview(src) {
  if (!src) return;
  $('history-image-preview').src = src;
  $('history-image-modal').hidden = false;
  $('history-image-close').focus();
}

$('history-list').addEventListener('click', event => {
  const image = event.target.closest('.history-image');
  if (image) openHistoryImagePreview(image.src);
});
$('history-list').addEventListener('keydown', event => {
  const image = event.target.closest('.history-image');
  if (image && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openHistoryImagePreview(image.src);
  }
});
$('history-image-close').addEventListener('click', closeHistoryImagePreview);
$('history-image-modal').addEventListener('click', event => {
  if (event.target === $('history-image-modal')) closeHistoryImagePreview();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('history-image-modal').hidden) closeHistoryImagePreview();
});

async function loadChatHistory() {
  try {
    const result = await window.controlApi.getChatHistory();
    if (!result.exists) {
      $('history-list').innerHTML = '<div class="history-empty">对话历史文件不存在</div>';
      return;
    }
    $('history-list').innerHTML = result.messages.map(message => {
      const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'other';
      const roleName = role === 'user' ? '用户' : role === 'assistant' ? 'AI' : (message.role || '未知');
      return `<article class="history-entry ${role}"><header>${escapeHtml(roleName)}</header><div class="history-content">${historyContent(message.content)}${historyImages(message.history_images)}${historyToolCalls(message.tool_calls)}</div></article>`;
    }).join('') || '<div class="history-empty">暂无对话记录</div>';
    $('history-list').scrollTop = $('history-list').scrollHeight;
  } catch (error) {
    $('history-list').innerHTML = `<div class="history-empty error">读取失败：${escapeHtml(error.message)}</div>`;
  }
}

let toastTimer = null;
function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

async function saveConfig() {
  if (pluginConfigDirty && !(await savePluginConfig())) return false;
  if (!configDirty) return true;
  syncCloudProviders();
  for (const [id, [path, type]] of Object.entries(fields)) {
    const el = $(id);
    if (!el) continue;
    set(config, path, type === 'checked' ? el.checked : type === 'number' ? Number(el.value) : el.value);
  }
  set(config, 'ui.show_model', !$('hide-model').checked);
  delete config.conversation;
  try {
    await window.controlApi.saveConfig(config);
    render(); setConfigDirty(false); showToast('配置保存成功');
    return true;
  } catch (error) {
    showToast(`保存失败：${error.message}`);
    return false;
  }
}

$('save-config').addEventListener('click', saveConfig);

async function confirmUnsavedConfig(title) {
  if (!configDirty && !pluginConfigDirty) return true;
  const choice = await window.controlApi.confirmUnsavedConfig(title);
  if (choice === 'save') return saveConfig();
  if (choice === 'discard') return true;
  return false;
}

window.controlApi.onCloseRequested(async () => {
  if (closePromptOpen) return;
  closePromptOpen = true;
  try {
    if (await confirmUnsavedConfig('关闭前保存配置')) {
      setConfigDirty(false);
      setPluginConfigDirty(false);
      await window.controlApi.windowAction('close');
    }
  } finally {
    closePromptOpen = false;
  }
});

$('start-live2d').addEventListener('click', async () => {
  const button = $('start-live2d');
  const wasRunning = live2dRunning;
  if (!wasRunning && !(await confirmUnsavedConfig('启动前保存配置'))) return;
  button.disabled = true;
  if (!wasRunning) clearDesktopLogs();
  try {
    const result = wasRunning
      ? await window.controlApi.stopLive2d()
      : await window.controlApi.startLive2d();
    showToast(result.message);
    if (result.ok) {
      // 退出事件可能比 IPC 返回更早，必须按本次操作显式赋值，不能取反。
      live2dRunning = wasRunning ? false : true;
      button.textContent = live2dRunning ? '■ 关闭桌宠' : '▶ 启动桌宠';
      button.classList.toggle('stop', live2dRunning);
    }
    button.disabled = false;
  } catch (error) {
    button.disabled = false;
    showToast(`启动失败：${error.message}`);
  }
});

function clearDesktopLogs() {
  $('pet-log').textContent = '';
  $('tool-log').textContent = '';
}

$('clear-logs').addEventListener('click', clearDesktopLogs);

window.controlApi.onLive2dLog(text => {
  if ($('pet-log').textContent === '暂无日志') $('pet-log').textContent = '';
  $('pet-log').textContent += text;
  $('pet-log').scrollTop = $('pet-log').scrollHeight;
});

window.controlApi.onToolLog(text => {
  if ($('tool-log').textContent === '暂无日志') $('tool-log').textContent = '';
  $('tool-log').textContent += text;
  $('tool-log').scrollTop = $('tool-log').scrollHeight;
});

window.controlApi.onLive2dState(running => {
  live2dRunning = running;
  const button = $('start-live2d');
  button.disabled = false;
  button.textContent = running ? '■ 关闭桌宠' : '▶ 启动桌宠';
  button.classList.toggle('stop', running);
});

let pluginData = { builtIn: [], community: [], market: [] };
let editingPlugin = null;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

function pluginCard(plugin) {
  const dlcInstalled = !plugin.downloadDlc || plugin.dlcInstalled;
  return `<article class="plugin-card card">
    <div class="plugin-summary"><strong>${escapeHtml(plugin.displayName)}</strong><p>${escapeHtml(plugin.description || '暂无说明')}</p><small>${escapeHtml([plugin.author, plugin.version].filter(Boolean).join(' · '))}</small></div>
    <div class="plugin-actions">
      ${plugin.downloadDlc && !dlcInstalled ? `<button type="button" class="primary" data-plugin-dlc="${escapeHtml(plugin.relPath)}">安装 DLC</button>` : ''}
      ${plugin.bat && dlcInstalled ? `<button type="button" data-plugin-launch="${escapeHtml(plugin.relPath)}">启动</button>` : ''}
      ${plugin.hasConfig ? `<button type="button" data-plugin-config="${escapeHtml(plugin.relPath)}">配置</button>` : ''}
      ${dlcInstalled ? `<label class="plugin-switch"><span>启用</span><input type="checkbox" data-plugin-enabled="${escapeHtml(plugin.relPath)}" ${plugin.enabled ? 'checked' : ''}><i></i></label>` : ''}
    </div>
  </article>`;
}

function marketCard(plugin) {
  return `<article class="plugin-card card"><div class="plugin-summary"><strong>${escapeHtml(plugin.display_name || plugin.id)}</strong><p>${escapeHtml(plugin.desc || '暂无说明')}</p><small>${escapeHtml(plugin.author || '')}</small></div><div class="plugin-actions"><button type="button" data-plugin-repo="${escapeHtml(plugin.repo || '')}">仓库</button><button type="button" class="primary" data-plugin-install="${escapeHtml(plugin.id)}" ${plugin.installed ? 'disabled' : ''}>${plugin.installed ? '已安装' : '安装'}</button></div></article>`;
}

function selectPluginTab(name) {
  document.querySelector('[data-plugin-tab].active')?.classList.remove('active');
  document.querySelector('[data-plugin-panel].active')?.classList.remove('active');
  document.querySelector(`[data-plugin-tab="${name}"]`)?.classList.add('active');
  document.querySelector(`[data-plugin-panel="${name}"]`)?.classList.add('active');
}

function bindPluginCards() {
  document.querySelectorAll('[data-plugin-enabled]').forEach(input => input.addEventListener('change', async () => {
    try { await window.controlApi.setPluginEnabled(input.dataset.pluginEnabled, input.checked); showToast(input.checked ? '插件已启用' : '插件已停用'); }
    catch (error) { input.checked = !input.checked; showToast(error.message); }
  }));
  document.querySelectorAll('[data-plugin-config]').forEach(button => button.addEventListener('click', () => {
    const plugin = [...pluginData.builtIn, ...pluginData.community].find(item => item.relPath === button.dataset.pluginConfig);
    if (plugin) openPluginDetail(plugin);
  }));
  document.querySelectorAll('[data-plugin-dlc]').forEach(button => button.addEventListener('click', async () => {
    const plugin = [...pluginData.builtIn, ...pluginData.community].find(item => item.relPath === button.dataset.pluginDlc);
    if (!plugin) return;
    button.disabled = true; button.textContent = '安装中…';
    const result = await window.controlApi.installPluginDlc(plugin.name, plugin.downloadDlc);
    showToast(result.message);
    await loadPlugins();
  }));
  document.querySelectorAll('[data-plugin-launch]').forEach(button => button.addEventListener('click', async () => {
    const plugin = [...pluginData.builtIn, ...pluginData.community].find(item => item.relPath === button.dataset.pluginLaunch);
    if (!plugin) return;
    const result = await window.controlApi.launchPluginBat(plugin.name, plugin.bat);
    showToast(result.message);
  }));
  document.querySelectorAll('[data-plugin-repo]').forEach(button => button.addEventListener('click', () => button.dataset.pluginRepo && window.controlApi.openExternal(button.dataset.pluginRepo)));
  document.querySelectorAll('[data-plugin-install]').forEach(button => button.addEventListener('click', async () => {
    const plugin = pluginData.market.find(item => item.id === button.dataset.pluginInstall);
    if (!plugin) return;
    button.disabled = true; button.textContent = '安装中…';
    const result = await window.controlApi.installPlugin(plugin.id, plugin.repo);
    showToast(result.message);
    await loadPlugins();
    if (result.ok) selectPluginTab('community');
  }));
}

function renderPlugins() {
  $('builtin-plugin-list').innerHTML = pluginData.builtIn.map(pluginCard).join('') || '<div class="empty card">暂无内置插件</div>';
  $('community-plugin-list').innerHTML = pluginData.community.map(pluginCard).join('') || '<div class="empty card">暂无社区插件</div>';
  $('market-plugin-list').innerHTML = pluginData.market.map(marketCard).join('') || '<div class="empty card">插件广场暂无内容</div>';
  bindPluginCards();
}

async function loadPlugins() {
  pluginData = await window.controlApi.listPlugins();
  renderPlugins();
}

function configFields(config, prefix = '') {
  let html = '';
  for (const [key, definition] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (definition && typeof definition === 'object' && definition.type === 'object' && definition.fields) {
      html += `<div class="plugin-config-group"><h3>${escapeHtml(definition.title || key)}</h3>${definition.description ? `<p>${escapeHtml(definition.description)}</p>` : ''}${configFields(definition.fields, path)}</div>`;
      continue;
    }
    const schema = definition && typeof definition === 'object' && 'type' in definition;
    const type = schema ? definition.type : typeof definition;
    const value = schema ? (definition.value ?? definition.default ?? '') : definition;
    const title = schema ? (definition.title || key) : key;
    const description = schema ? (definition.description || '') : '';
    if (type === 'boolean' || type === 'bool') html += `<label class="plugin-config-check"><span>${escapeHtml(title)}</span><input data-plugin-field="${escapeHtml(path)}" data-field-type="boolean" type="checkbox" ${value ? 'checked' : ''}></label>`;
    else if (type === 'text' || type === 'textarea') html += `<label>${escapeHtml(title)}<textarea data-plugin-field="${escapeHtml(path)}" data-field-type="string" rows="4">${escapeHtml(value)}</textarea>${description ? `<small>${escapeHtml(description)}</small>` : ''}</label>`;
    else {
      const numeric = ['number', 'integer', 'int', 'float'].includes(type);
      html += `<label>${escapeHtml(title)}<input data-plugin-field="${escapeHtml(path)}" data-field-type="${numeric ? 'number' : 'string'}" ${numeric ? 'type="number"' : ''} value="${escapeHtml(value)}">${description ? `<small>${escapeHtml(description)}</small>` : ''}</label>`;
    }
  }
  return html;
}

function openPluginDetail(plugin) {
  editingPlugin = plugin;
  document.querySelectorAll('#plugins > .plugin-tabs, #plugins > .plugin-panel').forEach(element => element.hidden = true);
  $('plugin-detail').hidden = false;
  $('plugin-detail-title').textContent = plugin.displayName;
  $('plugin-readme').hidden = !plugin.hasReadme;
  $('plugin-detail-content').innerHTML = `<div class="plugin-config-form">${configFields(plugin.config)}</div>`;
}

$('plugin-detail-back').addEventListener('click', () => {
  $('plugin-detail').hidden = true;
  document.querySelectorAll('#plugins > .plugin-tabs, #plugins > .plugin-panel').forEach(element => element.hidden = false);
});
$('plugin-readme').addEventListener('click', async () => {
  if (!editingPlugin) return;
  const readme = await window.controlApi.readPluginReadme(editingPlugin.type, editingPlugin.name);
  $('plugin-readme').hidden = true;
  $('plugin-detail-content').innerHTML = `<div class="plugin-readme-text">${renderPluginMarkdown(readme)}</div>`;
  $('plugin-detail-content').querySelectorAll('a[href]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    window.controlApi.openExternal(link.href);
  }));
});

function markdownToHtml(markdown) {
  const escaped = escapeHtml(markdown).replace(/\r\n?/g, '\n');
  return escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/^[-*] (.+)$/gm, '<div class="markdown-list-item">• $1</div>').replace(/\n/g, '<br>');
}
function renderPluginMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const inline = text => escapeHtml(text)
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  const isBlockStart = (line, next = '') => /^\s*$|^```|^#{1,6}\s+|^\s*([-*+] |\d+\. )|^>\s?|^\s*([-*_])(?:\s*\2){2,}\s*$/.test(line)
    || (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(next));
  const out = [];

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^```\s*([\w-]*)/);
    if (fence) {
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      if (i < lines.length) i++;
      out.push(`<pre><code${fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { const level = heading[1].length; out.push(`<h${level}>${inline(heading[2])}</h${level}>`); i++; continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const splitRow = row => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      const headers = splitRow(line); i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      out.push(`<div class="markdown-table-wrap"><table><thead><tr>${headers.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, index) => `<td>${inline(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const listMatch = line.match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]); const items = [];
      while (i < lines.length) {
        const match = lines[i].match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
        if (!match || /\d+\./.test(match[1]) !== ordered) break;
        items.push(`<li>${inline(match[2])}</li>`); i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    const paragraph = [line.trim()]; i++;
    while (i < lines.length && !isBlockStart(lines[i], lines[i + 1] || '')) paragraph.push(lines[i++].trim());
    out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
  }
  return out.join('');
}

async function savePluginConfig() {
  if (!editingPlugin) return;
  const updated = structuredClone(editingPlugin.config);
  let invalidField = '';
  document.querySelectorAll('[data-plugin-field]').forEach(field => {
    if (invalidField) return;
    const keys = field.dataset.pluginField.split('.');
    const leaf = keys.pop();
    let target = updated;
    for (const key of keys) target = target[key]?.fields || target[key] || (target[key] = {});
    const value = field.dataset.fieldType === 'boolean' ? field.checked : field.dataset.fieldType === 'number' ? Number(field.value) : field.value;
    if (field.dataset.fieldType === 'number' && !Number.isFinite(value)) { invalidField = field.dataset.pluginField; return; }
    if (target[leaf] && typeof target[leaf] === 'object' && 'type' in target[leaf]) target[leaf].value = value;
    else target[leaf] = value;
  });
  if (invalidField) { showToast(`${invalidField} 必须是数字`); return false; }
  try {
    await window.controlApi.savePluginConfig(editingPlugin.type, editingPlugin.name, updated);
    editingPlugin.config = updated;
    setPluginConfigDirty(false);
    showToast('插件配置已保存');
    return true;
  } catch (error) {
    showToast(`插件配置保存失败：${error.message}`);
    return false;
  }
}

document.addEventListener('input', event => {
  if (event.target.matches?.('[data-plugin-field]')) setPluginConfigDirty(true);
});
document.addEventListener('change', event => {
  if (event.target.matches?.('[data-plugin-field]')) setPluginConfigDirty(true);
});

document.querySelectorAll('[data-plugin-tab]').forEach(button => button.addEventListener('click', () => {
  selectPluginTab(button.dataset.pluginTab);
}));
$('refresh-plugins').addEventListener('click', async () => {
  const button = $('refresh-plugins');
  button.disabled = true; button.textContent = '刷新中…';
  try {
    pluginData = await window.controlApi.refreshPluginMarket();
    renderPlugins();
    showToast(`插件广场已更新，共 ${pluginData.market.length} 个插件`);
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; button.textContent = '刷新列表'; }
});
window.controlApi.onPluginsChanged(() => loadPlugins());

let toolMarketData = [];
async function loadMcpTools() {
  try {
    const tools = await window.controlApi.listMcpTools();
    $('mcp-tool-list').innerHTML = tools.map(tool => `<article class="tool-card card"><div><strong>${escapeHtml(tool.name)}</strong>${tool.description ? `<p>${escapeHtml(tool.description)}</p>` : ''}</div><button class="tool-status ${tool.enabled ? 'enabled' : ''}" data-tool-type="${tool.type}" data-tool-key="${escapeHtml(tool.key)}">${tool.enabled ? '使用中' : '未使用'}</button></article>`).join('') || '<div class="market-status">没有找到 MCP 工具</div>';
    document.querySelectorAll('[data-tool-key]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await window.controlApi.toggleMcpTool(button.dataset.toolType, button.dataset.toolKey); await loadMcpTools(); showToast('工具状态已更新'); }
      catch (error) { button.disabled = false; showToast(error.message); }
    }));
  } catch (error) { $('mcp-tool-list').innerHTML = `<div class="market-status">加载失败：${escapeHtml(error.message)}</div>`; }
}

async function loadToolMarket() {
  const button = $('refresh-tool-market'); button.disabled = true; button.textContent = '正在获取…';
  try {
    toolMarketData = await window.controlApi.getToolMarket();
    $('tool-market-list').innerHTML = toolMarketData.map((tool, index) => `<article class="tool-card card"><div><strong>${escapeHtml(tool.tool_name || tool.file_name || '未命名工具')}</strong><p>${escapeHtml(tool.description || '')}</p><small>${escapeHtml(tool.uploader_email || '')}</small></div><button class="primary" data-download-tool="${index}">下载</button></article>`).join('') || '<div class="market-status">工具广场暂无内容</div>';
    document.querySelectorAll('[data-download-tool]').forEach(download => download.addEventListener('click', async () => {
      const tool = toolMarketData[Number(download.dataset.downloadTool)];
      download.disabled = true; download.textContent = '下载中…';
      try { const result = await window.controlApi.downloadTool(tool); showToast(`下载成功：${result.filename}`); await loadMcpTools(); download.textContent = '已下载'; }
      catch (error) { download.disabled = false; download.textContent = '下载'; showToast(error.message); }
    }));
    showToast(`已获取 ${toolMarketData.length} 个工具`);
  } catch (error) { $('tool-market-list').innerHTML = `<div class="market-status">刷新失败：${escapeHtml(error.message)}</div>`; showToast(error.message); }
  finally { button.disabled = false; button.textContent = '刷新工具列表'; }
}

document.querySelectorAll('[data-tool-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelector('[data-tool-tab].active')?.classList.remove('active');
  document.querySelector('[data-tool-panel].active')?.classList.remove('active');
  button.classList.add('active'); document.querySelector(`[data-tool-panel="${button.dataset.toolTab}"]`).classList.add('active');
}));
$('refresh-mcp-tools').addEventListener('click', loadMcpTools);
$('refresh-tool-market').addEventListener('click', loadToolMarket);

function renderPrompts(prompts) {
  $('prompt-market-list').innerHTML = prompts.map((prompt, index) => `<article class="prompt-card card">
    <div class="prompt-card-head" data-prompt-toggle="${index}"><div><strong>${escapeHtml(prompt.title || '未命名提示词')}</strong><span>${escapeHtml(prompt.summary || '')}</span>${prompt.prerequisites ? '<small>有使用条件</small>' : ''}</div><button type="button" data-apply-prompt="${index}">应用</button></div>
    <div class="prompt-detail" data-prompt-detail="${index}" hidden>${prompt.prerequisites ? `<div class="prompt-prerequisite"><b>使用要求</b><p>${escapeHtml(prompt.prerequisites)}</p></div>` : ''}<pre>${escapeHtml(prompt.content || '')}</pre></div>
  </article>`).join('');
  document.querySelectorAll('[data-prompt-toggle]').forEach(header => header.addEventListener('click', () => {
    const detail = document.querySelector(`[data-prompt-detail="${header.dataset.promptToggle}"]`);
    detail.hidden = !detail.hidden;
  }));
  document.querySelectorAll('[data-apply-prompt]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const prompt = prompts[Number(button.dataset.applyPrompt)];
    $('llm-prompt').value = prompt.content || '';
    set(config, 'llm.system_prompt', prompt.content || '');
    setConfigDirty(true);
    showToast('已更新系统提示词，请保存配置');
  }));
}

async function refreshPrompts() {
  const button = $('refresh-prompts');
  button.disabled = true;
  $('prompt-market-status').textContent = '正在获取提示词…';
  try {
    const prompts = await window.controlApi.getPrompts();
    renderPrompts(prompts);
    $('prompt-market-status').textContent = prompts.length ? `共 ${prompts.length} 个提示词` : '接口返回的提示词列表为空';
    showToast(`成功获取 ${prompts.length} 个提示词`);
  } catch (error) {
    $('prompt-market-list').innerHTML = '';
    $('prompt-market-status').textContent = `刷新失败：${error.message}`;
    showToast(`刷新失败：${error.message}`);
  } finally { button.disabled = false; }
}

$('refresh-prompts').addEventListener('click', refreshPrompts);

const motionEmotions = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮'];
let currentMotion = { character: '', actions: {}, expressions: {} };
let actionPage = 0;
const actionPageSize = 18;

function bindingCard(emotion, values, kind) {
  const names = (values || []).map(file => file.split(/[\\/]/).pop().replace(/\.(motion3|exp3)\.json$/i, ''));
  return `<div class="emotion-binding" data-drop-kind="${kind}" data-emotion="${emotion}"><strong>${emotion}</strong><span>${names.length ? `${names.length} 个：${names.slice(0, 2).map(escapeHtml).join('、')}${names.length > 2 ? '…' : ''}` : '拖拽到这里绑定'}</span></div>`;
}

function motionButton(name, kind) {
  return `<button type="button" draggable="true" data-drag-kind="${kind}" data-motion-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
}

function renderMotionPage() {
  $('expression-bindings').innerHTML = motionEmotions.map(name => bindingCard(name, currentMotion.expressions[name], 'expressions')).join('');
  $('action-bindings').innerHTML = motionEmotions.map(name => bindingCard(name, currentMotion.actions[name], 'actions')).join('');
  const expressions = Object.keys(currentMotion.expressions).filter(name => !motionEmotions.includes(name) && name !== '默认表情');
  $('expression-buttons').innerHTML = expressions.map(name => motionButton(name, 'expressions')).join('') || '<span class="motion-empty">未找到可用表情</span>';
  const actions = Object.keys(currentMotion.actions).filter(name => !motionEmotions.includes(name) && currentMotion.actions[name]?.length);
  const pages = Math.max(1, Math.ceil(actions.length / actionPageSize));
  actionPage = Math.min(actionPage, pages - 1);
  $('action-buttons').innerHTML = actions.slice(actionPage * actionPageSize, (actionPage + 1) * actionPageSize).map(name => motionButton(name, 'actions')).join('') || '<span class="motion-empty">暂无未分类动作</span>';
  $('action-pagination').innerHTML = pages > 1 ? `<button data-action-page="prev" ${actionPage === 0 ? 'disabled' : ''}>上一页</button><span>${actionPage + 1} / ${pages}</span><button data-action-page="next" ${actionPage === pages - 1 ? 'disabled' : ''}>下一页</button>` : '';
  document.querySelectorAll('[data-action-page]').forEach(button => button.addEventListener('click', () => { actionPage += button.dataset.actionPage === 'next' ? 1 : -1; renderMotionPage(); }));
  document.querySelectorAll('[data-motion-name]').forEach(button => {
    button.addEventListener('dragstart', event => event.dataTransfer.setData('application/json', JSON.stringify({ kind: button.dataset.dragKind, name: button.dataset.motionName })));
    button.addEventListener('click', async () => {
      const result = button.dataset.dragKind === 'expressions' ? await window.controlApi.triggerExpression(button.dataset.motionName) : await window.controlApi.triggerMotion(button.dataset.motionName);
      showToast(result.message || (result.success ? '已触发' : '触发失败'));
    });
  });
  document.querySelectorAll('[data-drop-kind]').forEach(zone => {
    zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async event => {
      event.preventDefault(); zone.classList.remove('drag-over');
      let item; try { item = JSON.parse(event.dataTransfer.getData('application/json')); } catch { return; }
      if (item.kind !== zone.dataset.dropKind) return;
      const values = currentMotion[item.kind][item.name];
      if (!Array.isArray(values)) return;
      currentMotion[item.kind][zone.dataset.emotion] ||= [];
      currentMotion[item.kind][zone.dataset.emotion].push(...values.filter(value => !currentMotion[item.kind][zone.dataset.emotion].includes(value)));
      if (item.kind === 'actions') delete currentMotion.actions[item.name];
      await window.controlApi.saveMotionData(currentMotion.character, item.kind, currentMotion[item.kind]);
      renderMotionPage(); showToast(`已绑定到${zone.dataset.emotion}`);
    });
  });
}

async function loadMotionPage() {
  currentMotion = await window.controlApi.loadMotionData($('live2d-model').value);
  actionPage = 0; renderMotionPage();
}

document.querySelectorAll('[data-motion-trigger]').forEach(button => button.addEventListener('click', async () => {
  const result = await window.controlApi.triggerMotion(button.dataset.motionTrigger);
  showToast(result.message || (result.success ? '指令已发送' : '指令发送失败'));
}));
$('apply-vmc').addEventListener('click', async () => { const result = await window.controlApi.applyVmc($('vmc-host').value, $('vmc-port').value); showToast(result.message || 'VMC 地址已应用'); });
for (const [id, kind] of [['reset-expressions', 'expressions'], ['reset-actions', 'actions']]) {
  $(id).addEventListener('click', async () => { const result = await window.controlApi.resetMotionData(currentMotion.character, kind); showToast(result.message); if (result.ok) await loadMotionPage(); });
}

(async () => {
  try {
    config = await window.controlApi.loadConfig(); render();
    environment = await window.controlApi.environmentInfo();
    applyEdition();
    $('vmc-host').value = get(config, 'vmc.host', '127.0.0.1');
    $('vmc-port').value = get(config, 'vmc.port', 39539);
    await loadPlugins();
    await loadMcpTools();
    await refreshServiceStatus();
    const models = await window.controlApi.listLive2dModels();
    const currentModel = await window.controlApi.currentLive2dModel();
    if (currentModel) {
      $('live2d-model').value = currentModel;
      $('model-menu-text').textContent = `当前桌宠：${currentModel}`;
      if (currentModel.startsWith('[VRM] ')) {
        set(config, 'ui.model_type', 'vrm');
        set(config, 'ui.vrm_model', currentModel.slice(6));
      } else {
        set(config, 'ui.model_type', 'live2d');
        set(config, 'ui.live2d_model', currentModel);
      }
    }
    const submenu = $('model-submenu');
    if (models.length) {
      submenu.innerHTML = models.map(name => `<li class="listitem"><button class="article dropdown-option${name === currentModel ? ' selected' : ''}" type="button" aria-selected="${name === currentModel}" data-model="${name.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">${name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</button></li>`).join('');
      submenu.querySelectorAll('[data-model]').forEach(button => button.addEventListener('click', async () => {
        $('live2d-model').value = button.dataset.model;
        $('model-menu-text').textContent = `当前桌宠：${button.dataset.model}`;
        $('model-dropdown-state').checked = false;
        submenu.querySelectorAll('[data-model]').forEach(option => {
          const selected = option === button;
          option.classList.toggle('selected', selected);
          option.setAttribute('aria-selected', String(selected));
        });
        if (button.dataset.model.startsWith('[VRM] ')) {
          set(config, 'ui.model_type', 'vrm');
          set(config, 'ui.vrm_model', button.dataset.model.slice(6));
        } else {
          set(config, 'ui.model_type', 'live2d');
          set(config, 'ui.live2d_model', button.dataset.model);
        }
        const result = await window.controlApi.selectLive2dModel(button.dataset.model);
        showToast(result.message);
        loadMotionPage();
      }));
    } else {
      submenu.innerHTML = '<li class="listitem"><span class="article">未找到模型</span></li>';
    }
    await loadMotionPage();
    loadingConfigUi = false;
    setConfigDirty(false);
  }
  catch (error) { loadingConfigUi = false; showToast(`配置加载失败：${error.message}`); }
})();
