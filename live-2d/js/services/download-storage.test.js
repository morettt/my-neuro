const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { downloadCacheRoot, downloadProcessEnv, ensureDownloadSpace, explainStorageError } = require('./download-storage');

test('large downloads, Python temp and model caches stay on the project drive', t => {
    const testRoot = path.resolve(__dirname, '../../.download-cache/tests');
    fs.mkdirSync(testRoot, { recursive: true });
    const root = fs.mkdtempSync(path.join(testRoot, 'neuro-storage-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const cache = downloadCacheRoot(root);
    assert.equal(cache, path.join(root, '.download-cache'));
    const env = downloadProcessEnv(root, { TEMP: 'system-temp', PATH: 'keep-path' });
    for (const key of ['TEMP', 'TMP', 'TMPDIR', 'MODELSCOPE_CACHE', 'HF_HOME']) {
        assert.ok(env[key].startsWith(cache + path.sep));
    }
    assert.equal(env.PATH, 'keep-path');
    assert.ok(fs.existsSync(env.TEMP));
});

test('download is rejected before writing when available space is insufficient', () => {
    const gb = 1024 ** 3;
    assert.throws(() => ensureDownloadSpace('project-downloads', 2 * gb, {
        statfsSync: () => ({ bavail: 100, bsize: 4096 })
    }), error => error.code === 'ENOSPC' && /project-downloads/.test(error.message));
    assert.doesNotThrow(() => ensureDownloadSpace('project-downloads', gb, {
        statfsSync: () => ({ bavail: 3 * gb / 4096, bsize: 4096 })
    }));
});

test('ENOSPC reports the target directory and other errors retain their cause', () => {
    assert.match(explainStorageError({ code: 'ENOSPC', message: 'write failed' }, 'project-downloads'), /磁盘空间不足：project-downloads/);
    assert.equal(explainStorageError(new Error('HTTP 404'), 'project-downloads'), 'HTTP 404');
});
