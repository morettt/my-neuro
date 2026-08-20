// llm-provider.js - LLM 提供商统一管理器（运行时单例）
// 集中管理所有 LLM 提供商配置，各模块通过 provider_id / model_id 引用。
//
// 用法：
//   const { llmProviderManager } = require('./llm-provider.js');
//   llmProviderManager.init(config);   // config-loader.load() 时已自动调用
//   const resolved = llmProviderManager.resolveProviderOrFallback(
//       config.llm?.provider_id || null,
//       config.llm?.model_id || null
//   );
//   // resolved = { id, name, api_key, api_url, model, models,
//   //              temperature_enabled?, temperature?, reasoning_enabled?, reasoning_effort? }
//
// 模型级参数（temperature_* / reasoning_*）挂在每个模型条目上，
// 解析时把选中模型的参数合并到返回对象顶层，供 LLMClient 直接消费。

const { logToTerminal } = require('../api-utils.js');
const { MODEL_PARAM_KEYS } = require('./llm-provider-store.js');

class LLMProviderManager {
    constructor() {
        /** @type {Map<string, object>} id -> provider 配置 */
        this._providers = new Map();
        /** @type {string|null} 默认提供商 id（config.llm.provider_id） */
        this._defaultId = null;
        /** @type {string|null} 当前活跃模型 id（config.llm.model_id） */
        this._activeModelId = null;
        this._initialized = false;
    }

    /**
     * 从运行时配置初始化提供商列表。
     * config.llm_providers 由 llm-provider-store 在加载阶段注入（来源 llm_providers.json）。
     * @param {object} config - 完整 config 对象
     */
    init(config) {
        this._providers.clear();

        const providers = Array.isArray(config.llm_providers) ? config.llm_providers : [];
        for (const provider of providers) {
            if (!provider || !provider.id) continue;
            const normalized = {
                id: provider.id,
                name: provider.name || provider.id,
                api_key: provider.api_key || '',
                api_url: provider.api_url || '',
                enabled: provider.enabled !== false,
                models: Array.isArray(provider.models)
                    ? provider.models.filter(m => m && m.model_id).map(m => ({ ...m }))
                    : []
            };
            if (provider.prompt_cache !== undefined) {
                normalized.prompt_cache = this._clonePromptCache(provider.prompt_cache);
            }
            this._providers.set(provider.id, normalized);
        }

        // 默认提供商：config.llm.provider_id → "main" → 第一个启用的 → 第一个
        const requestedDefaultId = (config.llm && config.llm.provider_id) ? config.llm.provider_id : null;
        const mainProvider = this._providers.get('main');
        const firstEnabledProvider = Array.from(this._providers.values()).find(p => p.enabled !== false);

        if (requestedDefaultId && this._isProviderEnabled(this._providers.get(requestedDefaultId))) {
            this._defaultId = requestedDefaultId;
        } else if (this._isProviderEnabled(mainProvider)) {
            this._defaultId = 'main';
        } else if (firstEnabledProvider) {
            this._defaultId = firstEnabledProvider.id;
        } else if (this._providers.size > 0) {
            this._defaultId = this._providers.keys().next().value;
        } else {
            this._defaultId = null;
        }

        this._activeModelId = (config.llm && config.llm.model_id) ? config.llm.model_id : null;
        this._initialized = true;

        if (this._providers.size > 0) {
            logToTerminal('info', `✅ 已加载 ${this._providers.size} 个 LLM 提供商（默认: ${this._defaultId || '无'}，当前模型: ${this._activeModelId || '未指定'}）`);
        } else {
            logToTerminal('warn', '⚠️ 未配置任何 LLM 提供商');
        }
    }

    _isProviderEnabled(provider) {
        return !!provider && provider.enabled !== false;
    }

    /**
     * 获取指定 ID 的提供商配置
     * @returns {object|null}
     */
    getProvider(id) {
        if (!this._initialized) {
            logToTerminal('warn', '⚠️ LLMProviderManager 尚未初始化');
            return null;
        }
        return this._providers.get(id) || null;
    }

    /** 获取默认提供商（已禁用时降级到第一个启用的） */
    getDefaultProvider() {
        if (!this._defaultId) return null;
        const provider = this._providers.get(this._defaultId) || null;
        if (this._isProviderEnabled(provider)) {
            return provider;
        }
        return this.getAllProviders().find(candidate => this._isProviderEnabled(candidate)) || null;
    }

    getDefaultId() {
        return this._defaultId;
    }

    getAllProviders() {
        return Array.from(this._providers.values());
    }

