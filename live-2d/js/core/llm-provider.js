// llm-provider.js - LLM 提供商统一管理器
// 集中管理所有 LLM 提供商配置，各模块通过 provider_id 引用

const { logToTerminal } = require('../api-utils.js');

/**
 * LLM 提供商管理器（单例）
 * 
 * 用法：
 *   const { llmProviderManager } = require('./llm-provider.js');
 *   llmProviderManager.init(config);
 *   const provider = llmProviderManager.getProvider('main');
 *   // provider = { id, name, api_key, api_url, models, temperature }
 * 
 * models 格式（新）：
 *   [ { model_id, name, enabled } ]
 *
 * 兼容旧格式：provider.model 字符串 → 自动转为单条 models 数组
 */
class LLMProviderManager {
    constructor() {
        /** @type {Map<string, object>} id -> provider config */
        this._providers = new Map();
        /** @type {string|null} 默认提供商 id */
        this._defaultId = null;
        /** @type {string|null} 当前活跃模型 id (config.llm.model_id) */
        this._activeModelId = null;
        this._initialized = false;
    }

    /**
     * 从运行时配置初始化提供商列表
     * 输入应当是已经过加载层规范化的运行时配置：
     *   1. config.llm_providers 数组（通常由 llm_providers.json 注入）
     *   2. provider 只有 model 字符串时，自动转为 models 数组
     * 
     * @param {object} config - 完整的 config.json 对象
     */
    init(config) {
        this._providers.clear();

        if (config.llm_providers && Array.isArray(config.llm_providers) && config.llm_providers.length > 0) {
            // 新格式：从 llm_providers 数组加载
            for (const provider of config.llm_providers) {
                if (!provider.id) {
                    logToTerminal('warn', `⚠️ llm_providers 中存在缺少 id 的提供商，已跳过`);
                    continue;
                }
                // 规范化 models 字段
                const models = this._normalizeModels(provider);
                this._providers.set(provider.id, {
                    id: provider.id,
                    name: provider.name || provider.id,
                    api_key: provider.api_key || '',
                    api_url: provider.api_url || '',
                    models,
                    temperature: provider.temperature !== undefined ? provider.temperature : undefined,
                    enabled: provider.enabled !== false
                });
            }
            logToTerminal('info', `✅ 已加载 ${this._providers.size} 个 LLM 提供商`);
        }

        // 确定默认提供商：优先使用 config.llm.provider_id，否则用 "main"
        const requestedDefaultId = config.llm && config.llm.provider_id ? config.llm.provider_id : null;
        const mainProvider = this._providers.get('main');
        const firstEnabledProvider = Array.from(this._providers.values()).find(provider => provider.enabled !== false);

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

        // 记录当前活跃模型 id
        this._activeModelId = (config.llm && config.llm.model_id) ? config.llm.model_id : null;

        this._initialized = true;
    }

    /**
     * 将 provider 配置中的 model 字段规范化为 models 数组
     * 支持：
     *   - provider.models 已是数组 → 直接使用
     *   - provider.model 是字符串 → 包装为单元素 models 数组
     *   - 两者都没有 → 返回空数组
     * 
     * @param {object} provider
     * @returns {Array<{model_id:string, name:string, enabled:boolean}>}
     */
    _normalizeModels(provider) {
        if (Array.isArray(provider.models)) {
            return provider.models.map(m => ({
                model_id: this._normalizeModelId(provider, m.model_id || m.id || ''),
                name: this._normalizeModelId(provider, m.name || m.model_id || m.id || ''),
                enabled: m.enabled !== false
            }));
        }
        // 迁移旧数据时兼容单个 model 字符串
        if (typeof provider.model === 'string' && provider.model) {
            const modelId = this._normalizeModelId(provider, provider.model);
            return [{ model_id: modelId, name: modelId, enabled: true }];
        }
        return [];
    }

