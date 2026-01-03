// memos-client.js - MemOS 客户端封装
const axios = require('axios');

class MemosClient {
    constructor(config) {
        this.enabled = config?.memos?.enabled || false;
        this.apiUrl = config?.memos?.api_url || 'http://127.0.0.1:8003';
        this.autoInject = config?.memos?.auto_inject !== false;
        this.injectTopK = config?.memos?.inject_top_k || 3;
        this.similarityThreshold = config?.memos?.similarity_threshold || 0.6;
        
        // 🔥 新增：对话累积配置
        this.saveInterval = config?.memos?.save_interval || 10;  // 每10轮保存一次
        this.conversationBuffer = [];  // 对话缓存
        this.roundCount = 0;  // 当前轮数计数
        
        console.log(`MemOS 客户端初始化: ${this.enabled ? '启用' : '禁用'}`);
        if (this.enabled) {
            console.log(`  - API 地址: ${this.apiUrl}`);
            console.log(`  - 自动注入: ${this.autoInject}`);
            console.log(`  - 检索数量: ${this.injectTopK}`);
            console.log(`  - 保存间隔: 每 ${this.saveInterval} 轮`);
        }
    }

    /**
     * 搜索相关记忆
     * @param {string} query - 搜索查询
     * @param {number} topK - 返回数量
     * @returns {Promise<Array>} 记忆列表
     */
    async search(query, topK = null) {
        if (!this.enabled) {
            return [];
        }

        try {
            const response = await axios.post(`${this.apiUrl}/search`, {
                query: query,
                top_k: topK || this.injectTopK,
                user_id: "feiniu_default",
                similarity_threshold: this.similarityThreshold  // 🔥 传递相似度阈值
            }, {
                timeout: 3000  // 3秒超时
            });

            // 🔥 添加调试日志
            const memories = response.data.memories || [];
            if (memories.length > 0) {
                console.log(`🧠 MemOS 搜索结果: ${memories.length} 条相关记忆`);
                memories.forEach((m, i) => {
                    console.log(`  ${i+1}. [相似度:${m.similarity}] ${m.content.substring(0, 50)}...`);
                });
            }

            return memories;
        } catch (error) {
            console.error('MemOS 搜索失败:', error.message);
            return [];
        }
    }

    /**
     * 添加新记忆（直接发送，不累积）
     * @param {Array} messages - 对话消息列表
     * @returns {Promise<Object>} 添加结果
     */
    async add(messages) {
        if (!this.enabled) {
            return { status: 'disabled' };
        }

        try {
            const response = await axios.post(`${this.apiUrl}/add`, {
                messages: messages,
                user_id: "feiniu_default"
            }, {
                timeout: 10000  // 增加超时，因为可能处理多条
            });

            console.log('✅ 记忆已添加到 MemOS');
            return response.data;
        } catch (error) {
            console.error('MemOS 添加记忆失败:', error.message);
            return { status: 'error', message: error.message };
        }
    }

    /**
     * 🔥 累积对话并在达到指定轮数时批量保存
     * @param {Array} messages - 本轮对话消息 [{role, content}, ...]
     * @returns {Promise<Object>} 如果触发保存则返回结果，否则返回累积状态
     */
    async addWithBuffer(messages) {
        if (!this.enabled) {
            return { status: 'disabled' };
        }

        // 将本轮对话添加到缓存
        this.conversationBuffer.push(...messages);
        this.roundCount++;

        console.log(`📝 对话已缓存 (${this.roundCount}/${this.saveInterval} 轮)`);

        // 检查是否达到保存间隔
        if (this.roundCount >= this.saveInterval) {
            console.log(`🧠 达到 ${this.saveInterval} 轮，开始保存记忆...`);
            
            try {
                // 发送累积的所有对话
                const result = await this.add(this.conversationBuffer);
                
                // 清空缓存和计数器
                this.conversationBuffer = [];
                this.roundCount = 0;
                
                return { 
                    status: 'saved', 
                    message: `已保存 ${this.saveInterval} 轮对话`,
                    result 
                };
            } catch (error) {
                console.error('批量保存记忆失败:', error.message);
                return { status: 'error', message: error.message };
            }
        }

        return { 
            status: 'buffered', 
            bufferedRounds: this.roundCount,
            remaining: this.saveInterval - this.roundCount 
        };
    }

    /**
     * 🔥 强制保存当前缓存的对话（用于程序退出时）
     * @returns {Promise<Object>} 保存结果
     */
    async flushBuffer() {
        if (!this.enabled || this.conversationBuffer.length === 0) {
            return { status: 'empty' };
        }

        console.log(`🧠 强制保存缓存的 ${this.roundCount} 轮对话...`);
        
        try {
            const result = await this.add(this.conversationBuffer);
            
            // 清空缓存
            const savedRounds = this.roundCount;
            this.conversationBuffer = [];
            this.roundCount = 0;
            
            return { 
                status: 'flushed', 
                message: `已保存 ${savedRounds} 轮对话`,
                result 
            };
        } catch (error) {
            console.error('强制保存失败:', error.message);
            return { status: 'error', message: error.message };
        }
    }

    /**
     * 获取当前缓存状态
     */
    getBufferStatus() {
        return {
            bufferedRounds: this.roundCount,
            bufferedMessages: this.conversationBuffer.length,
            saveInterval: this.saveInterval,
            remaining: this.saveInterval - this.roundCount
        };
    }

    /**
     * 格式化记忆为 prompt 文本
     * @param {Array} memories - 记忆列表
     * @returns {string} 格式化后的文本
     */
    formatMemoriesForPrompt(memories) {
        if (!memories || memories.length === 0) {
            return '';
        }

        const lines = memories.map((mem, index) => {
            // 记忆格式：content, metadata (可能包含 timestamp, importance 等)
            const content = typeof mem === 'string' ? mem : mem.content;
            
            // 优先使用创建时间
            const timestamp = mem.created_at || mem.timestamp;
            const updatedAt = mem.updated_at;
            
            // 格式化时间戳
            let timeStr = '';
            if (timestamp) {
                try {
                    const date = new Date(timestamp);
                    timeStr = date.toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                } catch (e) {
                    timeStr = timestamp.substring(0, 10);
                }
            }
            
            // 如果有更新时间，添加标记
            let updateMark = '';
            if (updatedAt && updatedAt !== timestamp) {
                updateMark = '（已更新）';
            }
            
            // 返回格式：- 内容 【时间】（已更新）
            return timeStr 
                ? `- ${content} 【${timeStr}】${updateMark}`
                : `- ${content}`;
        });

        return lines.join('\n');
    }

    /**
     * 检查服务是否可用
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        if (!this.enabled) {
            return false;
        }

        try {
            const response = await axios.get(`${this.apiUrl}/health`, {
                timeout: 2000
            });
            return response.data.status === 'healthy';
        } catch (error) {
            console.warn('MemOS 服务不可用:', error.message);
            return false;
        }
    }
}

module.exports = { MemosClient };


