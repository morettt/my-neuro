const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const axios = require('axios');

const ENDPOINT = 'https://search.parallel.ai/mcp';
const USER_AGENT = 'my-neuro/1.0 (https://github.com/morettt/my-neuro)';

// 独立实例不继承应用的 axios 默认凭据/拦截器；强制 HTTP adapter，避免 renderer 的 XHR。
const nodeHttp = new axios.Axios({ adapter: 'http', headers: {}, responseType: 'stream',
    validateStatus: () => true, maxRedirects: 0 });

// 浏览器 fetch 会丢弃 User-Agent。使用已有的 axios Node HTTP adapter；将其正文转换成
// 当前运行环境的 Web Stream，让 SDK 在 Electron renderer 和 Node 中都能读取/取消 SSE。
async function nodeHttpFetch(url, init) {
    if (init.signal?.aborted) throw init.signal.reason || new Error('搜索已取消');
    const response = await nodeHttp.request({ url: String(url), method: init.method || 'GET',
        headers: Object.fromEntries(new Headers(init.headers)), data: init.body, signal: init.signal });
    let body = null;
    if (response.data && ![204, 205, 304].includes(response.status)) {
        const iterator = response.data[Symbol.asyncIterator]();
        let canceled = false;
        body = new ReadableStream({
            async pull(controller) {
                try {
                    const { done, value } = await iterator.next();
                    if (canceled) return;
                    if (done) controller.close();
                    else controller.enqueue(new Uint8Array(value));
                } catch (error) {
                    if (!canceled) controller.error(error);
                }
            },
            cancel() {
                canceled = true;
                response.data.destroy();
            }
        });
    } else {
        response.data?.destroy();
    }
    return new Response(body, { status: response.status, statusText: response.statusText,
        headers: response.headers.toJSON() });
}

async function callParallelTool(name, args, signal, timeout) {
    // 每次调用独立连接，连接生命周期不拥有 conversation/session_id。
    const client = new Client({ name: 'my-neuro', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
        requestInit: { headers: { 'User-Agent': USER_AGENT } },
        // 取消信号也覆盖响应正文流，不能在收到响应头时就移除监听。
        fetch: (url, init) => nodeHttpFetch(url, {
            ...init,
            signal: AbortSignal.any([signal, init?.signal].filter(Boolean))
        })
    });
    const options = { signal, timeout };
    try {
        await client.connect(transport, options);
        const tools = await client.listTools({}, options);
        if (!tools.tools.some(tool => tool.name === name)) {
            throw new Error(`Parallel 未提供工具: ${name}`);
        }
        const result = await client.callTool({ name, arguments: args }, undefined, options);
        const text = (result.content || []).filter(item => item.type === 'text')
            .map(item => item.text).join('\n');
        if (result.isError) throw new Error(text || 'Parallel 工具调用失败');
        return text || '未找到相关结果。';
    } finally {
        await client.close().catch(() => {});
    }
}

module.exports = { callParallelTool };
