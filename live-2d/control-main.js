const { app, BrowserWindow, ipcMain, shell, net, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const nodeNet = require('node:net');
const { scanLive2DModels, resolveLive2DModel, scanVRMModels } = require('./js/avatar/model-registry');
const { loadProvidersFromStore, saveProviders } = require('./js/core/llm-provider-store');

const configPath = path.join(__dirname, 'config.json');
const pluginsPath = path.join(__dirname, 'plugins');
let live2dProcess = null;
const runtimeLogPath = path.join(__dirname, 'runtime.log');
let runtimeLogSender = null;
let runtimeLogLength = 0;
let runtimeLogRemainder = '';
let selectedVoiceModelPath = '';
let selectedVoiceAudioPath = '';

function cleanToolLog(line) {
  return line
    .replace(/^(?:\[[^\]\r\n]+\]\s*)+/, '')
    .replace(/插件已加载[：:]\s*/u, '')
    .trim();
}

function cleanPetLog(line) {
  if (/\[Live2DStage\]\s*初始化完成|\[Live2DSetup\]\s*共发现|\[Live2DLoader\]\s*(?:开始加载模型|transform:|模型加载完成)|\[ParamDirector\]\s*已启用|\[Live2DRuntime\]\s*已安装|\[EmotionEngine\].*配置加载完成|\[AuDriver\]\s*(?:未找到模型 AU 配置|跳过不可映射 AU|已就绪|解算)|\[AvatarFacade\]\s*形态已激活/.test(line)) return null;
  if (/插件热加载监听已启动|\[Plugin:core_memory_injector\].*(?:不存在，跳过加载|插件已启动)|\[Plugin:dawn_dusk_line\].*已启动|\[Plugin:user_profile\].*(?:插件已启动|MemOS 不可用)|\[MotionDirector\]\s*(?:body|face)\s*失败，保留本地编舞|对话模型[：:].*提供商|配置文件加载成功|AI回复中/.test(line)) return null;
  if (/已将内容发送给AI/.test(line)) return '消息已发送给 AI';
  const modelMatch = line.match(/已加载\s*\d+\s*个\s*LLM\s*提供商[^\n]*?当前模型[：:]\s*([^）)\s]+)/i);
  return modelMatch ? `当前使用模型：${modelMatch[1]}` : line;
}

function pumpRuntimeLog(flush = false) {
  if (!runtimeLogSender || runtimeLogSender.isDestroyed() || !fs.existsSync(runtimeLogPath)) return;
  try {
    const content = fs.readFileSync(runtimeLogPath, 'utf8');
    if (content.length < runtimeLogLength) runtimeLogLength = 0;
    runtimeLogRemainder += content.slice(runtimeLogLength);
    runtimeLogLength = content.length;
    const lines = runtimeLogRemainder.split(/\r?\n/);
    runtimeLogRemainder = flush ? '' : lines.pop();
    if (flush && lines.length && !lines[lines.length - 1]) lines.pop();
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const channel = line.includes('[TOOL]') ? 'control:tool-log' : 'control:live2d-log';
      const cleaned = channel === 'control:tool-log' ? cleanToolLog(line) : cleanPetLog(line);
      if (cleaned) runtimeLogSender.send(channel, `${cleaned}\n`);
    }
  } catch (error) {
    if (!runtimeLogSender.isDestroyed()) runtimeLogSender.send('control:live2d-log', `读取日志文件出错：${error.message}\n`);
  }
}

function startRuntimeLog(sender) {
  fs.unwatchFile(runtimeLogPath);
  fs.writeFileSync(runtimeLogPath, '', 'utf8');
  runtimeLogSender = sender;
  runtimeLogLength = 0;
  runtimeLogRemainder = '';
  fs.watchFile(runtimeLogPath, { interval: 100 }, () => pumpRuntimeLog());
}

function stopRuntimeLog() {
  pumpRuntimeLog(true);
  fs.unwatchFile(runtimeLogPath);
  runtimeLogSender = null;
  runtimeLogLength = 0;
  runtimeLogRemainder = '';
}
const serviceProcesses = { tts: null, asr: null, bert: null };
const serviceDownloads = { tts: null, asr: null, bert: null };
const serviceDefinitions = {
  tts: { name: 'TTS 语音合成', port: 5000, bat: '2.TTS.bat', flag: '--tts', checks: [
    'tts-hub/GPT-SoVITS-Bundle/runtime', 'tts-hub/GPT-SoVITS-Bundle/GPT_SoVITS'
  ] },
  asr: { name: 'ASR 语音识别', port: 1000, bat: '1.ASR.bat', flag: '--asr', checks: [
    'asr-hub/model/torch_hub/snakers4_silero-vad_master',
    'asr-hub/model/asr/models/iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch/config.yaml',
    'asr-hub/model/asr/models/iic/punc_ct-transformer_cn-en-common-vocab471067-large/config.yaml',
    'asr-hub/model/asr/models/iic/punc_ct-transformer_cn-en-common-vocab471067-large/model.pt'
  ] },
  bert: { name: 'BERT 模型服务', port: 6007, bat: '3.bert.bat', flag: '--bert', checks: [
    'bert-hub/config.json', 'bert-hub/model.safetensors', 'bert-hub/vocab.txt'
  ] }
};
const projectRoot = path.resolve(__dirname, '..');
const hubRoot = path.join(projectRoot, 'full-hub');

