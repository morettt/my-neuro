/**
 * 网络搜索相关工具函数
 */
const axios = require('axios');

// Tavily API配置
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "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";

/**
 * 使用搜索网络引擎，并返回内容
 * @param {string} query - 想要搜索的内容关键词
 */
async function webSearch({query}) {
    try {
        console.log(`正在搜索: ${query}`);

        const response = await axios.post("https://api.tavily.com/search", {
            query: query,
            max_results: 3,
            include_answer: true,
            search_depth: "basic",
            api_key: TAVILY_API_KEY
        });

        // 检查响应是否有效
        if (!response.data) {
            return "错误：搜索没有返回任何结果";
        }

        let fullContent = '';

        // 先添加AI答案摘要
        const aiAnswer = response.data.answer || '无AI摘要';
        fullContent += `AI答案摘要：${aiAnswer}\n\n`;

        // 然后添加搜索结果
        const searchResults = response.data.results || [];
        if (searchResults.length > 0) {
            fullContent += "详细搜索结果：\n";
            searchResults.forEach((result, i) => {
                try {
                    const title = result.title || '无标题';
                    const content = result.content || '无内容';
                    const url = result.url || '无URL';

                    fullContent += `${i + 1}. 标题：${title}\n`;
                    fullContent += `   内容：${content.substring(0, 1500)}...\n`;
                    fullContent += `   来源：${url}\n\n`;
                } catch (e) {
                    fullContent += `${i + 1}. 处理搜索结果时出错：${e.message}\n\n`;
                }
            });
        } else {
            fullContent += "未找到相关搜索结果。\n";
        }

        return fullContent;

    } catch (error) {
        console.error("搜索错误:", error.message);

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            return "错误：网络连接失败，请检查网络连接";
        }

        return `搜索过程中出现错误：${error.message}`;
    }
}

// Function Call兼容接口
function getToolDefinitions() {
    return [
        {
            name: "web_search",
            description: "使用搜索网络引擎，并返回内容",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "想要搜索的内容关键词"
                    }
                },
                required: ["query"]
            }
        }
    ];
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    switch (name) {
        case 'web_search':
            return await webSearch(parameters);
        default:
            throw new Error(`不支持的函数: ${name}`);
    }
}

module.exports = {
    webSearch,
    getToolDefinitions,
    executeFunction
};