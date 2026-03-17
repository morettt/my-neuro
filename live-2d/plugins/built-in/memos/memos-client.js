const axios = require('axios');

class MemosClient {
    constructor(pluginConfig) {
        this.enabled = pluginConfig.enabled !== false;
        this.apiUrl = pluginConfig.api_url || 'http://127.0.0.1:8003';
        this.autoInject = pluginConfig.auto_inject !== false;
        this.injectTopK = pluginConfig.inject_top_k || 3;
        this.similarityThreshold = pluginConfig.similarity_threshold || 0.6;
        this.autoSave = pluginConfig.auto_save !== false;
        this.saveInterval = pluginConfig.save_interval || 10;
        this.conversationBuffer = [];
        this.roundCount = 0;
    }

    async search(query, topK = null) {
        if (!this.enabled) return [];

        try {
            const response = await axios.post(`${this.apiUrl}/search`, {
                query,
                top_k: topK || this.injectTopK,
                user_id: 'feiniu_default',
                similarity_threshold: this.similarityThreshold
            }, { timeout: 3000 });

            return response.data.memories || [];
        } catch (error) {
            console.error('MemOS 搜索失败:', error.message);
            return [];
        }
    }

    async add(messages) {
        if (!this.enabled) return { status: 'disabled' };

        try {
            const response = await axios.post(`${this.apiUrl}/add`, {
                messages,
                user_id: 'feiniu_default'
            }, { timeout: 10000 });

            return response.data;
        } catch (error) {
            console.error('MemOS 添加记忆失败:', error.message);
            return { status: 'error', message: error.message };
        }
    }

    async addWithBuffer(messages) {
        if (!this.enabled) return { status: 'disabled' };

        this.conversationBuffer.push(...messages);
        this.roundCount++;

        console.log(`[MemOS] 对话已缓存 (${this.roundCount}/${this.saveInterval} 轮)`);

        if (this.roundCount >= this.saveInterval) {
            console.log(`[MemOS] 达到 ${this.saveInterval} 轮，开始保存记忆...`);
            try {
                const result = await this.add(this.conversationBuffer);
                this.conversationBuffer = [];
                this.roundCount = 0;
                return { status: 'saved', result };
            } catch (error) {
                console.error('MemOS 批量保存失败:', error.message);
                return { status: 'error', message: error.message };
            }
        }

        return { status: 'buffered', bufferedRounds: this.roundCount, remaining: this.saveInterval - this.roundCount };
    }

    async flushBuffer() {
        if (!this.enabled || this.conversationBuffer.length === 0) return { status: 'empty' };

        console.log(`[MemOS] 强制保存缓存的 ${this.roundCount} 轮对话...`);
        try {
            const result = await this.add(this.conversationBuffer);
            const savedRounds = this.roundCount;
            this.conversationBuffer = [];
            this.roundCount = 0;
            return { status: 'flushed', message: `已保存 ${savedRounds} 轮对话`, result };
        } catch (error) {
            console.error('MemOS 强制保存失败:', error.message);
            return { status: 'error', message: error.message };
        }
    }

    formatMemoriesForPrompt(memories) {
        if (!memories || memories.length === 0) return '';

        return memories.map(mem => {
            const content = typeof mem === 'string' ? mem : mem.content;
            const timestamp = mem.created_at || mem.timestamp;
            const updatedAt = mem.updated_at;

            let timeStr = '';
            if (timestamp) {
                try {
                    timeStr = new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
                } catch (_) {
                    timeStr = timestamp.substring(0, 10);
                }
            }

            const updateMark = (updatedAt && updatedAt !== timestamp) ? '（已更新）' : '';
            return timeStr ? `- ${content} 【${timeStr}】${updateMark}` : `- ${content}`;
        }).join('\n');
    }

    async isAvailable() {
        if (!this.enabled) return false;
        try {
            const response = await axios.get(`${this.apiUrl}/health`, { timeout: 2000 });
            return response.data.status === 'healthy';
        } catch (_) {
            return false;
        }
    }
}

module.exports = { MemosClient };
