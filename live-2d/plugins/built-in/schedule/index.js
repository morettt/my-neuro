const { Plugin } = require('../../../js/core/plugin-base.js');
const fs = require('fs');
const path = require('path');

class SchedulePlugin extends Plugin {

    async onInit() {
        const cfg = this.context.getPluginFileConfig();
        const fileName = cfg.schedule_file?.value || cfg.schedule_file || '日程表.json';
        this._scheduleFile = path.join(process.cwd(), fileName);
        const dir = path.dirname(this._scheduleFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    getTools() {
        return [
            {
                type: 'function',
                function: {
                    name: 'add_schedule',
                    description: '添加一条日程。用户告诉你要做什么事、什么时候做，就用这个工具记下来。time 字段尽量填写，没有具体时间可填"待定"。',
                    parameters: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: '日程标题，简短描述要做的事' },
                            time:  { type: 'string', description: '时间，如 "明天下午3点"、"2026-04-05 14:00"、"待定" 等' },
                            note:  { type: 'string', description: '备注（可选），补充说明' }
                        },
                        required: ['title', 'time']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_schedule',
                    description: '查看日程列表。可以过滤只看未完成的、或全部。',
                    parameters: {
                        type: 'object',
                        properties: {
                            filter: {
                                type: 'string',
                                enum: ['all', 'pending', 'done'],
                                description: '过滤条件：all=全部，pending=未完成，done=已完成。默认 pending。'
                            }
                        },
                        required: []
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'complete_schedule',
                    description: '将指定 ID 的日程标记为已完成。用户说"做完了"、"搞定了"之类的话时使用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            id: { type: 'number', description: '要标记完成的日程 ID' }
                        },
                        required: ['id']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'delete_schedule',
                    description: '删除指定 ID 的日程。彻底移除，不保留记录。',
                    parameters: {
                        type: 'object',
                        properties: {
                            id: { type: 'number', description: '要删除的日程 ID' }
                        },
                        required: ['id']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'search_schedule',
                    description: '按关键词搜索日程。',
                    parameters: {
                        type: 'object',
                        properties: {
                            keyword: { type: 'string', description: '搜索关键词' }
                        },
                        required: ['keyword']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'edit_schedule',
                    description: '修改指定 ID 日程的标题、时间或备注。只传需要修改的字段即可。',
                    parameters: {
                        type: 'object',
                        properties: {
                            id:    { type: 'number', description: '要修改的日程 ID' },
                            title: { type: 'string', description: '新标题（可选）' },
                            time:  { type: 'string', description: '新时间（可选）' },
                            note:  { type: 'string', description: '新备注（可选）' }
                        },
                        required: ['id']
                    }
                }
            }
        ];
    }

    async executeTool(name, params) {
        switch (name) {
            case 'add_schedule':      return await this._add(params);
            case 'list_schedule':     return await this._list(params);
            case 'complete_schedule': return await this._complete(params);
            case 'delete_schedule':   return await this._delete(params);
            case 'search_schedule':   return await this._search(params);
            case 'edit_schedule':     return await this._edit(params);
            default: throw new Error(`[schedule] 不支持的工具: ${name}`);
        }
    }

    _load() {
        try {
            if (!fs.existsSync(this._scheduleFile)) return [];
            const content = fs.readFileSync(this._scheduleFile, 'utf8');
            return content.trim() ? JSON.parse(content) : [];
        } catch { return []; }
    }

    _save(list) {
        fs.writeFileSync(this._scheduleFile, JSON.stringify(list, null, 2), 'utf8');
    }

    _today() {
        const d = new Date();
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    }

    _nextId(list) {
        return list.length > 0 ? Math.max(...list.map(s => s.id)) + 1 : 1;
    }

    _fmt(item) {
        const status = item.done ? '✅' : '⏳';
        const note = item.note ? `  备注：${item.note}` : '';
        return `${status} [ID:${item.id}] ${item.title}  🕐 ${item.time}${note}`;
    }

    async _add({ title, time, note }) {
        if (!title?.trim()) return '⚠️ 日程标题不能为空';
        const list = this._load();
        const item = {
            id: this._nextId(list),
            title: title.trim(),
            time: time?.trim() || '待定',
            note: note?.trim() || '',
            done: false,
            created_at: this._today()
        };
        list.push(item);
        this._save(list);
        return `✅ 日程已记录 (ID: ${item.id})\n${this._fmt(item)}`;
    }

    async _list({ filter = 'pending' } = {}) {
        const list = this._load();
        if (list.length === 0) return '⚠️ 还没有任何日程';

        let filtered;
        if (filter === 'done')    filtered = list.filter(s => s.done);
        else if (filter === 'all') filtered = list;
        else                       filtered = list.filter(s => !s.done);

        if (filtered.length === 0) {
            const label = filter === 'done' ? '已完成' : '未完成';
            return `⚠️ 没有${label}的日程`;
        }

        const label = filter === 'done' ? '已完成' : filter === 'all' ? '全部' : '未完成';
        return `📅 日程列表（${label}，共 ${filtered.length} 条）：\n\n${filtered.map(s => this._fmt(s)).join('\n')}`;
    }

    async _complete({ id }) {
        const list = this._load();
        const item = list.find(s => s.id === id);
        if (!item) return `⚠️ 找不到 ID 为 ${id} 的日程`;
        if (item.done) return `⚠️ ID ${id} 的日程已经是完成状态了`;
        item.done = true;
        item.done_at = this._today();
        this._save(list);
        return `✅ 已完成：${item.title}（ID: ${id}）`;
    }

    async _delete({ id }) {
        const list = this._load();
        const index = list.findIndex(s => s.id === id);
        if (index === -1) return `⚠️ 找不到 ID 为 ${id} 的日程`;
        const deleted = list.splice(index, 1)[0];
        this._save(list);
        return `🗑️ 已删除：${deleted.title}（ID: ${id}）`;
    }

    async _search({ keyword }) {
        if (!keyword?.trim()) return '⚠️ 关键词不能为空';
        const list = this._load();
        const results = list.filter(s =>
            s.title.includes(keyword) ||
            s.time.includes(keyword) ||
            (s.note && s.note.includes(keyword))
        );
        if (results.length === 0) return `⚠️ 没有找到包含"${keyword}"的日程`;
        return `🔍 搜索结果（共 ${results.length} 条）：\n\n${results.map(s => this._fmt(s)).join('\n')}`;
    }

    async _edit({ id, title, time, note }) {
        const list = this._load();
        const item = list.find(s => s.id === id);
        if (!item) return `⚠️ 找不到 ID 为 ${id} 的日程`;
        if (title !== undefined) item.title = title.trim();
        if (time  !== undefined) item.time  = time.trim();
        if (note  !== undefined) item.note  = note.trim();
        this._save(list);
        return `✏️ 已更新（ID: ${id}）\n${this._fmt(item)}`;
    }
}

module.exports = SchedulePlugin;
