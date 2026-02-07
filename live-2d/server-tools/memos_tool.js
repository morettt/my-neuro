/**
 * MemOS 记忆管理工具 (Memory OS Tool v2.2)
 * 
 * 功能：让AI助手管理和检索长期记忆
 * 作者：MemOS 集成
 * 版本：2.2.0
 * 
 * 特性：
 * - 深度搜索记忆
 * - 添加新记忆
 * - 图片记忆管理（上传、搜索、截图保存）
 * - 工具使用记录（记录、搜索）
 * - 网页/文档导入（URL、PDF、TXT、MD）
 * - 记忆修正/补充/删除
 */

const axios = require('axios');
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

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

// ==================== 图片记忆工具 ====================

const UPLOAD_IMAGE_TOOL = {
    name: "memos_upload_image",
    description: "将图片保存到AI的长期记忆系统。当用户说'帮我记住这张图'、'保存这张图片'、'记录一下这个截图'等时使用。也可用于主动保存想要记住的重要图片。",
    parameters: {
        type: "object",
        properties: {
            image_base64: {
                type: "string",
                description: "图片的 base64 编码数据（不含 data:image/xxx;base64, 前缀）"
            },
            description: {
                type: "string",
                description: "图片的描述或标题，用于后续搜索"
            },
            image_type: {
                type: "string",
                description: "图片类型：screenshot（截图）、photo（照片）、artwork（艺术图）、document（文档）、other（其他）",
                enum: ["screenshot", "photo", "artwork", "document", "other"]
            },
            tags: {
                type: "array",
                items: { type: "string" },
                description: "图片的标签，用于分类和搜索"
            }
        },
        required: ["image_base64", "description"]
    }
};

const SEARCH_IMAGES_TOOL = {
    name: "memos_search_images",
    description: "从AI的图片记忆中搜索相关图片。当用户问'之前那张图呢'、'找一下猫的图片'、'有没有保存过xxx的截图'等时使用。也可用于主动搜索相关图片",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "搜索查询，描述想要找的图片内容"
            },
            image_type: {
                type: "string",
                description: "可选，限定图片类型",
                enum: ["screenshot", "photo", "artwork", "document", "other"]
            },
            top_k: {
                type: "integer",
                description: "返回数量，默认5"
            }
        },
        required: ["query"]
    }
};

// 🔥 新增：截图并保存到记忆的一站式工具
const SAVE_SCREENSHOT_TOOL = {
    name: "memos_save_screenshot",
    description: "【推荐】截取当前屏幕并保存到AI的长期记忆系统。当用户说'帮我记住当前屏幕'、'保存这个截图'、'记录一下屏幕内容'等时使用。此工具会自动截图并保存，无需先调用其他截图工具。",
    parameters: {
        type: "object",
        properties: {
            description: {
                type: "string",
                description: "【必填】截图的描述或标题，用于后续搜索和识别。例如：'用户正在查看的网页'、'聊天记录截图'等"
            },
            tags: {
                type: "array",
                items: { type: "string" },
                description: "截图的标签，用于分类和搜索"
            }
        },
        required: ["description"]
    }
};

// 🔥 新增：从本地文件保存图片到记忆
const SAVE_IMAGE_FROM_FILE_TOOL = {
    name: "memos_save_image_from_file",
    description: "将电脑上的图片文件保存到AI的长期记忆系统。当用户说'帮我保存这张图片'、'把xxx图片存到记忆'、'记住这个图片文件'等并提供了文件路径时使用。支持 JPG、PNG、GIF、WEBP 等常见图片格式。",
    parameters: {
        type: "object",
        properties: {
            file_path: {
                type: "string",
                description: "【必填】图片文件的完整路径。例如：'K:\\Photos\\cat.jpg' 或 'C:\\Users\\xxx\\Pictures\\photo.png'"
            },
            description: {
                type: "string",
                description: "【必填】图片的描述或标题，用于后续搜索和识别"
            },
            image_type: {
                type: "string",
                description: "图片类型：photo（照片）、artwork（艺术图）、document（文档）、screenshot（截图）、other（其他）",
                enum: ["photo", "artwork", "document", "screenshot", "other"]
            },
            tags: {
                type: "array",
                items: { type: "string" },
                description: "图片的标签，用于分类和搜索"
            }
        },
        required: ["file_path", "description"]
    }
};

