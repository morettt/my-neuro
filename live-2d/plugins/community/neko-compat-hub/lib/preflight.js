'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { DEFAULT_PORT, PORT_SCAN_MAX } = require('./constants.js');

const defaultExecFile = promisify(execFile);

function loadRuntimeLock(lockPath) {
    const resolved = lockPath || path.join(__dirname, '..', 'runtime-lock.json');
    const raw = fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
}

function parsePythonVersion(text) {
    const match = String(text || '').match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        text: `${match[1]}.${match[2]}.${match[3]}`
    };
}

function isPython311(version) {
    return Boolean(version && version.major === 3 && version.minor === 11);
}

async function runCommand(execFileFn, command, args, options = {}) {
    try {
        const result = await execFileFn(command, args, {
            timeout: options.timeout || 15000,
            windowsHide: true,
            encoding: 'utf8',
            ...options
        });
        return {
            ok: true,
            stdout: String(result.stdout || ''),
            stderr: String(result.stderr || '')
        };
    } catch (error) {
        return {
            ok: false,
            stdout: String(error.stdout || ''),
            stderr: String(error.stderr || error.message || ''),
            error
        };
    }
}

async function probePython(pythonPath, execFileFn) {
    const probe = await runCommand(execFileFn, pythonPath, ['--version']);
    const version = parsePythonVersion(`${probe.stdout}\n${probe.stderr}`);
    return {
        path: pythonPath,
        ok: probe.ok && isPython311(version),
        version,
        detail: probe.ok ? (version ? version.text : 'unparsed') : (probe.stderr || 'spawn failed')
    };
}

async function findPython311({ configuredPath, execFileFn, platform = process.platform }) {
    const candidates = [];
    if (configuredPath && String(configuredPath).trim()) {
        candidates.push(String(configuredPath).trim());
    }
    candidates.push('python3.11', 'python3', 'python');

    const tried = [];
    for (const candidate of candidates) {
        const result = await probePython(candidate, execFileFn);
        tried.push(result);
        if (result.ok) return { ok: true, python: result, tried };
    }

    if (platform === 'win32') {
        const pyLauncher = await runCommand(execFileFn, 'py', ['-3.11', '--version']);
        const version = parsePythonVersion(`${pyLauncher.stdout}\n${pyLauncher.stderr}`);
        const result = {
            path: 'py -3.11',
            ok: pyLauncher.ok && isPython311(version),
            version,
            detail: pyLauncher.ok ? (version ? version.text : 'unparsed') : (pyLauncher.stderr || 'py launcher missing'),
            argsPrefix: ['-3.11']
        };
        tried.push(result);
        if (result.ok) {
            return {
                ok: true,
                python: {
                    ...result,
                    path: 'py',
                    argsPrefix: ['-3.11']
                },
                tried
            };
        }
    }

    const found = tried
        .filter((item) => item.version)
        .map((item) => `${item.path}=${item.version.text}`)
        .join(', ');
    return {
        ok: false,
        reason: found
            ? `未找到 Python 3.11.x。已探测到: ${found}。上游硬性要求 ==3.11.*。`
            : '未找到可用的 Python 解释器。请在配置中填写 Python 3.11 的绝对路径。',
        tried
    };
}

function isPortFree(host, port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.unref();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen({ host, port, exclusive: true });
    });
}

async function selectPort(preferredPort, options = {}) {
    const host = options.host || '127.0.0.1';
    const start = Number.isInteger(preferredPort) && preferredPort > 0 ? preferredPort : DEFAULT_PORT;
    const maxTries = options.maxTries || PORT_SCAN_MAX;
    const probe = options.probe || isPortFree;
    for (let offset = 0; offset < maxTries; offset += 1) {
        const port = start + offset;
        if (await probe(host, port)) {
            return { ok: true, port, shifted: offset > 0 };
        }
    }
    return {
        ok: false,
        reason: `在 ${host}:${start}-${start + maxTries - 1} 范围内没有空闲端口`
    };
}

function parseSemverName(name) {
    const match = String(name || '').match(/^(\d+)\.(\d+)\.(\d+)(?:\.md)?$/);
    if (!match) return null;
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), text: `${match[1]}.${match[2]}.${match[3]}` };
}

function compareSemver(a, b) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
}

function readPackagedVersion(binDir, existsFn, readDirFn = fs.readdirSync) {
    const changelogDir = path.join(binDir, 'config', 'changelog');
    if (!existsFn(changelogDir)) return '';
    let names = [];
    try {
        names = readDirFn(changelogDir);
    } catch {
        return '';
    }
    const versions = names
        .map((name) => parseSemverName(name))
        .filter(Boolean)
        .sort(compareSemver);
    return versions.length ? versions[versions.length - 1].text : '';
}