function serviceLaunchDefinition(id) {
  const definition = serviceDefinitions[id];
  if (id !== 'asr' || !definition) return definition;
  const current = readJson(configPath, {});
  if (current.cloud?.baidu_asr?.enabled === true) {
    return { ...definition, name: '百度流式 ASR（仅 VAD）', bat: 'VAD.bat' };
  }
  if (current.cloud?.siliconflow_asr?.enabled === true) {
    return { ...definition, name: 'SiliconFlow ASR（本地 VAD）' };
  }
  return { ...definition, name: '本地 ASR' };
}

function serviceInstalled(definition) {
  return definition.checks.every(item => fs.existsSync(path.join(hubRoot, item)));
}

function portListening(port) {
  return new Promise(resolve => {
    const socket = nodeNet.createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.removeAllListeners(); socket.destroy(); resolve(value); };
    socket.setTimeout(450);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function sendServiceLog(sender, service, text) {
  if (!sender.isDestroyed()) sender.send('control:service-log', { service, text: String(text) });
}

async function serviceStatus() {
  return Promise.all(Object.entries(serviceDefinitions).map(async ([id, definition]) => ({
    id, name: definition.name, port: definition.port,
    installed: serviceInstalled(definition),
    downloading: Boolean(serviceDownloads[id]),
    running: await portListening(definition.port)
  })));
}

async function stopConfiguredServices() {
  const current = readJson(configPath, {});
  if (current.auto_close_services?.enabled === false) return;
  for (const [id, definition] of Object.entries(serviceDefinitions)) {
    const pids = await listeningPids(definition.port);
    if (serviceProcesses[id]?.pid) pids.push(String(serviceProcesses[id].pid));
    for (const pid of new Set(pids)) {
      await runProcess('taskkill.exe', ['/pid', pid, '/t', '/f']).catch(() => {});
    }
    serviceProcesses[id] = null;
    if (serviceDownloads[id]?.pid) {
      await runProcess('taskkill.exe', ['/pid', String(serviceDownloads[id].pid), '/t', '/f']).catch(() => {});
      serviceDownloads[id] = null;
    }
  }
}

function listeningPids(port) {
  return new Promise(resolve => {
    const child = spawn('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.on('error', () => resolve([]));
    child.on('exit', () => {
      const pids = new Set();
      for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1]?.endsWith(`:${port}`) && parts[3] === 'LISTENING') pids.add(parts[4]);
      }
      resolve([...pids]);
    });
  });
}

