const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const ENDPOINT = 'https://search.parallel.ai/mcp';
const USER_AGENT = 'my-neuro/1.0 (https://github.com/morettt/my-neuro)';

async function callParallelTool(name, args, signal, timeout) {
    // 每次调用独立连接，连接生命周期不拥有 conversation/session_id。
    const client = new Client({ name: 'my-neuro', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
        requestInit: { headers: { 'User-Agent': USER_AGENT } },
        // 取消信号也覆盖响应正文流，不能在收到响应头时就移除监听。
        fetch: (url, init) => fetch(url, {
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