function detectRuntimeLayout(checkoutPath, existsFn = fs.existsSync) {
    const root = String(checkoutPath || '').trim();
    if (!root) return { kind: 'missing', reason: '未配置 runtime_checkout_path，Hub 保持惰性。' };

    const exeName = process.platform === 'win32' ? 'projectneko_server.exe' : 'projectneko_server';
    const binCandidates = [
        root,
        path.join(root, 'resources', 'bin'),
        path.join(root, 'bin')
    ];
    for (const binDir of binCandidates) {
        const exe = path.join(binDir, exeName);
        const pluginsDir = path.join(binDir, 'plugin', 'plugins');
        if (existsFn(exe) && existsFn(pluginsDir)) {
            return {
                kind: 'packaged',
                binDir,
                exePath: exe,
                pluginsDir,
                version: readPackagedVersion(binDir, existsFn)
            };
        }
    }

    const sourceCandidates = [root, path.join(root, 'resources', 'bin')];
    for (const dir of sourceCandidates) {
        const entry = path.join(dir, 'plugin', 'user_plugin_server.py');
        if (existsFn(entry)) {
            return { kind: 'source', checkoutPath: dir, entryPath: entry };
        }
    }

    return {
        kind: 'unknown',
        reason: `路径既不是 N.E.K.O git checkout（缺 plugin/user_plugin_server.py），也不是 Steam 包装安装（缺 projectneko_server 与 plugin/plugins）: ${root}`
    };
}

async function readGitIdentity(checkoutPath, execFileFn) {
    const commitProbe = await runCommand(execFileFn, 'git', ['-C', checkoutPath, 'rev-parse', 'HEAD']);
    const tagProbe = await runCommand(execFileFn, 'git', [
        '-C', checkoutPath, 'describe', '--tags', '--exact-match'
    ]);
    return {
        commit: commitProbe.ok ? String(commitProbe.stdout).trim() : '',
        tag: tagProbe.ok ? String(tagProbe.stdout).trim() : '',
        commitError: commitProbe.ok ? '' : (commitProbe.stderr || 'git rev-parse 失败'),
        tagError: tagProbe.ok ? '' : (tagProbe.stderr || 'git describe 失败')
    };
}

async function runPreflight(options = {}) {
    const execFileFn = options.execFileFn || defaultExecFile;
    const existsFn = options.existsFn || ((target) => fs.existsSync(target));
    const lock = options.lock || loadRuntimeLock(options.lockPath);
    const checkoutPath = String(options.checkoutPath || '').trim();
    const failures = [];

    if (!checkoutPath) {
        return { ok: false, reason: '未配置 runtime_checkout_path，Hub 保持惰性。', failures };
    }
    if (!existsFn(checkoutPath)) {
        return { ok: false, reason: `checkout 路径不存在: ${checkoutPath}`, failures };
    }

    const layout = detectRuntimeLayout(checkoutPath, existsFn);
    if (layout.kind === 'missing' || layout.kind === 'unknown') {
        return { ok: false, reason: layout.reason, failures, layout };
    }

    const portResult = await selectPort(options.preferredPort, {
        probe: options.portProbe,
        maxTries: options.maxTries
    });
    if (!portResult.ok) {
        return { ok: false, reason: portResult.reason, layout };
    }

    if (layout.kind === 'packaged') {
        const notes = [];
        if (layout.version && layout.version !== lock.tag) {
            notes.push(`Steam 包装版版本 ${layout.version}，与源码锁 ${lock.tag} 不同；按主人指定的安装继续，协议不兼容时再降级。`);
        }
        return {
            ok: true,
            packaged: true,
            kind: 'packaged',
            checkoutPath: layout.binDir,
            entryPath: '',
            pythonPath: layout.exePath,
            pythonArgsPrefix: [],
            pythonVersion: 'bundled-3.11',
            commit: `packaged:${layout.version || 'unknown'}`,
            tag: layout.version || 'packaged',
            port: portResult.port,
            portShifted: portResult.shifted,
            startTimeoutSeconds: 120,
            notes,
            lock,
            layout
        };
    }

    const python = await findPython311({
        configuredPath: options.pythonPath,
        execFileFn,
        platform: options.platform
    });
    if (!python.ok) {
        return { ok: false, reason: python.reason, failures: python.tried, python, layout };
    }

    const git = await readGitIdentity(layout.checkoutPath, execFileFn);
    if (!git.commit) {
        return { ok: false, reason: `无法读取 checkout 的 git commit: ${git.commitError}`, git, python };
    }
    if (git.commit.toLowerCase() !== String(lock.commit || '').toLowerCase()) {
        return {
            ok: false,
            reason: `checkout commit ${git.commit} 与锁定 ${lock.commit} 不一致。请 checkout ${lock.tag}。`,
            git,
            python
        };
    }
    if (git.tag !== lock.tag) {
        return {
            ok: false,
            reason: `checkout tag ${git.tag || '(无精确 tag)'} 与锁定 ${lock.tag} 不一致。请 checkout ${lock.tag}。`,
            git,
            python
        };
    }

    return {
        ok: true,
        packaged: false,
        kind: 'source',
        checkoutPath: layout.checkoutPath,
        entryPath: layout.entryPath,
        pythonPath: python.python.path,
        pythonArgsPrefix: python.python.argsPrefix || [],
        pythonVersion: python.python.version.text,
        commit: git.commit,
        tag: git.tag,
        port: portResult.port,
        portShifted: portResult.shifted,
        lock
    };
}

module.exports = {
    loadRuntimeLock,
    parsePythonVersion,
    isPython311,
    findPython311,
    selectPort,
    isPortFree,
    readGitIdentity,
    detectRuntimeLayout,
    readPackagedVersion,
    runPreflight
};
