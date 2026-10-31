const fs = require('fs');
const path = require('path');
const { pluginDlcInfo } = require('./plugin-dlc');

function readJson(file, fallback = {}) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// 服务声明由插件提供；控制面板统一管理环境、进程和日志。
function discoverPluginServices(pluginsDir, reservedIds = []) {
    const services = {};
    const enabled = readJson(path.join(pluginsDir, 'enabled_plugins.json'), {}).plugins || [];
    for (const relPath of enabled) {
        if (typeof relPath !== 'string' || !/^(built-in|community)\/[\w.-]+$/.test(relPath)) continue;
        const pluginDir = path.join(pluginsDir, relPath);
        const metadata = readJson(path.join(pluginDir, 'metadata.json'));
        const service = metadata.localService;
        if (!service || !/^[a-z][a-z0-9-]*$/.test(service.id)
            || reservedIds.includes(service.id) || services[service.id]
            || !Number.isInteger(service.port) || service.port < 1 || service.port > 65535
            || !Array.isArray(service.checks) || !service.checks.length
            || !service.checks.every(item => typeof item === 'string' && item.length)) continue;
        const scripts = {};
        for (const key of ['startScript', ...(service.launchResolver ? ['launchResolver'] : [])]) {
            if (typeof service[key] !== 'string') break;
            const file = path.resolve(pluginDir, service[key]);
            if (!file.startsWith(pluginDir + path.sep) || !fs.existsSync(file)) break;
            scripts[key] = file;
        }
        if (!scripts.startScript || service.launchResolver && !scripts.launchResolver) continue;
        let dlc;
        try { dlc = pluginDlcInfo(pluginsDir, pluginDir, metadata); } catch { continue; }
        const runtime = {};
        for (const [key, relative] of [['pythonExecutable', service.pythonPath], ['workingDirectory', service.workingDirectory]]) {
            if (!relative) continue;
            if (typeof relative !== 'string' || !dlc.resourceRoot) break;
            const resolved = path.resolve(dlc.resourceRoot, relative);
            if (!resolved.startsWith(dlc.resourceRoot + path.sep)) break;
            runtime[key] = resolved;
        }
        if (service.pythonPath && !runtime.pythonExecutable || service.workingDirectory && !runtime.workingDirectory) continue;
        services[service.id] = { ...service, ...scripts, ...runtime, resourceRoot: dlc.resourceRoot, plugin: relPath };
    }
    return services;
}

function resolvePluginServiceLaunch(definition, config) {
    if (!definition?.launchResolver) return definition;
    const resolveLaunch = require(definition.launchResolver);
    const options = resolveLaunch(config);
    if (!options || !Array.isArray(options.startArgs) || !options.startArgs.every(arg => typeof arg === 'string')) {
        throw new Error('插件服务启动参数无效');
    }
    return { ...definition, name: options.name || definition.name, startArgs: options.startArgs };
}

module.exports = { discoverPluginServices, resolvePluginServiceLaunch };
