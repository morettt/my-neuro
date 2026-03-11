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
     * 从 config.json 初始化提供商列表
     * 支持两种格式：
     *   1. 新格式：config.llm_providers 数组（每个 provider 有 models 数组）
     *   2. 旧格式：config.llm 中直接写 api_key/api_url/model（自动迁移）
     *   3. 半新格式：provider 只有 model 字符串，自动转为 models 数组
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

        // 旧格式兼容：如果 config.llm 中直接有 api_key，自动创建 "main" provider
        if (config.llm && config.llm.api_key && !config.llm.provider_id) {
            if (!this._providers.has('main')) {
                const models = config.llm.model
                    ? [{ model_id: config.llm.model, name: config.llm.model, enabled: true }]
                    : [];
                this._providers.set('main', {
                    id: 'main',
                    name: '主模型（自动迁移）',
                    api_key: config.llm.api_key,
                    api_url: config.llm.api_url || '',
                    models,
                    temperature: config.llm.temperature,
                    enabled: true
                });
                logToTerminal('info', '📦 从旧格式 llm 配置自动创建 main 提供商');
            }
        }

        // 旧格式兼容：如果 config.vision.vision_model 中有独立配置，自动创建 "vision" provider
        if (config.vision && config.vision.vision_model && config.vision.vision_model.api_key) {
            if (!config.vision.provider_id && !this._providers.has('vision')) {
                const vModel = config.vision.vision_model.model;
                const models = vModel
                    ? [{ model_id: vModel, name: vModel, enabled: true }]
                    : [];
                this._providers.set('vision', {
                    id: 'vision',
                    name: '视觉模型（自动迁移）',
                    api_key: config.vision.vision_model.api_key,
                    api_url: config.vision.vision_model.api_url || '',
                    models,
                    enabled: true
                });
                logToTerminal('info', '📦 从旧格式 vision 配置自动创建 vision 提供商');
            }
        }

        // 确定默认提供商：优先使用 config.llm.provider_id，否则用 "main"
        if (config.llm && config.llm.provider_id) {
            this._defaultId = config.llm.provider_id;
        } else if (this._providers.has('main')) {
            this._defaultId = 'main';
        } else if (this._providers.size > 0) {
            // 使用第一个提供商作为默认
            this._defaultId = this._providers.keys().next().value;
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
                model_id: m.model_id || m.id || '',
                name: m.name || m.model_id || m.id || '',
                enabled: m.enabled !== false
            }));
        }
        // 旧格式兼容：单个 model 字符串
        if (typeof provider.model === 'string' && provider.model) {
            return [{ model_id: provider.model, name: provider.model, enabled: true }];
        }
        return [];
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
        return this.getProvider(this._defaultId);
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
        // 1. 显式传入
        if (modelId) {
            const found = models.find(m => m.model_id === modelId);
            if (found) return found.model_id;
        }
        // 2. 全局 active model id
        if (this._activeModelId) {
            const found = models.find(m => m.model_id === this._activeModelId);
            if (found) return found.model_id;
        }
        // 3. 第一个 enabled
        const firstEnabled = models.find(m => m.enabled !== false);
        if (firstEnabled) return firstEnabled.model_id;
        // 4. 第一个
        if (models.length > 0) return models[0].model_id;
        // 5. 兼容旧格式 provider.model 字符串
        return provider.model || '';
    }

    /**
     * 解析提供商引用：给定一个 provider_id（或为空），返回实际的 LLM 配置
     * 同时解析出当前模型 ID
     * 如果 provider_id 为空或找不到对应提供商，返回默认提供商
     * 
     * @param {string|null|undefined} providerId - 提供商 ID
     * @param {object} [fallbackConfig] - 降级配置（旧格式的 api_key/api_url/model）
     * @param {string|null} [modelId] - 指定模型 ID（可选）
     * @returns {object} { api_key, api_url, model, models, temperature }
     */
    resolveProvider(providerId, fallbackConfig = null, modelId = null) {
        // 1. 尝试通过 provider_id 查找
        if (providerId) {
            const provider = this.getProvider(providerId);
            if (provider) {
                const resolvedModelId = this.resolveModelId(provider, modelId);
                return {
                    ...provider,
                    model: resolvedModelId  // 保持 model 字段兼容性
                };
            }
            logToTerminal('warn', `⚠️ 未找到提供商 "${providerId}"，尝试降级`);
        }

        // 2. 尝试使用降级配置（旧格式的独立 LLM 配置）
        if (fallbackConfig && fallbackConfig.api_key) {
            const models = fallbackConfig.model
                ? [{ model_id: fallbackConfig.model, name: fallbackConfig.model, enabled: true }]
                : [];
            return {
                id: '_fallback',
                name: '降级配置',
                api_key: fallbackConfig.api_key,
                api_url: fallbackConfig.api_url || fallbackConfig.base_url || '',
                model: fallbackConfig.model || '',
                models,
                temperature: fallbackConfig.temperature,
                enabled: true
            };
        }

        // 3. 使用默认提供商
        const defaultProvider = this.getDefaultProvider();
        if (defaultProvider) {
            const resolvedModelId = this.resolveModelId(defaultProvider, modelId);
            return {
                ...defaultProvider,
                model: resolvedModelId
            };
        }

        // 4. 实在没有，返回空配置
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
    exportForConfig() {
        return this.getAllProviders().map(p => ({
            id: p.id,
            name: p.name,
            api_key: p.api_key,
            api_url: p.api_url,
            models: p.models || [],
            ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
            enabled: p.enabled !== false
        }));
    }

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
