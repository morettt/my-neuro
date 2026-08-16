'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { RuntimeManager } = require('../lib/runtime-manager.js');
const { LocalClient } = require('../lib/local-client.js');
const { selectPort } = require('../lib/preflight.js');

test('RuntimeManager 能启动、健康检查并停止子进程', async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-hub-rt-'));
    const portResult = await selectPort(49160);
    assert.equal(portResult.ok, true);
    const manager = new RuntimeManager({ runtimeDir, log() {} });
    const started = await manager.start({
        pythonPath: process.execPath,
        checkoutPath: path.join(__dirname, 'helpers'),
        entryPath: path.join(__dirname, 'helpers', 'stub-plugin-server.js'),
        port: portResult.port,
        startTimeoutSeconds: 10
    });
    assert.equal(started.ok, true, started.reason);
    const client = new LocalClient({ port: started.port, timeoutMs: 3000 });
    const health = await client.get('/health');
    assert.equal(health.data.status, 'ok');
    const pid = manager.getState().pid;
    assert.ok(pid);
    await manager.stop();
    assert.equal(manager.getState().state, 'stopped');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await assert.rejects(() => new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port: started.port, path: '/health', timeout: 500 }, resolve);
        req.on('error', reject);
    }));
});
