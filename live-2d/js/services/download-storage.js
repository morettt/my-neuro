const fs = require('fs');
const path = require('path');

function downloadCacheRoot(appDir) {
    const root = path.join(appDir, '.download-cache');
    fs.mkdirSync(root, { recursive: true });
    return root;
}

function ensureDownloadSpace(directory, bytes, filesystem = fs) {
    if (!bytes || typeof filesystem.statfsSync !== 'function') return;
    const stats = filesystem.statfsSync(directory);
    const free = Number(stats.bavail) * Number(stats.bsize);
    const required = bytes + 64 * 1024 * 1024;
    if (free < required) {
        const gb = amount => (amount / 1024 ** 3).toFixed(2);
        const error = new Error(`磁盘空间不足：${directory}，剩余 ${gb(free)} GB，本次下载至少需要 ${gb(required)} GB（解压还需额外空间）`);
        error.code = 'ENOSPC';
        throw error;
    }
}

function downloadProcessEnv(appDir, original = process.env) {
    const root = downloadCacheRoot(appDir);
    const temp = path.join(root, 'tmp');
    fs.mkdirSync(temp, { recursive: true });
    return { ...original, TEMP: temp, TMP: temp, TMPDIR: temp,
        MODELSCOPE_CACHE: path.join(root, 'modelscope'),
        HF_HOME: path.join(root, 'huggingface') };
}

function explainStorageError(error, directory) {
    if (error?.code === 'ENOSPC' || /ENOSPC|no space left on device|磁盘空间不足/i.test(error?.message || '')) {
        return `磁盘空间不足：${directory}。请释放该盘空间后重试。${error.message || ''}`;
    }
    return error?.message || String(error);
}

module.exports = { downloadCacheRoot, ensureDownloadSpace, downloadProcessEnv, explainStorageError };
