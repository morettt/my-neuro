// memos-client.js - MemOS 客户端封装 v2.0
// 支持记忆管理 + 知识图谱
const axios = require('axios');

class MemosClient {
    constructor(config) {
        this.enabled = config?.memos?.enabled || false;
        this.apiUrl = config?.memos?.api_url || 'http://127.0.0.1:8003';
        this.autoInject = config?.memos?.auto_inject !== false;
        this.injectTopK = config?.memos?.inject_top_k || 3;
        this.similarityThreshold = config?.memos?.similarity_threshold || 0.6;
        
        // 对话累积配置
        this.saveInterval = config?.memos?.save_interval || 10;
        this.conversationBuffer = [];
        this.roundCount = 0;
        
        // v2.0 新增：知识图谱配置
        this.graphEnabled = config?.memos?.graph_enabled !== false;
        this.autoExtractEntities = config?.memos?.auto_extract_entities || false;
        
        console.log(`MemOS v2.0 客户端初始化: ${this.enabled ? '启用' : '禁用'}`);
        if (this.enabled) {
            console.log(`  - API 地址: ${this.apiUrl}`);
            console.log(`  - 自动注入: ${this.autoInject}`);
            console.log(`  - 检索数量: ${this.injectTopK}`);
            console.log(`  - 保存间隔: 每 ${this.saveInterval} 轮`);
            console.log(`  - 知识图谱: ${this.graphEnabled ? '启用' : '禁用'}`);
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
                similarity_threshold: this.similarityThreshold,
                use_graph: this.graphEnabled  // 🔥 启用图谱增强搜索（实体关联 + 偏好权重加成）
            }, {
                timeout: 5000  // 增加超时，因为综合搜索可能更慢
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

    // ═══════════════════════════════════════════════════════════════
    //                    v2.0 知识图谱功能
    // ═══════════════════════════════════════════════════════════════

    /**
     * 获取图谱统计信息
     * @returns {Promise<Object>} 包含 entity_count, relation_count 等
     */
    async getGraphStats() {
        if (!this.enabled || !this.graphEnabled) {
            return { status: 'disabled' };
        }

        try {
            const response = await axios.get(`${this.apiUrl}/graph/stats`, {
                timeout: 3000
            });
            return response.data;
        } catch (error) {
            console.error('获取图谱统计失败:', error.message);
            return { status: 'error', message: error.message };
        }
    }

    /**
     * 添加实体到知识图谱
     * @param {string} name - 实体名称
     * @param {string} entityType - 实体类型 (person, food, place, hobby, profession 等)
     * @param {Object} properties - 附加属性
     * @returns {Promise<Object>} 包含 entity_id
     */
    async addEntity(name, entityType, properties = {}) {
        if (!this.enabled || !this.graphEnabled) {
            return { status: 'disabled' };
        }

        try {
            const response = await axios.post(`${this.apiUrl}/graph/entity`, {
                name: name,
                entity_type: entityType,
                properties: properties,
                user_id: "feiniu_default"
            }, {
                timeout: 5000
            });
            console.log(`🕸️ 添加实体: ${name} (${entityType})`);
            return response.data;
        } catch (error) {
            console.error('添加实体失败:', error.message);
            return { status: 'error', message: error.message };
        }
    }

    /**
     * 添加关系到知识图谱
     * @param {string} sourceId - 源实体 ID
     * @param {string} targetId - 目标实体 ID
     * @param {string} relationType - 关系类型 (likes, knows, works_as 等)
     * @param {Object} properties - 关系属性
     * @returns {Promise<Object>}
     */
    async addRelation(sourceId, targetId, relationType, properties = {}) {
        if (!this.enabled || !this.graphEnabled) {
            return { status: 'disabled' };
        }

        try {
            const response = await axios.post(`${this.apiUrl}/graph/relation`, {
                source_id: sourceId,
                target_id: targetId,
                relation_type: relationType,
                properties: properties
            }, {
                timeout: 5000
            });
            console.log(`🔗 添加关系: ${relationType}`);
            return response.data;
        } catch (error) {
            console.error('添加关系失败:', error.message);
            return { status: 'error', message: error.message };
        }
    }

    /**
     * 查找实体（按名称模糊匹配）
     * @param {string} name - 实体名称
     * @returns {Promise<Array>} 实体列表
     */
    async findEntity(name) {
        if (!this.enabled || !this.graphEnabled) {
            return [];
        }

        try {
            const response = await axios.get(`${this.apiUrl}/graph/entities`, {
                params: { user_id: "feiniu_default" },
                timeout: 3000
            });
            
            const entities = response.data.entities || [];
            // 客户端过滤匹配的实体
            const nameLower = name.toLowerCase();
            return entities.filter(e => 
                e.name.toLowerCase().includes(nameLower) || 
                nameLower.includes(e.name.toLowerCase())
            );
        } catch (error) {
            console.error('查找实体失败:', error.message);
            return [];
        }
    }

    /**
     * 查找实体的相关实体（多跳查询）
     * @param {string} entityId - 实体 ID
     * @param {number} maxDepth - 最大深度
     * @returns {Promise<Array>} 相关实体列表
     */
    async findRelatedEntities(entityId, maxDepth = 2) {
        if (!this.enabled || !this.graphEnabled) {
            return [];
        }

        try {
            const response = await axios.post(
                `${this.apiUrl}/graph/query/related`,
                null,
                {
                    params: { entity_id: entityId, max_depth: maxDepth },
                    timeout: 5000
                }
            );
            return response.data.related || [];
        } catch (error) {
            console.error('查找相关实体失败:', error.message);
            return [];
        }
    }

    /**
     * 获取实体的所有关系
     * @param {string} entityId - 实体 ID
     * @returns {Promise<Array>} 关系列表
     */
    async getEntityRelations(entityId) {
        if (!this.enabled || !this.graphEnabled) {
            return [];
        }

        try {
            const response = await axios.get(
                `${this.apiUrl}/graph/entity/${entityId}/relations`,
                { timeout: 3000 }
            );
            return response.data.relations || [];
        } catch (error) {
            console.error('获取实体关系失败:', error.message);
            return [];
        }
    }

    /**
     * 格式化图谱信息为 prompt 文本
     * @param {string} query - 用户查询
     * @returns {Promise<string>} 格式化后的图谱上下文
     */
    async getGraphContextForPrompt(query) {
        if (!this.enabled || !this.graphEnabled) {
            return '';
        }

        try {
            // 1. 从查询中提取可能的实体名称（简单分词）
            const keywords = query.split(/[\s,，。！？!?]+/).filter(w => w.length >= 2);
            
            let graphContext = [];
            
            for (const keyword of keywords.slice(0, 3)) {  // 最多检查3个关键词
                const entities = await this.findEntity(keyword);
                
                for (const entity of entities.slice(0, 2)) {  // 每个关键词最多2个实体
                    // 获取实体的关系
                    const relations = await this.getEntityRelations(entity.id);
                    
                    if (relations.length > 0) {
                        const relStr = relations.map(r => {
                            const dir = r.direction === 'out' ? '→' : '←';
                            return `${dir}[${r.relation_type}]`;
                        }).join(', ');
                        
                        graphContext.push(`${entity.name}(${entity.entity_type}): ${relStr}`);
                    }
                }
            }
            
            if (graphContext.length > 0) {
                return `\n【知识图谱】\n${graphContext.join('\n')}`;
            }
            
            return '';
        } catch (error) {
            console.error('获取图谱上下文失败:', error.message);
            return '';
        }
    }

    /**
     * 获取完整上下文（记忆 + 图谱）
     * @param {string} query - 用户查询
     * @returns {Promise<string>} 完整的记忆和图谱上下文
     */
    async getFullContextForPrompt(query) {
        let context = '';
        
        // 1. 获取相关记忆
        const memories = await this.search(query);
        if (memories.length > 0) {
            context += `【相关记忆】\n${this.formatMemoriesForPrompt(memories)}`;
        }
        
        // 2. 获取图谱上下文
        if (this.graphEnabled) {
            const graphContext = await this.getGraphContextForPrompt(query);
            if (graphContext) {
                context += graphContext;
            }
        }
        
        return context;
    }

    /**
     * 获取系统完整状态
     * @returns {Promise<Object>}
     */
    async getSystemStatus() {
        try {
            const [health, stats, graphStats] = await Promise.all([
                axios.get(`${this.apiUrl}/health`, { timeout: 2000 }).then(r => r.data).catch(() => null),
                axios.get(`${this.apiUrl}/stats`, { timeout: 2000 }).then(r => r.data).catch(() => null),
                axios.get(`${this.apiUrl}/graph/stats`, { timeout: 2000 }).then(r => r.data).catch(() => null)
            ]);

            return {
                online: health?.status === 'healthy',
                memory_count: stats?.total_count || 0,
                entity_count: graphStats?.entity_count || 0,
                relation_count: graphStats?.relation_count || 0,
                qdrant_available: health?.qdrant_available || false,
                graph_available: health?.neo4j_available || false
            };
        } catch (error) {
            return { online: false, error: error.message };
        }
    }
}

module.exports = { MemosClient };


