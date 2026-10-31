const { app, BrowserWindow, ipcMain, shell, net, dialog } = require('electron');

// Electron 28 / Chromium 120 retains an IMM32 fallback for Windows IMEs.
// The failing session receives only keyUp events, with no keyDown or composition
// reaching webContents despite correct focus. Use the alternate native IME path.
// https://github.com/chromium/chromium/blob/120.0.6099.225/ui/base/ime/init/input_method_factory.cc
if (process.platform === 'win32' && process.versions.electron?.startsWith('28.')) {
  const disabledFeatures = new Set(app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean));
  disabledFeatures.add('TSFImeSupport');
  app.commandLine.appendSwitch('disable-features', [...disabledFeatures].join(','));
}

const { configureElectron, electronLaunchArgs, projectPython, spawnManaged, stopManaged, requireLinuxPython } = require('./js/platform/runtime');
const { nativeWayland } = configureElectron(app);
const { overlayTopmostLevel } = require('./js/platform/window-layout');

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const http = require('http');
const nodeNet = require('node:net');
const { scanLive2DModels, resolveLive2DModel, scanVRMModels, scanMMDModels } = require('./js/avatar/model-registry');
const { EMOTIONS: motionEmotions, mergeExpressionConfig, mergeActionConfig, isLive2DModelDir } = require('./js/avatar/model-defaults');
const { loadProvidersFromStore, saveProviders } = require('./js/core/llm-provider-store');
const aliyunVoiceClone = require('./js/voice/aliyun-voice-clone');
const { llmRequestHeaders } = require('./js/ai/llm-request-headers');
const { discoverPluginServices, resolvePluginServiceLaunch } = require('./js/services/plugin-services');
const { pluginDlcInfo, findPluginDlc } = require('./js/services/plugin-dlc');
const { downloadCacheRoot, ensureDownloadSpace, downloadProcessEnv, explainStorageError } = require('./js/services/download-storage');

const configPath = path.join(__dirname, 'config.json');
const pluginsPath = path.join(__dirname, 'plugins');
let live2dProcess = null;
const runtimeLogPath = path.join(__dirname, 'runtime.log');
let runtimeLogSender = null;
let runtimeLogLength = 0;
let runtimeLogRemainder = '';
let controlWindow = null;

// 🔥 单实例锁：反复双击 肥牛.exe 之前会一直开新窗口/新进程，
// 拿不到锁就直接退出，并把已有窗口拉到前台。
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (!controlWindow || controlWindow.isDestroyed()) return;
  if (controlWindow.isMinimized()) controlWindow.restore();
  controlWindow.show();
  controlWindow.focus();
});
let selectedVoiceModelPath = '';
let selectedVoiceAudioPath = '';
let selectedAliyunAudioPath = '';
let avatarLoadingWindow = null;
let avatarLoadingTimer = null;

function closeAvatarLoadingWindow() {
  clearTimeout(avatarLoadingTimer);
  avatarLoadingTimer = null;
  if (avatarLoadingWindow && !avatarLoadingWindow.isDestroyed()) avatarLoadingWindow.destroy();
  avatarLoadingWindow = null;
}

function showAvatarLoadingWindow() {
  if (nativeWayland) return;
  closeAvatarLoadingWindow();
  const displays = require('electron').screen.getAllDisplays();
  const minX = Math.min(...displays.map(display => display.bounds.x));
  const minY = Math.min(...displays.map(display => display.bounds.y));
  const maxX = Math.max(...displays.map(display => display.bounds.x + display.bounds.width));
  const maxY = Math.max(...displays.map(display => display.bounds.y + display.bounds.height));
  const cached = readJson(path.join(__dirname, 'avatar-loading-position.json'), null);
  const config = readJson(configPath, {});
  const pos = config.ui?.model_position || {};
  const relX = Number.isFinite(cached?.x) ? cached.x : Math.max(0, Math.min(1, Number(pos.x) || 0.65));
  const relY = Number.isFinite(cached?.y) ? cached.y : Math.max(0, Math.min(1, Number(pos.y) || 0.38));
  const size = 72;
  avatarLoadingWindow = new BrowserWindow({
    x: Math.round(minX + (maxX - minX) * relX - size / 2),
    y: Math.round(minY + (maxY - minY) * relY - size / 2),
    width: size,
    height: size,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  avatarLoadingWindow.setIgnoreMouseEvents(true);
  avatarLoadingWindow.setAlwaysOnTop(true, overlayTopmostLevel());
  avatarLoadingWindow.loadFile('avatar-loading.html');
  avatarLoadingWindow.once('ready-to-show', () => avatarLoadingWindow?.showInactive());
  avatarLoadingTimer = setTimeout(closeAvatarLoadingWindow, 30000);
}

function cleanToolLog(line) {
  return line
    .replace(/^(?:\[[^\]\r\n]+\]\s*)+/, '')
    .replace(/插件已加载[：:]\s*/u, '')
    .trim();
}

function cleanPetLog(line) {
  if (/\[Live2DStage\]\s*初始化完成|\[Live2DSetup\]\s*共发现|\[Live2DLoader\]\s*(?:开始加载模型|transform:|模型加载完成)|\[ParamDirector\]\s*已启用|\[Live2DRuntime\]\s*已安装|\[EmotionEngine\].*配置加载完成|\[AuDriver\]\s*(?:未找到模型 AU 配置|跳过不可映射 AU|已就绪|解算)|\[AvatarFacade\]\s*形态已激活/.test(line)) return null;
  if (/插件热加载监听已启动|\[Plugin:core_memory_injector\].*(?:不存在，跳过加载|插件已启动)|\[Plugin:dawn_dusk_line\].*已启动|\[Plugin:user_profile\].*(?:插件已启动|MemOS 不可用)|\[MotionDirector\]\s*(?:body|face)\s*失败，保留本地编舞|对话模型[：:].*提供商|配置文件加载成功|AI回复中/.test(line)) return null;
  if (/已将内容发送给AI/.test(line)) return null;
  const modelMatch = line.match(/已加载\s*\d+\s*个\s*LLM\s*提供商[^\n]*?当前模型[：:]\s*([^）)\s]+)/i);
  return modelMatch ? `当前使用模型：${modelMatch[1]}` : line.replace(/\[Plugin:[^\]\r\n]+\][ \t]*/g, '');
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
      if (/\[AvatarFacade\]\s*形态已激活|\[Live2DLoader\]\s*模型加载完成/.test(line)) closeAvatarLoadingWindow();
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
const serviceProcesses = {};
const serviceDownloads = {};
const pluginDlcProgress = new Map();
const builtinServiceDefinitions = {};
function getServiceDefinitions() {
  return { ...builtinServiceDefinitions, ...discoverPluginServices(pluginsPath, Object.keys(builtinServiceDefinitions)) };
}
const projectRoot = path.resolve(__dirname, '..');
const hubRoot = path.join(projectRoot, 'full-hub');
const projectEnvPython = projectPython(projectRoot);
const projectEnvUrl = 'https://modelscope.cn/models/morelle/my-neuro-env/resolve/master/my-neuro-env.tar.gz';

