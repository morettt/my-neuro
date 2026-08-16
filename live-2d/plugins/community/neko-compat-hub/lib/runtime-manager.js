'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { LocalClient } = require('./local-client.js');
const {
    hubStateDir,
    readLauncherRecord,
    pluginPortFromRecord,
    agentPortFromRecord,
    buildPackagedEnv,
    reapOrRefusePackagedServers,
    killPidTree,
    pidAlive,
    readJsonFile
} = require('./packaged-process.js');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function looksLikePluginHealth(data) {
    return Boolean(data && data.status === 'ok');
}

function looksLikePluginCatalog(data) {
    return Boolean(data && Array.isArray(data.plugins));
}

class RuntimeManager {
    /**
     * @param {object} options
     * @param {string} options.runtimeDir
     * @param {Function} [options.log]
     * @param {Function} [options.spawnImpl]
     * @param {Function} [options.clientFactory]
     * @param {Function} [options.now]
     */
    constructor(options = {}) {
        this.runtimeDir = options.runtimeDir;
        this.log = options.log || (() => {});
        this._spawnImpl = options.spawnImpl || spawn;
        this._clientFactory = options.clientFactory || ((port) => new LocalClient({ port, timeoutMs: 4000 }));
        this._now = options.now || (() => new Date().toISOString());
        this._reapFn = options.reapFn || reapOrRefusePackagedServers;
        this._proc = null;
        this._stopping = false;
        this._restartCount = 0;
        this._state = 'stopped';
        this._port = null;
        this._agentPort = null;
        this._owned = false;
        this._stdout = null;
        this._stderr = null;
        this._onUnexpectedExit = options.onUnexpectedExit || null;
    }

    getState() {
        return {
            state: this._state,
            pid: this._proc && this._proc.pid ? this._proc.pid : null,
            port: this._port,
            agentPort: this._agentPort,
            restartCount: this._restartCount
        };
    }

