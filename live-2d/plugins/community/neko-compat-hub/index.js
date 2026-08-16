'use strict';

const fs = require('fs');
const path = require('path');
const { Plugin } = require('../../../js/core/plugin-base.js');
const { loadRuntimeLock, runPreflight } = require('./lib/preflight.js');
const { RuntimeManager } = require('./lib/runtime-manager.js');
const { LocalClient } = require('./lib/local-client.js');
const { discoverPlugins, activatePluginCatalog } = require('./lib/plugin-discovery.js');
const { classifyAll } = require('./lib/compatibility-classifier.js');
const { parseEntryList, decideExposure, mergePackApprovals } = require('./lib/authorization.js');
const { registerTools, clearDynamicTools } = require('./lib/tool-registry.js');
const { RunClient } = require('./lib/run-client.js');
const { normalizeExport } = require('./lib/result-normalizer.js');
const { writeReport, countByLevel } = require('./lib/report-writer.js');
const { DEFAULT_SDK_VERSION, isFixturePlugin, redactSensitive } = require('./lib/constants.js');
const {
    STEAM_OFFICIAL_PACKS,
    listPackFieldNames,
    listBlockedPackIds,
    readPackFlags,
    listCheckedPackIds,
    shouldLiftFixture
} = require('./lib/steam-official-packs.js');

const TAG = '[neko-compat-hub]';
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const RESTART_KEYS = [
    'enabled',
    'runtime_checkout_path',
    'runtime_python_path',
    'runtime_port',
    'runtime_start_timeout_seconds'
];
const AUTH_KEYS = [
    'approved_entries',
    'force_allow_entries',
    'expose_fixture_tools',
    'run_poll_interval_ms',
    'run_total_timeout_seconds',
    'max_concurrent_runs',
    'log_level',
    ...listPackFieldNames()
];

function flattenConfig(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [key, def] of Object.entries(raw)) {
        if (def && typeof def === 'object' && 'type' in def) {
            out[key] = def.value !== undefined ? def.value : def.default;
        } else {
            out[key] = def;
        }
    }
    return out;
}

function asBool(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
    }
    return fallback;
}

function asInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

class NekoCompatHubPlugin extends Plugin {
    constructor(metadata, context) {
        super(metadata, context);
        this._sourceDir = __dirname;
        this._pluginDir = (context && context._pluginDir) || __dirname;
        this._runtimeDir = path.join(this._pluginDir, '.runtime');
        this._lock = loadRuntimeLock(path.join(this._sourceDir, 'runtime-lock.json'));
        this._cfg = {};
        this._tools = [];
        this._toolIndex = new Map();
        this._classified = [];
        this._state = 'idle';
        this._notes = [];
        this._port = null;
        this._client = null;
        this._runClient = null;
        this._runtime = null;
        this._preflight = null;
        this._writingConfig = false;
        this._restarting = false;
        this._startedPlugins = new Set();
        this._exitHookInstalled = false;
        this._unexpectedRestarts = 0;
        this._lastDiscovery = null;
        this._enabledPacks = [];
    }

    _log(level, message) {
        const configured = LOG_LEVELS[this._cfg.log_level] ?? LOG_LEVELS.info;
        if ((LOG_LEVELS[level] ?? LOG_LEVELS.info) > configured) return;
        const line = `${TAG} ${message}`;
        if (this.context && typeof this.context.log === 'function') {
            this.context.log(level, line);
        }
    }

