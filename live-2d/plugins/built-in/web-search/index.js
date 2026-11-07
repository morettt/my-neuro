const { Plugin } = require('../../../js/core/plugin-base.js');
const axios = require('axios');
const { randomUUID } = require('crypto');
const { Events } = require('../../../js/core/events.js');
const { createRequestDeadline, normalizeRequestTimeout } = require('../../../js/core/request-deadline.js');

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

const FETCH_DEFINITION = {
    type: 'function',
    function: {
        name: 'web_fetch',
        description: '读取指定网页的正文摘录（Parallel），用于深入查看搜索结果或用户提供的网址',
        parameters: {
            type: 'object',
            properties: {
                urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
                objective: { type: 'string', maxLength: 200, description: '希望从网页中查找的信息' }
            },
            required: ['urls']
        }
    }
};

function configValue(value, fallback) {
    if (value && typeof value === 'object') return value.value ?? value.default ?? fallback;
    return value ?? fallback;
}

class WebSearchPlugin extends Plugin {

    async onInit() {
        const cfg = this.context.getPluginFileConfig();
        this._tavilyKey = String(configValue(cfg.tavily_api_key, '')).trim();
        const provider = String(configValue(cfg.provider, 'auto')).trim().toLowerCase();
        this._provider = provider === 'auto' ? (this._tavilyKey ? 'tavily' : 'parallel') : provider;
        this._timeout = normalizeRequestTimeout(configValue(cfg.timeout_ms, 30000), 30000);
        this._requests = new Set();
        this._stopped = false;
        this._interrupt = () => this._requests.forEach(controller => controller.abort(new Error('搜索已取消')));
        this.context.on(Events.TTS_INTERRUPTED, this._interrupt);
    }

    getTools() {
        if (this._stopped || this.context.getConfig()?.tools?.enabled === false) return [];
        if (this._provider === 'parallel') return [TOOL_DEFINITION, FETCH_DEFINITION];
        if (this._provider === 'tavily' && this._tavilyKey) return [TOOL_DEFINITION];
        return []; // disabled、未知提供商或显式 Tavily 缺 Key 时不改用其他服务。
    }

    async executeTool(name, params) {
        if (!this.getTools().some(tool => tool.function.name === name)) {
            throw new Error(`[web-search] 工具不可用: ${name}`);
        }
        // 在任何 await 前捕获调用所属对话；并发调用不会覆盖彼此的 ID。
        const sessionId = this.context.getConversationId() || randomUUID();
        const deadline = createRequestDeadline(this._timeout, { message: '搜索请求超时' });
        this._requests.add(deadline.controller);
        try {
            if (name === 'web_search' && (typeof params?.query !== 'string' || !params.query.trim())) {
                throw new Error('搜索关键词不能为空');
            }
            if (this._provider === 'tavily') return await this._webSearch(params, deadline.signal);

            const args = { session_id: sessionId };
            if (name === 'web_search') {
                args.objective = params.query;
                args.search_queries = [params.query];
            } else {
                if (!Array.isArray(params?.urls) || params.urls.length < 1 || params.urls.length > 20) {
                    throw new Error('请提供 1 到 20 个 HTTP(S) 网页地址');
                }
                args.urls = params.urls.map(value => {
                    const url = new URL(value);
                    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
                        throw new Error('只支持不含登录信息的 HTTP(S) 网页地址');
                    }
                    return url.href;
                });
                if (params.objective !== undefined) {
                    if (typeof params.objective !== 'string' || params.objective.length > 200) {
                        throw new Error('网页读取目标不能超过 200 个字符');
                    }
                    args.objective = params.objective;
                }
            }
            const { callParallelTool } = require('./parallel-search.js');
            return await callParallelTool(name, args, deadline.signal, this._timeout);
        } catch (error) {
            const message = deadline.signal.aborted ? deadline.signal.reason?.message || '搜索已取消' : error.message;
            this.context.log('error', `[web-search] ${this._provider}: ${message}`);
            return `搜索过程中出现错误：${message}`;
        } finally {
            deadline.cleanup();
            this._requests.delete(deadline.controller);
        }
    }

    async onStop() {
        this._stopped = true;
        this._interrupt();
        this.context.off(Events.TTS_INTERRUPTED, this._interrupt);
    }

    async _webSearch({ query }, signal) {
        try {
            this.context.log('info', `[web-search] 正在搜索: ${query}`);

            const response = await axios.post('https://api.tavily.com/search', {
                query,
                max_results: 3,
                include_answer: true,
                search_depth: 'basic',
                api_key: this._tavilyKey
            }, { signal, timeout: this._timeout });

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