    async start(spec) {
        if (this._proc && !this._proc.killed) {
            await this.stop();
        }
        this._stopping = false;
        this._state = 'starting';
        this._port = spec.port;
        this._agentPort = null;
        const logDir = path.join(this.runtimeDir, 'logs');
        const stateDir = hubStateDir(this.runtimeDir);
        ensureDir(logDir);
        ensureDir(stateDir);

        if (spec.packaged) {
            const reaped = await this._reapFn({
                exePath: spec.pythonPath,
                log: this.log,
                spawnImpl: this._spawnImpl
            });
            if (!reaped.ok) {
                this._state = 'error';
                return reaped;
            }
        }

        this._stdout = fs.createWriteStream(path.join(logDir, 'runtime.stdout.log'), { flags: 'a' });
        this._stderr = fs.createWriteStream(path.join(logDir, 'runtime.stderr.log'), { flags: 'a' });

        const args = spec.packaged
            ? [...(spec.pythonArgsPrefix || [])]
            : [
                ...(spec.pythonArgsPrefix || []),
                spec.entryPath || path.join(spec.checkoutPath, 'plugin', 'user_plugin_server.py')
            ];
        const env = {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            NEKO_USER_PLUGIN_SERVER_PORT: String(spec.port),
            USER_PLUGIN_SERVER_PORT: String(spec.port)
        };
        if (spec.packaged) {
            Object.assign(env, buildPackagedEnv(spec, this.runtimeDir));
        }
        this.log('info', `启动 Runtime: ${spec.pythonPath} ${args.join(' ')} cwd=${spec.checkoutPath} port=${spec.port} packaged=${Boolean(spec.packaged)}`);
        this._proc = this._spawnImpl(spec.pythonPath, args, {
            cwd: spec.checkoutPath,
            env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        this._owned = true;
        if (this._proc.stdout) this._proc.stdout.pipe(this._stdout);
        if (this._proc.stderr) this._proc.stderr.pipe(this._stderr);

        this._proc.on('error', (error) => {
            this.log('error', `Runtime spawn 失败: ${error.message}`);
            this._state = 'error';
        });
        this._proc.on('exit', (code, signal) => {
            this.log('warn', `Runtime 退出 code=${code} signal=${signal}`);
            this._proc = null;
            if (!this._stopping) {
                this._state = 'exited';
                if (typeof this._onUnexpectedExit === 'function') {
                    this._onUnexpectedExit({ code, signal, restartCount: this._restartCount });
                }
            }
        });

        const timeoutMs = (Number(spec.startTimeoutSeconds) || 60) * 1000;
        const ready = await this._waitReady(spec, timeoutMs);
        if (!ready.ok) {
            this._state = 'error';
            await this.stop();
            return ready;
        }
        this._port = ready.port;
        this._agentPort = ready.agentPort || null;
        this._state = 'running';
        this._writeRuntimeState(spec, ready);
        return {
            ok: true,
            port: ready.port,
            pid: this._proc ? this._proc.pid : null,
            agentPort: this._agentPort,
            owned: this._owned
        };
    }

    async _waitReady(spec, timeoutMs) {
        const started = Date.now();
        const preferredPort = spec.port;
        const requireCatalog = Boolean(spec.packaged);
        while (Date.now() - started < timeoutMs) {
            if (this._state === 'exited' || this._state === 'error') {
                const hint = spec.packaged
                    ? '包装启动器立即退出，通常是单实例锁或 attach 到已有实例。'
                    : '';
                return {
                    ok: false,
                    reason: `Runtime 进程在健康检查完成前退出。${hint}`.trim()
                };
            }

            const record = readLauncherRecord(hubStateDir(this.runtimeDir));
            const recordPort = pluginPortFromRecord(record, preferredPort);
            const ports = [];
            const seen = new Set();
            for (const port of [recordPort, preferredPort]) {
                if (Number.isInteger(port) && port > 0 && !seen.has(port)) {
                    seen.add(port);
                    ports.push(port);
                }
            }
            if (!requireCatalog) {
                for (let offset = 0; offset <= 50; offset += 1) {
                    const port = preferredPort + offset;
                    if (!seen.has(port)) {
                        seen.add(port);
                        ports.push(port);
                    }
                }
            }

            for (const port of ports) {
                const probe = await this._probePluginPort(port, requireCatalog);
                if (probe) {
                    return {
                        ok: true,
                        port,
                        agentPort: agentPortFromRecord(record),
                        data: probe.health
                    };
                }
            }
            await sleep(400);
        }
        return { ok: false, reason: `启动后 ${Math.round(timeoutMs / 1000)} 秒内插件服务未就绪` };
    }

    async _probePluginPort(port, requireCatalog) {
        try {
            const client = this._clientFactory(port);
            const health = await client.get('/health');
            if (health.status !== 200 || !looksLikePluginHealth(health.data)) return null;
            if (!requireCatalog) return { health: health.data };
            const catalog = await client.get('/plugins', { locale: 'zh-CN' });
            if (catalog.status === 200 && looksLikePluginCatalog(catalog.data)) {
                return { health: health.data, catalog: catalog.data };
            }
            return null;
        } catch {
            return null;
        }
    }

    _writeRuntimeState(spec, ready) {
        const payload = {
            pid: this._proc ? this._proc.pid : null,
            port: ready.port,
            agent_port: ready.agentPort || null,
            started_at: this._now(),
            python_path: spec.pythonPath,
            checkout_path: spec.checkoutPath,
            commit: spec.commit || null,
            tag: spec.tag || null,
            packaged: Boolean(spec.packaged)
        };
        fs.writeFileSync(
            path.join(this.runtimeDir, 'runtime.json'),
            `${JSON.stringify(payload, null, 2)}\n`,
            'utf8'
        );
    }

    async stop() {
        this._stopping = true;
        const proc = this._proc;
        this._proc = null;
        const record = readLauncherRecord(hubStateDir(this.runtimeDir));
        const recordPid = record && record.pid ? Number(record.pid) : null;
        const saved = readJsonFile(path.join(this.runtimeDir, 'runtime.json'));
        const savedPid = saved && saved.pid ? Number(saved.pid) : null;
        const pids = [proc && proc.pid, recordPid, savedPid].filter((pid, index, all) => {
            return pid && all.indexOf(pid) === index && pidAlive(pid);
        });
        if (proc && proc.pid) {
            this.log('info', `停止 Runtime PID=${proc.pid}`);
            await killProcessTree(proc, this._spawnImpl);
        }
        for (const pid of pids) {
            if (proc && pid === proc.pid) continue;
            this.log('info', `停止 Runtime 附属 PID=${pid}`);
            await killPidTree(pid, this._spawnImpl);
        }
        this._state = 'stopped';
        this._port = null;
        this._agentPort = null;
        this._owned = false;
        await closeStream(this._stdout);
        await closeStream(this._stderr);
        this._stdout = null;
        this._stderr = null;
        return { ok: true };
    }
}

function closeStream(stream) {
    return new Promise((resolve) => {
        if (!stream) return resolve();
        stream.end(() => resolve());
        setTimeout(resolve, 200);
    });
}

function killProcessTree(proc, spawnImpl) {
    return new Promise((resolve) => {
        const done = () => resolve();
        const timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* ignore */ }
            done();
        }, 4000);
        proc.once('exit', () => {
            clearTimeout(timer);
            done();
        });
        try {
            if (process.platform === 'win32') {
                const tk = spawnImpl('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true });
                tk.on('error', () => {
                    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
                });
            } else {
                proc.kill('SIGTERM');
            }
        } catch {
            done();
        }
    });
}

module.exports = { RuntimeManager };
