const axios = require('axios');
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// ==================== 工具定义 ====================

const TOOL_DEFINITIONS = [
    {
        name: 'memos_search_memory',
        description: "从AI的长期记忆系统中深度搜索相关的历史信息和对话。当用户询问'你还记得吗'、'之前说过'、'上次'、'以前'、'有没有'、'记不记得'等涉及过去事件的问题时必须使用此工具！也可用于主动搜索用户的偏好、经历、约定等。",
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: "搜索查询语句。【重要】必须使用完整的自然语言句子，不要只用单个词！例如：'用户喜欢吃什么'、'用户玩过什么游戏'、'关于炸串的记忆'。" },
                top_k: { type: 'integer', description: '返回最相关的记忆数量，默认5条' }
            },
            required: ['query']
        }
    },
    {
        name: 'memos_add_memory',
        description: "手动添加重要信息到AI的长期记忆系统。当用户明确说'记住这个'、'别忘了'、'帮我记一下'、'以后记得'等时使用。也可用于主动记录用户透露的重要信息（如生日、喜好、重要事件等）。",
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '要记住的内容，应该简洁明了' }
            },
            required: ['content']
        }
    },
    {
        name: 'memos_upload_image',
        description: "将图片保存到AI的长期记忆系统。当用户说'帮我记住这张图'、'保存这张图片'等时使用。",
        parameters: {
            type: 'object',
            properties: {
                image_base64: { type: 'string', description: '图片的 base64 编码数据（不含 data:image/xxx;base64, 前缀）' },
                description: { type: 'string', description: '图片的描述或标题，用于后续搜索' },
                image_type: { type: 'string', description: '图片类型：screenshot、photo、artwork、document、other', enum: ['screenshot', 'photo', 'artwork', 'document', 'other'] },
                tags: { type: 'array', items: { type: 'string' }, description: '图片的标签，用于分类和搜索' }
            },
            required: ['image_base64', 'description']
        }
    },
    {
        name: 'memos_search_images',
        description: "从AI的图片记忆中搜索相关图片。当用户问'之前那张图呢'、'找一下猫的图片'等时使用。",
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索查询，描述想要找的图片内容' },
                image_type: { type: 'string', description: '可选，限定图片类型', enum: ['screenshot', 'photo', 'artwork', 'document', 'other'] },
                top_k: { type: 'integer', description: '返回数量，默认5' }
            },
            required: ['query']
        }
    },
    {
        name: 'memos_save_screenshot',
        description: "截取当前屏幕并保存到AI的长期记忆系统。当用户说'帮我记住当前屏幕'、'保存这个截图'等时使用。此工具会自动截图并保存。",
        parameters: {
            type: 'object',
            properties: {
                description: { type: 'string', description: '【必填】截图的描述或标题，用于后续搜索和识别' },
                tags: { type: 'array', items: { type: 'string' }, description: '截图的标签，用于分类和搜索' }
            },
            required: ['description']
        }
    },
    {
        name: 'memos_save_image_from_file',
        description: "将电脑上的图片文件保存到AI的长期记忆系统。支持 JPG、PNG、GIF、WEBP 等常见图片格式。",
        parameters: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '【必填】图片文件的完整路径' },
                description: { type: 'string', description: '【必填】图片的描述或标题' },
                image_type: { type: 'string', description: '图片类型', enum: ['photo', 'artwork', 'document', 'screenshot', 'other'] },
                tags: { type: 'array', items: { type: 'string' }, description: '图片的标签' }
            },
            required: ['file_path', 'description']
        }
    },
    {
        name: 'memos_record_tool_usage',
        description: '记录工具使用情况到记忆系统。在执行重要的工具调用后自动调用，以便后续回顾。',
        parameters: {
            type: 'object',
            properties: {
                tool_name: { type: 'string', description: '工具名称' },
                parameters: { type: 'object', description: '调用工具时使用的参数' },
                result_summary: { type: 'string', description: '工具执行结果的简短摘要' },
                category: { type: 'string', description: '工具类别', enum: ['search', 'media', 'utility', 'game', 'other'] }
            },
            required: ['tool_name', 'result_summary']
        }
    },
    {
        name: 'memos_search_tool_usage',
        description: "搜索之前的工具使用记录。当用户问'之前搜过什么'、'上次播放的音乐'等时使用。",
        parameters: {
            type: 'object',
            properties: {
                tool_name: { type: 'string', description: '可选，限定工具名称' },
                keyword: { type: 'string', description: '可选，搜索关键词' },
                limit: { type: 'integer', description: '返回数量，默认10' }
            },
            required: []
        }
    },
    {
        name: 'memos_import_url',
        description: "将网页内容导入到AI的长期记忆系统。当用户说'帮我记住这个网页'、'把这个链接保存下来'等时使用。",
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '要导入的网页 URL（http 或 https 开头）' },
                tags: { type: 'array', items: { type: 'string' }, description: '可选标签，用于分类和后续搜索' }
            },
            required: ['url']
        }
    },
    {
        name: 'memos_import_document',
        description: "将文档导入到AI的长期记忆系统。支持 txt、pdf、md 格式。",
        parameters: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文档的本地路径，支持 .txt、.pdf、.md 格式' },
                tags: { type: 'array', items: { type: 'string' }, description: '可选标签，用于分类' }
            },
            required: ['file_path']
        }
    },
    {
        name: 'memos_correct_memory',
        description: "修正、补充或删除已有的记忆。需要先用 memos_search_memory 找到记忆ID。",
        parameters: {
            type: 'object',
            properties: {
                memory_id: { type: 'string', description: '要修正的记忆 ID（通过搜索获取）' },
                action: { type: 'string', description: '操作类型', enum: ['correct', 'supplement', 'delete'] },
                new_content: { type: 'string', description: '修正后的内容或要补充的内容（删除时不需要）' },
                reason: { type: 'string', description: '可选，修正或删除的原因' }
            },
            required: ['memory_id', 'action']
        }
    },
    {
        name: 'memos_get_preferences',
        description: "获取用户的偏好摘要和详细列表。推荐食物、音乐等时使用，也可回答'我喜欢什么'等问题。",
        parameters: {
            type: 'object',
            properties: {
                category: { type: 'string', description: '可选，只查看特定类别的偏好', enum: ['food', 'music', 'game', 'movie', 'hobby', 'style', 'schedule', 'general'] },
                include_details: { type: 'boolean', description: '是否包含详细偏好列表，默认 true' }
            },
            required: []
        }
    }
];

