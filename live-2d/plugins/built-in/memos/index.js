const { Plugin } = require('../../../js/core/plugin-base.js');
const { MemosClient } = require('./memos-client.js');
const { MemosTools } = require('./tools.js');
const fs = require('fs');
const path = require('path');

const BACKEND_CONFIG_PATH = path.join(__dirname, '..', '..', '..', '..', 'memos_system', 'config', 'memos_config.json');

class MemosPlugin extends Plugin {

    async onInit() {
        const cfg = this.context.getPluginFileConfig();
        this.client = new MemosClient(cfg);
        this.tools = new MemosTools(this.client.apiUrl);
        this._cfg = cfg;
    }

    async onStart() {
        if (!this.client.enabled) {
            this.context.log('warn', 'MemOS 已禁用');
            return;
        }

        this._syncBackendConfig();

        const ok = await this.client.isAvailable();
        this.context.log('info', `MemOS 服务: ${ok ? '已连接' : '不可用（请确认 memos_system 是否启动）'}`);
    }

    async onStop() {
        if (this.client?.enabled) {
            await this.client.flushBuffer();
        }
    }

    async onUserInput(event) {
        if (!this.client?.enabled || !this._cfg.auto_inject) return;
        if (!['voice', 'text'].includes(event.source)) return;

        try {
            const memories = await this.client.search(event.text);
            if (memories.length > 0) {
                const text = this.client.formatMemoriesForPrompt(memories);
                this.context.addSystemPromptPatch('memos-recall', `\n\n【你对主人的已知记忆，回答时必须自然融入，不要说"根据记忆"】:\n${text}`);
            } else {
                this.context.removeSystemPromptPatch('memos-recall');
            }
        } catch (err) {
            this.context.log('error', `记忆注入失败: ${err.message}`);
        }
    }

    async onLLMResponse(response) {
        if (!this.client?.enabled || !this._cfg.auto_save) return;

        try {
            const messages = this.context.getMessages();
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            if (!lastUser) return;

            await this.client.addWithBuffer([
                { role: 'user', content: lastUser.content },
                { role: 'assistant', content: response.text }
            ]);
        } catch (err) {
            this.context.log('error', `MemOS 保存对话失败: ${err.message}`);
        }
    }

    getTools() {
        if (!this.client?.enabled) return [];
        return this.tools.getDefinitions();
    }

    async executeTool(name, params) {
        return this.tools.execute(name, params);
    }

    /**
     * 将插件中的后端配置同步写入 memos_system/config/memos_config.json
     * 只覆盖插件管理的字段，保留后端独有字段（storage、embedding 等）
     */
    _syncBackendConfig() {
        try {
            let backendCfg = {};
            if (fs.existsSync(BACKEND_CONFIG_PATH)) {
                backendCfg = JSON.parse(fs.readFileSync(BACKEND_CONFIG_PATH, 'utf-8'));
            }

            const cfg = this._cfg;

            // LLM
            if (cfg.backend_llm) {
                backendCfg.llm = backendCfg.llm || {};
                backendCfg.llm.config = {
                    model: cfg.backend_llm.model || backendCfg.llm?.config?.model || '',
                    api_key: cfg.backend_llm.api_key || backendCfg.llm?.config?.api_key || '',
                    base_url: cfg.backend_llm.base_url || backendCfg.llm?.config?.base_url || ''
                };
            }

            // LLM fallback
            if (cfg.backend_llm_fallback) {
                backendCfg.llm_fallback = {
                    enabled: cfg.backend_llm_fallback.enabled !== false,
                    config: {
                        model: cfg.backend_llm_fallback.model || backendCfg.llm_fallback?.config?.model || '',
                        api_key: cfg.backend_llm_fallback.api_key || backendCfg.llm_fallback?.config?.api_key || '',
                        base_url: cfg.backend_llm_fallback.base_url || backendCfg.llm_fallback?.config?.base_url || ''
                    }
                };
            }

            // Search
            if (cfg.backend_search) {
                backendCfg.search = backendCfg.search || {};
                if (cfg.backend_search.enable_bm25 !== undefined) backendCfg.search.enable_bm25 = cfg.backend_search.enable_bm25;
                if (cfg.backend_search.bm25_weight !== undefined) backendCfg.search.bm25_weight = cfg.backend_search.bm25_weight;
                if (cfg.backend_search.enable_graph_query !== undefined) backendCfg.search.enable_graph_query = cfg.backend_search.enable_graph_query;
                backendCfg.search.similarity_threshold = cfg.similarity_threshold || backendCfg.search.similarity_threshold || 0.5;
            }

            // Features
            if (cfg.backend_features) {
                if (cfg.backend_features.entity_extraction !== undefined) {
                    backendCfg.entity_extraction = backendCfg.entity_extraction || {};
                    backendCfg.entity_extraction.enabled = cfg.backend_features.entity_extraction;
                    backendCfg.entity_extraction.auto_extract_on_add = cfg.backend_features.entity_extraction;
                }
                if (cfg.backend_features.image_memory !== undefined) {
                    backendCfg.image = backendCfg.image || {};
                    backendCfg.image.enabled = cfg.backend_features.image_memory;
                }
                if (cfg.backend_features.image_auto_describe !== undefined) {
                    backendCfg.image = backendCfg.image || {};
                    backendCfg.image.auto_describe = cfg.backend_features.image_auto_describe;
                }
            }

            const dir = path.dirname(BACKEND_CONFIG_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(BACKEND_CONFIG_PATH, JSON.stringify(backendCfg, null, 2), 'utf-8');
            this.context.log('info', '已同步后端配置到 memos_config.json');
        } catch (err) {
            this.context.log('warn', `同步后端配置失败（不影响运行）: ${err.message}`);
        }
    }
}

module.exports = MemosPlugin;
