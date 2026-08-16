'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    isHubOwnedParent,
    reapOrRefusePackagedServers,
    buildPackagedEnv,
    hubStateDir
} = require('../lib/packaged-process.js');

test('node/cmd 父进程视为 Hub 残留，可清理', () => {
    assert.equal(isHubOwnedParent({ parentPid: process.pid, parentName: 'node.exe' }), true);
    assert.equal(isHubOwnedParent({ parentPid: process.pid, parentName: 'powershell.exe' }), true);
    assert.equal(isHubOwnedParent({ parentPid: process.pid, parentName: 'N.E.K.O.exe' }), false);
});

test('N.E.K.O.exe 父进程视为游戏实例，拒绝第二份', async () => {
    const result = await reapOrRefusePackagedServers({
        exePath: 'G:\\GAME\\STEAM\\steamapps\\common\\n.e.k.o\\resources\\bin\\projectneko_server.exe',
        listFn: async () => ([{
            pid: 111,
            parentPid: process.pid,
            parentName: 'N.E.K.O.exe',
            executable: 'G:\\GAME\\STEAM\\steamapps\\common\\n.e.k.o\\resources\\bin\\projectneko_server.exe'
        }]),
        killFn: async () => {
            throw new Error('should not kill game instance');
        }
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Steam N\.E\.K\.O/);
});

test('Hub 残留会被杀掉', async () => {
    const killed = [];
    const result = await reapOrRefusePackagedServers({
        exePath: 'C:\\neko\\projectneko_server.exe',
        listFn: async () => ([{
            pid: 222,
            parentPid: 1,
            parentName: 'node.exe',
            executable: 'C:\\neko\\projectneko_server.exe'
        }]),
        killFn: async (pid) => { killed.push(pid); }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(killed, [222]);
});

test('包装环境写入独立 NEKO_RUNTIME_STATE_DIR', () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-hub-env-'));
    const env = buildPackagedEnv({ port: 48926 }, runtimeDir);
    assert.equal(env.NEKO_MERGED, '1');
    assert.equal(env.NEKO_USER_PLUGIN_SERVER_PORT, '48926');
    assert.equal(env.NEKO_RUNTIME_STATE_DIR, hubStateDir(runtimeDir));
    assert.equal(fs.existsSync(env.NEKO_RUNTIME_STATE_DIR), true);
});