async function ensureProjectPython(sender, service, onProgress = () => {}) {
  if (process.platform !== 'win32') return requireLinuxPython(projectRoot);
  if (fs.existsSync(projectEnvPython)) {
    onProgress({ stage: 'environment-ready', percent: 100 });
    return projectEnvPython;
  }
  onProgress({ stage: 'environment-download', percent: null, received: 0, total: 0 });
  const tempDir = fs.mkdtempSync(path.join(downloadCacheRoot(__dirname), 'env-'));
  const archive = path.join(tempDir, 'my-neuro-env.tar.gz');
  const envDir = path.join(projectRoot, 'env');
  sendServiceLog(sender, service, '@@ENV_START\n');
  sendServiceLog(sender, service, '\u672a\u68c0\u6d4b\u5230\u9879\u76ee Python \u73af\u5883\uff0c\u5f00\u59cb\u4e0b\u8f7d morelle/my-neuro-env...\n');
  try {
    const response = await net.fetch(projectEnvUrl, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    ensureDownloadSpace(tempDir, total);
    let received = 0;
    let lastPercent = -1;
    let lastProgressBytes = 0;
    const progressStream = new (require('node:stream').Transform)({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        const percent = total ? Math.min(100, Math.floor(received / total * 100)) : 0;
        if (percent !== lastPercent || received - lastProgressBytes >= 1024 * 1024) {
          lastPercent = percent;
          lastProgressBytes = received;
          sendServiceLog(sender, service, `@@ENV_PROGRESS:${percent}:${received}:${total}\n`);
          onProgress({ stage: 'environment-download', percent: total ? percent : null, received, total });
        }
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), progressStream, fs.createWriteStream(archive));
    fs.mkdirSync(envDir, { recursive: true });
    sendServiceLog(sender, service, '@@ENV_EXTRACT\n');
    onProgress({ stage: 'environment-extract', percent: null });
    sendServiceLog(sender, service, '\u9879\u76ee Python \u73af\u5883\u4e0b\u8f7d\u5b8c\u6210\uff0c\u6b63\u5728\u89e3\u538b...\n');
    await new Promise((resolve, reject) => {
      const child = spawn('tar.exe', ['-xzf', archive, '-C', envDir], { windowsHide: true });
      let errorText = '';
      child.stderr.on('data', chunk => { errorText += String(chunk); });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(errorText.trim() || `tar.exe ${code}`)));
    });
    if (!fs.existsSync(projectEnvPython)) throw new Error('\u89e3\u538b\u540e\u672a\u627e\u5230 env\\python.exe');
    sendServiceLog(sender, service, '@@ENV_DONE\n');
    onProgress({ stage: 'environment-ready', percent: 100 });
    sendServiceLog(sender, service, '\u9879\u76ee Python \u73af\u5883\u5b89\u88c5\u5b8c\u6210\u3002\n');
    return projectEnvPython;
  } catch (error) {
    throw new Error(explainStorageError(error, tempDir));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function serviceLaunchDefinition(id) {
  return resolvePluginServiceLaunch(getServiceDefinitions()[id], readJson(configPath, {}));
}

function serviceInstalled(definition) {
  return definition.checks.every(item => fs.existsSync(path.join(definition.resourceRoot || hubRoot, item)));
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
  return Promise.all(Object.entries(getServiceDefinitions()).map(async ([id, definition]) => {
    const listening = await portListening(definition.port);
    const processActive = Boolean(serviceProcesses[id] && serviceProcesses[id].exitCode === null);
    return {
      id, name: definition.name, tabLabel: definition.tabLabel || id.toUpperCase(), port: definition.port, plugin: definition.plugin || null,
      installed: serviceInstalled(definition) && (!definition.startScript || fs.existsSync(definition.pythonExecutable || projectEnvPython)),
      downloading: Boolean(serviceDownloads[id]),
      running: listening || processActive,
      starting: processActive && !listening
    };
  }));
}

async function stopConfiguredServices() {
  if (process.platform !== 'win32') {
    await Promise.all([...Object.values(serviceProcesses), ...Object.values(serviceDownloads)].map(stopManaged));
    for (const id of Object.keys(serviceProcesses)) serviceProcesses[id] = null;
    for (const id of Object.keys(serviceDownloads)) serviceDownloads[id] = null;
    return;
  }
  for (const [id, definition] of Object.entries(getServiceDefinitions())) {
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
  // DLC 可以在插件启用前安装，退出时也要结束这些安装进程。
  for (const [id, child] of Object.entries(serviceDownloads)) {
    if (!child?.pid) continue;
    await runProcess('taskkill.exe', ['/pid', String(child.pid), '/t', '/f']).catch(() => {});
    serviceDownloads[id] = null;
  }
}

function listeningPids(port) {
  if (process.platform !== 'win32') return Promise.resolve([]);
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
  config.tts ||= {};
  config.asr ||= {};
  config.tts.enabled = true;
  config.asr.enabled = true;
  config.llm ||= {};
  const providers = loadProvidersFromStore(__dirname).providers;
  const provider = providers.find(item => item.id === config.llm.provider_id)
    || providers.find(item => item.enabled !== false)
    || providers[0];
  // An explicitly saved empty model is intentional; only legacy configs need a default.
  const hasModelSelection = Object.prototype.hasOwnProperty.call(config.llm, 'model_id');
  const model = hasModelSelection
    ? provider?.models?.find(item => item.model_id === config.llm.model_id)
    : provider?.models?.find(item => item.enabled !== false) || provider?.models?.[0];
  if (hasModelSelection) config.llm.model = config.llm.model_id || '';
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
  const hasVisionModelSelection = Object.prototype.hasOwnProperty.call(config.vision, 'model_id');
  const visionModel = hasVisionModelSelection
    ? visionProvider?.models?.find(item => item.model_id === config.vision.model_id)
    : visionProvider?.models?.find(item => item.enabled !== false) || visionProvider?.models?.[0];
  if (hasVisionModelSelection) config.vision.vision_model.model = config.vision.model_id || '';
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
      let dlcInstalled = false;
      try { dlcInstalled = pluginDlcInfo(pluginsPath, dir, meta).installed; } catch {}
      result[key].push({ type, name: entry.name, relPath: `${type}/${entry.name}`,
        displayName: meta.displayName || meta.name || entry.name, description: meta.description || '',
        author: meta.author || '', version: meta.version || '', enabled: enabled.has(`${type}/${entry.name}`),
        hasConfig: fs.existsSync(configFile), config: readJson(configFile, {}),
        categories: Array.isArray(meta.categories) ? meta.categories : [],
        serviceId: meta.localService?.id || null,
        serviceActions: meta.localService?.actions || [],
        hasReadme: fs.existsSync(path.join(dir, 'README.md')), bat: meta.bat || '', downloadDlc: meta.download_dlc || '',
        dlcInstalled, dlcProgress: pluginDlcProgress.get(entry.name) || null });
    }
    result[key].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
  }
  const market = readJson(path.join(pluginsPath, 'plugin-house', 'plugin_hub.json'), {});
  const marketDisplayNames = {
    'time-awareness': '时间感知',
    'my-neuro-plugin-hitokoto': '每日一言',
    'my-neuro-plugin-memos': 'MemOS 长期记忆',
    'loki-shadow': '洛基之影',
    'myneuro-plugin-skills': '技能管理',
    'core-memory-injector': '核心记忆注入',
    'astrbook-forum': 'AstrBook 论坛',
    'world-eye': '世界之眼',
    'ai-log': '思痕之册',
    'dawn-dusk-line': '晨昏之线',
    'mood-chat': '心情对话系统',
    'thinking-bubble': '思考气泡',
    'rebirth-feiniu-music': '网易云音乐',
    'bilibili-tools': 'B站工具',
    'multi-search': '多引擎搜索',
    'openrouter-image': 'OpenRouter 图像生成',
    'windows-app-launcher': 'Windows 应用启动',
    'mcp-filesystem': 'MCP 文件系统',
    'remote-sync': '远程同步',
    'exp3-model-processor': 'EXP3 表情整理器',
    'check-in': '定时问候',
    'txt-writer': '文本写入',
    'minimax-music': 'MiniMax 音乐生成',
    'feiniu-board-game': '肥牛棋盘游戏',
    'kimi-search': 'Kimi 联网搜索',
    'agent-dream': '梦境系统',
    'qq-connect': 'QQ 连接',
    'timed-tasks': '定时任务',
    'screen-narrator': '屏幕感知'
  };
  result.market = Object.entries(market).map(([id, item]) => {
    const installedPlugin = result.community.find(plugin => plugin.name === id);
    return {
      id,
      ...item,
      categories: installedPlugin?.categories?.length ? installedPlugin.categories : (Array.isArray(item.categories) ? item.categories : []),
      display_name: installedPlugin?.displayName || marketDisplayNames[id] || item.display_name || id,
      installed: Boolean(installedPlugin)
    };
  });
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
    const forward = chunk => { const text = chunk.toString(); output += text; options.onOutput?.(text); };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(output.trim() || `${command} 退出码 ${code}`)));
  });
}