    _readConfig() {
        let raw = {};
        try {
            if (this.context && typeof this.context.getPluginConfig === 'function') {
                raw = this.context.getPluginConfig() || {};
            }
        } catch {
            raw = {};
        }
        if (!raw || Object.keys(raw).length === 0) {
            try {
                const text = fs.readFileSync(path.join(this._pluginDir, 'plugin_config.json'), 'utf8').replace(/^\uFEFF/, '');
                raw = flattenConfig(JSON.parse(text));
            } catch {
                raw = {};
            }
        }
        this._cfg = {
            enabled: asBool(raw.enabled, false),
            runtime_checkout_path: String(raw.runtime_checkout_path || '').trim(),
            runtime_python_path: String(raw.runtime_python_path || '').trim(),
            runtime_port: asInt(raw.runtime_port, 48916),
            runtime_start_timeout_seconds: asInt(raw.runtime_start_timeout_seconds, 60),
            approved_entries: raw.approved_entries || '',
            force_allow_entries: raw.force_allow_entries || '',
            run_poll_interval_ms: asInt(raw.run_poll_interval_ms, 500),
            run_total_timeout_seconds: asInt(raw.run_total_timeout_seconds, 120),
            max_concurrent_runs: asInt(raw.max_concurrent_runs, 2),
            expose_fixture_tools: asBool(raw.expose_fixture_tools, false),
            log_level: String(raw.log_level || 'info')
        };
        for (const pack of STEAM_OFFICIAL_PACKS) {
            this._cfg[pack.field] = asBool(raw[pack.field], false);
        }
        return this._cfg;
    }

    async onInit() {
        this._readConfig();
        this._installExitHook();
        this._log('info', '已加载。未配置 checkout 或未启用时保持惰性，不启动任何进程。');
    }

    async onStart() {
        try {
            await this._bootstrap();
        } catch (error) {
            this._state = 'degraded';
            this._notes.push(`bootstrap 异常: ${error.message}`);
            this._log('error', `启动失败，已降级: ${error.message}`);
            await this._safeWriteReport();
        }
    }

    // Optional host hook: upstream hosts may require a plugin reload after saving configuration.
    async onConfigChanged(newConfig, oldConfig) {
        if (this._writingConfig) return;
        const previous = { ...this._cfg };
        this._readConfig();
        const restart = RESTART_KEYS.some((key) => String(this._cfg[key]) !== String(previous[key]));
        const authChanged = AUTH_KEYS.some((key) => String(this._cfg[key]) !== String(previous[key]));
        try {
            if (restart) {
                await this._bootstrap();
            } else if (authChanged && this._state === 'ready') {
                await this._refreshTools('config');
            }
        } catch (error) {
            this._state = 'degraded';
            this._log('error', `配置热更新失败: ${error.message}`);
            await this._safeWriteReport();
        }
    }

    async onStop() {
        await this._shutdown('onStop');
    }

    async onDestroy() {
        await this._shutdown('onDestroy');
        this._removeExitHook();
    }

    getTools() {
        return this._tools;
    }

    async executeTool(name, params) {
        try {
            return await this._executeToolInner(name, params);
        } catch (error) {
            this._log('error', `工具 ${name} 失败: ${error.message}`);
            return `${TAG} 调用失败: ${error.message}`;
        }
    }

