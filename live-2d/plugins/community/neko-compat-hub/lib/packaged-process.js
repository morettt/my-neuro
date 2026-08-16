'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const defaultExecFile = promisify(execFile);

const HUB_PARENT_NAMES = /^(node|nodejs|cmd|powershell|pwsh|python|pythonw|conhost)\.exe$/i;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 0) return false;
    try {
        process.kill(n, 0);
        return true;
    } catch (error) {
        if (error && error.code === 'EPERM') return true;
        return false;
    }
}

function readJsonFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function defaultNekoStateDir() {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || '';
    return base ? path.join(base, 'N.E.K.O.runtime') : '';
}

function hubStateDir(runtimeDir) {
    return path.join(runtimeDir, 'neko-state');
}

function readLauncherRecord(stateDir) {
    if (!stateDir) return null;
    const record = readJsonFile(path.join(stateDir, 'launcher.json'));
    return record && typeof record === 'object' ? record : null;
}

function pluginPortFromRecord(record, fallback) {
    const internal = record && record.internal_ports ? record.internal_ports : {};
    const ports = record && record.ports ? record.ports : {};
    const value = Number(
        internal.USER_PLUGIN_SERVER_PORT
        || ports.USER_PLUGIN_SERVER_PORT
        || fallback
    );
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function agentPortFromRecord(record) {
    const ports = record && record.ports ? record.ports : {};
    const value = Number(ports.TOOL_SERVER_PORT);
    return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function sameExecutable(left, right) {
    return Boolean(left && right && normalizePath(left) === normalizePath(right));
}

function isHubOwnedParent(proc) {
    if (!proc) return false;
    if (!pidAlive(proc.parentPid)) return true;
    return HUB_PARENT_NAMES.test(String(proc.parentName || ''));
}

async function listPackagedServers(execFileFn = defaultExecFile) {
    if (process.platform !== 'win32') return [];
    const script = [
        "$ErrorActionPreference = 'SilentlyContinue'",
        "$rows = @()",
        "Get-CimInstance Win32_Process -Filter \"Name = 'projectneko_server.exe'\" | ForEach-Object {",
        "  $parent = Get-CimInstance Win32_Process -Filter \"ProcessId = $($_.ParentProcessId)\"",
        "  $rows += [pscustomobject]@{",
        "    pid = $_.ProcessId",
        "    parentPid = $_.ParentProcessId",
        "    executable = $_.ExecutablePath",
        "    parentName = $(if ($parent) { $parent.Name } else { '' })",
        "  }",
        "}",
        "if ($rows.Count -eq 0) { '[]' } else { $rows | ConvertTo-Json -Compress -Depth 3 }"
    ].join('; ');
    try {
        const result = await execFileFn('powershell.exe', ['-NoProfile', '-Command', script], {
            timeout: 20000,
            windowsHide: true,
            encoding: 'utf8'
        });
        const text = String(result.stdout || '').trim();
        if (!text) return [];
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return [];
    }
}

function killPidTree(pid, spawnImpl, spawnFn) {
    const spawn = spawnImpl || spawnFn || require('child_process').spawn;
    return new Promise((resolve) => {
        const done = () => resolve();
        if (!pid) return done();
        try {
            if (process.platform === 'win32') {
                const tk = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
                const timer = setTimeout(done, 5000);
                tk.on('exit', () => {
                    clearTimeout(timer);
                    done();
                });
                tk.on('error', () => {
                    clearTimeout(timer);
                    done();
                });
                return;
            }
            try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
            done();
        } catch {
            done();
        }
    });
}

/**
 * Kill Hub leftovers of the same Steam exe. Refuse if the game UI owns the process.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
async function reapOrRefusePackagedServers(options = {}) {
    const exePath = options.exePath;
    const log = options.log || (() => {});
    const listFn = options.listFn || listPackagedServers;
    const killFn = options.killFn || ((pid) => killPidTree(pid, options.spawnImpl));
    const servers = await listFn(options.execFileFn);
    const mine = servers.filter((proc) => sameExecutable(proc.executable, exePath));
    if (mine.length === 0) return { ok: true, killed: [] };

    const foreign = mine.filter((proc) => !isHubOwnedParent(proc));
    if (foreign.length > 0) {
        const first = foreign[0];
        return {
            ok: false,
            reason: `本机已有 Steam N.E.K.O 在运行 (PID=${first.pid}, parent=${first.parentName || first.parentPid})。Hub 不会启动第二份后端。请先退出游戏窗口。`
        };
    }

    const killed = [];
    for (const proc of mine) {
        log('warn', `清理残留 projectneko_server PID=${proc.pid} parent=${proc.parentName || proc.parentPid}`);
        await killFn(proc.pid);
        killed.push(proc.pid);
    }
    await sleep(800);
    return { ok: true, killed };
}

function buildPackagedEnv(spec, runtimeDir) {
    const stateDir = hubStateDir(runtimeDir);
    fs.mkdirSync(stateDir, { recursive: true });
    return {
        PYTHONUNBUFFERED: '1',
        NEKO_MERGED: '1',
        NEKO_RUNTIME_STATE_DIR: stateDir,
        NEKO_USER_PLUGIN_SERVER_PORT: String(spec.port),
        USER_PLUGIN_SERVER_PORT: String(spec.port)
    };
}

module.exports = {
    pidAlive,
    readJsonFile,
    defaultNekoStateDir,
    hubStateDir,
    readLauncherRecord,
    pluginPortFromRecord,
    agentPortFromRecord,
    sameExecutable,
    isHubOwnedParent,
    listPackagedServers,
    killPidTree,
    reapOrRefusePackagedServers,
    buildPackagedEnv,
    HUB_PARENT_NAMES
};