// ==================== 工具使用记录工具 ====================

const RECORD_TOOL_USAGE_TOOL = {
    name: "memos_record_tool_usage",
    description: "记录工具使用情况到记忆系统。在执行重要的工具调用（如搜索、播放音乐、查询天气等）后自动调用，以便后续回顾。",
    parameters: {
        type: "object",
        properties: {
            tool_name: {
                type: "string",
                description: "工具名称，如 bilibili_search、web_search、play_music 等"
            },
            parameters: {
                type: "object",
                description: "调用工具时使用的参数"
            },
            result_summary: {
                type: "string",
                description: "工具执行结果的简短摘要"
            },
            category: {
                type: "string",
                description: "工具类别：search（搜索）、media（媒体）、utility（工具）、game（游戏）、other（其他）",
                enum: ["search", "media", "utility", "game", "other"]
            }
        },
        required: ["tool_name", "result_summary"]
    }
};

const SEARCH_TOOL_USAGE_TOOL = {
    name: "memos_search_tool_usage",
    description: "搜索之前的工具使用记录。当用户问'之前搜过什么'、'上次播放的音乐'、'帮我查过什么'等时使用。也可用于主动搜索信息",
    parameters: {
        type: "object",
        properties: {
            tool_name: {
                type: "string",
                description: "可选，限定工具名称"
            },
            keyword: {
                type: "string",
                description: "可选，搜索关键词"
            },
            limit: {
                type: "integer",
                description: "返回数量，默认10"
            }
        },
        required: []
    }
};

// ==================== 知识库/网页导入工具 ====================

const IMPORT_URL_TOOL = {
    name: "memos_import_url",
    description: "将网页内容导入到AI的长期记忆系统。当用户说'帮我记住这个网页'、'把这个链接保存下来'、'导入这个URL的内容'、'把这篇文章存起来'等时使用。也可用于主动记录用户透露的重要信息",
    parameters: {
        type: "object",
        properties: {
            url: {
                type: "string",
                description: "要导入的网页 URL（http 或 https 开头）"
            },
            tags: {
                type: "array",
                items: { type: "string" },
                description: "可选标签，用于分类和后续搜索，如 ['技术', '教程']"
            }
        },
        required: ["url"]
    }
};

const IMPORT_DOCUMENT_TOOL = {
    name: "memos_import_document",
    description: "将文档导入到AI的长期记忆系统。支持 txt、pdf、md 格式。当用户说'帮我导入这个文档'、'把这个PDF存到记忆里'等时使用。也可用于主动记录用户透露的重要信息",
    parameters: {
        type: "object",
        properties: {
            file_path: {
                type: "string",
                description: "文档的本地路径，支持 .txt、.pdf、.md 格式"
            },
            tags: {
                type: "array",
                items: { type: "string" },
                description: "可选标签，用于分类"
            }
        },
        required: ["file_path"]
    }
};

// ==================== 记忆修正工具 ====================

const CORRECT_MEMORY_TOOL = {
    name: "memos_correct_memory",
    description: "修正、补充或删除已有的记忆。当用户说'这条记忆不对'、'应该改成...'、'补充一下'、'删掉这条记忆'等时使用。需要先用 memos_search_memory 找到记忆ID。",
    parameters: {
        type: "object",
        properties: {
            memory_id: {
                type: "string",
                description: "要修正的记忆 ID（通过搜索获取）"
            },
            action: {
                type: "string",
                description: "操作类型：correct（修正内容）、supplement（补充信息）、delete（删除）",
                enum: ["correct", "supplement", "delete"]
            },
            new_content: {
                type: "string",
                description: "修正后的内容或要补充的内容（删除时不需要）"
            },
            reason: {
                type: "string",
                description: "可选，修正或删除的原因"
            }
        },
        required: ["memory_id", "action"]
    }
};

// ==================== 偏好查询工具 ====================