    async _bootstrap() {
        this._readConfig();
        this._clearTools();
        if (!this._cfg.enabled || !this._cfg.runtime_checkout_path) {
            if (this._runtime) await this._runtime.stop();
            this._runtime = null;
            this._client = null;
            this._runClient = null;
            this._state = 'idle';
            this._notes = ['Hub 未启用或未配置 checkout，保持惰性。'];
            await this._safeWriteReport();
            this._log('info', this._notes[0]);
            return;
        }

        const preflight = await runPreflight({
            checkoutPath: this._cfg.runtime_checkout_path,
            pythonPath: this._cfg.runtime_python_path,
            preferredPort: this._cfg.runtime_port,
            lock: this._lock
        });
        if (!preflight.ok) {
            this._state = 'degraded';
            this._notes = [preflight.reason];
            this._log('error', preflight.reason);
            await this._safeWriteReport();
            return;
        }
        this._preflight = preflight;
        if (Array.isArray(preflight.notes)) {
            for (const note of preflight.notes) {
                this._notes.push(note);
                this._log('warn', note);
            }
        }
        if (preflight.portShifted) {
            await this._writeConfigValue('runtime_port', preflight.port);
            this._cfg.runtime_port = preflight.port;
            this._log('warn', `端口 ${this._cfg.runtime_port} 被占用，已改用 ${preflight.port}`);
        }

        this._runtime = new RuntimeManager({
            runtimeDir: this._runtimeDir,
            log: (level, message) => this._log(level, message),
            onUnexpectedExit: (info) => {
                this._handleUnexpectedExit(info).catch((error) => {
                    this._log('error', `Runtime 异常退出处理失败: ${error.message}`);
                });
            }
        });
        const started = await this._runtime.start({
            pythonPath: preflight.pythonPath,
            pythonArgsPrefix: preflight.pythonArgsPrefix,
            checkoutPath: preflight.checkoutPath,
            entryPath: preflight.entryPath,
            port: preflight.port,
            startTimeoutSeconds: preflight.packaged
                ? Math.max(this._cfg.runtime_start_timeout_seconds, 120)
                : this._cfg.runtime_start_timeout_seconds,
            commit: preflight.commit,
            tag: preflight.tag,
            packaged: Boolean(preflight.packaged)
        });
        if (!started.ok) {
            this._state = 'degraded';
            this._notes = [started.reason || 'Runtime 启动失败'];
            this._log('error', this._notes[0]);
            await this._safeWriteReport();
            return;
        }
        this._port = started.port;
        this._client = new LocalClient({ port: started.port, timeoutMs: 15000 });
        this._runClient = new RunClient({
            client: this._client,
            pollIntervalMs: this._cfg.run_poll_interval_ms,
            totalTimeoutSeconds: this._cfg.run_total_timeout_seconds,
            maxConcurrent: this._cfg.max_concurrent_runs
        });
        try {
            const catalog = await activatePluginCatalog(this._client, {
                agentClient: started.agentPort
                    ? new LocalClient({ port: started.agentPort, timeoutMs: 8000 })
                    : null,
                timeoutMs: preflight.packaged ? 90000 : 15000,
                log: (message) => this._log('info', message)
            });
            this._log('info', `插件目录已就绪 plugins=${catalog.pluginCount} entries=${catalog.entryCount}`);
        } catch (error) {
            this._state = 'degraded';
            this._notes = [error.message];
            this._log('error', error.message);
            await this._safeWriteReport();
            return;
        }
        await this._refreshTools('bootstrap');
        this._state = 'ready';
        this._log('info', `Runtime 就绪 port=${this._port} tools=${this._tools.length}`);
    }