// ==================== 工具执行 ====================

class MemosTools {
    constructor(apiUrl, options = {}) {
        this.apiUrl = apiUrl;
        this.similarityThreshold = options.similarityThreshold ?? 0.6;
    }

    getDefinitions() {
        return TOOL_DEFINITIONS.map(def => ({
            type: 'function',
            function: {
                name: def.name,
                description: def.description,
                parameters: def.parameters
            }
        }));
    }

    async execute(name, params) {
        const handler = this._handlers[name];
        if (!handler) throw new Error(`[MemOS] 不支持此功能: ${name}`);
        return handler.call(this, params);
    }

    get _handlers() {
        return {
            memos_search_memory: this._searchMemory,
            memos_add_memory: this._addMemory,
            memos_upload_image: this._uploadImage,
            memos_search_images: this._searchImages,
            memos_save_screenshot: this._saveScreenshot,
            memos_save_image_from_file: this._saveImageFromFile,
            memos_record_tool_usage: this._recordToolUsage,
            memos_search_tool_usage: this._searchToolUsage,
            memos_import_url: this._importUrl,
            memos_import_document: this._importDocument,
            memos_correct_memory: this._correctMemory,
            memos_get_preferences: this._getPreferences,
        };
    }

    // ---------- helpers ----------

    _formatTime(ts) {
        if (!ts) return '';
        try {
            const d = new Date(ts);
            if (isNaN(d.getTime())) return typeof ts === 'string' ? ts : String(ts);
            return d.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        } catch (_) {
            return typeof ts === 'string' ? ts : String(ts);
        }
    }

    _connRefused(error) {
        return error.code === 'ECONNREFUSED' ? '记忆系统服务未启动。' : null;
    }

    // ---------- 基础记忆 ----------

    async _searchMemory({ query, top_k = 5 }) {
        if (!query) return '错误：未提供搜索查询 (query)。';
        try {
            const { data } = await axios.post(`${this.apiUrl}/search`, {
                query, top_k, user_id: 'feiniu_default',
                similarity_threshold: this.similarityThreshold
            }, { timeout: 5000 });
            const memories = data.memories || [];
            if (memories.length === 0) return `在记忆中没有找到关于"${query}"的相关信息。`;

            const lines = memories.map((mem, i) => {
                const content = typeof mem === 'string' ? mem : mem.content;
                const pl = mem && typeof mem.payload === 'object' && mem.payload ? mem.payload : null;
                const rawCreated = mem.created_at || mem.timestamp || (pl && (pl.created_at || pl.timestamp));
                const rawUpdated = mem.updated_at || (pl && pl.updated_at);
                const timeStr = this._formatTime(rawCreated);
                const updateMark = (rawUpdated && rawUpdated !== rawCreated) ? '（已更新）' : '';
                const idTag = mem.id ? ` [ID: ${mem.id}]` : '';
                return timeStr ? `${i + 1}. ${content} 【${timeStr}】${updateMark}${idTag}` : `${i + 1}. ${content}${idTag}`;
            });
            return `找到 ${memories.length} 条相关记忆：\n${lines.join('\n')}`;
        } catch (error) {
            return this._connRefused(error) || `搜索记忆时出错: ${error.message}`;
        }
    }

