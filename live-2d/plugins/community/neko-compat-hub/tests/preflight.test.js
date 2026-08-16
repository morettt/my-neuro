'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { parsePythonVersion, isPython311, runPreflight, selectPort } = require('../lib/preflight.js');

test('Python 版本解析与 3.11 判定', () => {
    assert.deepEqual(parsePythonVersion('Python 3.11.15'), { major: 3, minor: 11, patch: 15, text: '3.11.15' });
    assert.equal(isPython311(parsePythonVersion('Python 3.11.15')), true);
    assert.equal(isPython311(parsePythonVersion('Python 3.13.5')), false);
});

test('Python 版本不符时拒绝', async () => {
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-src-'));
    fs.mkdirSync(path.join(checkout, 'plugin'), { recursive: true });
    fs.writeFileSync(path.join(checkout, 'plugin', 'user_plugin_server.py'), '# stub\n');
    const result = await runPreflight({
        checkoutPath: checkout,
        pythonPath: 'python',
        preferredPort: 48916,
        lock: { tag: 'v0.8.3', commit: 'abc' },
        execFileFn: async (command, args) => {
            if (String(command).includes('python') && args.includes('--version')) {
                return { stdout: 'Python 3.13.5', stderr: '' };
            }
            return { stdout: '', stderr: '' };
        },
        portProbe: async () => true
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /3\.11/);
});

test('Steam 包装安装可被识别且跳过 git 锁', async () => {
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-steam-'));
    const fakeBin = path.join(fakeRoot, 'resources', 'bin');
    fs.mkdirSync(path.join(fakeBin, 'plugin', 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(fakeBin, 'config', 'changelog'), { recursive: true });
    fs.writeFileSync(path.join(fakeBin, 'projectneko_server.exe'), 'stub');
    fs.writeFileSync(path.join(fakeBin, 'config', 'changelog', '0.9.0.md'), '- steam\n');
    const { detectRuntimeLayout, runPreflight } = require('../lib/preflight.js');
    const layout = detectRuntimeLayout(fakeRoot);
    assert.equal(layout.kind, 'packaged');
    assert.equal(layout.version, '0.9.0');

    const result = await runPreflight({
        checkoutPath: fakeRoot,
        preferredPort: 48916,
        lock: { tag: 'v0.8.3', commit: 'abc' },
        portProbe: async () => true,
        execFileFn: async () => ({ stdout: '', stderr: '' })
    });
    assert.equal(result.ok, true);
    assert.equal(result.packaged, true);
    assert.equal(result.tag, '0.9.0');
    assert.match(result.pythonPath, /projectneko_server\.exe$/);
    assert.ok(result.notes.some((note) => note.includes('0.9.0')));
});

test('commit 不匹配时拒绝', async () => {
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-hub-'));
    fs.mkdirSync(path.join(checkout, 'plugin'), { recursive: true });
    fs.writeFileSync(path.join(checkout, 'plugin', 'user_plugin_server.py'), '# stub\n');
    const result = await runPreflight({
        checkoutPath: checkout,
        pythonPath: 'python',
        lock: { tag: 'v0.8.3', commit: 'expected' },
        existsFn: (target) => fs.existsSync(target),
        execFileFn: async (command, args) => {
            if (args.includes('--version')) return { stdout: 'Python 3.11.2', stderr: '' };
            if (args.includes('rev-parse')) return { stdout: 'othercommit\n', stderr: '' };
            if (args.includes('describe')) return { stdout: 'v0.8.3\n', stderr: '' };
            return { stdout: '', stderr: '' };
        },
        portProbe: async () => true
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /commit/);
});

test('端口占用时顺延', async () => {
    const busy = new Set([48916, 48917]);
    const result = await selectPort(48916, {
        probe: async (_host, port) => !busy.has(port)
    });
    assert.equal(result.ok, true);
    assert.equal(result.port, 48918);
    assert.equal(result.shifted, true);
});

test('预检通过时返回 python/commit/port', async () => {
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-hub-'));
    fs.mkdirSync(path.join(checkout, 'plugin'), { recursive: true });
    fs.writeFileSync(path.join(checkout, 'plugin', 'user_plugin_server.py'), '# stub\n');
    const result = await runPreflight({
        checkoutPath: checkout,
        pythonPath: 'python',
        preferredPort: 48916,
        lock: { tag: 'v0.8.3', commit: 'eab8da4b521e419d2c36280e7b6fafd08291b640' },
        existsFn: (target) => fs.existsSync(target),
        execFileFn: async (command, args) => {
            if (args.includes('--version')) return { stdout: 'Python 3.11.15', stderr: '' };
            if (args.includes('rev-parse')) return { stdout: 'eab8da4b521e419d2c36280e7b6fafd08291b640\n', stderr: '' };
            if (args.includes('describe')) return { stdout: 'v0.8.3\n', stderr: '' };
            return { stdout: '', stderr: '' };
        },
        portProbe: async () => true
    });
    assert.equal(result.ok, true);
    assert.equal(result.port, 48916);
    assert.equal(result.pythonVersion, '3.11.15');
    assert.equal(result.tag, 'v0.8.3');
});