async function downloadFileOnce(url, file, onProgress) {
  let received = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const headers = received ? { Range: `bytes=${received}-` } : {};
  const response = await net.fetch(url, { headers, signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
  if (received && response.status !== 206) { received = 0; fs.rmSync(file, { force: true }); }
  const total = received + (Number(response.headers.get('content-length')) || 0);
  const output = fs.createWriteStream(file, { flags: received ? 'a' : 'w' });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Download stream unavailable');
  try {
    while (true) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('download stalled for 30 seconds')), 30000))
      ]);
      if (done) break;
      received += value.byteLength;
      if (!output.write(Buffer.from(value))) await new Promise(resolve => output.once('drain', resolve));
      onProgress?.(received, total);
    }
  } finally { output.end(); }
}

async function downloadFile(url, file, onProgress) {
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await downloadFileOnce(url, file, onProgress);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 8) await new Promise(resolve => setTimeout(resolve, Math.min(attempt * 2000, 10000)));
    }
  }
  throw lastError;
}

async function expandZip(zipFile, destination, onProgress) {
  fs.mkdirSync(destination, { recursive: true });
  await runProcess('7z.exe', ['x', zipFile, `-o${destination}`, '-y', '-bsp1'], {
    onOutput: text => { const match = text.match(/(\d+)%/); if (match) onProgress?.(match[1]); }
  });
  /* await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference = "Stop"; [Console]::OutputEncoding = [Text.UTF8Encoding]::new(); Expand-Archive -LiteralPath $env:MY_NEURO_PLUGIN_ZIP -DestinationPath $env:MY_NEURO_PLUGIN_DESTINATION -Force'], {
    env: {
      ...process.env,
      MY_NEURO_PLUGIN_ZIP: zipFile,
      MY_NEURO_PLUGIN_DESTINATION: destination
    }
  }); */
}

