/**
 * MemOS 记忆管理工具 (Memory OS Tool v1.0)
 * 
 * 功能：让AI助手管理和检索长期记忆
 * 作者：MemOS 集成
 * 版本：1.0.0
 * 
 * 特性：
 * - 深度搜索记忆
 * - 添加新记忆
 * - 列出所有记忆
 * - 删除指定记忆
 */

const axios = require('axios');

// MemOS API 地址
const MEMOS_API_URL = 'http://127.0.0.1:8003';

// 定义工具

const SEARCH_MEMORY_TOOL = {
    name: "memos_search_memory",
    description: "从AI的长期记忆系统中深度搜索相关的历史信息和对话。当用户询问'你还记得吗'、'之前说过'、'上次'、'以前'、'有没有'、'记不记得'等涉及过去事件的问题时必须使用此工具！也可用于主动搜索用户的偏好、经历、约定等。",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "搜索查询语句。【重要】必须使用完整的自然语言句子，不要只用单个词！例如：'用户喜欢吃什么'、'用户玩过什么游戏'、'关于炸串的记忆'、'用户的生日是什么时候'。单个词如'炸串'效果很差，应改为'用户吃过炸串吗'或'关于炸串的事情'。"
            },
            top_k: {
                type: "integer",
                description: "返回最相关的记忆数量，默认5条"
            }
        },
        required: ["query"]
    }
};

const ADD_MEMORY_TOOL = {
    name: "memos_add_memory",
    description: "手动添加重要信息到AI的长期记忆系统。当用户明确说'记住这个'、'别忘了'、'帮我记一下'、'以后记得'等时使用。也可用于主动记录用户透露的重要信息（如生日、喜好、重要事件等）。",
    parameters: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "要记住的内容，应该简洁明了"
            }
        },
        required: ["content"]
    }
};

// 工具执行函数

/**
 * 搜索记忆
 * @param {object} parameters - 包含 query 和 top_k 的对象
 * @returns {Promise<string>} 返回搜索结果
 */
async function memosSearchMemory(parameters) {
    const { query, top_k = 5 } = parameters;
    
    if (!query) {
        return "错误：未提供搜索查询 (query)。";
    }

    try {
        const response = await axios.post(`${MEMOS_API_URL}/search`, {
            query: query,
            top_k: top_k,
            user_id: "feiniu_default"
        }, {
            timeout: 5000
        });

        const memories = response.data.memories || [];
        
        if (memories.length === 0) {
            return `在记忆中没有找到关于"${query}"的相关信息。`;
        }

        // 格式化返回结果（包含时间戳）
        const formattedMemories = memories.map((mem, index) => {
            const content = typeof mem === 'string' ? mem : mem.content;
            // 优先使用创建时间，其次是 timestamp
            const timestamp = mem.created_at || mem.timestamp || '';
            const updatedAt = mem.updated_at || '';
            
            // 格式化创建时间
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
            
            // 如果有更新时间且不同于创建时间，添加更新标记
            let updateMark = '';
            if (updatedAt && updatedAt !== timestamp) {
                updateMark = '（已更新）';
            }
            
            // 返回格式：序号. 内容 【时间】（已更新）
            return timeStr 
                ? `${index + 1}. ${content} 【${timeStr}】${updateMark}`
                : `${index + 1}. ${content}`;
        }).join('\n');

        return `找到 ${memories.length} 条相关记忆：\n${formattedMemories}`;
        
    } catch (error) {
        console.error('MemOS 搜索失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法搜索记忆。";
        }
        return `搜索记忆时出错: ${error.message}`;
    }
}

/**
 * 添加记忆
 * @param {object} parameters - 包含 content 的对象
 * @returns {Promise<string>} 返回操作结果
 */
async function memosAddMemory(parameters) {
    const { content } = parameters;
    
    if (!content) {
        return "错误：未提供要记住的内容 (content)。";
    }

    try {
        const response = await axios.post(`${MEMOS_API_URL}/add`, {
            messages: [{ role: "user", content: content }],
            user_id: "feiniu_default"
        }, {
            timeout: 5000
        });

        console.log('✅ 记忆已添加:', content.substring(0, 50));
        return `已成功记住: ${content}`;
        
    } catch (error) {
        console.error('MemOS 添加记忆失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法添加记忆。";
        }
        return `添加记忆时出错: ${error.message}`;
    }
}

// 导出
module.exports = {
    getToolDefinitions: () => [SEARCH_MEMORY_TOOL, ADD_MEMORY_TOOL],
    executeFunction: async (name, parameters) => {
        if (name === "memos_search_memory") {
            return await memosSearchMemory(parameters);
        } else if (name === "memos_add_memory") {
            return await memosAddMemory(parameters);
        } else {
            throw new Error(`[MemOS Tool] 不支持此功能: ${name}`);
        }
    }
};