    async _refreshTools(reason) {
        if (!this._client) {
            this._clearTools();
            return;
        }
        const discovered = await discoverPlugins(this._client);
        this._classified = classifyAll(discovered.plugins, {
            sdkVersion: this._lock.sdk_version_expected || DEFAULT_SDK_VERSION
        });
        const approvedText = parseEntryList(this._cfg.approved_entries, { allowWildcard: true });
        const packFlags = readPackFlags(this._cfg);
        const approved = mergePackApprovals(approvedText, packFlags, {
            blockedPackIds: listBlockedPackIds()
        });
        const forceAllow = parseEntryList(this._cfg.force_allow_entries, { allowWildcard: false });
        this._notes = [];
        this._enabledPacks = approved.deniedAll ? [] : listCheckedPackIds(this._cfg);
        for (const warning of approved.warnings.concat(forceAllow.warnings)) {
            this._notes.push(warning);
            this._log('warn', warning);
        }

        const exposable = [];
        for (const row of this._classified) {
            const decision = decideExposure(row, {
                approved,
                forceAllow,
                exposeFixture: this._cfg.expose_fixture_tools,
                liftFixture: shouldLiftFixture(row.plugin_id, packFlags),
                isFixture: isFixturePlugin(row.plugin_id)
            });
            row.authorized = decision.ok;
            row.auth_reason = decision.reason;
            if (decision.forceLifted) {
                this._log('warn', `force_allow 解除 B0: ${row.plugin_id}:${row.entry_id}`);
            }
            if (decision.ok) exposable.push(row);
        }

        const pluginKeys = [
            this.metadata && this.metadata.name,
            this.context && this.context._pluginName
        ].filter(Boolean);
        const registration = registerTools(exposable, {
            clear: () => clearDynamicTools(this.context && this.context._pluginManager, pluginKeys),
            register: (toolDef) => {
                if (this.context && typeof this.context.registerTool === 'function') {
                    this.context.registerTool(toolDef);
                }
            },
            getMergedToolsList: () => {
                try {
                    return require('../../../js/api-utils.js').getMergedToolsList();
                } catch {
                    return this._tools;
                }
            }
        });
        this._tools = registration.accepted;
        this._toolIndex = new Map(this._tools.map((tool) => [tool.name, tool]));
        for (const rejected of registration.rejected) {
            this._notes.push(`撞名拒绝 ${rejected.plugin_id}:${rejected.entry_id} -> ${rejected.tool_name}`);
            this._log('error', this._notes[this._notes.length - 1]);
        }
        for (const missing of registration.missing) {
            if (String(missing).startsWith('getMergedToolsList_failed')) continue;
            this._notes.push(`注册后回读缺失: ${missing}`);
            this._log('warn', `工具 ${missing} 未出现在 getMergedToolsList 中，可能被宿主去重丢弃`);
        }

        const started = new Set();
        for (const row of exposable) {
            if (started.has(row.plugin_id)) continue;
            started.add(row.plugin_id);
            await this._ensurePluginStarted(row.plugin_id);
        }

        this._lastDiscovery = {
            plugin_count: discovered.pluginCount,
            entry_count: discovered.entryCount,
            approved_count: exposable.length,
            registered_count: registration.accepted.length,
            confirmed_count: registration.accepted.length - registration.missing.filter((name) => !String(name).startsWith('getMergedToolsList_failed')).length,
            rejected_count: registration.rejected.length
        };
        await this._safeWriteReport();
        this._log('info', `工具刷新(${reason}): 授权 ${exposable.length} / 注册 ${registration.accepted.length}`);
    }

    async _ensurePluginStarted(pluginId) {
        if (!this._client || this._startedPlugins.has(pluginId)) return;
        try {
            const response = await this._client.post(`/plugin/${encodeURIComponent(pluginId)}/start`);
            if (response.status >= 400) {
                this._log('warn', `启动上游插件 ${pluginId} 返回 HTTP ${response.status}`);
                return;
            }
            this._startedPlugins.add(pluginId);
            this._log('info', `已请求启动上游插件 ${pluginId}`);
        } catch (error) {
            this._log('warn', `启动上游插件 ${pluginId} 失败: ${error.message}`);
        }
    }

    async _executeToolInner(name, params) {
        const tool = this._toolIndex.get(name);
        if (!tool || !tool._neko) {
            return `${TAG} 未注册的工具: ${name}`;
        }
        if (!this._runClient || this._state !== 'ready') {
            return `${TAG} Runtime 未就绪（状态 ${this._state}）。`;
        }
        const { plugin_id: pluginId, entry_id: entryId, llm_result_fields: fields } = tool._neko;
        this._log('info', `创建 run ${pluginId}:${entryId} args=${JSON.stringify(redactSensitive(params || {}))}`);
        await this._ensurePluginStarted(pluginId);
        const result = await this._runClient.execute({
            pluginId,
            entryId,
            args: params && typeof params === 'object' ? params : {}
        });
        if (!result.ok) {
            const err = result.error && result.error.message ? result.error.message : result.reason;
            return `${TAG} run 失败: ${err}`;
        }
        const normalized = normalizeExport({
            items: result.items,
            pluginId,
            entryId,
            llmResultFields: fields
        });
        return normalized.text;
    }

    _clearTools() {
        this._tools = [];
        this._toolIndex = new Map();
        const pluginKeys = [
            this.metadata && this.metadata.name,
            this.context && this.context._pluginName
        ].filter(Boolean);
        clearDynamicTools(this.context && this.context._pluginManager, pluginKeys);
    }

    async _shutdown(reason) {
        this._clearTools();
        this._startedPlugins.clear();
        if (this._runtime) {
            await this._runtime.stop();
            this._runtime = null;
        }
        this._client = null;
        this._runClient = null;
        this._state = 'idle';
        this._log('info', `已停止 Runtime (${reason})`);
    }