function readJson(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function loadControlConfig() {
  const config = readJson(configPath, {});
  config.llm ||= {};
  const providers = loadProvidersFromStore(__dirname).providers;
  const provider = providers.find(item => item.id === config.llm.provider_id)
    || providers.find(item => item.enabled !== false)
    || providers[0];
  const model = provider?.models?.find(item => item.model_id === config.llm.model_id)
    || provider?.models?.find(item => item.enabled !== false)
    || provider?.models?.[0];
  if (provider) {
    config.llm.provider_id = provider.id;
    config.llm.api_key = provider.api_key || '';
    config.llm.api_url = provider.api_url || '';
  }
  if (model) {
    config.llm.model_id = model.model_id;
    config.llm.model = model.model_id;
    if (model.temperature !== undefined) config.llm.temperature = model.temperature;
    if (model.temperature_enabled !== undefined) config.llm.temperature_enabled = model.temperature_enabled;
  }
  config.vision ||= {};
  config.vision.vision_model ||= {};
  const visionProvider = providers.find(item => item.id === config.vision.provider_id);
  const visionModel = visionProvider?.models?.find(item => item.model_id === config.vision.model_id)
    || visionProvider?.models?.find(item => item.enabled !== false)
    || visionProvider?.models?.[0];
  if (visionProvider) {
    config.vision.vision_model.api_key = visionProvider.api_key || '';
    config.vision.vision_model.api_url = visionProvider.api_url || '';
  }
  if (visionModel) config.vision.vision_model.model = visionModel.model_id;
  return config;
}

function saveControlConfig(config) {
  config.llm ||= {};
  const providers = loadProvidersFromStore(__dirname).providers;
  let provider = providers.find(item => item.id === config.llm.provider_id)
    || providers.find(item => item.enabled !== false)
    || providers[0];
  if (!provider) {
    provider = { id: 'main', name: '主模型', api_key: '', api_url: '', enabled: true, models: [] };
    providers.push(provider);
  }
  provider.api_key = String(config.llm.api_key || '');
  provider.api_url = String(config.llm.api_url || '');
  provider.enabled = true;
  provider.models ||= [];
  const modelId = String(Object.prototype.hasOwnProperty.call(config.llm, 'model') ? config.llm.model : (config.llm.model_id || '')).trim();
  let model = provider.models.find(item => item.model_id === modelId);
  if (modelId && !model) {
    model = { model_id: modelId, name: modelId, enabled: true };
    provider.models.push(model);
  }
  if (model) {
    model.enabled = true;
    model.temperature = Number(config.llm.temperature ?? model.temperature ?? 1);
    model.temperature_enabled = Boolean(config.llm.temperature_enabled);
  }
  config.llm.provider_id = provider.id;
  config.llm.model_id = modelId;
  config.vision ||= {};
  const visionView = config.vision.vision_model || {};
  const visionModelId = String(Object.prototype.hasOwnProperty.call(visionView, 'model') ? visionView.model : (config.vision.model_id || '')).trim();
  const hasVisionConfig = Boolean(String(visionView.api_key || '').trim() || String(visionView.api_url || '').trim() || visionModelId);
  if (hasVisionConfig) {
    let visionProvider = providers.find(item => item.id === config.vision.provider_id);
    if (!visionProvider) {
      visionProvider = providers.find(item => item.api_key === String(visionView.api_key || '') && item.api_url === String(visionView.api_url || ''));
    }
    if (!visionProvider) {
      let id = 'vision';
      let suffix = 2;
      while (providers.some(item => item.id === id)) id = `vision-${suffix++}`;
      visionProvider = { id, name: '视觉模型', api_key: '', api_url: '', enabled: true, models: [] };
      providers.push(visionProvider);
    }
    visionProvider.api_key = String(visionView.api_key || '');
    visionProvider.api_url = String(visionView.api_url || '');
    visionProvider.enabled = true;
    visionProvider.models ||= [];
    if (visionModelId && !visionProvider.models.some(item => item.model_id === visionModelId)) {
      visionProvider.models.push({ model_id: visionModelId, name: visionModelId, enabled: true });
    }
    config.vision.provider_id = visionProvider.id;
    config.vision.model_id = visionModelId;
  } else {
    config.vision.provider_id = '';
    config.vision.model_id = '';
  }
  config.vision.vision_model = {};
  delete config.llm.api_key;
  delete config.llm.api_url;
  delete config.llm.model;
  delete config.llm.temperature;
  delete config.llm.temperature_enabled;
  saveProviders(__dirname, providers);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function listPlugins() {
  const enabled = new Set(readJson(path.join(pluginsPath, 'enabled_plugins.json'), { plugins: [] }).plugins || []);
  const result = { builtIn: [], community: [], market: [] };
  for (const [type, key] of [['built-in', 'builtIn'], ['community', 'community']]) {
    const base = path.join(pluginsPath, type);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      const metaPath = path.join(dir, 'metadata.json');
      if (!fs.existsSync(metaPath)) continue;
      const meta = readJson(metaPath, {});
      const configFile = path.join(dir, 'plugin_config.json');
      result[key].push({ type, name: entry.name, relPath: `${type}/${entry.name}`,
        displayName: meta.displayName || meta.name || entry.name, description: meta.description || '',
        author: meta.author || '', version: meta.version || '', enabled: enabled.has(`${type}/${entry.name}`),
        hasConfig: fs.existsSync(configFile), config: readJson(configFile, {}),
        hasReadme: fs.existsSync(path.join(dir, 'README.md')), bat: meta.bat || '', downloadDlc: meta.download_dlc || '',
        dlcInstalled: !meta.download_dlc || fs.existsSync(path.join(__dirname, 'plugins-dlc', entry.name)) });
    }
    result[key].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
  }
  const market = readJson(path.join(pluginsPath, 'plugin-house', 'plugin_hub.json'), {});
  result.market = Object.entries(market).map(([id, item]) => ({ id, ...item, installed: result.community.some(p => p.name === id) }));
  return result;
}

const pluginMarketUrl = 'https://raw.githubusercontent.com/morettt/my-neuro/main/live-2d/plugins/plugin-house/plugin_hub.json';

async function refreshPluginMarket() {
  const response = await net.fetch(pluginMarketUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`获取插件列表失败（HTTP ${response.status}）`);
  const market = await response.json();
  if (!market || Array.isArray(market) || typeof market !== 'object') throw new Error('插件列表格式无效');
  fs.writeFileSync(path.join(pluginsPath, 'plugin-house', 'plugin_hub.json'), `${JSON.stringify(market, null, 2)}\n`, 'utf8');
  return listPlugins();
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk.toString(); });
    child.stderr?.on('data', chunk => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(output.trim() || `${command} 退出码 ${code}`)));
  });
}

