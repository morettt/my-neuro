const { Plugin } = require('../../../js/core/plugin-base.js');
const fs = require('fs');
const path = require('path');

class NotePlugin extends Plugin {

    async onInit() {
        const cfg = this.context.getPluginFileConfig();
        const fileName = cfg.memory_file?.value || cfg.memory_file || '用户记忆.json';
        this._memoryFile = path.join(process.cwd(), fileName);
    }

    getTools() {
        return [
            { type: 'function', function: { name: 'record_memory', description: '记录用户的核心记忆，包括个人信息（年龄、经历、偏好等）和日程安排', parameters: { type: 'object', properties: { content: { type: 'string', description: '要记录的内容' } }, required: ['content'] } } },
            { type: 'function', function: { name: 'read_memory', description: '读取用户记忆记录，会显示带ID的列表', parameters: { type: 'object', properties: { count: { type: 'number', description: '读取最近的N条记录，不传或传0则读取全部' } }, required: [] } } },
            { type: 'function', function: { name: 'delete_memory', description: '删除指定ID的记录', parameters: { type: 'object', properties: { id: { type: 'number', description: '要删除的记录ID' } }, required: ['id'] } } },
            { type: 'function', function: { name: 'search_memory', description: '搜索包含指定关键词的记忆记录', parameters: { type: 'object', properties: { keyword: { type: 'string', description: '搜索关键词' } }, required: ['keyword'] } } }
        ];
    }

    async executeTool(name, params) {
        switch (name) {
            case 'record_memory': return await this._recordMemory(params);
            case 'read_memory':   return await this._readMemory(params);
            case 'delete_memory': return await this._deleteMemory(params);
            case 'search_memory': return await this._searchMemory(params);
            default: throw new Error(`[note] 不支持的工具: ${name}`);
        }
    }

    _load() {
        try {
            if (!fs.existsSync(this._memoryFile)) return [];
            const content = fs.readFileSync(this._memoryFile, 'utf8');
            return content.trim() ? JSON.parse(content) : [];
        } catch { return []; }
    }

    _save(memories) {
        fs.writeFileSync(this._memoryFile, JSON.stringify(memories, null, 2), 'utf8');
    }

    _date() {
        const d = new Date();
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    }

    async _recordMemory({ content }) {
        if (!content?.trim()) return '⚠️ 记录内容不能为空';
        const memories = this._load();
        const newId = memories.length > 0 ? Math.max(...memories.map(m => m.id)) + 1 : 1;
        memories.push({ id: newId, date: this._date(), content });
        this._save(memories);
        return `✅ 已记录 (ID: ${newId})`;
    }

    async _readMemory({ count = 0 }) {
        const memories = this._load();
        if (memories.length === 0) return '⚠️ 还没有任何记录';
        const result = count > 0 && count < memories.length ? memories.slice(-count) : memories;
        return `📝 用户记忆（共 ${memories.length} 条）：\n\n${result.map(m => `${m.id}. [${m.date}] ${m.content}`).join('\n\n')}`;
    }

    async _deleteMemory({ id }) {
        const memories = this._load();
        const index = memories.findIndex(m => m.id === id);
        if (index === -1) return `⚠️ 找不到 ID 为 ${id} 的记录`;
        const deleted = memories.splice(index, 1)[0];
        this._save(memories);
        return `✅ 已删除记录 (ID: ${id})：\n[${deleted.date}] ${deleted.content}`;
    }

    async _searchMemory({ keyword }) {
        if (!keyword?.trim()) return '⚠️ 关键词不能为空';
        const memories = this._load();
        const results = memories.filter(m => m.content.includes(keyword) || m.date.includes(keyword));
        if (results.length === 0) return `⚠️ 没有找到包含 "${keyword}" 的记录`;
        return `🔍 搜索结果（共找到 ${results.length} 条）：\n\n${results.map(m => `${m.id}. [${m.date}] ${m.content}`).join('\n\n')}`;
    }
}

module.exports = NotePlugin;
