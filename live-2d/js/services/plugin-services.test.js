const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { discoverPluginServices, resolvePluginServiceLaunch } = require('./plugin-services');
const { pluginDlcInfo, findPluginDlc } = require('./plugin-dlc');
const { downloadProcessEnv, explainStorageError } = require('./download-storage');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'control-main.js'), 'utf8');

function fixture(t) {
    const testRoot = path.join(root, '.download-cache', 'tests');
    fs.mkdirSync(testRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(testRoot, 'neuro-service-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const pluginsDir = path.join(dir, 'live-2d/plugins');
    const pluginDir = path.join(pluginsDir, 'built-in/local-bert');
    fs.mkdirSync(pluginDir, { recursive: true });
    for (const name of fs.readdirSync(path.join(root, 'plugins/built-in/local-bert'))) {
        fs.copyFileSync(path.join(root, 'plugins/built-in/local-bert', name), path.join(pluginDir, name));
    }
    const setEnabled = enabled => fs.writeFileSync(path.join(pluginsDir, 'enabled_plugins.json'), JSON.stringify({ plugins: enabled }));
    setEnabled(['built-in/local-bert']);
    return { dir, pluginsDir, setEnabled };
}

test('BERT follows plugin enablement and preserves existing model files', t => {
    const { dir, pluginsDir, setEnabled } = fixture(t);
    const model = path.join(dir, 'full-hub/bert-hub');
    fs.mkdirSync(model, { recursive: true });
    for (const name of ['config.json', 'model.safetensors', 'vocab.txt']) fs.writeFileSync(path.join(model, name), 'existing');
    const service = discoverPluginServices(pluginsDir, ['tts', 'asr']).bert;
    assert.equal(service.port, 6007);
    assert.equal(service.plugin, 'built-in/local-bert');
    assert.ok(service.checks.every(file => fs.existsSync(path.join(dir, 'full-hub', file))));
    setEnabled([]);
    assert.deepEqual(discoverPluginServices(pluginsDir), {});
    assert.equal(fs.readFileSync(path.join(model, 'model.safetensors'), 'utf8'), 'existing');
    setEnabled(['built-in/local-bert']);
    assert.ok(discoverPluginServices(pluginsDir).bert);
});

test('missing scripts, reserved ids and invalid plugin paths cannot register services', t => {
    const { pluginsDir, setEnabled } = fixture(t);
    assert.deepEqual(discoverPluginServices(pluginsDir, ['bert']), {});
    setEnabled(['../outside', 'built-in/missing']);
    assert.deepEqual(discoverPluginServices(pluginsDir), {});
    setEnabled(['built-in/local-bert']);
    fs.renameSync(path.join(pluginsDir, 'built-in/local-bert/server.py'), path.join(pluginsDir, 'built-in/local-bert/server.py.bak'));
    assert.deepEqual(discoverPluginServices(pluginsDir), {});
});

function controlHarness(t) {
    const { dir, pluginsDir, setEnabled } = fixture(t);
    const handlers = new Map();
    const calls = [];
    const logs = [];
    const serviceProcesses = {};
    const serviceDownloads = {};
    const context = {
        fs, path, setTimeout: callback => { callback(); },
        __dirname: path.join(dir, 'live-2d'), downloadProcessEnv, explainStorageError,
        pluginsPath: pluginsDir,
        pluginDlcInfo, findPluginDlc,
        readJson: file => JSON.parse(fs.readFileSync(file, 'utf8')),
        projectRoot: dir, hubRoot: path.join(dir, 'full-hub'), projectEnvPython: path.join(dir, 'env/python.exe'),
        serviceProcesses, serviceDownloads,
        pluginDlcProgress: new Map(),
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        getServiceDefinitions: () => discoverPluginServices(pluginsDir),
        serviceLaunchDefinition: id => discoverPluginServices(pluginsDir)[id],
        serviceInstalled: () => false,
        portListening: async () => false,
        listeningPids: async () => [],
        ensureProjectPython: async () => path.join(dir, 'env/python.exe'),
        sendServiceLog: (_sender, service, text) => logs.push({ service, text }),
        runProcess: async () => {},
        net: { fetch: async url => { calls.push({ url }); } },
        AbortSignal,
        process: { env: {} },
        spawn: (command, args, options) => {
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.exitCode = null;
            child.pid = 123;
            calls.push({ command, args, options });
            return child;
        }
    };
    vm.runInNewContext(source.slice(source.indexOf("ipcMain.handle('control:start-service'"), source.indexOf("ipcMain.handle('control:open-external'")), context);
    vm.runInNewContext(source.slice(source.indexOf("ipcMain.handle('control:set-plugin-enabled'"), source.indexOf("ipcMain.handle('control:save-plugin-config'")), context);
    vm.runInNewContext(source.slice(source.indexOf("ipcMain.handle('control:service-status'"), source.indexOf("ipcMain.handle('control:start-service'")), context);
    vm.runInNewContext(source.slice(source.indexOf("ipcMain.handle('control:install-plugin-dlc'"), source.indexOf("ipcMain.handle('control:launch-plugin-bat'")), context);
    const event = { sender: { isDestroyed: () => false, send: () => {} } };
    return { context, handlers, calls, event, setEnabled, logs };
}

test('BERT cannot use the old download-module entry point', async t => {
    const { context, handlers, calls, event } = controlHarness(t);
    const result = await handlers.get('control:download-service')(event, 'bert');
    assert.equal(result.ok, false);
    assert.match(result.message, /安装 DLC/);
    assert.equal(calls.length, 0);
});

test('start uses plugin server, forwards logs, and rejects disabled plugin', async t => {
    const { context, handlers, calls, event, setEnabled, logs } = controlHarness(t);
    context.serviceInstalled = () => true;
    fs.mkdirSync(path.dirname(context.projectEnvPython), { recursive: true });
    fs.writeFileSync(context.projectEnvPython, 'test');
    assert.equal((await handlers.get('control:start-service')(event, 'bert')).ok, true);
    assert.equal(calls[0].command, context.projectEnvPython);
    assert.equal(calls[0].args[1], context.getServiceDefinitions().bert.startScript);
    context.serviceProcesses.bert.stdout.emit('data', 'ready');
    assert.ok(logs.some(log => log.text === 'ready' && log.service === 'bert'));
    context.serviceProcesses.bert.emit('exit', 0);
    assert.equal(context.serviceProcesses.bert, null);
    setEnabled([]);
    assert.equal((await handlers.get('control:start-service')(event, 'bert')).ok, false);
    assert.equal((await handlers.get('control:download-service')(event, 'bert')).ok, false);
});

test('stop uses shutdown endpoint declared by plugin', async t => {
    const { context, handlers, calls, event } = controlHarness(t);
    context.listeningPids = async () => ['123'];
    const result = await handlers.get('control:stop-service')(event, 'bert');
    assert.equal(result.ok, true);
    assert.equal(calls[0].url, 'http://127.0.0.1:6007/shutdown');
});

test('disabling plugin stops running service before removing its registration', async t => {
    const { context, handlers, calls, event } = controlHarness(t);
    context.serviceProcesses.bert = { pid: 123 };
    await handlers.get('control:set-plugin-enabled')(event, 'built-in/local-bert', false);
    assert.equal(calls[0].url, 'http://127.0.0.1:6007/shutdown');
    assert.equal(context.getServiceDefinitions().bert, undefined);
    assert.equal(context.serviceProcesses.bert, null);
});

test('downloading plugin cannot be disabled midway through environment setup', async t => {
    const { context, handlers, event } = controlHarness(t);
    context.serviceDownloads.bert = { exitCode: null };
    await assert.rejects(handlers.get('control:set-plugin-enabled')(event, 'built-in/local-bert', false), /正在下载/);
    assert.ok(context.getServiceDefinitions().bert);
});

test('terminal only lists TTS; plugin management receives BERT and ASR', async t => {
    const { context, handlers } = controlHarness(t);
    context.serviceStatus = async () => [
        { id: 'tts', plugin: null }, { id: 'asr', plugin: 'built-in/local-asr' },
        { id: 'bert', plugin: 'built-in/local-bert' }
    ];
    const terminal = await handlers.get('control:service-status')();
    const plugins = await handlers.get('control:plugin-service-status')();
    assert.equal(JSON.stringify(terminal.map(service => service.id)), '["tts"]');
    assert.equal(JSON.stringify(plugins.map(service => service.id)), '["asr","bert"]');
});

function addAsrPlugin(context) {
    const pluginDir = path.join(context.pluginsPath, 'built-in/local-asr');
    fs.mkdirSync(pluginDir, { recursive: true });
    for (const name of fs.readdirSync(path.join(root, 'plugins/built-in/local-asr'))) {
        if (name === '__pycache__') continue;
        fs.copyFileSync(path.join(root, 'plugins/built-in/local-asr', name), path.join(pluginDir, name));
    }
}

test('ASR registers as an enabled plugin and resolves local or cloud VAD launch modes', t => {
    const { context, setEnabled } = controlHarness(t);
    addAsrPlugin(context);
    setEnabled(['built-in/local-bert', 'built-in/local-asr']);
    const services = context.getServiceDefinitions();
    assert.ok(services.bert);
    assert.equal(services.asr.plugin, 'built-in/local-asr');
    assert.equal(services.asr.port, 1000);
    assert.deepEqual(resolvePluginServiceLaunch(services.asr, {}).startArgs, []);
    for (const provider of ['baidu_asr', 'siliconflow_asr']) {
        const launch = resolvePluginServiceLaunch(services.asr, { cloud: { [provider]: { enabled: true } } });
        assert.deepEqual(launch.startArgs, ['--vad-only']);
    }
    setEnabled(['built-in/local-bert']);
    assert.equal(context.getServiceDefinitions().asr, undefined);
});

test('ASR starts its own server with cloud VAD flag and project-local runtime caches', async t => {
    const { context, handlers, calls, event, setEnabled } = controlHarness(t);
    addAsrPlugin(context);
    setEnabled(['built-in/local-asr']);
    context.serviceInstalled = () => true;
    context.serviceLaunchDefinition = id => resolvePluginServiceLaunch(context.getServiceDefinitions()[id], { cloud: { siliconflow_asr: { enabled: true } } });
    fs.mkdirSync(path.dirname(context.projectEnvPython), { recursive: true });
    fs.writeFileSync(context.projectEnvPython, 'test');
    assert.equal((await handlers.get('control:start-service')(event, 'asr')).ok, true);
    assert.equal(calls[0].args[1], context.getServiceDefinitions().asr.startScript);
    assert.equal(calls[0].args[2], '--vad-only');
    assert.ok(calls[0].options.env.TEMP.startsWith(context.__dirname));
    assert.ok(calls[0].options.env.MODELSCOPE_CACHE.startsWith(context.__dirname));
});

test('ASR installs through plugin DLC before enablement and reports its own progress label', async t => {
    const { context, handlers, calls, event, setEnabled } = controlHarness(t);
    addAsrPlugin(context);
    setEnabled([]);
    fs.mkdirSync(path.dirname(context.projectEnvPython), { recursive: true });
    fs.writeFileSync(context.projectEnvPython, 'test');
    const url = 'https://www.modelscope.cn/models/morelle/my-neuro-vad';
    const task = handlers.get('control:install-plugin-dlc')(event, 'local-asr', url);
    await new Promise(setImmediate);
    const plugin = findPluginDlc(context.pluginsPath, 'local-asr', url);
    assert.equal(calls[0].args[1], plugin.script);
    assert.equal(calls[0].options.env.MY_NEURO_PLUGIN_DLC_DIR, plugin.target);
    assert.match(context.pluginDlcProgress.get('local-asr').label, /ASR/);
    assert.doesNotMatch(context.pluginDlcProgress.get('local-asr').label, /BERT/);
    for (const relative of plugin.metadata.localService.checks) {
        const file = path.join(plugin.target, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'fixture');
    }
    context.serviceDownloads.asr.emit('exit', 0);
    assert.equal((await task).ok, true);
    assert.equal(findPluginDlc(context.pluginsPath, 'local-asr', url).installed, true);
});

test('main process only declares TTS as a built-in terminal service', () => {
    const definitions = vm.runInNewContext(source.slice(source.indexOf('const builtinServiceDefinitions'), source.indexOf('function getServiceDefinitions')) + '; builtinServiceDefinitions');
    assert.equal(JSON.stringify(Object.keys(definitions)), '["tts"]');
});

test('DLC installer works before plugin enablement and validates resources before success', async t => {
    const { context, handlers, calls, event, setEnabled } = controlHarness(t);
    setEnabled([]);
    fs.mkdirSync(path.dirname(context.projectEnvPython), { recursive: true });
    fs.writeFileSync(context.projectEnvPython, 'test');
    const url = 'https://www.modelscope.cn/models/morelle/Omni_fn_bert';
    const task = handlers.get('control:install-plugin-dlc')(event, 'local-bert', url);
    await new Promise(setImmediate);
    const plugin = findPluginDlc(context.pluginsPath, 'local-bert', url);
    assert.equal(calls[0].command, context.projectEnvPython);
    assert.equal(calls[0].args[1], plugin.script);
    assert.equal(calls[0].options.env.MY_NEURO_PLUGIN_DLC_DIR, plugin.target);
    assert.equal(plugin.installed, false);
    fs.mkdirSync(path.join(plugin.target, 'bert-hub'), { recursive: true });
    for (const file of plugin.metadata.localService.checks) fs.writeFileSync(path.join(plugin.target, file), 'model');
    context.serviceDownloads.bert.emit('exit', 0);
    assert.equal((await task).ok, true);
    assert.equal(findPluginDlc(context.pluginsPath, 'local-bert', url).installed, true);
    assert.equal(context.serviceDownloads.bert, null);
});

test('failed DLC install retains partial resources and permits retry', async t => {
    const { context, handlers, event } = controlHarness(t);
    const url = 'https://www.modelscope.cn/models/morelle/Omni_fn_bert';
    const plugin = findPluginDlc(context.pluginsPath, 'local-bert', url);
    fs.mkdirSync(plugin.target, { recursive: true });
    const partial = path.join(plugin.target, 'partial-model');
    fs.writeFileSync(partial, 'keep');
    const task = handlers.get('control:install-plugin-dlc')(event, 'local-bert', url);
    await new Promise(setImmediate);
    const duplicate = await handlers.get('control:install-plugin-dlc')(event, 'local-bert', url);
    assert.equal(duplicate.ok, false);
    context.serviceDownloads.bert.emit('exit', 1);
    assert.equal((await task).ok, false);
    assert.equal(context.serviceDownloads.bert, null);
    assert.equal(fs.readFileSync(partial, 'utf8'), 'keep');
});

test('DLC detection checks model completeness and prefers new DLC over legacy resources', t => {
    const { dir, pluginsDir } = fixture(t);
    const url = 'https://www.modelscope.cn/models/morelle/Omni_fn_bert';
    let plugin = findPluginDlc(pluginsDir, 'local-bert', url);
    fs.mkdirSync(plugin.target, { recursive: true });
    assert.equal(findPluginDlc(pluginsDir, 'local-bert', url).installed, false);
    fs.mkdirSync(path.join(dir, 'env'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'env/python.exe'), 'test');
    const legacy = path.join(dir, 'full-hub');
    fs.mkdirSync(path.join(legacy, 'bert-hub'), { recursive: true });
    for (const file of plugin.metadata.localService.checks) fs.writeFileSync(path.join(legacy, file), 'old');
    plugin = findPluginDlc(pluginsDir, 'local-bert', url);
    assert.equal(plugin.installed, true);
    assert.equal(plugin.resourceRoot, legacy);
    fs.mkdirSync(path.join(plugin.target, 'bert-hub'), { recursive: true });
    for (const file of plugin.metadata.localService.checks) fs.writeFileSync(path.join(plugin.target, file), 'new');
    assert.equal(findPluginDlc(pluginsDir, 'local-bert', url).resourceRoot, plugin.target);
});

test('BERT always exposes configuration, while DLC gates enablement', () => {
    const renderer = fs.readFileSync(path.join(root, 'control-renderer.js'), 'utf8');
    const context = { escapeHtml: String, dlcInstallProgress: new Map(), dlcProgressMarkup: () => '' };
    vm.runInNewContext(renderer.slice(renderer.indexOf('function pluginCard('), renderer.indexOf('function marketCard(')), context);
    const plugin = { name: 'local-bert', relPath: 'built-in/local-bert', serviceId: 'bert', hasConfig: false, downloadDlc: 'source', dlcInstalled: false };
    const pending = context.pluginCard(plugin);
    assert.match(pending, /安装 DLC/);
    assert.match(pending, /data-plugin-config/);
    assert.match(pending, /配置/);
    assert.doesNotMatch(pending, /data-plugin-enabled|下载模块/);
    const installed = context.pluginCard({ ...plugin, dlcInstalled: true });
    assert.doesNotMatch(installed, /安装 DLC/);
    assert.match(installed, /配置/);
    assert.match(installed, /data-plugin-enabled/);
});

test('DLC environment progress is forwarded to plugin UI before model download', async t => {
    const { context, handlers, event } = controlHarness(t);
    const events = [];
    event.sender.send = (channel, payload) => events.push({ channel, payload });
    context.ensureProjectPython = async (_sender, _id, report) => {
        report({ stage: 'environment-download', percent: 42, received: 42 * 1024 * 1024, total: 100 * 1024 * 1024 });
        report({ stage: 'environment-extract', percent: null });
        return context.projectEnvPython;
    };
    const task = handlers.get('control:install-plugin-dlc')(event, 'local-bert', 'https://www.modelscope.cn/models/morelle/Omni_fn_bert');
    await new Promise(setImmediate);
    const progress = events.filter(item => item.channel === 'control:dlc-progress').map(item => item.payload);
    assert.ok(progress.some(item => item.plugin === 'local-bert' && item.stage === 'environment-download' && item.percent === 42));
    assert.ok(progress.some(item => item.stage === 'environment-extract' && item.percent === null));
    assert.equal(progress.at(-1).stage, 'model-download');
    context.serviceDownloads.bert.stderr.emit('data', Buffer.from('Downloading: 63%|======|'));
    assert.equal(events.at(-1).payload.text, 'Downloading: 63%|======|');
    context.serviceDownloads.bert.emit('exit', 1);
    assert.equal((await task).ok, false);
    assert.equal(context.pluginDlcProgress.get('local-bert').active, false);
    assert.equal(context.pluginDlcProgress.get('local-bert').stage, 'error');
});

test('DLC progress renders real percentage, bytes, extraction and fragmented model output', () => {
    const renderer = fs.readFileSync(path.join(root, 'control-renderer.js'), 'utf8');
    const context = { escapeHtml: text => String(text).replace(/</g, '&lt;') };
    vm.runInNewContext(renderer.slice(renderer.indexOf('function updateDlcInstallProgress('), renderer.indexOf('function paintDlcInstallProgress(')), context);
    const update = context.updateDlcInstallProgress;
    const render = context.dlcProgressMarkup;
    let state = update({}, { stage: 'environment-download', percent: 42, active: true, received: 42 * 1024 * 1024, total: 100 * 1024 * 1024 });
    assert.match(render(state), /width:42%/);
    assert.match(render(state), /42.0 MB \/ 100.0 MB/);
    state = update(state, { stage: 'environment-extract', percent: null });
    assert.match(render(state), /正在解压 Python 环境/);
    assert.match(render(state), /indeterminate/);
    assert.doesNotMatch(render(state), /aria-valuenow/);
    state = update(state, { stage: 'model-download', percent: null });
    state = update(state, { text: 'Downloading: 6' });
    state = update(state, { text: '7%|======|' });
    assert.equal(state.percent, 67);
    assert.match(render(state), /当前文件/);
    state = update(state, { text: '\rDownloading: 100%|' });
    assert.equal(state.active, true);
    state = update(state, { stage: 'done', percent: 100, active: false });
    assert.equal(render(state), '');
    state = update(state, { stage: 'error', percent: null, active: false, text: '<failure>' });
    assert.match(render(state), /&lt;failure>/);
    assert.doesNotMatch(render(state), /indeterminate/);
});

test('BERT configuration opens only service controls and logs', () => {
    const renderer = fs.readFileSync(path.join(root, 'control-renderer.js'), 'utf8');
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', addEventListener() {}, insertAdjacentHTML(_where, html) { this.innerHTML += html; } });
        return elements.get(id);
    };
    const context = { $: element, document: { querySelectorAll: () => [] },
        configFields: () => { throw new Error('Service page must not render parameter fields'); },
        renderPluginService() {}, refreshServiceStatus() {}, serviceLogs: {} };
    vm.runInNewContext(renderer.slice(renderer.indexOf('function openPluginDetail('), renderer.indexOf("$('plugin-detail-back').addEventListener")), context);
    context.openPluginDetail({ serviceId: 'bert', displayName: 'BERT', hasReadme: true });
    assert.match(element('plugin-detail-content').innerHTML, /plugin-service-controls/);
    assert.match(element('plugin-detail-content').innerHTML, /plugin-service-log/);
    assert.doesNotMatch(element('plugin-detail-content').innerHTML, /plugin-config-form|data-plugin-field/);
    assert.equal(element('plugin-readme').hidden, true);
    assert.equal(fs.existsSync(path.join(root, 'plugins/built-in/local-bert/plugin_config.json')), false);
});
