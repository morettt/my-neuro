/**
 * 笔记记录相关工具函数
 */
const fs = require('fs');
const path = require('path');

// 文件路径 - 保存在上一级目录
const RECORDS_FILE = path.join(process.cwd(), '事件记录.txt');

// 获取简化的日期 (只到天)
function getSimpleDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    return `${year}年${month}月${day}日`;
}

/**
 * 当遇到想要记录的内容，可以使用此工具记录下内容
 * @param {string} content - 要记录的内容
 */
async function recordNote({content}) {
    try {
        if (!content || content.trim() === '') {
            throw new Error("记录内容不能为空");
        }

        // 获取简化日期
        const date = getSimpleDate();

        // 格式化笔记
        const note = `[${date}] 普通记录: ${content}\n\n`;

        // 检查文件是否存在，不存在则创建
        if (!fs.existsSync(RECORDS_FILE)) {
            fs.writeFileSync(RECORDS_FILE, '', 'utf8');
        }

        // 追加笔记到文件
        fs.appendFileSync(RECORDS_FILE, note, 'utf8');

        return `✅ 已记录到事件记录.txt文件`;
    } catch (error) {
        console.error('保存笔记错误:', error);
        return `⚠️ 记录失败: ${error.message}`;
    }
}

// Function Call兼容接口
function getToolDefinitions() {
    return [
        {
            name: "record_note",
            description: "当遇到想要记录的内容，可以使用此工具记录下内容",
            parameters: {
                type: "object",
                properties: {
                    content: {
                        type: "string",
                        description: "要记录的内容"
                    }
                },
                required: ["content"]
            }
        }
    ];
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    switch (name) {
        case 'record_note':
            return await recordNote(parameters);
        default:
            throw new Error(`不支持的函数: ${name}`);
    }
}

module.exports = {
    recordNote,
    getToolDefinitions,
    executeFunction
};