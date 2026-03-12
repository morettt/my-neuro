const fs = require('fs');
const path = require('path');

function getProviderStorePath(baseDir) {
    return path.join(baseDir, 'llm_providers.json');
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeProvidersData(rawValue) {
    if (Array.isArray(rawValue)) {
        return clone(rawValue);
    }
    if (rawValue && Array.isArray(rawValue.providers)) {
        return clone(rawValue.providers);
    }
    return [];
}

function resolveProvidersForConfig(baseDir, config) {
    const providersPath = getProviderStorePath(baseDir);
    let providers = [];

    if (fs.existsSync(providersPath)) {
        try {
            providers = normalizeProvidersData(readJsonFile(providersPath));
        } catch (error) {
            console.warn(`读取 LLM 提供商文件失败: ${error.message}`);
        }
    }

    if (providers.length === 0) {
        providers = normalizeProvidersData(config.llm_providers);
    }

    config.llm_providers = providers;
    return { providers };
}

function saveProviders(baseDir, providers) {
    const providersPath = getProviderStorePath(baseDir);
    const payload = { providers: normalizeProvidersData(providers) };
    fs.writeFileSync(providersPath, JSON.stringify(payload, null, 2), 'utf8');
}

module.exports = {
    getProviderStorePath,
    normalizeProvidersData,
    resolveProvidersForConfig,
    saveProviders
};
