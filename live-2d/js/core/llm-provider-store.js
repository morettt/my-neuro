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

function hasLegacyProviderData(source) {
    if (!source || typeof source !== 'object') {
        return false;
    }
    return ['api_key', 'api_url'].some(key => typeof source[key] === 'string' && source[key].trim());
}

function buildProviderFromLegacy(source, providerId, name, temperature) {
    const modelId = (source.model || '').trim();
    const provider = {
        id: providerId,
        name,
        api_key: source.api_key || '',
        api_url: source.api_url || '',
        models: modelId ? [{ model_id: modelId, name: modelId, enabled: true }] : [],
        enabled: true
    };
    if (temperature !== undefined) {
        provider.temperature = temperature;
    }
    return provider;
}

function buildLegacyProviders(config) {
    const providers = [];
    const llmConfig = config.llm || {};
    const llmProviderId = (llmConfig.provider_id || '').trim();
    const visionRoot = config.vision || {};
    const visionConfig = visionRoot.vision_model || {};
    const visionProviderId = (visionRoot.provider_id || '').trim();

    if ((llmProviderId === '' || llmProviderId === 'main') && hasLegacyProviderData(llmConfig)) {
        providers.push(buildProviderFromLegacy(llmConfig, 'main', '主模型', llmConfig.temperature));
    }
    if ((visionProviderId === '' || visionProviderId === 'vision') && hasLegacyProviderData(visionConfig)) {
        providers.push(buildProviderFromLegacy(visionConfig, 'vision', '视觉模型'));
    }

    return providers;
}

function applyLegacyProviderSelection(config, providers) {
    const providerById = new Map(
        normalizeProvidersData(providers)
            .filter(provider => provider && provider.id)
            .map(provider => [provider.id, provider])
    );

    if (!config.llm) {
        config.llm = {};
    }

    if (!config.llm.provider_id && providerById.has('main')) {
        const provider = providerById.get('main');
        const selectedModelId = config.llm.model_id
            || config.llm.model
            || ((provider.models || []).find(model => model && model.model_id)?.model_id || '');
        config.llm.provider_id = 'main';
        config.llm.model_id = selectedModelId;
        config.llm.model = selectedModelId;
    }

    if (!config.vision) {
        config.vision = {};
    }

    const legacyVision = config.vision.vision_model || {};
    if (!config.vision.provider_id && providerById.has('vision') && hasLegacyProviderData(legacyVision)) {
        const provider = providerById.get('vision');
        const selectedModelId = config.vision.model_id
            || legacyVision.model
            || ((provider.models || []).find(model => model && model.model_id)?.model_id || '');
        config.vision.provider_id = 'vision';
        config.vision.model_id = selectedModelId;
    }
}

function scrubLegacyProviderConfig(config) {
    let changed = false;

    if (!config.llm) {
        config.llm = {};
        changed = true;
    }

    const llmModelId = config.llm.model_id || config.llm.model || '';
    if (config.llm.model !== llmModelId) {
        config.llm.model = llmModelId;
        changed = true;
    }
    if (config.llm.api_key) {
        config.llm.api_key = '';
        changed = true;
    }
    if (config.llm.api_url) {
        config.llm.api_url = '';
        changed = true;
    }

    if (!config.vision) {
        config.vision = {};
        changed = true;
    }

    if (!config.vision.model_id) {
        const legacyModelId = config.vision.vision_model?.model || '';
        if (legacyModelId) {
            config.vision.model_id = legacyModelId;
            changed = true;
        }
    }

    const legacyVision = config.vision.vision_model || {};
    if (Object.keys(legacyVision).length > 0) {
        config.vision.vision_model = {};
        changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(config, 'llm_providers')) {
        delete config.llm_providers;
        changed = true;
    }

    return changed;
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

function ensureProviderStore(baseDir, config) {
    const providersPath = getProviderStorePath(baseDir);
    let providers = [];
    let storeChanged = false;

    if (fs.existsSync(providersPath)) {
        try {
            providers = normalizeProvidersData(readJsonFile(providersPath));
        } catch (error) {
            console.warn(`读取 LLM 提供商文件失败: ${error.message}`);
        }
    }

    const inlineProviders = normalizeProvidersData(config.llm_providers);
    if (providers.length === 0 && inlineProviders.length > 0) {
        providers = inlineProviders;
        storeChanged = true;
    }

    const providerIds = new Set(
        providers
            .filter(provider => provider && provider.id)
            .map(provider => provider.id)
    );

    for (const legacyProvider of buildLegacyProviders(config)) {
        if (!providerIds.has(legacyProvider.id)) {
            providers.push(legacyProvider);
            providerIds.add(legacyProvider.id);
            storeChanged = true;
        }
    }

    applyLegacyProviderSelection(config, providers);
    config.llm_providers = normalizeProvidersData(providers);
    const configChanged = scrubLegacyProviderConfig(config);

    return {
        providers: normalizeProvidersData(providers),
        storeChanged,
        configChanged
    };
}

function saveProviders(baseDir, providers) {
    const providersPath = getProviderStorePath(baseDir);
    const payload = { providers: normalizeProvidersData(providers) };
    fs.writeFileSync(providersPath, JSON.stringify(payload, null, 2), 'utf8');
}

module.exports = {
    applyLegacyProviderSelection,
    buildLegacyProviders,
    ensureProviderStore,
    getProviderStorePath,
    hasLegacyProviderData,
    normalizeProvidersData,
    resolveProvidersForConfig,
    scrubLegacyProviderConfig,
    saveProviders
};