    async _addMemory({ content }) {
        if (!content) return '错误：未提供要记住的内容 (content)。';
        try {
            await axios.post(`${this.apiUrl}/add`, { messages: [{ role: 'user', content }], user_id: 'feiniu_default' }, { timeout: 60000 });
            return `已成功记住: ${content}`;
        } catch (error) {
            return this._connRefused(error) || `添加记忆时出错: ${error.message}`;
        }
    }

    // ---------- 图片记忆 ----------

    async _uploadImage({ image_base64, description, image_type = 'other', tags = [] }) {
        if (!image_base64) return '错误：未提供图片数据 (image_base64)。';
        if (!description) return '错误：未提供图片描述 (description)。';
        try {
            const { data } = await axios.post(`${this.apiUrl}/images/upload`, { image_base64, description, image_type, tags, user_id: 'feiniu_default' }, { timeout: 30000 });
            return `已成功保存图片「${description}」，图片ID: ${data.image_id || '已生成'}`;
        } catch (error) {
            return this._connRefused(error) || `保存图片时出错: ${error.message}`;
        }
    }

    async _searchImages({ query, image_type, top_k = 5 }) {
        if (!query) return '错误：未提供搜索查询 (query)。';
        try {
            const reqData = { query, top_k, user_id: 'feiniu_default' };
            if (image_type) reqData.image_type = image_type;
            const { data } = await axios.post(`${this.apiUrl}/images/search`, reqData, { timeout: 10000 });
            const images = data.images || [];
            if (images.length === 0) return `没有找到关于「${query}」的图片记忆。`;

            const lines = images.map((img, i) => {
                const desc = img.description || '无描述';
                const type = img.image_type || 'unknown';
                const time = img.created_at ? new Date(img.created_at).toLocaleDateString('zh-CN') : '';
                const t = img.tags?.length > 0 ? `[${img.tags.join(', ')}]` : '';
                return `${i + 1}. 【${type}】${desc} ${t}${time ? ` (${time})` : ''}`;
            });
            return `找到 ${images.length} 张相关图片：\n${lines.join('\n')}`;
        } catch (error) {
            return this._connRefused(error) || `搜索图片时出错: ${error.message}`;
        }
    }

    async _saveScreenshot({ description, tags = [] }) {
        if (!description) return '错误：未提供截图描述 (description)。';
        try {
            const base64Image = await ipcRenderer.invoke('take-screenshot');
            if (!base64Image) return '错误：截图失败，未能获取屏幕图像。';

            const { data } = await axios.post(`${this.apiUrl}/images/upload`, {
                image_base64: base64Image, description, image_type: 'screenshot', tags, user_id: 'feiniu_default'
            }, { timeout: 30000 });
            return `已成功截取屏幕并保存到记忆！\n描述：${description}\n图片ID：${data.image_id || '已生成'}`;
        } catch (error) {
            if (error.message?.includes('invoke')) return '截图功能不可用，可能是 Electron 环境问题。';
            return this._connRefused(error) || `保存截图时出错: ${error.message}`;
        }
    }

    async _saveImageFromFile({ file_path, description, image_type = 'photo', tags = [] }) {
        if (!file_path) return '错误：未提供图片文件路径 (file_path)。';
        if (!description) return '错误：未提供图片描述 (description)。';
        try {
            if (!fs.existsSync(file_path)) return `错误：文件不存在: ${file_path}`;
            const ext = path.extname(file_path).toLowerCase();
            const supported = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
            if (!supported.includes(ext)) return `错误：不支持的图片格式 (${ext})。支持：${supported.join(', ')}`;

            const imageBuffer = fs.readFileSync(file_path);
            const base64Image = imageBuffer.toString('base64');
            const filename = path.basename(file_path);

            const { data } = await axios.post(`${this.apiUrl}/images/upload`, {
                image_base64: base64Image, filename, description, image_type, tags, user_id: 'feiniu_default'
            }, { timeout: 30000 });
            return `已成功保存图片到记忆！\n文件：${filename}\n描述：${description}\n图片ID：${data.image_id || '已生成'}`;
        } catch (error) {
            if (error.code === 'ENOENT') return `错误：无法读取文件: ${file_path}`;
            return this._connRefused(error) || `保存图片时出错: ${error.message}`;
        }
    }