    async _handleUnexpectedExit(info) {
        if (this._restarting || !this._cfg.enabled) return;
        this._unexpectedRestarts += 1;
        if (this._unexpectedRestarts > 2) {
            this._state = 'degraded';
            this._notes.push('Runtime 连续异常退出，已停止自动重启');
            this._clearTools();
            await this._safeWriteReport();
            return;
        }
        this._log('warn', `Runtime 异常退出，尝试重启 ${this._unexpectedRestarts}/2`);
        this._restarting = true;
        try {
            await this._bootstrap();
        } finally {
            this._restarting = false;
        }
    }

    async _safeWriteReport() {
        try {
            const counts = countByLevel(this._classified);
            const report = {
                generated_at: new Date().toISOString(),
                hub_state: this._state,
                port: this._port,
                tag: this._preflight && this._preflight.tag,
                commit: this._preflight && this._preflight.commit,
                python_version: this._preflight && this._preflight.pythonVersion,
                plugin_count: this._lastDiscovery ? this._lastDiscovery.plugin_count : 0,
                entry_count: this._lastDiscovery ? this._lastDiscovery.entry_count : 0,
                approved_count: this._lastDiscovery ? this._lastDiscovery.approved_count : 0,
                registered_count: this._tools.length,
                confirmed_count: this._lastDiscovery ? this._lastDiscovery.confirmed_count : 0,
                rejected_count: this._lastDiscovery ? this._lastDiscovery.rejected_count : 0,
                enabled_packs: Array.isArray(this._enabledPacks) ? this._enabledPacks.slice() : [],
                level_counts: counts,
                entries: this._classified.map((row) => ({
                    plugin_id: row.plugin_id,
                    entry_id: row.entry_id,
                    level: row.level,
                    rule: row.rule,
                    reason: row.reason,
                    authorized: Boolean(row.authorized),
                    auth_reason: row.auth_reason || '',
                    tool_name: row.authorized ? (this._tools.find((tool) => tool._neko.plugin_id === row.plugin_id && tool._neko.entry_id === row.entry_id) || {}).name : ''
                })),
                notes: this._notes
            };
            const written = writeReport(this._runtimeDir, report);
            await this._writeConfigValue('last_report_summary', written.summary);
        } catch (error) {
            this._log('warn', `写兼容报告失败: ${error.message}`);
        }
    }

    async _writeConfigValue(key, value) {
        const cfgPath = path.join(this._pluginDir, 'plugin_config.json');
        if (!fs.existsSync(cfgPath)) return;
        this._writingConfig = true;
        try {
            if (this.context && typeof this.context.pauseHotReloadFor === 'function') {
                this.context.pauseHotReloadFor(this.metadata.name, `write ${key}`);
            }
            const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
            if (!raw[key] || typeof raw[key] !== 'object') {
                raw[key] = { type: 'string', value };
            } else {
                raw[key].value = value;
            }
            fs.writeFileSync(cfgPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
        } finally {
            if (this.context && typeof this.context.resumeHotReloadFor === 'function') {
                this.context.resumeHotReloadFor(this.metadata.name);
            }
            setTimeout(() => {
                this._writingConfig = false;
            }, 600);
        }
    }

    _installExitHook() {
        if (this._exitHookInstalled) return;
        this._onProcessExit = () => {
            if (this._runtime) {
                this._runtime.stop().catch(() => {});
            }
        };
        process.once('exit', this._onProcessExit);
        process.once('SIGINT', this._onProcessExit);
        process.once('SIGTERM', this._onProcessExit);
        this._exitHookInstalled = true;
    }

    _removeExitHook() {
        if (!this._exitHookInstalled) return;
        process.removeListener('exit', this._onProcessExit);
        process.removeListener('SIGINT', this._onProcessExit);
        process.removeListener('SIGTERM', this._onProcessExit);
        this._exitHookInstalled = false;
    }
}

module.exports = NekoCompatHubPlugin;