const GET_PREFERENCES_TOOL = {
    name: "memos_get_preferences",
    description: "获取用户的偏好摘要和详细列表。当AI需要做决策、推荐、选择时使用，例如：推荐食物时查看食物偏好、推荐音乐时查看音乐偏好、做任何选择时了解用户喜好。也可用于回答'我喜欢什么'、'我的偏好是什么'等问题。",
    parameters: {
        type: "object",
        properties: {
            category: {
                type: "string",
                description: "可选，只查看特定类别的偏好：food（食物）、music（音乐）、game（游戏）、movie（电影）、hobby（爱好）、style（风格）、schedule（日程）、general（一般）",
                enum: ["food", "music", "game", "movie", "hobby", "style", "schedule", "general"]
            },
            include_details: {
                type: "boolean",
                description: "是否包含详细偏好列表，默认 true"
            }
        },
        required: []
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

// ==================== 图片记忆执行函数 ====================

/**
 * 上传图片到记忆系统
 * @param {object} parameters - 包含 image_base64, description 等
 * @returns {Promise<string>} 返回操作结果
 */
async function memosUploadImage(parameters) {
    const { image_base64, description, image_type = 'other', tags = [] } = parameters;
    
    if (!image_base64) {
        return "错误：未提供图片数据 (image_base64)。";
    }
    if (!description) {
        return "错误：未提供图片描述 (description)。";
    }

    try {
        const response = await axios.post(`${MEMOS_API_URL}/images/upload`, {
            image_base64: image_base64,
            description: description,
            image_type: image_type,
            tags: tags,
            user_id: "feiniu_default"
        }, {
            timeout: 30000  // 图片上传可能较慢
        });

        const result = response.data;
        console.log('🖼️ 图片已保存:', description.substring(0, 30));
        return `已成功保存图片「${description}」，图片ID: ${result.image_id || '已生成'}`;
        
    } catch (error) {
        console.error('MemOS 图片上传失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法保存图片。";
        }
        return `保存图片时出错: ${error.message}`;
    }
}

/**
 * 搜索图片记忆
 * @param {object} parameters - 包含 query, image_type, top_k
 * @returns {Promise<string>} 返回搜索结果
 */
async function memosSearchImages(parameters) {
    const { query, image_type, top_k = 5 } = parameters;
    
    if (!query) {
        return "错误：未提供搜索查询 (query)。";
    }

    try {
        const requestData = {
            query: query,
            top_k: top_k,
            user_id: "feiniu_default"
        };
        if (image_type) {
            requestData.image_type = image_type;
        }

        const response = await axios.post(`${MEMOS_API_URL}/images/search`, requestData, {
            timeout: 10000
        });

        const images = response.data.images || [];
        
        if (images.length === 0) {
            return `没有找到关于「${query}」的图片记忆。`;
        }

        // 格式化返回结果
        const formattedImages = images.map((img, index) => {
            const desc = img.description || '无描述';
            const type = img.image_type || 'unknown';
            const time = img.created_at ? new Date(img.created_at).toLocaleDateString('zh-CN') : '';
            const tags = img.tags && img.tags.length > 0 ? `[${img.tags.join(', ')}]` : '';
            
            return `${index + 1}. 【${type}】${desc} ${tags}${time ? ` (${time})` : ''}`;
        }).join('\n');

        return `找到 ${images.length} 张相关图片：\n${formattedImages}`;
        
    } catch (error) {
        console.error('MemOS 图片搜索失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法搜索图片。";
        }
        return `搜索图片时出错: ${error.message}`;
    }
}

/**
 * 🔥 截图并保存到记忆系统（一站式工具）
 * @param {object} parameters - 包含 description, tags
 * @returns {Promise<string>} 返回操作结果
 */
async function memosSaveScreenshot(parameters) {
    const { description, tags = [] } = parameters;
    
    if (!description) {
        return "错误：未提供截图描述 (description)。请描述这张截图的内容或用途。";
    }

    try {
        // 步骤1：截取屏幕
        console.log('📸 [MemOS] 正在截取屏幕...');
        const base64Image = await ipcRenderer.invoke('take-screenshot');
        
        if (!base64Image) {
            console.error('[MemOS] 截图返回空数据');
            return "错误：截图失败，未能获取屏幕图像。";
        }
        
        console.log(`📸 [MemOS] 截图成功，数据长度: ${base64Image.length} 字符`);
        
        // 步骤2：保存到记忆系统
        console.log('💾 [MemOS] 正在保存截图到记忆系统...');
        const response = await axios.post(`${MEMOS_API_URL}/images/upload`, {
            image_base64: base64Image,
            description: description,
            image_type: 'screenshot',
            tags: tags,
            user_id: "feiniu_default"
        }, {
            timeout: 30000
        });

        const result = response.data;
        console.log('✅ [MemOS] 截图已保存到记忆:', description.substring(0, 30));
        
        return `已成功截取屏幕并保存到记忆！\n📝 描述：${description}\n🆔 图片ID：${result.image_id || '已生成'}\n📐 尺寸：${result.dimensions || '未知'}`;
        
    } catch (error) {
        console.error('[MemOS] 截图保存失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法保存截图。请确保 MemOS 服务正在运行。";
        }
        if (error.message && error.message.includes('invoke')) {
            return "截图功能不可用，可能是 Electron 环境问题。";
        }
        return `保存截图时出错: ${error.message}`;
    }
}

/**
 * 🔥 从本地文件保存图片到记忆系统
 * @param {object} parameters - 包含 file_path, description, image_type, tags
 * @returns {Promise<string>} 返回操作结果
 */
async function memosSaveImageFromFile(parameters) {
    const { file_path, description, image_type = 'photo', tags = [] } = parameters;
    
    if (!file_path) {
        return "错误：未提供图片文件路径 (file_path)。";
    }
    if (!description) {
        return "错误：未提供图片描述 (description)。";
    }

    try {
        // 检查文件是否存在
        if (!fs.existsSync(file_path)) {
            return `错误：文件不存在: ${file_path}`;
        }
        
        // 检查文件扩展名
        const ext = path.extname(file_path).toLowerCase();
        const supportedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
        if (!supportedExts.includes(ext)) {
            return `错误：不支持的图片格式 (${ext})。支持的格式：${supportedExts.join(', ')}`;
        }
        
        // 读取文件并转为 base64
        console.log(`🖼️ [MemOS] 正在读取图片文件: ${file_path}`);
        const imageBuffer = fs.readFileSync(file_path);
        const base64Image = imageBuffer.toString('base64');
        
        console.log(`🖼️ [MemOS] 图片读取成功，大小: ${(imageBuffer.length / 1024).toFixed(1)} KB`);
        
        // 获取文件名
        const filename = path.basename(file_path);
        
        // 保存到记忆系统
        console.log('💾 [MemOS] 正在保存图片到记忆系统...');
        const response = await axios.post(`${MEMOS_API_URL}/images/upload`, {
            image_base64: base64Image,
            filename: filename,
            description: description,
            image_type: image_type,
            tags: tags,
            user_id: "feiniu_default"
        }, {
            timeout: 30000
        });

        const result = response.data;
        console.log('✅ [MemOS] 图片已保存到记忆:', description.substring(0, 30));
        
        return `已成功保存图片到记忆！\n📁 文件：${filename}\n📝 描述：${description}\n🆔 图片ID：${result.image_id || '已生成'}\n📐 尺寸：${result.dimensions || '未知'}`;
        
    } catch (error) {
        console.error('[MemOS] 图片保存失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法保存图片。请确保 MemOS 服务正在运行。";
        }
        if (error.code === 'ENOENT') {
            return `错误：无法读取文件: ${file_path}`;
        }
        return `保存图片时出错: ${error.message}`;
    }
}

// ==================== 工具使用记录执行函数 ====================

/**
 * 记录工具使用
 * @param {object} parameters - 包含 tool_name, parameters, result_summary, category
 * @returns {Promise<string>} 返回操作结果
 */
async function memosRecordToolUsage(parameters) {
    const { tool_name, parameters: toolParams = {}, result_summary, category = 'other' } = parameters;
    
    if (!tool_name) {
        return "错误：未提供工具名称 (tool_name)。";
    }
    if (!result_summary) {
        return "错误：未提供结果摘要 (result_summary)。";
    }

    try {
        const response = await axios.post(`${MEMOS_API_URL}/tools/record`, {
            tool_name: tool_name,
            parameters: toolParams,
            result_summary: result_summary,
            category: category,
            user_id: "feiniu_default"
        }, {
            timeout: 5000
        });

        console.log('🔧 工具使用已记录:', tool_name);
        return `已记录工具「${tool_name}」的使用`;
        
    } catch (error) {
        console.error('MemOS 工具记录失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法记录工具使用。";
        }
        return `记录工具使用时出错: ${error.message}`;
    }
}

/**
 * 搜索工具使用记录
 * @param {object} parameters - 包含 tool_name, keyword, limit
 * @returns {Promise<string>} 返回搜索结果
 */
async function memosSearchToolUsage(parameters) {
    const { tool_name, keyword, limit = 10 } = parameters;

    try {
        // 获取最近的工具使用记录
        const response = await axios.get(`${MEMOS_API_URL}/tools/recent`, {
            params: {
                tool_name: tool_name || undefined,
                limit: limit
            },
            timeout: 5000
        });

        let records = response.data.records || [];
        
        // 如果有关键词，进行过滤
        if (keyword && records.length > 0) {
            const kw = keyword.toLowerCase();
            records = records.filter(r => 
                (r.tool_name && r.tool_name.toLowerCase().includes(kw)) ||
                (r.result_summary && r.result_summary.toLowerCase().includes(kw)) ||
                (r.parameters && JSON.stringify(r.parameters).toLowerCase().includes(kw))
            );
        }
        
        if (records.length === 0) {
            if (tool_name) {
                return `没有找到工具「${tool_name}」的使用记录。`;
            }
            return "没有找到工具使用记录。";
        }

        // 格式化返回结果
        const formattedRecords = records.map((record, index) => {
            const name = record.tool_name || 'unknown';
            const summary = record.result_summary || '无摘要';
            const time = record.timestamp ? new Date(record.timestamp).toLocaleString('zh-CN') : '';
            const params = record.parameters ? ` (参数: ${JSON.stringify(record.parameters).substring(0, 50)}...)` : '';
            
            return `${index + 1}. 【${name}】${summary}${params}${time ? ` - ${time}` : ''}`;
        }).join('\n');

        return `找到 ${records.length} 条工具使用记录：\n${formattedRecords}`;
        
    } catch (error) {
        console.error('MemOS 工具记录搜索失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法搜索工具记录。";
        }
        return `搜索工具记录时出错: ${error.message}`;
    }
}

// ==================== 知识库/网页导入执行函数 ====================

/**
 * 从 URL 导入网页内容
 * @param {object} parameters - 包含 url, tags
 * @returns {Promise<string>} 返回导入结果
 */
async function memosImportUrl(parameters) {
    const { url, tags = [] } = parameters;
    
    if (!url) {
        return "错误：未提供网页 URL。";
    }
    
    // 验证 URL 格式
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return "错误：URL 必须以 http:// 或 https:// 开头。";
    }

    try {
        const response = await axios.post(`${MEMOS_API_URL}/kb/import`, {
            source: url,
            tags: ['web', ...tags],
            user_id: "feiniu_default"
        }, {
            timeout: 60000  // 网页导入可能较慢
        });

        const result = response.data;
        
        if (result.status === 'success') {
            console.log('🌐 网页已导入:', url.substring(0, 50));
            return `已成功导入网页内容！\n- URL: ${url}\n- 分块数: ${result.chunks_count || 0}\n- 导入记忆: ${result.imported_count || 0} 条`;
        } else {
            return `导入失败: ${result.message || '未知错误'}`;
        }
        
    } catch (error) {
        console.error('MemOS 网页导入失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法导入网页。";
        }
        if (error.response?.status === 503) {
            return "文档加载器未初始化，无法导入网页。";
        }
        return `导入网页时出错: ${error.message}`;
    }
}

/**
 * 导入本地文档
 * @param {object} parameters - 包含 file_path, tags
 * @returns {Promise<string>} 返回导入结果
 */
async function memosImportDocument(parameters) {
    const { file_path, tags = [] } = parameters;
    
    if (!file_path) {
        return "错误：未提供文档路径。";
    }

    try {
        const response = await axios.post(`${MEMOS_API_URL}/kb/import`, {
            source: file_path,
            tags: ['document', ...tags],
            user_id: "feiniu_default"
        }, {
            timeout: 120000  // PDF 导入可能很慢
        });

        const result = response.data;
        
        if (result.status === 'success') {
            console.log('📄 文档已导入:', file_path);
            return `已成功导入文档！\n- 路径: ${file_path}\n- 分块数: ${result.chunks_count || 0}\n- 导入记忆: ${result.imported_count || 0} 条`;
        } else {
            return `导入失败: ${result.message || '未知错误'}`;
        }
        
    } catch (error) {
        console.error('MemOS 文档导入失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法导入文档。";
        }
        if (error.response?.status === 503) {
            return "文档加载器未初始化，无法导入文档。";
        }
        return `导入文档时出错: ${error.message}`;
    }
}

// ==================== 记忆修正执行函数 ====================

/**
 * 修正/补充/删除记忆
 * @param {object} parameters - 包含 memory_id, action, new_content, reason
 * @returns {Promise<string>} 返回操作结果
 */
async function memosCorrectMemory(parameters) {
    const { memory_id, action, new_content, reason } = parameters;
    
    if (!memory_id) {
        return "错误：未提供记忆 ID。请先使用 memos_search_memory 搜索并获取记忆 ID。";
    }
    
    if (!action) {
        return "错误：未指定操作类型。可选：correct（修正）、supplement（补充）、delete（删除）";
    }
    
    if ((action === 'correct' || action === 'supplement') && !new_content) {
        return `错误：${action === 'correct' ? '修正' : '补充'}操作需要提供 new_content。`;
    }

    try {
        const requestData = {
            memory_id: memory_id,
            feedback_type: action,
            reason: reason || ''
        };
        
        if (action === 'correct' || action === 'supplement') {
            requestData.correction = new_content;
        }

        const response = await axios.post(`${MEMOS_API_URL}/memory/feedback`, requestData, {
            timeout: 10000
        });

        const result = response.data;
        
        if (result.status === 'success') {
            const actionName = {
                'correct': '修正',
                'supplement': '补充',
                'delete': '删除'
            }[action] || action;
            
            console.log(`✏️ 记忆已${actionName}:`, memory_id);
            
            if (action === 'delete') {
                return `已成功删除记忆 (ID: ${memory_id})`;
            } else {
                return `已成功${actionName}记忆！\n- ID: ${memory_id}\n- 新内容: ${result.new_content || new_content}`;
            }
        } else {
            return `操作失败: ${result.message || '未知错误'}`;
        }
        
    } catch (error) {
        console.error('MemOS 记忆修正失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法修正记忆。";
        }
        if (error.response?.status === 404) {
            return `记忆 ID「${memory_id}」不存在，请确认 ID 是否正确。`;
        }
        return `修正记忆时出错: ${error.message}`;
    }
}

// ==================== 偏好查询执行函数 ====================

/**
 * 获取用户偏好摘要和列表
 * @param {object} parameters - 包含 category, include_details
 * @returns {Promise<string>} 返回偏好信息
 */
async function memosGetPreferences(parameters) {
    const { category, include_details = true } = parameters;

    try {
        // 1. 获取偏好摘要
        const summaryResponse = await axios.get(`${MEMOS_API_URL}/preferences/summary`, {
            params: { user_id: "feiniu_default" },
            timeout: 5000
        });
        
        const summary = summaryResponse.data.summary || {};
        
        // 2. 获取详细偏好列表（如果需要）
        let preferences = [];
        if (include_details) {
            const listParams = { user_id: "feiniu_default" };
            if (category) {
                listParams.category = category;
            }
            
            const listResponse = await axios.get(`${MEMOS_API_URL}/preferences`, {
                params: listParams,
                timeout: 5000
            });
            
            preferences = listResponse.data.preferences || [];
        }
        
        // 格式化输出
        let result = [];
        
        // 摘要信息
        const totalCount = summary.total_count || 0;
        const categoryCount = summary.category_count || 0;
        
        if (totalCount === 0) {
            return "目前没有记录用户的偏好信息。";
        }
        
        result.push(`📊 用户偏好摘要：共 ${totalCount} 个偏好，涉及 ${categoryCount} 个类别`);
        
        // 类别分布
        const categories = summary.categories || {};
        if (Object.keys(categories).length > 0) {
            const catLabels = {
                'food': '🍔食物', 'music': '🎵音乐', 'game': '🎮游戏', 
                'movie': '🎬电影', 'hobby': '⭐爱好', 'style': '👗风格',
                'schedule': '📅日程', 'general': '📌一般'
            };
            const catList = Object.entries(categories)
                .map(([cat, count]) => `${catLabels[cat] || cat}: ${count}`)
                .join(', ');
            result.push(`类别分布: ${catList}`);
        }
        
        // 详细偏好列表
        if (include_details && preferences.length > 0) {
            result.push('\n📋 偏好详情:');
            
            // 分组显示喜欢和不喜欢
            const likes = preferences.filter(p => p.preference_type === 'like' || p.type === 'like');
            const dislikes = preferences.filter(p => p.preference_type === 'dislike' || p.type === 'dislike');
            
            if (likes.length > 0) {
                result.push('💝 喜欢:');
                likes.slice(0, 10).forEach((p, i) => {
                    const item = p.item || p.name || '未知';
                    const cat = p.category || 'general';
                    const confidence = p.confidence || p.strength || 0.8;
                    result.push(`  ${i+1}. ${item} [${cat}] (置信度: ${(confidence * 100).toFixed(0)}%)`);
                });
                if (likes.length > 10) {
                    result.push(`  ... 还有 ${likes.length - 10} 个`);
                }
            }
            
            if (dislikes.length > 0) {
                result.push('💔 不喜欢:');
                dislikes.slice(0, 10).forEach((p, i) => {
                    const item = p.item || p.name || '未知';
                    const cat = p.category || 'general';
                    const confidence = p.confidence || p.strength || 0.8;
                    result.push(`  ${i+1}. ${item} [${cat}] (置信度: ${(confidence * 100).toFixed(0)}%)`);
                });
                if (dislikes.length > 10) {
                    result.push(`  ... 还有 ${dislikes.length - 10} 个`);
                }
            }
        }
        
        console.log('💝 获取用户偏好:', totalCount, '个');
        return result.join('\n');
        
    } catch (error) {
        console.error('MemOS 获取偏好失败:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return "记忆系统服务未启动，无法获取偏好。";
        }
        return `获取偏好时出错: ${error.message}`;
    }
}

// 导出
module.exports = {
    getToolDefinitions: () => [
        // 基础记忆
        SEARCH_MEMORY_TOOL, 
        ADD_MEMORY_TOOL,
        // 图片记忆
        UPLOAD_IMAGE_TOOL,
        SEARCH_IMAGES_TOOL,
        SAVE_SCREENSHOT_TOOL,       // 截图并保存
        SAVE_IMAGE_FROM_FILE_TOOL,  // 🔥 新增：从文件保存图片
        // 工具使用记录
        RECORD_TOOL_USAGE_TOOL,
        SEARCH_TOOL_USAGE_TOOL,
        // 知识库/网页导入
        IMPORT_URL_TOOL,
        IMPORT_DOCUMENT_TOOL,
        // 记忆修正
        CORRECT_MEMORY_TOOL,
        // 偏好查询
        GET_PREFERENCES_TOOL
    ],
    executeFunction: async (name, parameters) => {
        switch (name) {
            // 基础记忆
            case "memos_search_memory":
                return await memosSearchMemory(parameters);
            case "memos_add_memory":
                return await memosAddMemory(parameters);
            // 图片记忆
            case "memos_upload_image":
                return await memosUploadImage(parameters);
            case "memos_search_images":
                return await memosSearchImages(parameters);
            case "memos_save_screenshot":
                return await memosSaveScreenshot(parameters);
            case "memos_save_image_from_file":  // 🔥 新增：从文件保存图片
                return await memosSaveImageFromFile(parameters);
            // 工具使用记录
            case "memos_record_tool_usage":
                return await memosRecordToolUsage(parameters);
            case "memos_search_tool_usage":
                return await memosSearchToolUsage(parameters);
            // 知识库/网页导入
            case "memos_import_url":
                return await memosImportUrl(parameters);
            case "memos_import_document":
                return await memosImportDocument(parameters);
            // 记忆修正
            case "memos_correct_memory":
                return await memosCorrectMemory(parameters);
            // 偏好查询
            case "memos_get_preferences":
                return await memosGetPreferences(parameters);
            default:
                throw new Error(`[MemOS Tool] 不支持此功能: ${name}`);
        }
    }
};