    // ---------- 工具使用记录 ----------

    async _recordToolUsage({ tool_name, parameters: toolParams = {}, result_summary, category = 'other' }) {
        if (!tool_name) return '错误：未提供工具名称 (tool_name)。';
        if (!result_summary) return '错误：未提供结果摘要 (result_summary)。';
        try {
            await axios.post(`${this.apiUrl}/tools/record`, { tool_name, parameters: toolParams, result_summary, category, user_id: 'feiniu_default' }, { timeout: 5000 });
            return `已记录工具「${tool_name}」的使用`;
        } catch (error) {
            return this._connRefused(error) || `记录工具使用时出错: ${error.message}`;
        }
    }

    async _searchToolUsage({ tool_name, keyword, limit = 10 }) {
        try {
            const { data } = await axios.get(`${this.apiUrl}/tools/recent`, { params: { tool_name: tool_name || undefined, limit }, timeout: 5000 });
            let records = data.records || [];
            if (keyword && records.length > 0) {
                const kw = keyword.toLowerCase();
                records = records.filter(r =>
                    r.tool_name?.toLowerCase().includes(kw) ||
                    r.result_summary?.toLowerCase().includes(kw) ||
                    (r.parameters && JSON.stringify(r.parameters).toLowerCase().includes(kw))
                );
            }
            if (records.length === 0) {
                const hints = [tool_name && `工具「${tool_name}」`, keyword && `关键词「${keyword}」`].filter(Boolean);
                return hints.length > 0 ? `没有找到匹配 ${hints.join('、')} 的工具使用记录。` : '没有找到工具使用记录。';
            }

            const lines = records.map((r, i) => {
                const name = r.tool_name || 'unknown';
                const summary = r.result_summary || '无摘要';
                const time = r.timestamp ? new Date(r.timestamp).toLocaleString('zh-CN') : '';
                let p = '';
                if (r.parameters) {
                    const paramStr = JSON.stringify(r.parameters);
                    p = paramStr.length > 50 ? ` (参数: ${paramStr.substring(0, 50)}...)` : ` (参数: ${paramStr})`;
                }
                return `${i + 1}. 【${name}】${summary}${p}${time ? ` - ${time}` : ''}`;
            });
            return `找到 ${records.length} 条工具使用记录：\n${lines.join('\n')}`;
        } catch (error) {
            return this._connRefused(error) || `搜索工具记录时出错: ${error.message}`;
        }
    }

    // ---------- 知识库导入 ----------

    async _importUrl({ url, tags = [] }) {
        if (!url) return '错误：未提供网页 URL。';
        if (!url.startsWith('http://') && !url.startsWith('https://')) return '错误：URL 必须以 http:// 或 https:// 开头。';
        try {
            const { data } = await axios.post(`${this.apiUrl}/kb/import`, { source: url, tags: ['web', ...tags], user_id: 'feiniu_default' }, { timeout: 60000 });
            if (data.status === 'success') return `已成功导入网页内容！\n- URL: ${url}\n- 分块数: ${data.chunks_count || 0}\n- 导入记忆: ${data.imported_count || 0} 条`;
            return `导入失败: ${data.message || '未知错误'}`;
        } catch (error) {
            if (error.response?.status === 503) return '文档加载器未初始化，无法导入网页。';
            return this._connRefused(error) || `导入网页时出错: ${error.message}`;
        }
    }

    async _importDocument({ file_path, tags = [] }) {
        if (!file_path) return '错误：未提供文档路径。';
        try {
            if (!file_path.startsWith('http://') && !file_path.startsWith('https://')) {
                if (!fs.existsSync(file_path)) return `错误：文件不存在: ${file_path}`;
                const ext = path.extname(file_path).toLowerCase();
                const supported = ['.txt', '.pdf', '.md'];
                if (!supported.includes(ext)) return `错误：不支持的文档格式 (${ext})。支持：${supported.join(', ')}`;
            }
            const { data } = await axios.post(`${this.apiUrl}/kb/import`, { source: file_path, tags: ['document', ...tags], user_id: 'feiniu_default' }, { timeout: 120000 });
            if (data.status === 'success') return `已成功导入文档！\n- 路径: ${file_path}\n- 分块数: ${data.chunks_count || 0}\n- 导入记忆: ${data.imported_count || 0} 条`;
            return `导入失败: ${data.message || '未知错误'}`;
        } catch (error) {
            if (error.response?.status === 503) return '文档加载器未初始化，无法导入文档。';
            return this._connRefused(error) || `导入文档时出错: ${error.message}`;
        }
    }

