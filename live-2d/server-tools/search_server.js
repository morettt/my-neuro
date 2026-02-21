/**
 * Rabbit Search 语义并发搜索工具
 * 核心思路：多关键词并发搜索 + 下级智能体深度整合
 * 
 * 工作流程：
 * 1. 主LLM调用此工具，传入搜索主题和关键词
 * 2. 将关键词拆分，并发调用 Tavily 搜索
 * 3. 调用下级智能体（DeepSeek-V3.2）对每组搜索结果进行语义提炼
 * 4. 汇总所有提炼结果，返回结构化的搜索报告
 * 
 * 版本：1.0.0
 */

const axios = require('axios');

// ==================== 配置 ====================

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "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";
const TAVILY_API_URL = "https://api.tavily.com/search";

const SILICONFLOW_API_URL = 'https://www.dmxapi.cn/v1/chat/completions';
const SILICONFLOW_API_KEY = 'sk-t95DArKVeBgoxBITRaRb0J3NROfaGUNmTkdV5R0AgDUHdL2d';
const AGENT_MODEL = 'GLM-4.7-Flash';

const MAX_CONCURRENT = 4;
const MAX_RETRIES = 2;
const RETRY_DELAY = 2000;

// ==================== 通用重试 ====================

async function withRetry(fn, label, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isLast = attempt === retries;
            if (isLast) throw error;
            console.error(`   ⚠️ [${label}] 第${attempt + 1}次失败: ${error.message}，${RETRY_DELAY / 1000}秒后重试...`);
            await new Promise(r => setTimeout(r, RETRY_DELAY));
        }
    }
}

// ==================== 工具定义 ====================

const VSEARCH_TOOL = {
    name: "vsearch",
    description: "【主搜索工具 - 语义并发深度搜索】联网搜索的首选工具。它会将问题智能拆分为多个关键词并发搜索，再用AI整合出高质量的结构化报告。比普通搜索更全面、更深入、质量更高。适合：游戏攻略/剧情查询、技术问题调研、热点事件了解、任何需要全面信息的场景。只有在明确需要特定引擎（如学术论文、站内搜索）时才使用其他搜索工具。",
    parameters: {
        type: "object",
        properties: {
            topic: {
                type: "string",
                description: "搜索的目标主题，描述你想了解什么（如：鸣潮角色爱弥斯的剧情故事线）"
            },
            keywords: {
                type: "string",
                description: "具体的搜索关键词，多个关键词用逗号分隔（如：鸣潮 爱弥斯 剧情,Wuthering Waves Aemis story,鸣潮爱弥斯角色故事）。建议2-5个关键词，中英文混合效果更好。"
            }
        },
        required: ["topic", "keywords"]
    }
};

// ==================== 辅助函数 ====================

/**
 * 调用 Tavily 搜索单个关键词
 */
async function tavilySearch(keyword) {
    try {
        const data = await withRetry(async () => {
            const response = await axios.post(TAVILY_API_URL, {
                query: keyword,
                max_results: 5,
                include_answer: true,
                search_depth: "advanced",
                api_key: TAVILY_API_KEY
            }, { timeout: 30000 });
            return response.data;
        }, `Tavily·${keyword}`);

        if (!data) return null;

        let content = '';
        if (data.answer) {
            content += `摘要：${data.answer}\n\n`;
        }

        const results = data.results || [];
        results.forEach((item, i) => {
            const title = item.title || '无标题';
            const text = item.content || '';
            const url = item.url || '';
            content += `[${i + 1}] ${title}\n${text.substring(0, 800)}\n来源: ${url}\n\n`;
        });

        return content || null;
    } catch (error) {
        console.error(`[VSearch] 搜索 "${keyword}" 最终失败:`, error.message);
        return null;
    }
}

/**
 * 调用下级智能体整合单个关键词的搜索结果
 */
async function synthesizeResult(topic, keyword, rawSearchData) {
    const systemPrompt = `你是一个专业的信息整合助手。你的任务是根据【研究主题】和【检索关键词】，从提供的原始搜索结果中提取最有价值的信息，生成精炼的结构化摘要。

要求：
1. 深入理解研究主题，确保提取的信息直接服务于该主题
2. 从搜索结果中提取关键事实、核心数据、重要细节
3. 去除广告、无关内容、重复信息
4. 输出格式：[核心发现] + [关键细节]，信息密度要高
5. 控制在500字以内，确保重要信息不遗漏`;

    const userMessage = `【研究主题】：${topic}
【当前关键词】：${keyword}

【原始搜索结果】：
${rawSearchData}

请提取并整合最有价值的信息：`;

    try {
        return await withRetry(async () => {
            const response = await axios.post(SILICONFLOW_API_URL, {
                model: AGENT_MODEL,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ],
                temperature: 0.3,
                max_tokens: 2000
            }, {
                headers: {
                    'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            });
            return response.data.choices[0].message.content;
        }, `DeepSeek整合·${keyword}`);
    } catch (error) {
        console.error(`[VSearch] 整合 "${keyword}" 最终失败:`, error.message);
        return `[整合失败] ${keyword}: ${error.message}`;
    }
}

// ==================== 主函数 ====================

/**
 * VSearch 语义并发深度搜索 - 多关键词并发搜索并用AI整合结果
 * @param {string} topic - 搜索的目标主题
 * @param {string} keywords - 搜索关键词，逗号分隔
 */
async function vsearch({ topic, keywords }) {
    if (!topic || !keywords) {
        return "错误：请提供搜索主题(topic)和关键词(keywords)";
    }

    const keywordList = keywords.split(/[,，\n]/)
        .map(k => k.trim())
        .filter(k => k.length > 0);

    if (keywordList.length === 0) {
        return "错误：未识别到有效的关键词";
    }

    console.log(`\n🔍 [VSearch] 启动语义并发搜索`);
    console.log(`   主题: ${topic}`);
    console.log(`   关键词(${keywordList.length}个): ${keywordList.join(' | ')}`);

    const allResults = [];

    for (let i = 0; i < keywordList.length; i += MAX_CONCURRENT) {
        const chunk = keywordList.slice(i, i + MAX_CONCURRENT);

        const searchPromises = chunk.map(async (kw) => {
            console.log(`   🔎 搜索: "${kw}"`);
            const rawData = await tavilySearch(kw);
            if (!rawData) {
                return { keyword: kw, result: `[搜索无结果] ${kw}` };
            }

            console.log(`   🤖 整合: "${kw}"`);
            const synthesized = await synthesizeResult(topic, kw, rawData);
            return { keyword: kw, result: synthesized };
        });

        const chunkResults = await Promise.all(searchPromises);
        allResults.push(...chunkResults);
    }

    let report = `【${topic}】搜索报告\n\n`;
    allResults.forEach(({ keyword, result }) => {
        report += `━━━ ${keyword} ━━━\n${result}\n\n`;
    });

    console.log(`✅ [VSearch] 搜索完成，共 ${allResults.length} 组结果\n`);

    return report;
}

// ==================== 导出 ====================

function getToolDefinitions() {
    return [VSEARCH_TOOL];
}

async function executeFunction(name, parameters) {
    if (name === "vsearch") {
        return await vsearch(parameters);
    }
    throw new Error(`[VSearch] 不支持的功能: ${name}`);
}

module.exports = {
    vsearch,
    getToolDefinitions,
    executeFunction
};