    /** 当前活跃模型 ID（config.llm.model_id） */
    getActiveModelId() {
        return this._activeModelId;
    }

    isInitialized() {
        return this._initialized;
    }

    /**
     * 在 provider 的 models 中解析出应使用的模型条目。
     * 优先级：显式 modelId（须启用）→ 全局活跃模型（须启用）→ 第一个启用的 → 第一个
     * @returns {object|null} 模型条目
     */
    _resolveModelEntry(provider, modelId = null) {
        if (!provider) return null;
        const models = Array.isArray(provider.models) ? provider.models : [];
        const lookupEnabled = (id) => {
            if (!id) return null;
            const found = models.find(m => m && m.model_id === id);
            return (found && found.enabled !== false) ? found : null;
        };
        return lookupEnabled(modelId)
            || lookupEnabled(this._activeModelId)
            || models.find(m => m && m.enabled !== false)
            || models[0]
            || null;
    }

    /** 将选中模型的模型级参数合并到返回对象顶层 */
    _buildResolved(provider, modelId) {
        const entry = this._resolveModelEntry(provider, modelId);
        const resolved = {
            ...provider,
            models: provider.models.map(m => ({ ...m })),
            model: entry ? entry.model_id : ''
        };
        if (entry?.prompt_cache !== undefined) {
            resolved.prompt_cache = this._mergePromptCache(
                provider.prompt_cache,
                entry.prompt_cache
            );
        }
        for (const key of MODEL_PARAM_KEYS) {
            if (entry && entry[key] !== undefined) {
                resolved[key] = entry[key];
            } else {
                delete resolved[key];
            }
        }
        return resolved;
    }

    /**
     * 解析提供商引用，返回可直接消费的 LLM 配置（找不到时降级到默认提供商）。
     * @param {string|null|undefined} providerId
     * @param {string|null} [modelId]
     * @returns {object} { id, name, api_key, api_url, model, models, ...模型级参数 }
     */
    resolveProvider(providerId, modelId = null) {
        if (providerId) {
            const provider = this.getProvider(providerId);
            if (this._isProviderEnabled(provider)) {
                return this._buildResolved(provider, modelId);
            }
            if (provider && provider.enabled === false) {
                logToTerminal('warn', `⚠️ LLM 提供商 "${providerId}" 已禁用，降级到默认提供商`);
            } else {
                logToTerminal('warn', `⚠️ 未找到 LLM 提供商 "${providerId}"，降级到默认提供商`);
            }
        }

        const defaultProvider = this.getDefaultProvider();
        if (defaultProvider) {
            return this._buildResolved(defaultProvider, modelId);
        }

        logToTerminal('error', '❌ 没有可用的 LLM 提供商配置');
        return {
            id: '_empty',
            name: '未配置',
            api_key: '',
            api_url: '',
            model: '',
            models: [],
            enabled: true
        };
    }

    /**
     * 解析提供商，仅在可直接使用时返回，否则返回 null。
     * @returns {object|null}
     */
    resolveProviderOrFallback(providerId, modelId = null) {
        const provider = this.resolveProvider(providerId, modelId);
        if (!provider || provider.id === '_empty' || !provider.api_url) {
            return null;
        }
        return provider;
    }

    /** 动态添加/更新提供商（运行时） */
    addProvider(provider) {
        if (!provider || !provider.id) return;
        const normalized = {
            id: provider.id,
            name: provider.name || provider.id,
            api_key: provider.api_key || '',
            api_url: provider.api_url || '',
            enabled: provider.enabled !== false,
            models: Array.isArray(provider.models)
                ? provider.models.filter(m => m && m.model_id).map(m => ({ ...m }))
                : []
        };
        if (provider.prompt_cache !== undefined) {
            normalized.prompt_cache = this._clonePromptCache(provider.prompt_cache);
        }
        this._providers.set(provider.id, normalized);
    }

    _clonePromptCache(value) {
        if (value === undefined) return undefined;
        if (!value || typeof value !== 'object') return value;
        return { ...value };
    }

    _mergePromptCache(providerValue, modelValue) {
        if (
            providerValue &&
            typeof providerValue === 'object' &&
            modelValue &&
            typeof modelValue === 'object'
        ) {
            return { ...providerValue, ...modelValue };
        }
        return this._clonePromptCache(modelValue);
    }

    /** 移除提供商（运行时） */
    removeProvider(id) {
        this._providers.delete(id);
    }
}

// 单例导出
const llmProviderManager = new LLMProviderManager();
module.exports = { LLMProviderManager, llmProviderManager };