    // ---------- 记忆修正 ----------

    async _correctMemory({ memory_id, action, new_content, reason }) {
        if (!memory_id) return '错误：未提供记忆 ID。请先使用 memos_search_memory 搜索并获取记忆 ID。';
        if (!action) return '错误：未指定操作类型。可选：correct、supplement、delete';
        if ((action === 'correct' || action === 'supplement') && !new_content) {
            return `错误：${action === 'correct' ? '修正' : '补充'}操作需要提供 new_content。`;
        }
        try {
            const reqData = { memory_id, feedback_type: action, reason: reason || '', user_id: 'feiniu_default' };
            if (action === 'correct' || action === 'supplement') reqData.correction = new_content;

            const { data } = await axios.post(`${this.apiUrl}/memory/feedback`, reqData, { timeout: 10000 });
            if (data.status === 'success') {
                const actionName = { correct: '修正', supplement: '补充', delete: '删除' }[action] || action;
                if (action === 'delete') return `已成功删除记忆 (ID: ${memory_id})`;
                return `已成功${actionName}记忆！\n- ID: ${memory_id}\n- 新内容: ${data.new_content || new_content}`;
            }
            return `操作失败: ${data.message || '未知错误'}`;
        } catch (error) {
            if (error.response?.status === 404) return `记忆 ID「${memory_id}」不存在，请确认 ID 是否正确。`;
            return this._connRefused(error) || `修正记忆时出错: ${error.message}`;
        }
    }

    // ---------- 偏好查询 ----------

    async _getPreferences({ category, include_details = true }) {
        try {
            const summaryParams = { user_id: 'feiniu_default' };
            if (category) summaryParams.category = category;
            const { data: summaryData } = await axios.get(`${this.apiUrl}/preferences/summary`, { params: summaryParams, timeout: 5000 });
            const summary = summaryData.summary || {};

            let preferences = [];
            if (include_details) {
                const listParams = { user_id: 'feiniu_default' };
                if (category) listParams.category = category;
                const { data: listData } = await axios.get(`${this.apiUrl}/preferences`, { params: listParams, timeout: 5000 });
                preferences = listData.preferences || [];
            }

            const totalCount = summary.total_count || 0;
            if (totalCount === 0) return '目前没有记录用户的偏好信息。';

            const result = [`用户偏好摘要：共 ${totalCount} 个偏好，涉及 ${summary.category_count || 0} 个类别`];

            const categories = summary.categories || {};
            if (Object.keys(categories).length > 0) {
                const catLabels = { food: '食物', music: '音乐', game: '游戏', movie: '电影', hobby: '爱好', style: '风格', schedule: '日程', general: '一般' };
                result.push('类别分布: ' + Object.entries(categories).map(([c, n]) => `${catLabels[c] || c}: ${n}`).join(', '));
            }

            if (include_details && preferences.length > 0) {
                result.push('\n偏好详情:');
                const likes = preferences.filter(p => (p.preference_type || p.type) === 'like');
                const dislikes = preferences.filter(p => (p.preference_type || p.type) === 'dislike');

                if (likes.length > 0) {
                    result.push('喜欢:');
                    likes.slice(0, 10).forEach((p, i) => {
                        const conf = ((p.confidence || p.strength || 0.8) * 100).toFixed(0);
                        result.push(`  ${i + 1}. ${p.item || p.name || '未知'} [${p.category || 'general'}] (置信度: ${conf}%)`);
                    });
                    if (likes.length > 10) result.push(`  ... 还有 ${likes.length - 10} 个`);
                }
                if (dislikes.length > 0) {
                    result.push('不喜欢:');
                    dislikes.slice(0, 10).forEach((p, i) => {
                        const conf = ((p.confidence || p.strength || 0.8) * 100).toFixed(0);
                        result.push(`  ${i + 1}. ${p.item || p.name || '未知'} [${p.category || 'general'}] (置信度: ${conf}%)`);
                    });
                    if (dislikes.length > 10) result.push(`  ... 还有 ${dislikes.length - 10} 个`);
                }
            }

            return result.join('\n');
        } catch (error) {
            return this._connRefused(error) || `获取偏好时出错: ${error.message}`;
        }
    }
}

module.exports = { MemosTools };