    _normalizeModelId(provider, modelId) {
        const rawModelId = (modelId || '').trim();
        if (!rawModelId) {
            return '';
        }

        const prefixes = [];
        const providerName = (provider?.name || '').trim().replace(/\/+$/g, '');
        const providerId = (provider?.id || '').trim().replace(/\/+$/g, '');
        if (providerName) {
            prefixes.push(providerName);
        }
        if (providerId && !prefixes.includes(providerId)) {
            prefixes.push(providerId);
        }

        for (const prefix of prefixes) {
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

    /**
     * 获取指定 ID 的提供商配置
     * @param {string} id - 提供商 ID
     * @returns {object|null} { id, name, api_key, api_url, models, temperature, enabled }
     */
    getProvider(id) {
        if (!this._initialized) {
            logToTerminal('warn', '⚠️ LLMProviderManager 尚未初始化');
            return null;
        }
        return this._providers.get(id) || null;
    }

    /**
     * 获取默认提供商配置
     * @returns {object|null}
     */
    getDefaultProvider() {
        if (!this._defaultId) return null;
        const provider = this.getProvider(this._defaultId);
        if (this._isProviderEnabled(provider)) {
            return provider;
        }
        return this.getAllProviders().find(candidate => this._isProviderEnabled(candidate)) || null;
    }

    /**
     * 获取默认提供商 ID
     * @returns {string|null}
     */
    getDefaultId() {
        return this._defaultId;
    }

    /**
     * 获取所有提供商列表
     * @returns {Array<object>}
     */
    getAllProviders() {
        return Array.from(this._providers.values());
    }

    /**
     * 获取当前活跃模型 ID（config.llm.model_id）
     * @returns {string|null}
     */
    getActiveModelId() {
        return this._activeModelId;
    }

    /**
     * 从提供商的 models 数组中解析出当前使用的模型 ID
     * 优先级：
     *   1. 传入的 modelId 参数
     *   2. this._activeModelId（config.llm.model_id）
     *   3. 第一个 enabled=true 的模型
     *   4. 第一个模型（不管 enabled）
     * 
     * @param {object} provider
     * @param {string|null} [modelId]
     * @returns {string} 模型 ID 字符串
     */
    resolveModelId(provider, modelId = null) {
        if (!provider) return '';
        const models = provider.models || [];
        // 1. 显式传入。
        // 只有命中且模型仍处于 enabled 状态时才直接返回；
        // 否则继续向下回退到首个启用模型，避免禁用模型仍被旧调用链使用。
        if (modelId) {
            const found = models.find(m => m.model_id === modelId);
            if (found && found.enabled !== false) return found.model_id;
        }
        // 2. 全局 active model id，同样只接受启用中的模型。
        if (this._activeModelId) {
            const found = models.find(m => m.model_id === this._activeModelId);
            if (found && found.enabled !== false) return found.model_id;
        }
        // 3. 第一个 enabled
        const firstEnabled = models.find(m => m.enabled !== false);
        if (firstEnabled) return firstEnabled.model_id;
        // 4. 第一个
        if (models.length > 0) return models[0].model_id;
        return '';
    }

    _isProviderEnabled(provider) {
        return !!provider && provider.enabled !== false;
    }

    /**
     * 解析提供商引用：给定一个 provider_id（或为空），返回实际的 LLM 配置
     * 同时解析出当前模型 ID
     * 如果 provider_id 为空或找不到对应提供商，返回默认提供商
     * 
     * @param {string|null|undefined} providerId - 提供商 ID
     * @param {string|null} [modelId] - 指定模型 ID（可选）
     * @returns {object} { api_key, api_url, model, models, temperature }
     */
    resolveProvider(providerId, modelId = null) {
        // 1. 尝试通过 provider_id 查找
        if (providerId) {
            const provider = this.getProvider(providerId);
            if (this._isProviderEnabled(provider)) {
                const resolvedModelId = this.resolveModelId(provider, modelId);
                return {
                    ...provider,
                    model: resolvedModelId  // 保持 model 字段兼容性
                };
            }
            if (provider && provider.enabled === false) {
                logToTerminal('warn', `⚠️ 提供商 "${providerId}" 已禁用，尝试降级`);
            }
            logToTerminal('warn', `⚠️ 未找到提供商 "${providerId}"，尝试降级`);
        }

        // 2. 使用默认提供商
        const defaultProvider = this.getDefaultProvider();
        if (defaultProvider) {
            const resolvedModelId = this.resolveModelId(defaultProvider, modelId);
            return {
                ...defaultProvider,
                model: resolvedModelId
            };
        }

        // 3. 实在没有，返回空配置
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
     * 解析提供商并仅在可直接使用时返回。
     * 将查找逻辑与可用性判断收敛到一处，避免重复判断。
     *
     * @param {string|null|undefined} providerId
     * @param {string|null} [modelId]
     * @returns {object|null}
     */
    resolveProviderOrFallback(providerId, modelId = null) {
        const provider = this.resolveProvider(providerId, modelId);
        if (!provider || provider.id === '_empty') {
            return null;
        }
        return provider;
    }

    /**
     * 动态添加/更新提供商
     * @param {object} provider - { id, name, api_key, api_url, models, temperature }
     */
    addProvider(provider) {
        if (!provider.id) return;
        const models = this._normalizeModels(provider);
        this._providers.set(provider.id, {
            id: provider.id,
            name: provider.name || provider.id,
            api_key: provider.api_key || '',
            api_url: provider.api_url || '',
            models,
            temperature: provider.temperature,
            enabled: provider.enabled !== false
        });
    }

    /**
     * 移除提供商
     * @param {string} id
     */
    removeProvider(id) {
        this._providers.delete(id);
    }

    /**
     * 将当前提供商列表导出为可保存到 config.json 的格式
     * @returns {Array<object>}
     */
    /**
     * 检查是否已初始化
     * @returns {boolean}
     */
    isInitialized() {
        return this._initialized;
    }
}

// 单例导出
const llmProviderManager = new LLMProviderManager();
module.exports = { LLMProviderManager, llmProviderManager };