async function downloadFile(url, file) {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

async function expandZip(zipFile, destination) {
  fs.mkdirSync(destination, { recursive: true });
  await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force', zipFile, destination]);
}

async function installDependencies(pluginDir) {
  const messages = [];
  if (fs.existsSync(path.join(pluginDir, 'requirements.txt'))) {
    await runProcess('python.exe', ['-m', 'pip', 'install', '-r', path.join(pluginDir, 'requirements.txt')], { cwd: pluginDir });
    messages.push('Python 依赖已安装');
  }
  return messages;
}

async function installPluginArchive(id, repo) {
  if (!/^[\w.-]+$/.test(id) || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i.test(repo)) throw new Error('插件信息无效');
  const target = path.join(pluginsPath, 'community', id);
  if (fs.existsSync(target)) throw new Error('插件已经安装');
  const match = repo.replace(/\.git\/?$/i, '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  const temp = fs.mkdtempSync(path.join(app.getPath('temp'), 'my-neuro-plugin-'));
  const zipFile = path.join(temp, 'plugin.zip');
  const extractDir = path.join(temp, 'extract');
  try {
    let lastError;
    for (const branch of ['main', 'master']) {
      try { await downloadFile(`https://github.com/${match[1]}/${match[2]}/archive/refs/heads/${branch}.zip`, zipFile); lastError = null; break; }
      catch (error) { lastError = error; }
    }
    if (lastError) throw lastError;
    await expandZip(zipFile, extractDir);
    const roots = fs.readdirSync(extractDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
    if (roots.length !== 1) throw new Error('插件压缩包结构无效');
    const source = path.join(extractDir, roots[0].name);
    if (!fs.existsSync(path.join(source, 'metadata.json'))) throw new Error('仓库根目录缺少 metadata.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
    const dependencyMessages = await installDependencies(target);
    return { ok: true, message: ['插件安装完成', ...dependencyMessages].join('，') };
  } catch (error) {
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function postDesktop(route, payload, timeout = 2500) {
  return new Promise(resolve => {
    const body = JSON.stringify(payload);
    const request = http.request({ hostname: '127.0.0.1', port: 3002, path: route, method: 'POST', timeout,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => { try { resolve(JSON.parse(text)); } catch { resolve({ success: response.statusCode < 400, message: text }); } });
    });
    request.on('timeout', () => request.destroy(new Error('桌宠响应超时')));
    request.on('error', error => resolve({ success: false, message: error.message }));
    request.end(body);
  });
}

function motionData(character) {
  if (String(character || '').startsWith('[VRM] ')) return { character, actions: {}, expressions: {} };
  const actionsAll = readJson(path.join(__dirname, 'emotion_actions.json'), {});
  const expressionsAll = readJson(path.join(__dirname, 'emotion_expressions.json'), {});
  const candidates = [character, ...(Object.keys(actionsAll))].filter(Boolean);
  const selected = candidates.find(name => actionsAll[name] || expressionsAll[name]) || '';
  return { character: selected, actions: actionsAll[selected]?.emotion_actions || {}, expressions: expressionsAll[selected]?.emotion_expressions || {} };
}

function environmentInfo() {
  const ttsHub = path.resolve(__dirname, '..', 'full-hub', 'tts-hub');
  let hasLocalTts = false;
  try { hasLocalTts = fs.statSync(ttsHub).isDirectory() && fs.readdirSync(ttsHub, { withFileTypes: true }).some(entry => entry.isDirectory()); } catch {}
  const currentConfig = readJson(configPath, {});
  return { edition: hasLocalTts ? 'local' : 'cloud', editionLabel: hasLocalTts ? '本地' : '云端', version: currentConfig.version || '' };
}

function listMcpTools() {
  const dir = path.join(__dirname, 'mcp', 'tools');
  const tools = [];
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(js|txt)$/i.test(file) || file.toLowerCase() === 'index.js') continue;
      const fullPath = path.join(dir, file);
      if (!fs.statSync(fullPath).isFile()) continue;
      let description = '';
      try { description = fs.readFileSync(fullPath, 'utf8').slice(0, 500).match(/\/\*\*\s*\n?\s*\*?\s*([^\n*]+)/)?.[1]?.trim() || ''; } catch {}
      tools.push({ type: 'local', key: file, name: file.replace(/\.(js|txt)$/i, ''), enabled: file.endsWith('.js'), description });
    }
  }
  const mcpConfig = readJson(path.join(__dirname, 'mcp', 'mcp_config.json'), {});
  const localNames = new Set(tools.map(tool => tool.name));
  for (const [key, value] of Object.entries(mcpConfig)) {
    const name = key.endsWith('_disabled') ? key.slice(0, -9) : key;
    const isLocal = (value.args || []).some(arg => typeof arg === 'string' && arg.includes('./mcp/tools/'));
    if (!isLocal && !localNames.has(name)) tools.push({ type: 'external', key, name, enabled: !key.endsWith('_disabled'), description: `外部工具 · ${value.command || ''}` });
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function createControlWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    frame: false,
    show: false,
    opacity: 0,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'control-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  const fadeWindow = (from, to, duration = 320) => new Promise(resolve => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (win.isDestroyed()) {
        clearInterval(timer);
        resolve();
        return;
      }
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      win.setOpacity(from + (to - from) * eased);
      if (progress >= 1) {
        clearInterval(timer);
        resolve();
      }
    }, 16);
  });
  let closing = false;
  win.once('ready-to-show', () => {
    win.show();
    fadeWindow(0, 1);
  });
  win.on('close', event => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    Promise.all([fadeWindow(win.getOpacity(), 0, 260), stopLive2dProcess(), stopConfiguredServices()])
      .finally(() => { if (!win.isDestroyed()) win.destroy(); });
  });
  win.loadFile('control.html');
  let pluginWatcher = null;
  try {
    let refreshTimer = null;
    pluginWatcher = fs.watch(pluginsPath, { recursive: true }, () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.send('control:plugins-changed');
      }, 350);
    });
  } catch {}
  win.once('closed', () => pluginWatcher?.close());
}

