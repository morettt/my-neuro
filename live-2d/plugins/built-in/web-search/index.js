const { Plugin } = require('../../../js/core/plugin-base.js');
const axios = require('axios');

const TOOL_DEFINITION = {
    type: 'function',
    function: {
        name: 'web_search',
        description: '使用搜索网络引擎，并返回内容',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '想要搜索的内容关键词'
                }
            },
            required: ['query']
        }
    }
};

class WebSearchPlugin extends Plugin {

    async onInit() {
        const cfg = this.context.getPluginFileConfig();
        this._tavilyKey = cfg.tavily_api_key?.value || cfg.tavily_api_key || '';
    }

    getTools() {
        if (!this._tavilyKey) return [];
        return [TOOL_DEFINITION];
    }

    async executeTool(name, params) {
        if (name === 'web_search') return await this._webSearch(params);
        throw new Error(`[web-search] 不支持的工具: ${name}`);
    }

    async _webSearch({ query }) {
        try {
            this.context.log('info', `[web-search] 正在搜索: ${query}`);

            const response = await axios.post('https://api.tavily.com/search', {
                query,
                max_results: 3,
                include_answer: true,
                search_depth: 'basic',
                api_key: this._tavilyKey
            });

            if (!response.data) return '错误：搜索没有返回任何结果';

            let fullContent = '';

            const aiAnswer = response.data.answer || '无AI摘要';
            fullContent += `AI答案摘要：${aiAnswer}\n\n`;

            const searchResults = response.data.results || [];
            if (searchResults.length > 0) {
                fullContent += '详细搜索结果：\n';
                searchResults.forEach((result, i) => {
                    const title = result.title || '无标题';
                    const content = result.content || '无内容';
                    const url = result.url || '无URL';
                    fullContent += `${i + 1}. 标题：${title}\n`;
                    fullContent += `   内容：${content.substring(0, 1500)}...\n`;
                    fullContent += `   来源：${url}\n\n`;
                });
            } else {
                fullContent += '未找到相关搜索结果。\n';
            }

            return fullContent;

        } catch (error) {
            this.context.log('error', `[web-search] 搜索错误: ${error.message}`);
            if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                return '错误：网络连接失败，请检查网络连接';
            }
            return `搜索过程中出现错误：${error.message}`;
        }
    }
}

module.exports = WebSearchPlugin;
