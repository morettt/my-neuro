import https from 'node:https';

/**
 * 随机二次元图片工具 MCP 服务器。
 * 这里不用第三方依赖，避免用户未安装 live-2d/mcp/node_modules 时工具无法启动。
 */

const TOOL_NAME = 'get_random_acg_pic';

const toolDefinition = {
  name: 'get_random_acg_pic',
  description: '获取随机二次元图片',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['pc', 'wap'],
        default: 'pc',
        description: '图片类型: pc(电脑端) 或 wap(手机端)'
      }
    },
    additionalProperties: false
  }
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function readJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'my-neuro-mcp-random-acg-pic/1.0' } }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error(`响应不是有效JSON: ${error.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function getRandomAcgPic({ type = 'pc' } = {}) {
  const safeType = type === 'wap' ? 'wap' : 'pc';
  const data = await readJson(`https://v2.xxapi.cn/api/randomAcgPic?type=${safeType}`);
  const imageUrl = data?.data;

  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error(data?.msg || '接口未返回图片地址');
  }

  return imageUrl;
}

async function handleRequest(request) {
  const { id, method, params } = request;

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ACGPicServer', version: '1.0.0' }
    });
    return;
  }

  if (method === 'tools/list') {
    sendResult(id, { tools: [toolDefinition] });
    return;
  }

  if (method === 'tools/call') {
    if (params?.name !== TOOL_NAME) {
      sendError(id, -32601, `未知工具: ${params?.name || ''}`);
      return;
    }

    try {
      const imageUrl = await getRandomAcgPic(params.arguments || {});
      sendResult(id, { content: [{ type: 'text', text: imageUrl }] });
    } catch (error) {
      sendResult(id, { content: [{ type: 'text', text: `获取图片失败: ${error.message}` }] });
    }
    return;
  }

  if (id !== undefined) {
    sendError(id, -32601, `未知方法: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const request = JSON.parse(trimmed);
      handleRequest(request).catch((error) => {
        if (request.id !== undefined) sendError(request.id, -32603, error.message);
      });
    } catch (error) {
      sendError(null, -32700, `解析请求失败: ${error.message}`);
    }
  }
});