async function stopLive2dProcess() {
  if (!live2dProcess || live2dProcess.exitCode !== null) {
    live2dProcess = null;
    return { ok: false, message: '桌宠未在运行' };
  }
  await postDesktop('/prepare-close', {}, 1800);
  const pid = live2dProcess.pid;
  return new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    killer.on('error', error => resolve({ ok: false, message: `关闭失败：${error.message}` }));
    killer.on('exit', code => {
      if (code === 0) {
        live2dProcess = null;
        resolve({ ok: true, message: '桌宠已关闭' });
      } else {
        resolve({ ok: false, message: `关闭失败（${code}）` });
      }
    });
  });
}

ipcMain.handle('control:window', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  if (action === 'close') win.close();
});

ipcMain.handle('control:open-github', () => shell.openExternal('https://github.com/morettt/my-neuro'));
ipcMain.handle('control:reset-model-position', async () => {
  const current = readJson(configPath, {});
  current.ui ||= {};
  current.ui.model_position ||= {};
  Object.assign(current.ui.model_position, { x: 1.35, y: 0.8, remember_position: true });
  current.ui.model_scale = 0.65;
  fs.writeFileSync(configPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  const result = await postDesktop('/reset-model-position', {});
  return result.success ? { ok: true, message: '皮套位置已立即复位' } : { ok: true, message: '皮套位置已保存，桌宠启动后生效' };
});
ipcMain.handle('control:adjust-subtitle-position', async () => {
  const result = await postDesktop('/adjust-subtitle-position', {});
  return result.success ? { ok: true, message: '已进入字幕调整模式' } : { ok: false, message: '请先启动桌宠再调整字幕位置' };
});
ipcMain.handle('control:select-voice-file', async (_event, kind) => {
  const isModel = kind === 'model';
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: isModel
    ? [{ name: 'PyTorch 模型', extensions: ['pth'] }]
    : [{ name: '音频文件', extensions: ['wav'] }] });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const source = result.filePaths[0];
  const targetDir = path.join(__dirname, 'Voice_Model_Factory');
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, path.basename(source));
  fs.copyFileSync(source, target);
  if (isModel) selectedVoiceModelPath = target;
  else selectedVoiceAudioPath = target;
  return { ok: true, filename: path.basename(target) };
});
ipcMain.handle('control:generate-voice-bat', (_event, options) => {
  const character = String(options?.character || '').trim();
  const text = String(options?.text || '').trim();
  const language = ['zh', 'en', 'ja'].includes(options?.language) ? options.language : 'zh';
  if (!character || !text) return { ok: false, message: '请填写角色名称和参考文本' };
  if (!selectedVoiceModelPath || !fs.existsSync(selectedVoiceModelPath)) return { ok: false, message: '请先选择模型文件' };
  if (!selectedVoiceAudioPath || !fs.existsSync(selectedVoiceAudioPath)) return { ok: false, message: '请先选择参考音频' };
  const safeName = character.replace(/[<>:"/\\|?*]/g, '_');
  const escapedText = text.replace(/"/g, '""');
  const batPath = path.join(__dirname, 'Voice_Model_Factory', `${safeName}_TTS.bat`);
  const content = ['@echo off', 'set "PATH=%~dp0..\\..\\full-hub\\tts-hub\\GPT-SoVITS-Bundle\\runtime;%PATH%"',
    'cd /d "%~dp0..\\..\\full-hub\\tts-hub\\GPT-SoVITS-Bundle"',
    `python api.py -p 5000 -d cuda -s "${selectedVoiceModelPath}" -dr "${selectedVoiceAudioPath}" -dt "${escapedText}" -dl ${language}`, 'pause', ''].join('\r\n');
  fs.writeFileSync(batPath, content, 'utf8');
  return { ok: true, message: `已生成：${path.basename(batPath)}` };
});
ipcMain.handle('control:service-status', () => serviceStatus());
ipcMain.handle('control:start-service', async (event, id) => {
  const definition = serviceLaunchDefinition(id);
  if (!definition) return { ok: false, message: '未知服务' };
  if (!serviceInstalled(definition)) return { ok: false, message: `${definition.name} 模块尚未安装` };
  if (await portListening(definition.port)) return { ok: false, message: `${definition.name} 已在运行` };
  const batPath = path.join(projectRoot, definition.bat);
  if (!fs.existsSync(batPath)) return { ok: false, message: `找不到 ${definition.bat}` };
  sendServiceLog(event.sender, id, `正在启动 ${definition.name}...\n`);
  const child = spawn('cmd.exe', ['/d', '/c', batPath], { cwd: projectRoot, windowsHide: true });
  serviceProcesses[id] = child;
  child.stdout.on('data', chunk => sendServiceLog(event.sender, id, chunk));
  child.stderr.on('data', chunk => sendServiceLog(event.sender, id, chunk));
  child.on('error', error => sendServiceLog(event.sender, id, `启动失败：${error.message}\n`));
  child.on('exit', code => {
    if (serviceProcesses[id] === child) serviceProcesses[id] = null;
    sendServiceLog(event.sender, id, `\n${definition.name} 进程已退出（${code ?? '未知'}）\n`);
    if (!event.sender.isDestroyed()) event.sender.send('control:service-state');
  });
  return { ok: true, message: `${definition.name} 正在启动` };
});
ipcMain.handle('control:stop-service', async (event, id) => {
  const definition = serviceDefinitions[id];
  if (!definition) return { ok: false, message: '未知服务' };
  const pids = await listeningPids(definition.port);
  const tracked = serviceProcesses[id];
  if (tracked?.pid) pids.push(String(tracked.pid));
  const uniquePids = [...new Set(pids)];
  if (!uniquePids.length) return { ok: false, message: `${definition.name} 未在运行` };
  sendServiceLog(event.sender, id, `正在停止 ${definition.name}...\n`);
  await Promise.all(uniquePids.map(pid => new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/pid', pid, '/t', '/f'], { windowsHide: true });
    killer.on('error', resolve);
    killer.on('exit', resolve);
  })));
  serviceProcesses[id] = null;
  sendServiceLog(event.sender, id, `${definition.name} 已停止\n`);
  return { ok: true, message: `${definition.name} 已停止` };
});
ipcMain.handle('control:download-service', (event, id) => {
  const definition = serviceDefinitions[id];
  if (!definition) return { ok: false, message: '未知服务' };
  if (serviceInstalled(definition)) return { ok: false, message: `${definition.name} 已安装` };
  if (serviceDownloads[id]) return { ok: false, message: `${definition.name} 正在下载` };
  const script = path.join(hubRoot, 'Batch_Download.py');
  if (!fs.existsSync(script)) return { ok: false, message: '找不到 Batch_Download.py' };
  sendServiceLog(event.sender, id, `开始下载 ${definition.name} 模块...\n`);
  const child = spawn('python.exe', ['-u', script, definition.flag], { cwd: hubRoot, windowsHide: true });
  serviceDownloads[id] = child;
  child.stdout.on('data', chunk => sendServiceLog(event.sender, id, chunk));
  child.stderr.on('data', chunk => sendServiceLog(event.sender, id, chunk));
  child.on('error', error => sendServiceLog(event.sender, id, `下载启动失败：${error.message}\n`));
  child.on('exit', code => {
    serviceDownloads[id] = null;
    sendServiceLog(event.sender, id, `\n下载进程已结束（${code ?? '未知'}）\n`);
    if (!event.sender.isDestroyed()) event.sender.send('control:service-state');
  });
  return { ok: true, message: `开始下载 ${definition.name}` };
});
ipcMain.handle('control:open-external', (_event, url) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('不支持的链接');
  return shell.openExternal(url);
});
ipcMain.handle('control:list-plugins', () => listPlugins());
ipcMain.handle('control:refresh-plugin-market', () => refreshPluginMarket());
ipcMain.handle('control:set-plugin-enabled', (_event, relPath, enabled) => {
  if (!/^(built-in|community)\/[\w.-]+$/.test(relPath)) throw new Error('插件路径无效');
  const file = path.join(pluginsPath, 'enabled_plugins.json');
  const current = new Set(readJson(file, { plugins: [] }).plugins || []);
  enabled ? current.add(relPath) : current.delete(relPath);
  fs.writeFileSync(file, `${JSON.stringify({ plugins: [...current] }, null, 2)}\n`, 'utf8');
  return { ok: true };
});
ipcMain.handle('control:save-plugin-config', (_event, type, name, pluginConfig) => {
  if (!/^(built-in|community)$/.test(type) || !/^[\w.-]+$/.test(name)) throw new Error('插件名称无效');
  const file = path.join(pluginsPath, type, name, 'plugin_config.json');
  if (!fs.existsSync(path.dirname(file))) throw new Error('插件不存在');
  fs.writeFileSync(file, `${JSON.stringify(pluginConfig, null, 2)}\n`, 'utf8');
  return { ok: true };
});
ipcMain.handle('control:read-plugin-readme', (_event, type, name) => {
  if (!/^(built-in|community)$/.test(type) || !/^[\w.-]+$/.test(name)) throw new Error('插件名称无效');
  const file = path.join(pluginsPath, type, name, 'README.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
});
ipcMain.handle('control:install-plugin', async (_event, id, repo) => {
  try { return await installPluginArchive(id, repo); }
  catch (error) { return { ok: false, message: `安装失败：${error.message}` }; }
});
ipcMain.handle('control:install-plugin-dlc', async (_event, name, url) => {
  if (!/^[\w.-]+$/.test(name) || !/^https:\/\//i.test(url)) return { ok: false, message: 'DLC 信息无效' };
  const target = path.join(__dirname, 'plugins-dlc', name);
  const temp = fs.mkdtempSync(path.join(app.getPath('temp'), 'my-neuro-dlc-'));
  const zipFile = path.join(temp, 'dlc.zip');
  try {
    await downloadFile(url, zipFile);
    await expandZip(zipFile, target);
    return { ok: true, message: 'DLC 安装完成' };
  } catch (error) { return { ok: false, message: `DLC 安装失败：${error.message}` }; }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
ipcMain.handle('control:launch-plugin-bat', (_event, name, bat) => {
  if (!/^[\w.-]+$/.test(name) || typeof bat !== 'string') return { ok: false, message: '启动信息无效' };
  const root = path.resolve(__dirname, 'plugins-dlc', name);
  const file = path.resolve(root, bat);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) return { ok: false, message: '找不到插件启动文件' };
  spawn('cmd.exe', ['/d', '/c', 'start', '', file], { cwd: path.dirname(file), windowsHide: true, detached: true }).unref();
  return { ok: true, message: '插件已启动' };
});

ipcMain.handle('control:load-config', () => loadControlConfig());
ipcMain.handle('control:get-chat-history', () => {
  const file = path.join(projectRoot, 'AI记录室', '对话历史.jsonl');
  if (!fs.existsSync(file)) return { exists: false, file, messages: [], invalidLines: 0 };
  const messages = [];
  let invalidLines = 0;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { messages.push(JSON.parse(line)); } catch { invalidLines += 1; }
  }
  return { exists: true, file, messages, invalidLines };
});
ipcMain.handle('control:environment-info', () => environmentInfo());
ipcMain.handle('control:get-prompts', async () => {
  const response = await net.fetch('http://mynewbot.com/api/get-prompts');
  if (!response.ok) throw new Error(`提示词接口请求失败（${response.status}）`);
  const data = await response.json();
  if (!data.success) throw new Error(data.message || '获取提示词列表失败');
  return Array.isArray(data.prompts) ? data.prompts : [];
});
ipcMain.handle('control:fetch-llm-models', async (_event, apiUrl, apiKey) => {
  let endpoint = String(apiUrl || '').trim().replace(/\/+$/, '');
  if (!endpoint) throw new Error('请先填写 API 地址');
  for (const suffix of ['/chat/completions', '/completions', '/responses', '/models']) {
    if (endpoint.toLowerCase().endsWith(suffix)) { endpoint = endpoint.slice(0, -suffix.length).replace(/\/+$/, ''); break; }
  }
  endpoint += '/models';
  const headers = { Accept: 'application/json' };
  if (String(apiKey || '').trim()) headers.Authorization = `Bearer ${String(apiKey).trim()}`;
  let response;
  try { response = await net.fetch(endpoint, { headers, signal: AbortSignal.timeout(28000) }); }
  catch (error) { throw new Error(`连接模型接口失败：${error.message}`); }
  let payload = {};
  try { payload = await response.json(); } catch { throw new Error(`模型接口返回的不是 JSON（HTTP ${response.status}）`); }
  if (!response.ok) throw new Error(payload?.error?.message ? `HTTP ${response.status}：${payload.error.message}` : `获取失败（HTTP ${response.status}）`);
  const items = Array.isArray(payload) ? payload : payload.data;
  if (!Array.isArray(items)) throw new Error('接口返回格式不受支持：未找到模型列表');
  const models = [...new Set(items.map(item => typeof item === 'object' ? (item.id || item.name) : item).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  if (!models.length) throw new Error('接口返回成功，但模型列表为空');
  return models;
});
ipcMain.handle('control:list-mcp-tools', () => listMcpTools());
ipcMain.handle('control:toggle-mcp-tool', (_event, type, key) => {
  if (type === 'local') {
    if (!/^[\w.-]+\.(js|txt)$/.test(key) || key.toLowerCase() === 'index.js') throw new Error('工具文件无效');
    const oldPath = path.join(__dirname, 'mcp', 'tools', key);
    if (!fs.existsSync(oldPath)) throw new Error('工具文件不存在');
    const newKey = key.endsWith('.js') ? `${key.slice(0, -3)}.txt` : `${key.slice(0, -4)}.js`;
    fs.renameSync(oldPath, path.join(__dirname, 'mcp', 'tools', newKey));
  } else if (type === 'external') {
    const file = path.join(__dirname, 'mcp', 'mcp_config.json');
    const data = readJson(file, {});
    if (!(key in data)) throw new Error('外部工具不存在');
    const newKey = key.endsWith('_disabled') ? key.slice(0, -9) : `${key}_disabled`;
    data[newKey] = data[key]; delete data[key];
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } else throw new Error('工具类型无效');
  return { ok: true };
});
ipcMain.handle('control:get-tool-market', async () => {
  const response = await net.fetch('http://mynewbot.com/api/get-tools');
  if (!response.ok) throw new Error(`工具接口请求失败（${response.status}）`);
  const data = await response.json();
  if (!data.success) throw new Error(data.message || '获取工具列表失败');
  return Array.isArray(data.tools) ? data.tools : [];
});
ipcMain.handle('control:download-tool', async (_event, tool) => {
  const id = String(tool?.id || '');
  const filename = path.basename(String(tool?.file_name || ''));
  if (!id || !filename || !/\.(js|txt)$/i.test(filename)) throw new Error('工具信息无效');
  const response = await net.fetch(`http://mynewbot.com/api/download-tool/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
  fs.mkdirSync(path.join(__dirname, 'mcp', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'mcp', 'tools', filename), Buffer.from(await response.arrayBuffer()));
  return { ok: true, filename };
});

ipcMain.handle('control:save-config', (_event, config) => {
  saveControlConfig(config);
  return { ok: true };
});

ipcMain.handle('control:list-live2d-models', () => [
  ...scanLive2DModels().map(model => model.name),
  ...scanVRMModels().map(model => `[VRM] ${model.name}`)
]);
ipcMain.handle('control:current-live2d-model', () => {
  const currentConfig = readJson(configPath, {});
  if (currentConfig.ui?.model_type === 'vrm') {
    const configured = currentConfig.ui?.vrm_model;
    const model = scanVRMModels().find(item => item.name === configured) || scanVRMModels()[0];
    return model ? `[VRM] ${model.name}` : '';
  }
  return resolveLive2DModel(currentConfig.ui?.live2d_model).entry?.name || '';
});
ipcMain.handle('control:select-live2d-model', async (_event, name) => {
  const isVrm = name.startsWith('[VRM] ');
  const modelName = isVrm ? name.slice(6) : name;
  const targetType = isVrm ? 'vrm' : 'live2d';
  const vrmEntry = isVrm ? scanVRMModels().find(model => model.name === modelName) : null;
  if (isVrm ? !vrmEntry : !scanLive2DModels().some(model => model.name === modelName)) throw new Error('模型不存在');
  const currentConfig = readJson(configPath, {});
  const activeType = currentConfig.ui?.model_type === 'vrm' ? 'vrm' : 'live2d';
  const modelResult = await postDesktop('/set-avatar-model', { type: targetType, model_name: modelName }, 20000);
  let switchResult = modelResult;
  if (modelResult.success && activeType !== targetType) {
    switchResult = await postDesktop('/switch-avatar-type', { type: targetType }, 30000);
  }
  currentConfig.ui ||= {};
  currentConfig.ui.model_type = targetType;
  if (isVrm) {
    currentConfig.ui.vrm_model = vrmEntry.name;
    currentConfig.ui.vrm_model_path = vrmEntry.modelPath;
  } else {
    currentConfig.ui.live2d_model = modelName;
    currentConfig.ui.vrm_model = '';
    currentConfig.ui.vrm_model_path = '';
  }
  fs.writeFileSync(configPath, `${JSON.stringify(currentConfig, null, 2)}\n`, 'utf8');
  if (switchResult.success) return { ok: true, hotReloaded: true, message: `已切换到 ${name}` };
  return { ok: true, hotReloaded: false, message: `已选择 ${name}，桌宠未运行，将在下次启动时生效` };
});
ipcMain.handle('control:load-motion-data', (_event, character) => motionData(character));
ipcMain.handle('control:save-motion-data', (_event, character, kind, values) => {
  if (!character || !['actions', 'expressions'].includes(kind)) throw new Error('动作配置无效');
  const fileName = kind === 'actions' ? 'emotion_actions.json' : 'emotion_expressions.json';
  const rootKey = kind === 'actions' ? 'emotion_actions' : 'emotion_expressions';
  const file = path.join(__dirname, fileName);
  const all = readJson(file, {});
  all[character] ||= {};
  all[character][rootKey] = values;
  fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  return { ok: true };
});
ipcMain.handle('control:reset-motion-data', (_event, character, kind) => {
  const backupFile = kind === 'actions' ? 'character_backups.json' : 'character_backups1.json';
  const backup = readJson(path.join(__dirname, backupFile), {});
  const original = backup[character]?.original_config;
  if (!original) return { ok: false, message: `角色 ${character} 没有备份配置` };
  const fileName = kind === 'actions' ? 'emotion_actions.json' : 'emotion_expressions.json';
  const all = readJson(path.join(__dirname, fileName), {});
  all[character] = original;
  fs.writeFileSync(path.join(__dirname, fileName), `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  return { ok: true, message: '已还原原始配置' };
});
ipcMain.handle('control:trigger-motion', (_event, name) => postDesktop('/control-motion', { action: 'trigger_emotion', emotion_name: name }));
ipcMain.handle('control:trigger-expression', (_event, name) => postDesktop('/control-expression', { action: 'trigger_expression', expression_name: name }));
ipcMain.handle('control:apply-vmc', async (_event, host, port) => {
  const current = readJson(configPath, {}); current.vmc ||= {}; current.vmc.host = host || '127.0.0.1'; current.vmc.port = Number(port) || 39539;
  fs.writeFileSync(configPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  if (!live2dProcess || live2dProcess.exitCode !== null) return { success: true, message: 'VMC 地址已保存，桌宠启动后生效' };
  return postDesktop('/control-vmc', { host: current.vmc.host, port: current.vmc.port });
});

ipcMain.handle('control:start-live2d', event => {
  if (live2dProcess && live2dProcess.exitCode === null) return { ok: false, message: '桌宠已在运行' };
  startRuntimeLog(event.sender);
  live2dProcess = spawn('cmd.exe', ['/d', '/c', 'go.bat'], {
    cwd: __dirname,
    windowsHide: true
  });
  live2dProcess.stdout.on('data', () => {});
  live2dProcess.stderr.on('data', () => {});
  live2dProcess.on('exit', code => {
    stopRuntimeLog();
    if (!event.sender.isDestroyed()) {
      event.sender.send('control:tool-log', `桌宠进程已退出（${code ?? '未知'}）\n`);
      event.sender.send('control:live2d-state', false);
    }
    live2dProcess = null;
  });
  return { ok: true, message: '正在启动桌宠' };
});

ipcMain.handle('control:stop-live2d', async () => {
  return stopLive2dProcess();
});

app.whenReady().then(createControlWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
