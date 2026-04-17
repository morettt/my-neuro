const { Plugin } = require('../../../js/core/plugin-base.js');
const axios = require('axios');

class RagMemoryPlugin extends Plugin {

    async onInit() {
        const cfg = this.context.getPluginFileConfig();
        this._url = cfg.rag_url?.value || cfg.rag_url || 'http://127.0.0.1:8002/ask';
    }

    getTools() {
        return [{
            type: 'function',
            function: {
                name: 'search_memory',
                description: '从LLM的记忆系统中搜索相关的历史对话和信息',
                parameters: {
                    type: 'object',
                    properties: {
                        question: { type: 'string', description: '要搜索的问题或关键词' },
                        top_k: { type: 'integer', description: '返回最相关的记忆数量，默认1', default: 1 }
                    },
                    required: ['question']
                }
            }
        }];
    }

    async executeTool(name, params) {
        if (name === 'search_memory') return await this._searchMemory(params);
        throw new Error(`[rag-memory] 不支持的工具: ${name}`);
    }

    async _searchMemory({ question, top_k = 1 }) {
        const response = await axios.post(this._url, { question, top_k });
        return (response.data.relevant_passages || []).map(p => p.content).join('\n').trim();
    }
}

module.exports = RagMemoryPlugin;
