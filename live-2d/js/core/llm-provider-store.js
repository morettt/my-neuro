const fs = require('fs');
const path = require('path');

function getProviderStorePath(baseDir) {
    return path.join(baseDir, 'llm_providers.json');
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getProviderPrefixes(provider) {
    const prefixes = [];
    const providerId = (provider?.id || '').trim().replace(/\/+$/g, '');
    const providerName = (provider?.name || '').trim().replace(/\/+$/g, '');
    if (providerId) {
        prefixes.push(providerId);
    }
    if (providerName && !prefixes.includes(providerName)) {
        prefixes.push(providerName);
    }
    return prefixes;
}

function normalizeModelIdForProvider(provider, modelId) {
    const rawModelId = (modelId || '').trim();
    if (!rawModelId) {
        return '';
    }

    for (const prefix of getProviderPrefixes(provider)) {
        if (rawModelId.startsWith(`${prefix}/`)) {
            return rawModelId.slice(prefix.length + 1);
        }
    }

    const apiUrl = (provider?.api_url || '').trim().toLowerCase();
    if (apiUrl.includes('dashscope.aliyuncs.com/compatible-mode') && rawModelId.split('/').length === 2) {
        return rawModelId.split('/', 2)[1];
    }

    return rawModelId;
}

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeProvidersData(rawValue) {
    const normalizeProvider = (provider) => {
        if (!provider || typeof provider !== 'object') {
            return provider;
        }

        const normalized = clone(provider);
        const models = Array.isArray(normalized.models) ? normalized.models : [];
        normalized.models = models.map((model) => {
            if (!model || typeof model !== 'object') {
                const normalizedModelId = normalizeModelIdForProvider(normalized, String(model || ''));
                return { model_id: normalizedModelId, name: normalizedModelId, enabled: true };
            }

            const normalizedModelId = normalizeModelIdForProvider(
                normalized,
                model.model_id || model.id || model.name || ''
            );
            return {
                ...model,
                model_id: normalizedModelId,
                name: (!model.name || model.name === model.model_id || model.name === model.id)
                    ? normalizedModelId
                    : model.name
            };
        });
        if (typeof normalized.model === 'string' && normalized.model) {
            normalized.model = normalizeModelIdForProvider(normalized, normalized.model);
        }
        return normalized;
    };

    if (Array.isArray(rawValue)) {
        return rawValue.map(normalizeProvider);
    }
    if (rawValue && Array.isArray(rawValue.providers)) {
        return rawValue.providers.map(normalizeProvider);
    }
    return [];
}

function getFirstModelId(provider) {
    return ((provider?.models || []).find(model => model && model.model_id)?.model_id || '');
}

function ensureSelectedModelPresent(provider, modelId) {
    if (!provider || !modelId) {
        return false;
    }

    const normalizedModelId = normalizeModelIdForProvider(provider, modelId);
    if (!normalizedModelId) {
        return false;
    }

    provider.models = Array.isArray(provider.models) ? provider.models : [];
    const existing = provider.models.find(model => model && model.model_id === normalizedModelId);
    if (existing) {
        if (existing.enabled === false) {
            existing.enabled = true;
            return true;
        }
        if (!existing.name) {
            existing.name = normalizedModelId;
            return true;
        }
        return false;
    }

    provider.models.push({
        model_id: normalizedModelId,
        name: normalizedModelId,
        enabled: true
    });
    return true;
}

function loadProvidersFromStore(baseDir) {
    const providersPath = getProviderStorePath(baseDir);
    if (!fs.existsSync(providersPath)) {
        return { providers: [], normalizedChanged: false };
    }

    try {
        const rawData = readJsonFile(providersPath);
        const providers = normalizeProvidersData(rawData);
        const rawProviders = Array.isArray(rawData)
            ? rawData
            : (rawData && Array.isArray(rawData.providers) ? rawData.providers : []);
        return {
            providers,
            normalizedChanged: JSON.stringify(rawProviders) !== JSON.stringify(providers)
        };
    } catch (error) {
        console.warn(`读取 LLM 提供商文件失败: ${error.message}`);
        return { providers: [], normalizedChanged: false };
    }
}

function hasLegacyProviderData(source) {
    if (!source || typeof source !== 'object') {
        return false;
    }
    return ['api_key', 'api_url'].some(key => typeof source[key] === 'string' && source[key].trim());
}

function buildProviderFromLegacy(source, providerId, name, temperature) {
    const modelId = (source.model_id || source.model || '').trim();
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
        const selectedModelId = config.llm.model_id || getFirstModelId(provider);
        config.llm.provider_id = 'main';
        config.llm.model_id = selectedModelId;
    }

    if (!config.vision) {
        config.vision = {};
    }

    const legacyVision = config.vision.vision_model || {};
    if (!config.vision.provider_id && providerById.has('vision') && hasLegacyProviderData(legacyVision)) {
        const provider = providerById.get('vision');
        const selectedModelId = config.vision.model_id || getFirstModelId(provider);
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

    const providerById = new Map(
        (Array.isArray(config.llm_providers) ? config.llm_providers : [])
            .filter(provider => provider && provider.id)
            .map(provider => [provider.id, provider])
    );

    const selectedLlmProvider = providerById.get(config.llm.provider_id || '');
    const llmModelId = normalizeModelIdForProvider(selectedLlmProvider, config.llm.model_id || '');
    if (ensureSelectedModelPresent(selectedLlmProvider, llmModelId)) {
        changed = true;
    }
    if (config.llm.model_id !== llmModelId) {
        config.llm.model_id = llmModelId;
        changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(config.llm, 'model')) {
        delete config.llm.model;
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

    const legacyVision = config.vision.vision_model || {};
    const selectedVisionProvider = providerById.get(config.vision.provider_id || '');
    const normalizedVisionModelId = normalizeModelIdForProvider(
        selectedVisionProvider,
        config.vision.model_id || ''
    );
    if (ensureSelectedModelPresent(selectedVisionProvider, normalizedVisionModelId)) {
        changed = true;
    }
    if (config.vision.model_id !== normalizedVisionModelId) {
        config.vision.model_id = normalizedVisionModelId;
        changed = true;
    }
    if (Object.keys(legacyVision).length > 0) {
        config.vision.vision_model = {};
        changed = true;
    }

    return changed;
}

function ensureProviderStore(baseDir, config) {
    const storeState = loadProvidersFromStore(baseDir);
    let providers = storeState.providers;
    let storeChanged = storeState.normalizedChanged;

    const inlineProviders = normalizeProvidersData(config.llm_providers);
    if (providers.length === 0 && inlineProviders.length > 0) {
        providers = inlineProviders;
        storeChanged = true;
    }

    if (providers.length === 0) {
        providers = buildLegacyProviders(config);
        if (providers.length > 0) {
            storeChanged = true;
        }
    }

    const normalizedProviders = normalizeProvidersData(providers);
    applyLegacyProviderSelection(config, normalizedProviders);
    config.llm_providers = normalizedProviders;
    const configChanged = scrubLegacyProviderConfig(config);
    const finalProviders = normalizeProvidersData(config.llm_providers);
    const providerStateChanged = JSON.stringify(normalizedProviders) !== JSON.stringify(finalProviders);

    return {
        providers: finalProviders,
        storeChanged: storeChanged || providerStateChanged,
        configChanged
    };
}

function saveProviders(baseDir, providers) {
    const providersPath = getProviderStorePath(baseDir);
    const payload = { providers: normalizeProvidersData(providers) };
    fs.writeFileSync(providersPath, JSON.stringify(payload, null, 2), 'utf8');
}

function persistProviderStore(baseDir, configPath, config) {
    const result = ensureProviderStore(baseDir, config);
    if (result.storeChanged || result.configChanged) {
        saveProviders(baseDir, result.providers);
    }
    if (configPath && (result.storeChanged || result.configChanged)) {
        const persistableConfig = clone(config);
        delete persistableConfig.llm_providers;
        fs.writeFileSync(configPath, JSON.stringify(persistableConfig, null, 2), 'utf8');
    }
    return result;
}

module.exports = {
    persistProviderStore,
    resolveProvidersForConfig: ensureProviderStore,
    saveProviders
};
