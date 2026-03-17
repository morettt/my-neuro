// plugins/community/llm-inspector/index.js
// LLM 抓包器：完整记录每次 LLM 请求和响应

const { Plugin } = require('../../../js/core/plugin-base.js');
const fs = require('fs');
const path = require('path');

// 日志文件路径
const LOG_FILE = path.join(__dirname, '..', '..', '..', '..', 'AI记录室', 'LLM抓包.jsonl');

// role 对应的显示前缀
const ROLE_LABEL = {
    system:    '📋 SYSTEM',
    user:      '👤 USER  ',
    assistant: '🤖 ASST  ',
    tool:      '🔧 TOOL  ',
};

class LLMInspectorPlugin extends Plugin {

    async onInit() {
        this._cfg = this.context.getPluginFileConfig();
        this._requestCount = 0;
    }

    async onStart() {
        if (!this._cfg.enabled) return;
        this.context.log('info', '🔍 LLM抓包器已启动');

        // 确保日志目录存在
        if (this._cfg.save_to_file) {
            const dir = path.dirname(LOG_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    async onLLMRequest(request) {
        if (!this._cfg.enabled) return;

        this._requestCount++;
        const reqId = this._requestCount;
        const timestamp = new Date().toISOString();
        const { messages = [], tools = [] } = request;

        // ── 终端摘要输出 ──────────────────────────────────
        if (this._cfg.log_to_terminal) {
            const maxLen = this._cfg.max_content_chars ?? 0;
            const divider = '─'.repeat(60);

            this.context.log('info', `\n${divider}`);
            this.context.log('info', `📡 LLM请求 #${reqId}  ${timestamp}`);
            this.context.log('info', `   消息数: ${messages.length}  工具数: ${tools.length}`);
            this.context.log('info', divider);

            for (const msg of messages) {
                const label = ROLE_LABEL[msg.role] || `[${msg.role}]`;
                let body = '';

                if (typeof msg.content === 'string') {
                    body = (maxLen > 0 && msg.content.length > maxLen)
                        ? msg.content.slice(0, maxLen) + `…(共${msg.content.length}字)`
                        : msg.content;
                } else if (Array.isArray(msg.content)) {
                    // 多模态内容（含图片）
                    const parts = msg.content.map(p => {
                        if (p.type === 'text') {
                            const t = p.text || '';
                            return (maxLen > 0 && t.length > maxLen) ? t.slice(0, maxLen) + '…' : t;
                        }
                        if (p.type === 'image_url') return '[图片]';
                        return `[${p.type}]`;
                    });
                    body = parts.join(' ');
                } else if (msg.content === null && msg.tool_calls) {
                    body = '(tool_calls)';
                }

                // tool_calls 附加信息
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    const calls = msg.tool_calls.map(tc => tc.function?.name || tc.id).join(', ');
                    body += `  ← 调用工具: [${calls}]`;
                }

                // tool 消息附加 tool_call_id
                if (msg.role === 'tool') {
                    body = `(id:${msg.tool_call_id}) ${body}`;
                }

                this.context.log('info', `  ${label} | ${body}`);
            }

            // 工具列表（仅名称）
            if (this._cfg.show_tools && tools.length > 0) {
                const toolNames = tools.map(t => t.name || t.function?.name || '?').join(', ');
                this.context.log('info', `  🛠️  TOOLS  | [${toolNames}]`);
            }

            this.context.log('info', divider);
        }

        // ── 写入文件（完整内容）────────────────────────────
        if (this._cfg.save_to_file) {
            const record = {
                type: 'request',
                id: reqId,
                timestamp,
                messages: messages.map(msg => this._serializeMessage(msg)),
                tools: tools.map(t => ({
                    name: t.name || t.function?.name,
                    description: t.description || t.function?.description
                }))
            };
            this._appendLine(record);
        }
    }

    async onLLMResponse(response) {
        if (!this._cfg.enabled) return;

        const timestamp = new Date().toISOString();
        const text = response.text || '';
        const maxLen = this._cfg.max_content_chars ?? 0;

        if (this._cfg.log_to_terminal) {
            const preview = (maxLen > 0 && text.length > maxLen)
                ? text.slice(0, maxLen) + `…(共${text.length}字)`
                : text;
            this.context.log('info', `  ✅ LLM响应 #${this._requestCount} | ${preview}`);
        }

        if (this._cfg.save_to_file) {
            const record = {
                type: 'response',
                id: this._requestCount,
                timestamp,
                text
            };
            this._appendLine(record);
        }
    }

    // ── 私有工具方法 ──────────────────────────────────────

    _serializeMessage(msg) {
        const out = { role: msg.role };

        if (typeof msg.content === 'string') {
            out.content = msg.content;
        } else if (Array.isArray(msg.content)) {
            out.content = msg.content.map(p => {
                if (p.type === 'image_url') return { type: 'image_url', url: '(base64省略)' };
                return p;
            });
        } else {
            out.content = msg.content;
        }

        if (msg.tool_calls) out.tool_calls = msg.tool_calls;
        if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
        if (msg.name) out.name = msg.name;

        return out;
    }

    _appendLine(record) {
        try {
            fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
        } catch (err) {
            this.context.log('warn', `抓包文件写入失败: ${err.message}`);
        }
    }
}

module.exports = LLMInspectorPlugin;
