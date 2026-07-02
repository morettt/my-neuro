const { Plugin } = require('../../../js/core/plugin-base.js');
const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '..', '..', '..', 'AI记录室', '核心用户记忆.txt');

class CoreMemoryInjector extends Plugin {

    async onInit() {
        this._watcher = null;
        this._cachedMemory = null;
    }

    async onStart() {
        this._loadMemory();
        this._watchFile();
        this.context.log('info', `核心记忆注入插件已启动，监听文件: ${MEMORY_FILE}`);
    }

    async onStop() {
        this._unwatchFile();
        this._cachedMemory = null;
    }

    /**
     * 每次 LLM 请求前，将核心记忆注入到 system 消息中。
     * 操作的是 deep copy 的 messagesForAPI，不会污染持久化的 messages。
     */
    async onLLMRequest(request) {
        if (!this._cachedMemory) return;

        const sysMsg = request.messages.find(m => m.role === 'system');
        if (sysMsg) {
            sysMsg.content += `\n\n【核心用户记忆 - 请务必牢记以下内容】\n${this._cachedMemory}`;
        }
    }

    // ===== 工具注册 =====

    getTools() {
        return [
            {
                type: 'function',
                function: {
                    name: 'core_memory_write',
                    description: '将重要信息写入核心记忆。当用户说"写入核心记忆"、"记到核心记忆里"、"这个要永远记住"等时使用。核心记忆是最高优先级的永久记忆，每次对话都会加载。',
                    parameters: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: '要写入核心记忆的内容，应简洁准确地概括要记住的信息' }
                        },
                        required: ['content']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'core_memory_list',
                    description: '查看当前所有核心记忆条目。在写入新记忆前可以先查看已有内容，避免重复。',
                    parameters: {
                        type: 'object',
                        properties: {},
                        required: []
                    }
                }
            }
        ];
    }

    async executeTool(name, params) {
        switch (name) {
            case 'core_memory_write':
                return this._writeMemory(params.content);
            case 'core_memory_list':
                return this._listMemories();
            default:
                return undefined;
        }
    }

    // ===== 工具执行 =====

    _writeMemory(content) {
        if (!content) return '错误：未提供要写入的内容。';
        try {
            const dir = path.dirname(MEMORY_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const timestamp = this._getTimestamp();
            const entry = `[${timestamp}] ${content}\n`;
            fs.appendFileSync(MEMORY_FILE, entry, 'utf-8');
            this._loadMemory();
            this.context.log('info', `核心记忆已写入: ${content}`);
            return `已成功写入核心记忆: ${content}`;
        } catch (e) {
            this.context.log('error', `写入核心记忆失败: ${e.message}`);
            return `写入核心记忆失败: ${e.message}`;
        }
    }

    _listMemories() {
        try {
            if (!fs.existsSync(MEMORY_FILE)) return '当前没有核心记忆。';
            const raw = fs.readFileSync(MEMORY_FILE, 'utf-8').trim();
            if (!raw) return '当前没有核心记忆。';

            const entries = raw.split(/\n+/).filter(line => line.trim());
            if (entries.length === 0) return '当前没有核心记忆。';

            const list = entries.map((entry, i) => `${i + 1}. ${entry}`).join('\n');
            return `当前共 ${entries.length} 条核心记忆：\n${list}`;
        } catch (e) {
            return `读取核心记忆失败: ${e.message}`;
        }
    }

    _getTimestamp() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    // ===== 记忆文件读取与监听 =====

    _loadMemory() {
        try {
            if (!fs.existsSync(MEMORY_FILE)) {
                this.context.log('warn', '核心用户记忆.txt 不存在，跳过加载');
                this._cachedMemory = null;
                return;
            }
            const raw = fs.readFileSync(MEMORY_FILE, 'utf-8').trim();
            if (!raw) {
                this.context.log('warn', '核心用户记忆.txt 为空，跳过加载');
                this._cachedMemory = null;
                return;
            }
            this._cachedMemory = raw;
            this.context.log('info', `核心记忆已加载，长度: ${raw.length} 字符`);
        } catch (e) {
            this.context.log('error', `读取核心记忆失败: ${e.message}`);
            this._cachedMemory = null;
        }
    }

    _watchFile() {
        try {
            const dir = path.dirname(MEMORY_FILE);
            const base = path.basename(MEMORY_FILE);
            this._watcher = fs.watch(dir, (eventType, filename) => {
                if (filename === base) {
                    clearTimeout(this._debounce);
                    this._debounce = setTimeout(() => {
                        this.context.log('info', '核心记忆文件已变更，重新加载...');
                        this._loadMemory();
                    }, 1000);
                }
            });
        } catch (e) {
            this.context.log('warn', `无法监听记忆文件变更: ${e.message}`);
        }
    }

    _unwatchFile() {
        if (this._watcher) {
            this._watcher.close();
            this._watcher = null;
        }
        clearTimeout(this._debounce);
    }
}

module.exports = CoreMemoryInjector;
