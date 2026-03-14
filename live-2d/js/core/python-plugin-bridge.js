// python-plugin-bridge.js
// 将 Python 插件进程包装成标准 Plugin 接口
// 通过 stdin/stdout JSON 通信

const { spawn } = require('child_process');
const path = require('path');
const { Plugin } = require('./plugin-base.js');
const { logToTerminal } = require('../api-utils.js');

// Windows 用 python，其他平台用 python3
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

// plugin_sdk.py 所在目录（plugins/）
const SDK_DIR = path.join(__dirname, '..', '..', 'plugins');

class PythonPluginBridge extends Plugin {
    constructor(metadata, context, scriptPath) {
        super(metadata, context);
        this._scriptPath = scriptPath;
        this._process = null;
        this._pending = new Map();
        this._reqId = 0;
        this._buffer = '';
        this._tools = [];
        this._timeout = 10000;
    }

    // ===== 启动子进程 =====

    async _spawn() {
        return new Promise((resolve, reject) => {
            this._process = spawn(PYTHON_CMD, [this._scriptPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                    PYTHONPATH: SDK_DIR
                }
            });

            this._process.stdout.on('data', (data) => {
                this._buffer += data.toString('utf8');
                let idx;
                while ((idx = this._buffer.indexOf('\n')) !== -1) {
                    const line = this._buffer.slice(0, idx).trim();
                    this._buffer = this._buffer.slice(idx + 1);
                    if (line) this._handleLine(line);
                }
            });

            this._process.stderr.on('data', (data) => {
                logToTerminal('warn', `[Python:${this.metadata.name}] ${data.toString().trim()}`);
            });

            this._process.on('error', (err) => {
                logToTerminal('error', `[Python:${this.metadata.name}] 启动失败: ${err.message}`);
                reject(err);
            });

            this._process.on('exit', (code) => {
                for (const [, { reject }] of this._pending) {
                    reject(new Error('Python 进程已退出'));
                }
                this._pending.clear();
            });

            // 等进程启动
            setTimeout(resolve, 300);
        });
    }

    _handleLine(line) {
        try {
            const msg = JSON.parse(line);

            // 日志
            if (msg.type === 'log') {
                logToTerminal(msg.level || 'info', `[Python:${this.metadata.name}] ${msg.message}`);
                return;
            }
            // Python 主动让 AI 说话
            if (msg.type === 'sendMessage') {
                this.context?.sendMessage(msg.text).catch(() => {});
                return;
            }
            // Python 请求 JS 执行某个操作（get_messages / call_llm）
            if (msg.type === 'request') {
                this._handlePythonRequest(msg).catch(() => {});
                return;
            }
            // fire-and-forget：UI / 系统提示词 / 工具注册
            if (msg.type === 'showSubtitle') {
                this.context?.showSubtitle(msg.text, msg.duration);
                return;
            }
            if (msg.type === 'triggerEmotion') {
                this.context?.triggerEmotion(msg.emotion);
                return;
            }
            if (msg.type === 'addSystemPromptPatch') {
                this.context?.addSystemPromptPatch(msg.id, msg.text);
                return;
            }
            if (msg.type === 'removeSystemPromptPatch') {
                this.context?.removeSystemPromptPatch(msg.id);
                return;
            }
            if (msg.type === 'registerTool') {
                this.context?.registerTool(msg.toolDef);
                return;
            }
            // JS→Python 钩子调用的响应
            const pending = this._pending.get(msg.id);
            if (pending) {
                this._pending.delete(msg.id);
                msg.error ? pending.reject(new Error(msg.error)) : pending.resolve(msg);
            }
        } catch (e) {
            logToTerminal('warn', `[Python:${this.metadata.name}] 无效响应: ${line}`);
        }
    }

    _write(msg) {
        if (this._process?.stdin?.writable) {
            this._process.stdin.write(JSON.stringify(msg) + '\n');
        }
    }

    async _call(event, data) {
        if (!this._process || this._process.exitCode !== null) return null;

        return new Promise((resolve, reject) => {
            const id = ++this._reqId;
            this._pending.set(id, { resolve, reject });
            this._write({ id, event, data });

            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    reject(new Error(`超时: ${event}`));
                }
            }, this._timeout);
        });
    }

    async _handlePythonRequest(msg) {
        const { reqId, method, data } = msg;
        try {
            let result;
            if (method === 'getMessages') {
                result = this.context?.getMessages() || [];
            } else if (method === 'callLLM') {
                result = await this.context?.callLLM(data.prompt, data.options);
            } else {
                throw new Error(`未知方法: ${method}`);
            }
            this._write({ type: 'response', reqId, result });
        } catch (e) {
            this._write({ type: 'response', reqId, error: e.message });
        }
    }

    // ===== 生命周期 =====

    async onInit() {
        await this._spawn();
        const config = this.context?.getConfig() || {};
        const pluginFileConfig = this.context?.getPluginFileConfig() || {};
        await this._call('onInit', { config, pluginFileConfig });
        // 预加载工具列表（同步接口，需要提前缓存）
        const res = await this._call('getTools', {}).catch(() => null);
        this._tools = res?.tools || [];
    }

    async onStart() {
        await this._call('onStart', {}).catch(() => {});
    }

    async onStop() {
        await this._call('onStop', {}).catch(() => {});
        this._process?.stdin.end();
    }

    async onDestroy() {
        await this._call('onDestroy', {}).catch(() => {});
        if (this._process?.exitCode === null) this._process.kill();
    }

    // ===== 钩子 =====

    async onUserInput(event) {
        const res = await this._call('onUserInput', {
            text: event.text,
            source: event.source
        }).catch(() => null);

        for (const action of res?.actions || []) {
            if (action.type === 'addContext')     event.addContext(action.text);
            if (action.type === 'setText')        event.setText(action.text);
            if (action.type === 'preventDefault') event.preventDefault();
            if (action.type === 'stopPropagation') event.stopPropagation();
        }
    }

    async onLLMRequest(request) {
        const res = await this._call('onLLMRequest', {
            messages: request.messages
        }).catch(() => null);

        if (res?.messages) {
            request.messages.length = 0;
            request.messages.push(...res.messages);
        }
    }

    async onLLMResponse(response) {
        const res = await this._call('onLLMResponse', {
            text: response.text
        }).catch(() => null);

        if (typeof res?.text === 'string') response.text = res.text;
    }

    async onTTSText(text) {
        const res = await this._call('onTTSText', { text }).catch(() => null);
        return typeof res?.result === 'string' ? res.result : text;
    }

    async onTTSStart(text) {
        await this._call('onTTSStart', { text }).catch(() => {});
    }

    async onTTSEnd() {
        await this._call('onTTSEnd', {}).catch(() => {});
    }

    // ===== 工具 =====

    getTools() {
        return this._tools;
    }

    async executeTool(name, params) {
        const res = await this._call('executeTool', { name, params }).catch(() => null);
        return res?.result ?? '工具执行失败';
    }
}

module.exports = { PythonPluginBridge };