function flattenSingleDirectory(destination) {
  const entries = fs.readdirSync(destination, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  const nested = path.join(destination, entries[0].name);
  for (const entry of fs.readdirSync(nested)) {
    fs.renameSync(path.join(nested, entry), path.join(destination, entry));
  }
  fs.rmSync(nested, { recursive: true, force: true });
}

async function installModelScopeDlc(repoUrl, destination, onProgress) {
  const match = repoUrl.match(/^https:\/\/www\.modelscope\.cn\/(models|datasets)\/([\w.-]+)\/([\w.-]+)\/?$/i);
  if (!match) throw new Error('魔搭仓库地址无效');
  const repoId = `${match[2]}/${match[3]}`;
  const kind = match[1].toLowerCase() === 'datasets' ? '--dataset' : '--model';
  fs.mkdirSync(destination, { recursive: true });
  let lastError;
  for (const command of ['modelscope', 'python.exe']) {
    try {
      const args = command === 'modelscope'
        ? ['download', kind, repoId, '--revision', 'master', '--local_dir', destination]
        : ['-m', 'modelscope', 'download', kind, repoId, '--revision', 'master', '--local_dir', destination];
      await runProcess(command, args, { cwd: destination, onOutput: text => onProgress?.(text) });
      const required = ['web.py', 'weights/gpt.pth', 'weights/vq.pth', 'runtime/env/python.exe', '启动动作服务.bat'];
      const hasRequired = required.every(file => fs.existsSync(path.join(destination, file)));
      if (!hasRequired) throw new Error('魔搭下载不完整：缺少 BONES120 运行文件或权重');
      return;
    } catch (error) { lastError = error; }
  }
  throw new Error(`找不到可用的 ModelScope 下载命令：${lastError?.message || '请安装 modelscope CLI'}`);
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

const motionFile = kind => path.join(__dirname, kind === 'actions' ? 'emotion_actions.json' : 'emotion_expressions.json');
const motionRootKey = kind => kind === 'actions' ? 'emotion_actions' : 'emotion_expressions';
const mergeMotionConfig = (kind, character, existing) => (kind === 'actions' ? mergeActionConfig : mergeExpressionConfig)(character, existing);
// WebUI 保存过的模型会有 per-model sidecar（2D/<模型>/emotion_mapping.json），桌宠优先读它而不是中央配置；
// 面板必须同样以它为准读写，否则这里的改动桌宠看不到。
const sidecarPath = character => path.join(__dirname, '2D', character, 'emotion_mapping.json');
const sidecarKeys = kind => kind === 'actions' ? { list: 'motions', named: 'actions' } : { list: 'expressions', named: 'expressions_named' };

function readMotionConfig(character, kind) {
  const sidecar = readJson(sidecarPath(character), null);
  if (!sidecar || typeof sidecar !== 'object') return readJson(motionFile(kind), {})[character]?.[motionRootKey(kind)];
  const { list, named } = sidecarKeys(kind);
  const config = {};
  for (const [emotion, entry] of Object.entries(sidecar.emotions || {})) if (Array.isArray(entry?.[list])) config[emotion] = entry[list];
  for (const [name, files] of Object.entries(sidecar[named] || {})) if (Array.isArray(files)) config[name] = files;
  return config;
}

function writeMotionConfig(character, kind, values) {
  const file = motionFile(kind);
  const all = readJson(file, {});
  all[character] ||= {};
  all[character][motionRootKey(kind)] = values;
  fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  const sidecar = readJson(sidecarPath(character), null);
  if (!sidecar || typeof sidecar !== 'object') return;
  const { list, named } = sidecarKeys(kind);
  sidecar.emotions ||= {};
  sidecar[named] = {};
  for (const [key, files] of Object.entries(values)) {
    if (motionEmotions.includes(key)) (sidecar.emotions[key] ||= {})[list] = files;
    else sidecar[named][key] = files;
  }
  fs.writeFileSync(sidecarPath(character), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
}

// 桌宠运行中时让它重读表情/动作配置；未运行则静默忽略（下次启动自然生效）
const notifyDesktopReload = () => postDesktop('/reload-config', {}, 3000);

// 面板展示的配置以模型目录为准：没有条目就按目录生成，有条目就补齐新增文件、剔除已删除的文件。
// 这样用户直接把模型丢进 2D/ 就能用，不再依赖手动运行 AI_set_live2d.py。
function syncedMotionConfig(character, kind) {
  const { config, changed } = mergeMotionConfig(kind, character, readMotionConfig(character, kind));
  if (changed) { writeMotionConfig(character, kind, config); notifyDesktopReload(); }
  return config;
}

function motionData(character) {
  const name = String(character || '');
  if (!name || name.startsWith('[VRM] ') || !isLive2DModelDir(name)) return { character: name, actions: {}, expressions: {} };
  return { character: name, actions: syncedMotionConfig(name, 'actions'), expressions: syncedMotionConfig(name, 'expressions') };
}

function environmentInfo() {
  let hasLocalTts = false;
  try {
    const metadata = readJson(path.join(pluginsPath, 'built-in/local-tts/metadata.json'), {});
    hasLocalTts = metadata.localService?.id === 'tts' && pluginDlcInfo(pluginsPath, path.join(pluginsPath, 'built-in/local-tts'), metadata).installed;
  } catch {}
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
  const win = controlWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    frame: nativeWayland,
    show: process.platform === 'linux',
    opacity: process.platform === 'linux' ? 1 : 0,
    transparent: process.platform !== 'linux',
    backgroundColor: process.platform === 'linux' ? '#20232b' : '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'control-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // 全屏透明的桌宠窗口抢鼠标时，系统会误判面板被完全遮挡而停止绘制，日志收到了也不刷新
      backgroundThrottling: false
    }
  });
  const fadeWindow = (from, to, duration = 320) => new Promise(resolve => {
    if (process.platform === 'linux') { resolve(); return; }
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
  let configDirty = false;
  win.once('ready-to-show', () => {
    win.show();
    if (process.platform !== 'linux') fadeWindow(0, 1);
  });
  win.on('close', event => {
    if (closing) return;
    event.preventDefault();
    if (configDirty) {
      win.webContents.send('control:close-requested');
      return;
    }
    closing = true;
    const autoCloseServices = readJson(configPath, {}).auto_close_services?.enabled ?? true;
    Promise.all([fadeWindow(win.getOpacity(), 0, 260), stopLive2dProcess(),
      autoCloseServices ? stopConfiguredServices() : Promise.resolve()])
      .finally(() => { if (!win.isDestroyed()) win.destroy(); });
  });
  win.webContents.once('did-finish-load', () => {
    if (process.argv.includes('--start-pet')) startLive2d({ sender: win.webContents });
  });
  win.loadFile(path.join(__dirname, 'control.html'), {
    query: process.argv.includes('--voice-clone') ? { view: 'voice-clone' } : {}
  });
  ipcMain.on('control:config-dirty', (event, dirty) => {
    if (event.sender === win.webContents) configDirty = Boolean(dirty);
  });
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
  if (process.platform !== 'win32') {
    try { await stopManaged(live2dProcess); live2dProcess = null; return { ok: true, message: '桌宠已关闭' }; }
    catch (error) { return { ok: false, message: error.message }; }
  }
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

ipcMain.handle('control:confirm-unsaved-config', async (event, title = '未保存配置') => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    title,
    message: '当前配置有未保存的修改，继续操作可能导致配置未生效。',
    detail: '是否保存当前配置？',
    buttons: ['保存', '放弃', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });
  return ['save', 'discard', 'cancel'][result.response] || 'cancel';
});

ipcMain.handle('control:open-github', () => shell.openExternal('https://github.com/morettt/my-neuro'));
ipcMain.handle('control:reset-model-position', async () => {
  const current = readJson(configPath, {});
  current.ui ||= {};
  current.ui.model_position ||= {};
  Object.assign(current.ui.model_position, { x: 1.35, y: 0.8, remember_position: true });
  current.ui.model_scale = 0.65;
  delete current.ui.vrm_viewport_width;
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
ipcMain.handle('control:select-aliyun-audio', async (_event, droppedPath) => {
  try {
    let source = typeof droppedPath === 'string' ? droppedPath : '';
    if (!source) {
      const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [
        { name: '参考音频', extensions: ['wav', 'mp3', 'm4a'] }
      ] });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      source = result.filePaths[0];
    }
    const extension = path.extname(source).slice(1).toLowerCase();
    const mimes = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4' };
    if (!mimes[extension]) throw new Error('请选择 WAV、MP3 或 M4A 音频');
    const stat = await fs.promises.stat(source);
    if (!stat.isFile() || !stat.size || stat.size > 10 * 1024 * 1024) throw new Error('音频不能为空，且不能超过 10 MB');
    const bytes = await fs.promises.readFile(source);
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('音频不能为空，且不能超过 10 MB');
    selectedAliyunAudioPath = source;
    return { ok: true, filename: path.basename(source), size: bytes.length,
      preview: `data:${mimes[extension]};base64,${bytes.toString('base64')}` };
  } catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle('control:upload-aliyun-audio', async () => {
  const defaults = readJson(path.join(__dirname, '.voice-upload-client.json'), {});
  try {
    if (!selectedAliyunAudioPath) throw new Error('请先选择参考音频');
    const uploaded = await aliyunVoiceClone.uploadAudio(selectedAliyunAudioPath, defaults, (...args) => net.fetch(...args));
    return { ok: true, ...uploaded };
  } catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle('control:enroll-aliyun-voice', async (_event, options) => {
  try {
    return { ok: true, ...await aliyunVoiceClone.enrollVoice(options, (...args) => net.fetch(...args)) };
  } catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle('control:query-aliyun-voice', async (_event, options) => {
  try {
    return { ok: true, ...await aliyunVoiceClone.queryVoice(options, (...args) => net.fetch(...args)) };
  } catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle('control:generate-voice-bat', (_event, options) => {
  if (process.platform !== 'win32') return { ok: false, message: 'Linux 请独立部署 GPT-SoVITS 并配置 TTS API 地址，不使用 Windows 声音启动脚本。' };
  const character = String(options?.character || '').trim();
  const text = String(options?.text || '').trim();
  const language = ['zh', 'en', 'ja'].includes(options?.language) ? options.language : 'zh';
  if (!character || !text) return { ok: false, message: '请填写角色名称和参考文本' };
  if (!selectedVoiceModelPath || !fs.existsSync(selectedVoiceModelPath)) return { ok: false, message: '请先选择模型文件' };
  if (!selectedVoiceAudioPath || !fs.existsSync(selectedVoiceAudioPath)) return { ok: false, message: '请先选择参考音频' };
  const { writeVoiceLauncher } = require('./plugins/built-in/local-tts/voice-launcher');
  const batPath = writeVoiceLauncher({ factoryDir: path.join(__dirname, 'Voice_Model_Factory'),
    character, model: selectedVoiceModelPath, reference: selectedVoiceAudioPath, text, language });
  return { ok: true, message: `已生成：${path.basename(batPath)}` };
});
ipcMain.handle('control:service-status', async () => (await serviceStatus()).filter(service => !service.plugin));
ipcMain.handle('control:plugin-service-status', async () => (await serviceStatus()).filter(service => service.plugin));
ipcMain.handle('control:start-service', async (event, id) => {
  const definition = serviceLaunchDefinition(id);
  if (!definition) return { ok: false, message: '未知服务' };
  if (!serviceInstalled(definition)) return { ok: false, message: `${definition.name} 模块尚未安装` };
  if (await portListening(definition.port)) return { ok: false, message: `${definition.name} 已在运行` };
  if (process.platform !== 'win32' && !definition.startScript) return { ok: false, message: '此模块仅提供 Windows 运行包。Linux 请独立部署服务并配置 API 地址，参见 Linux 部署文档。' };
  const batPath = definition.bat ? path.join(projectRoot, definition.bat) : null;
  if (batPath && !fs.existsSync(batPath)) return { ok: false, message: `找不到 ${definition.bat}` };
  const pythonExecutable = definition.pythonExecutable || projectEnvPython;
  if (process.platform !== 'win32' && /\.exe$/i.test(pythonExecutable)) return { ok: false, message: '该 DLC 使用 Windows Python 运行环境。Linux 请独立部署服务并配置 API 地址。' };
  if (definition.startScript && !fs.existsSync(pythonExecutable)) return { ok: false, message: '缺少服务运行环境，请先安装 DLC' };
  sendServiceLog(event.sender, id, `正在启动 ${definition.name}...\n`);
  const child = definition.startScript
    ? spawnManaged(pythonExecutable, ['-u', definition.startScript, ...(definition.startArgs || [])], {
      cwd: definition.workingDirectory || definition.resourceRoot || hubRoot, windowsHide: true,
      env: { ...downloadProcessEnv(__dirname), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', MY_NEURO_FULL_HUB_DIR: hubRoot,
        MY_NEURO_SERVICE_RESOURCE_DIR: definition.resourceRoot || hubRoot }
    })
    : spawn('cmd.exe', ['/d', '/c', batPath], { cwd: projectRoot, windowsHide: true });
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
async function stopService(event, id) {
  const definition = getServiceDefinitions()[id];
  if (!definition) return { ok: false, message: '未知服务' };
  const tracked = serviceProcesses[id];
  if (process.platform !== 'win32') {
    if (!tracked) return { ok: false, message: '此服务不是由本控制面板启动，请在启动它的终端停止。' };
    try {
      await stopManaged(tracked);
      serviceProcesses[id] = null;
      return { ok: true, message: `${definition.name} 已停止` };
    } catch (error) { return { ok: false, message: error.message }; }
  }
  const pids = await listeningPids(definition.port);
  if (tracked?.pid) pids.push(String(tracked.pid));
  const uniquePids = [...new Set(pids)];
  if (!uniquePids.length) return { ok: false, message: `${definition.name} 未在运行` };
  sendServiceLog(event.sender, id, `正在停止 ${definition.name}...\n`);
  if (definition.shutdownPath) {
    try {
      await net.fetch(`http://127.0.0.1:${definition.port}${definition.shutdownPath}`, {
        method: 'POST',
        signal: AbortSignal.timeout(1500)
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!(await portListening(definition.port))) {
        serviceProcesses[id] = null;
        sendServiceLog(event.sender, id, `${definition.name} 已停止\n`);
        return { ok: true, message: `${definition.name} 已停止` };
      }
    } catch (_) {
      // 服务不支持退出接口时，继续使用进程结束兜底。
    }
  }
  const stopResults = await Promise.allSettled(uniquePids.map(pid =>
    runProcess('taskkill.exe', ['/pid', pid, '/t', '/f'])
  ));
  await new Promise(resolve => setTimeout(resolve, 300));
  let remainingPids = await listeningPids(definition.port);
  if (remainingPids.length) {
    await Promise.allSettled(remainingPids.map(pid =>
      runProcess('taskkill.exe', ['/pid', pid, '/f'])
    ));
    await new Promise(resolve => setTimeout(resolve, 500));
    remainingPids = await listeningPids(definition.port);
  }
  if (remainingPids.length) {
    const errors = stopResults
      .filter(result => result.status === 'rejected')
      .map(result => result.reason?.message)
      .filter(Boolean)
      .join('；');
    const message = `${definition.name} 停止失败，端口 ${definition.port} 仍被 PID ${remainingPids.join(', ')} 占用${errors ? `：${errors}` : ''}`;
    sendServiceLog(event.sender, id, `${message}\n`);
    return { ok: false, message };
  }
  serviceProcesses[id] = null;
  sendServiceLog(event.sender, id, `${definition.name} 已停止\n`);
  return { ok: true, message: `${definition.name} 已停止` };
}
ipcMain.handle('control:stop-service', stopService);
ipcMain.handle('control:download-service', async (event, id) => {
  const definition = getServiceDefinitions()[id];
  if (!definition) return { ok: false, message: '未知服务' };
  if (definition.plugin) return { ok: false, message: '请在插件列表点击安装 DLC' };
  if (process.platform !== 'win32') return { ok: false, message: '该下载包含 Windows 运行环境。Linux 请独立部署 GPT-SoVITS 或使用云端 TTS。' };
  if (serviceInstalled(definition) && fs.existsSync(projectEnvPython)) return { ok: false, message: `${definition.name} 已安装` };
  if (serviceDownloads[id]) return { ok: false, message: `${definition.name} 正在下载` };
  const script = definition.downloadScript || path.join(hubRoot, 'Batch_Download.py');
  if (!fs.existsSync(script)) return { ok: false, message: `找不到下载脚本：${script}` };
  sendServiceLog(event.sender, id, `开始下载 ${definition.name} 模块...\n`);
  serviceDownloads[id] = { exitCode: null };
  if (!event.sender.isDestroyed()) event.sender.send('control:service-state');
  let pythonExecutable;
  try {
    pythonExecutable = await ensureProjectPython(event.sender, id);
  } catch (error) {
    serviceDownloads[id] = null;
    sendServiceLog(event.sender, id, `\u9879\u76ee Python \u73af\u5883\u5b89\u88c5\u5931\u8d25\uff1a${error.message}\n`);
    if (!event.sender.isDestroyed()) event.sender.send('control:service-state');
    return { ok: false, message: `\u9879\u76ee Python \u73af\u5883\u5b89\u88c5\u5931\u8d25\uff1a${error.message}` };
  }
  fs.mkdirSync(hubRoot, { recursive: true });
  const child = spawnManaged(pythonExecutable, ['-u', script, ...(definition.flag ? [definition.flag] : [])], {
    cwd: hubRoot,
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', MY_NEURO_FULL_HUB_DIR: hubRoot }
  });
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
ipcMain.handle('control:set-plugin-enabled', async (event, relPath, enabled) => {
  if (!/^(built-in|community)\/[\w.-]+$/.test(relPath)) throw new Error('插件路径无效');
  const file = path.join(pluginsPath, 'enabled_plugins.json');
  const current = new Set(readJson(file, { plugins: [] }).plugins || []);
  if (!enabled) {
    for (const [id, definition] of Object.entries(getServiceDefinitions())) {
      if (definition.plugin !== relPath) continue;
      if (serviceDownloads[id]) throw new Error('模块正在下载，请等待下载结束后停用插件');
      if (serviceProcesses[id] || await portListening(definition.port)) {
        const result = await stopService(event, id);
        if (!result.ok) throw new Error(result.message);
      }
    }
  }
  enabled ? current.add(relPath) : current.delete(relPath);
  fs.writeFileSync(file, `${JSON.stringify({ plugins: [...current] }, null, 2)}\n`, 'utf8');
  if (!event.sender.isDestroyed()) event.sender.send('control:service-state');
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
ipcMain.handle('control:install-plugin-dlc', async (event, name, url) => {
  if (!/^[\w.-]+$/.test(name) || !/^https:\/\//i.test(url)) return { ok: false, message: 'DLC 信息无效' };
  const plugin = findPluginDlc(pluginsPath, name, url);
  if (!plugin) return { ok: false, message: '找不到对应插件的 DLC 声明' };
  if (process.platform !== 'win32' && /\.exe$/i.test(plugin.metadata.localService?.pythonPath || '')) return { ok: false, message: '该 DLC 包含 Windows Python 运行环境。Linux 请独立部署服务并配置 API 地址。' };
  if (process.platform !== 'win32' && !plugin.script) return { ok: false, message: '该 DLC 未提供跨平台安装器，请按插件文档手动部署 Linux 服务。' };
  if (plugin.script) {
    const id = plugin.metadata.localService.id;
    if (serviceDownloads[id]) return { ok: false, message: 'DLC 正在安装' };
    serviceDownloads[id] = { exitCode: null };
    const progress = report => {
      const update = report && typeof report.stage === 'string' ? report : { text: String(report) };
      const current = { ...pluginDlcProgress.get(name), ...update, plugin: name };
      pluginDlcProgress.set(name, current);
      if (!event.sender.isDestroyed()) event.sender.send('control:dlc-progress', { plugin: name, ...update });
    };
    try {
      progress({ stage: 'checking', percent: null, active: true, text: '' });
      const python = await ensureProjectPython(event.sender, id, progress);
      progress({ stage: 'model-download', label: `正在下载${plugin.metadata.localService.tabLabel || name}模型（当前文件）`, percent: null, received: 0, total: 0, text: '' });
      fs.mkdirSync(plugin.target, { recursive: true });
      await new Promise((resolve, reject) => {
        const child = spawnManaged(python, ['-u', plugin.script], {
          cwd: plugin.target, windowsHide: true,
          env: { ...downloadProcessEnv(__dirname), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
            MY_NEURO_FULL_HUB_DIR: hubRoot, MY_NEURO_PLUGIN_DLC_DIR: plugin.target }
        });
        serviceDownloads[id] = child;
        let outputTail = '';
        const log = chunk => {
          outputTail = (outputTail + String(chunk)).slice(-4096);
          sendServiceLog(event.sender, id, chunk); progress(chunk);
        };
        child.stdout.on('data', log);
        child.stderr.on('data', log);
        child.once('error', reject);
        child.once('exit', code => {
          if (code === 0) return resolve();
          const error = new Error(/ENOSPC|no space left on device|磁盘空间不足/i.test(outputTail)
            ? 'ENOSPC: 磁盘空间不足' : `DLC 安装进程退出（${code}）`);
          reject(error);
        });
      });
      if (!pluginDlcInfo(pluginsPath, plugin.dir, plugin.metadata).installed) throw new Error('DLC 模型文件不完整');
      progress({ stage: 'done', percent: 100, active: false, text: 'DLC 安装完成' });
      return { ok: true, message: 'DLC 安装完成' };
    } catch (error) {
      const message = explainStorageError(error, plugin.target);
      progress({ stage: 'error', percent: null, active: false, text: message });
      return { ok: false, message: `DLC 安装失败：${message}` };
    } finally {
      serviceDownloads[id] = null;
      if (!event.sender.isDestroyed()) event.sender.send('control:service-state');
    }
  }
  const target = path.join(__dirname, 'plugins-dlc', name);
  const isModelScope = /^https:\/\/www\.modelscope\.cn\/(models|datasets)\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i.test(url);
  const temp = fs.mkdtempSync(path.join(app.getPath('temp'), 'my-neuro-dlc-'));
  const zipFile = path.join(temp, 'dlc.zip');
  try {
    if (isModelScope) {
      const zipUrl = `${url.replace(/\/$/, '')}/resolve/master/T2M.zip`;
      await downloadFile(zipUrl, zipFile, (received, total) => {
        event.sender.send('control:dlc-progress', total ? `${Math.floor(received * 100 / total)}%` : '下载中');
      });
      event.sender.send('control:dlc-progress', 'extracting');
      await expandZip(zipFile, target, percent => event.sender.send('control:dlc-progress', `${percent}%`));
      flattenSingleDirectory(target);
    } else {
      await downloadFile(url, zipFile);
      await expandZip(zipFile, target, percent => event.sender.send('control:dlc-progress', `${percent}%`));
      flattenSingleDirectory(target);
    }
    if (plugin.metadata.bat && !fs.existsSync(path.join(target, plugin.metadata.bat))) throw new Error(`DLC 文件结构无效：找不到 ${plugin.metadata.bat}`);
    return { ok: true, message: 'DLC 安装完成' };
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: false, message: `DLC 安装失败：${error.message}` };
  }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
ipcMain.handle('control:launch-plugin-bat', (_event, name, bat) => {
  if (!/^[\w.-]+$/.test(name) || typeof bat !== 'string') return { ok: false, message: '启动信息无效' };
  const root = path.resolve(__dirname, 'plugins-dlc', name);
  const direct = path.resolve(root, bat);
  let file = direct;
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) {
    file = null;
    if (fs.existsSync(root)) {
      const pending = [root];
      while (pending.length && !file) {
        const current = pending.shift();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const candidate = path.join(current, entry.name);
          if (entry.isDirectory()) pending.push(candidate);
          else if (entry.name === bat) { file = candidate; break; }
        }
      }
    }
  }
  if (!file || !fs.existsSync(file)) return { ok: false, message: '找不到插件启动文件' };
  if (process.platform !== 'win32') return { ok: false, message: '该插件只提供 Windows 启动脚本，请按插件文档手动部署 Linux 服务。' };
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
    try {
      const message = JSON.parse(line);
      message.history_images = (Array.isArray(message.attachments) ? message.attachments : [])
        .filter(item => item?.type === 'image' && typeof item.path === 'string')
        .map(item => {
          const imageRoot = path.join(projectRoot, 'AI记录室', '对话截图');
          const imagePath = path.resolve(path.join(projectRoot, 'AI记录室'), item.path);
          if (!imagePath.startsWith(`${imageRoot}${path.sep}`) || !fs.existsSync(imagePath)) return null;
          const mime = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
          return `data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`;
        })
        .filter(Boolean);
      messages.push(message);
    } catch { invalidLines += 1; }
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
  if (/^https:\/\/opencode\.ai\/inference\/go\/openai\/v1\/models$/i.test(endpoint)) {
    endpoint = 'https://opencode.ai/inference/go/v1/models';
  }
  const headers = { ...llmRequestHeaders(endpoint, String(apiKey || '').trim()), Accept: 'application/json' };
  if (!String(apiKey || '').trim()) delete headers.Authorization;
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
ipcMain.handle('control:test-llm-model', async (_event, apiUrl, apiKey, model) => {
  let endpoint = String(apiUrl || '').trim().replace(/\/+$/, '');
  if (!endpoint || !String(model || '').trim()) return { ok: false, message: '请先填写接口地址并选择模型' };
  for (const suffix of ['/chat/completions', '/completions', '/responses', '/models']) {
    if (endpoint.toLowerCase().endsWith(suffix)) { endpoint = endpoint.slice(0, -suffix.length).replace(/\/+$/, ''); break; }
  }
  const headers = { ...llmRequestHeaders(endpoint, String(apiKey || '').trim()), Accept: 'application/json' };
  if (!String(apiKey || '').trim()) delete headers.Authorization;
  const started = performance.now();
  const signal = AbortSignal.timeout(30000);
  try {
    // 🔥 默认关闭思考模式，避免测出来的延迟被思考过程拉高
    const requestBody = {
      model: String(model).trim(),
      messages: [{ role: 'user', content: '请只回复 OK' }],
      stream: true,
      thinking: { type: 'disabled' }
    };
    const response = await net.fetch(`${endpoint}/chat/completions`, {
      method: 'POST', headers, signal,
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      let detail;
      try { detail = (await response.json())?.error?.message; } catch { /* 忽略非 JSON 错误体 */ }
      const message = String(detail || '模型请求失败').slice(0, 240);
      const key = String(apiKey || '').trim();
      return { ok: false, message: `HTTP ${response.status}：${key ? message.split(key).join('***') : message}` };
    }

    // 🔥 实际对话走的是流式响应，这里测的也应是首个正文 token 的到达时间（TTFT），
    // 而不是等完整回复——开了思考模式的模型完整回复耗时会被思考过程严重拉高，
    // 跟用户真实感知到的延迟对不上。
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let firstTokenMs = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]' || !trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5);
        let chunk;
        try { chunk = JSON.parse(jsonStr); } catch { continue; }
        if (chunk?.choices?.[0]?.delta?.content) {
          firstTokenMs = Math.round(performance.now() - started);
          break;
        }
      }
      if (firstTokenMs !== null) { try { await reader.cancel(); } catch { /* 已拿到结果，忽略取消失败 */ } break; }
    }

    if (firstTokenMs === null) return { ok: false, message: '接口未返回有效的文本回复' };
    return { ok: true, elapsedMs: firstTokenMs };
  } catch {
    return { ok: false, message: signal.aborted ? '测试超时（30秒），暂未确认可用' : '连接失败，请检查接口地址和网络' };
  }
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

ipcMain.handle('control:save-config', async (_event, config) => {
  saveControlConfig(config);
  await notifyDesktopReload();
  return { ok: true };
});

ipcMain.handle('control:list-live2d-models', () => [
  ...scanLive2DModels().map(model => model.name),
  ...scanVRMModels().map(model => `[VRM] ${model.name}`),
  ...scanMMDModels().map(model => `[PMX] ${model.name}`)
]);
ipcMain.handle('control:current-live2d-model', () => {
  const currentConfig = readJson(configPath, {});
  const type = currentConfig.ui?.model_type;
  if (type === 'vrm' || type === 'mmd') {
    const models = type === 'mmd' ? scanMMDModels() : scanVRMModels();
    const model = models.find(item => item.modelPath === currentConfig.ui?.[`${type}_model_path`])
      || models.find(item => item.name === currentConfig.ui?.[`${type}_model`]) || models[0];
    return model ? `[${type === 'mmd' ? 'PMX' : 'VRM'}] ${model.name}` : '';
  }
  return resolveLive2DModel(currentConfig.ui?.live2d_model).entry?.name || '';
});
ipcMain.handle('control:select-live2d-model', async (_event, name) => {
  const targetType = name.startsWith('[PMX] ') ? 'mmd' : name.startsWith('[VRM] ') ? 'vrm' : 'live2d';
  const modelName = targetType === 'live2d' ? name : name.slice(6);
  const models = targetType === 'mmd' ? scanMMDModels() : targetType === 'vrm' ? scanVRMModels() : scanLive2DModels();
  const entry = models.find(model => model.name === modelName);
  if (!entry) throw new Error('模型不存在');
  const currentConfig = readJson(configPath, {});
  const activeType = currentConfig.ui?.model_type || 'live2d';
  const modelResult = await postDesktop('/set-avatar-model', { type: targetType, model_name: modelName }, 20000);
  let switchResult = modelResult;
  if (modelResult.success && activeType !== targetType) {
    switchResult = await postDesktop('/switch-avatar-type', { type: targetType }, 30000);
  }
  currentConfig.ui ||= {};
  currentConfig.ui.model_type = targetType;
  if (targetType !== 'live2d') {
    currentConfig.ui[`${targetType}_model`] = entry.name;
    currentConfig.ui[`${targetType}_model_path`] = entry.modelPath;
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
ipcMain.handle('control:save-motion-data', async (_event, character, kind, values) => {
  if (!character || !['actions', 'expressions'].includes(kind)) throw new Error('动作配置无效');
  writeMotionConfig(character, kind, values);
  await notifyDesktopReload();
  return { ok: true };
});
ipcMain.handle('control:reset-motion-data', async (_event, character, kind) => {
  if (!['actions', 'expressions'].includes(kind) || !isLive2DModelDir(character)) return { ok: false, message: '当前模型没有可还原的配置' };
  // AI_set_live2d.py 写表情备份时用的键名是 original_config1，动作备份才是 original_config
  const backupFile = kind === 'actions' ? 'character_backups.json' : 'character_backups1.json';
  const backupKey = kind === 'actions' ? 'original_config' : 'original_config1';
  const original = readJson(path.join(__dirname, backupFile), {})[character]?.[backupKey]?.[motionRootKey(kind)];
  // 没有备份（例如手动放进来的新模型）时，直接按模型目录重新生成默认配置；有备份也过一遍合并，剔除已不存在的文件
  writeMotionConfig(character, kind, mergeMotionConfig(kind, character, original || {}).config);
  await notifyDesktopReload();
  return { ok: true, message: original ? '已还原原始配置' : '没有找到备份，已按模型文件重新生成默认配置' };
});
ipcMain.handle('control:trigger-motion', (_event, name) => postDesktop('/control-motion', { action: 'trigger_emotion', emotion_name: name }));
ipcMain.handle('control:trigger-expression', (_event, name) => postDesktop('/control-expression', { action: 'trigger_expression', expression_name: name }));
ipcMain.handle('control:apply-vmc', async (_event, host, port) => {
  const current = readJson(configPath, {}); current.vmc ||= {}; current.vmc.host = host || '127.0.0.1'; current.vmc.port = Number(port) || 39539;
  fs.writeFileSync(configPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  if (!live2dProcess || live2dProcess.exitCode !== null) return { success: true, message: 'VMC 地址已保存，桌宠启动后生效' };
  return postDesktop('/control-vmc', { host: current.vmc.host, port: current.vmc.port });
});

function startLive2d(event) {
  if (live2dProcess && live2dProcess.exitCode === null) return { ok: false, message: '桌宠已在运行' };
  startRuntimeLog(event.sender);
  showAvatarLoadingWindow();
  live2dProcess = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/c', 'go.bat'], { cwd: __dirname, windowsHide: true })
    : spawnManaged(process.execPath, electronLaunchArgs('.'), {
      cwd: __dirname, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
    });
  const petProcess = live2dProcess;
  live2dProcess.on('error', error => {
    if (live2dProcess === petProcess) live2dProcess = null;
    closeAvatarLoadingWindow();
    stopRuntimeLog();
    if (!event.sender.isDestroyed()) event.sender.send('control:tool-log', `桌宠启动失败：${error.message}\n`);
  });
  const appendPetLog = chunk => fs.appendFileSync(runtimeLogPath, chunk);
  live2dProcess.stdout.on('data', appendPetLog);
  live2dProcess.stderr.on('data', appendPetLog);
  live2dProcess.on('exit', code => {
    closeAvatarLoadingWindow();
    stopRuntimeLog();
    if (!event.sender.isDestroyed()) {
      event.sender.send('control:tool-log', `桌宠进程已退出（${code ?? '未知'}）\n`);
      event.sender.send('control:live2d-state', false);
    }
    live2dProcess = null;
  });
  return { ok: true, message: '正在启动桌宠' };
}
ipcMain.handle('control:start-live2d', startLive2d);

ipcMain.handle('control:stop-live2d', async () => {
  return stopLive2dProcess();
});

app.whenReady().then(createControlWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
