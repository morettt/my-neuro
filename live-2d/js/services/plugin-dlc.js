const fs = require('fs');
const path = require('path');

function pluginDlcInfo(pluginsDir, pluginDir, metadata) {
    const target = path.resolve(pluginsDir, '..', 'plugins-dlc', path.basename(pluginDir));
    if (!metadata.dlc?.installScript) {
        return { target, installed: !metadata.download_dlc || fs.existsSync(target) };
    }
    const script = path.resolve(pluginDir, metadata.dlc.installScript);
    if (!script.startsWith(path.resolve(pluginDir) + path.sep) || !fs.existsSync(script)) {
        throw new Error('DLC 安装脚本不存在或路径无效');
    }
    const checks = metadata.localService?.checks || [];
    const complete = root => checks.length > 0 && checks.every(file => fs.existsSync(path.join(root, file)));
    const legacyRoot = path.resolve(pluginsDir, '..', '..', 'full-hub');
    const resourceRoot = complete(target) ? target : complete(legacyRoot) ? legacyRoot : target;
    const python = metadata.localService?.pythonPath
        ? path.resolve(resourceRoot, metadata.localService.pythonPath)
        : path.resolve(pluginsDir, '..', '..', 'env', 'python.exe');
    if (metadata.localService?.pythonPath && !python.startsWith(resourceRoot + path.sep)) {
        throw new Error('插件运行环境路径无效');
    }
    return { target, script, resourceRoot, installed: complete(resourceRoot) && fs.existsSync(python) };
}

function findPluginDlc(pluginsDir, name, url) {
    for (const type of ['built-in', 'community']) {
        const dir = path.join(pluginsDir, type, name);
        let metadata;
        try { metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')); } catch { continue; }
        if (metadata.download_dlc === url) return { metadata, dir, ...pluginDlcInfo(pluginsDir, dir, metadata) };
    }
    return null;
}

module.exports = { pluginDlcInfo, findPluginDlc };
