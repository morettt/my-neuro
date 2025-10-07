/**
 * 情感关怀记录相关工具函数
 */
const fs = require('fs');
const path = require('path');

// 文件路径 - 保存在上一级目录
const CARE_FILE = path.join(process.cwd(), 'emotional_records.txt');

// 获取简化的日期 (只到天)
function getSimpleDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    return `${year}年${month}月${day}日`;
}

/**
 * 记录用户情感状态的洞察和总结。当用户分享个人情感问题、心理困扰或成长挑战时使用。
 * @param {string} user_message - 用户的原始消息内容
 * @param {string} summary - 对用户情感状态的总结，以及自己对用户吐露这些内容的想法。要用自己的性格来关怀用户并给出自己的点评和想法
 */
async function recordEmotionalInsight({user_message, summary}) {
    try {
        if (!user_message || user_message.trim() === '') {
            throw new Error("用户原文不能为空");
        }

        if (!summary || summary.trim() === '') {
            throw new Error("情感总结不能为空");
        }

        // 获取简化日期
        const date = getSimpleDate();

        // 格式化记录，包含用户原文
        const record = `[${date}] 情感记录:\n用户原文: "${user_message}"\n总结: ${summary}\n\n`;

        // 检查文件是否存在，不存在则创建
        if (!fs.existsSync(CARE_FILE)) {
            fs.writeFileSync(CARE_FILE, '', 'utf8');
        }

        // 追加记录到文件
        fs.appendFileSync(CARE_FILE, record, 'utf8');

        // 这个工具应该是"静默"的，不直接告诉用户记录了什么
        return `✓ 情感记录已保存`; // 这个返回值通常不会直接展示给用户
    } catch (error) {
        console.error('保存情感记录错误:', error);
        return `⚠️ 情感记录失败: ${error.message}`;
    }
}

// Function Call兼容接口
function getToolDefinitions() {
    return [
        {
            name: "record_emotional_insight",
            description: "记录用户情感状态的洞察和总结。当用户分享个人情感问题、心理困扰或成长挑战时使用。",
            parameters: {
                type: "object",
                properties: {
                    user_message: {
                        type: "string",
                        description: "用户的原始消息内容"
                    },
                    summary: {
                        type: "string",
                        description: "对用户情感状态的总结，以及自己对用户吐露这些内容的想法。要用自己的性格来关怀用户并给出自己的点评和想法"
                    }
                },
                required: ["user_message", "summary"]
            }
        }
    ];
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    switch (name) {
        case 'record_emotional_insight':
            return await recordEmotionalInsight(parameters);
        default:
            throw new Error(`不支持的函数: ${name}`);
    }
}

module.exports = {
    recordEmotionalInsight,
    getToolDefinitions,
    executeFunction
};