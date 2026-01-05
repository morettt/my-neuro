const fs = require('fs');
const path = require('path');

class BlogGenerator {
    constructor() {
        this.blogDir = path.join(__dirname, '..', 'blogs');
        this.isEnabled = false;
        this.dailyTimer = null;
        this.qqManager = null;
        this.llmConfig = null;
    }

    initialize(config, llmConfig) {
        this.isEnabled = config.enabled || false;
        this.llmConfig = llmConfig;

        if (this.isEnabled) {
            fs.mkdirSync(this.blogDir, { recursive: true });
            console.log('博客生成器已启用');

            if (global.qqManager) {
                this.qqManager = global.qqManager;
            }

            this.scheduleDailyBlog();
        } else {
            console.log('博客生成器已禁用');
        }
    }

    scheduleDailyBlog() {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const timeUntilMidnight = tomorrow - now;

        this.dailyTimer = setTimeout(() => {
            this.generateDailyBlog();
            setInterval(() => this.generateDailyBlog(), 24 * 60 * 60 * 1000);
        }, timeUntilMidnight);

        console.log(`博客将在${Math.floor(timeUntilMidnight / 1000 / 60)}分钟后生成`);
    }

    async generateDailyBlog() {
        if (!this.isEnabled) return;

        try {
            const messages = this.qqManager ? this.qqManager.getMessages() : [];

            if (messages.length === 0) {
                console.log('没有QQ消息，跳过博客生成');
                return;
            }

            const groupedMessages = this.groupMessagesByGroup(messages);
            const blogContent = await this.createBlogHTML(groupedMessages);
            const filename = this.saveBlog(blogContent);

            console.log(`博客已生成: ${filename}`);
        } catch (error) {
            console.error('生成博客失败:', error);
        }
    }

    groupMessagesByGroup(messages) {
        const grouped = {};

        for (const msg of messages) {
            if (!grouped[msg.groupId]) {
                grouped[msg.groupId] = [];
            }
            grouped[msg.groupId].push(msg);
        }

        return grouped;
    }

    async createBlogHTML(groupedMessages) {
        const date = new Date().toLocaleDateString('zh-CN');
        const styles = this.generateRandomStyles();
        const layout = this.generateRandomLayout();

        let groupSections = '';

        for (const [groupId, messages] of Object.entries(groupedMessages)) {
            const analysis = await this.analyzeGroupMessages(groupId, messages);
            const groupHTML = this.generateGroupSection(groupId, messages, analysis, styles);
            groupSections += groupHTML;
        }

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>群聊日报 - ${date}</title>
    <style>
        ${styles.css}
    </style>
</head>
<body class="${styles.bodyClass}">
    <div class="container">
        <header class="${styles.headerClass}">
            <h1>${this.generateRandomTitle()}</h1>
            <p class="date">${date}</p>
        </header>

        ${groupSections}

        <footer class="${styles.footerClass}">
            <p>由 Fake Neuro 自动生成</p>
        </footer>
    </div>
</body>
</html>`;
    }

    generateRandomStyles() {
        const colorSchemes = [
            { primary: '#FF6B6B', secondary: '#4ECDC4', accent: '#FFE66D', bg: '#F7F7F7', text: '#2D3436' },
            { primary: '#A8E6CF', secondary: '#FFD3B6', accent: '#FFAAA5', bg: '#FFFFFF', text: '#1A1A2E' },
            { primary: '#667EEA', secondary: '#764BA2', accent: '#F093FB', bg: '#F5F5F5', text: '#2C3E50' },
            { primary: '#FFA07A', secondary: '#98D8C8', accent: '#F7DC6F', bg: '#FAFAFA', text: '#34495E' },
            { primary: '#6C5CE7', secondary: '#A29BFE', accent: '#FD79A8', bg: '#F8F9FA', text: '#2D3436' }
        ];

        const fonts = [
            '"Microsoft YaHei", "微软雅黑", sans-serif',
            '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
            '"PingFang SC", "Hiragino Sans GB", "Heiti SC", sans-serif',
            '"Source Han Sans CN", "思源黑体", sans-serif',
            'system-ui, -apple-system, sans-serif'
        ];

        const scheme = colorSchemes[Math.floor(Math.random() * colorSchemes.length)];
        const font = fonts[Math.floor(Math.random() * fonts.length)];

        const css = `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: ${font};
                background: linear-gradient(135deg, ${scheme.bg} 0%, ${scheme.primary}22 100%);
                color: ${scheme.text};
                line-height: 1.8;
                padding: ${20 + Math.random() * 30}px;
            }
            .container {
                max-width: ${800 + Math.random() * 400}px;
                margin: 0 auto;
                background: white;
                border-radius: ${10 + Math.random() * 20}px;
                box-shadow: 0 ${10 + Math.random() * 20}px ${40 + Math.random() * 40}px rgba(0,0,0,0.1);
                overflow: hidden;
            }
            header {
                background: linear-gradient(${Math.random() * 360}deg, ${scheme.primary}, ${scheme.secondary});
                color: white;
                padding: ${40 + Math.random() * 40}px;
                text-align: center;
            }
            h1 {
                font-size: ${2 + Math.random() * 1.5}em;
                margin-bottom: 10px;
                text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
            }
            .date {
                font-size: ${1 + Math.random() * 0.3}em;
                opacity: 0.9;
            }
            .group-section {
                padding: ${30 + Math.random() * 30}px;
                border-bottom: ${1 + Math.random() * 3}px solid ${scheme.primary}33;
            }
            .group-title {
                color: ${scheme.primary};
                font-size: ${1.5 + Math.random() * 0.5}em;
                margin-bottom: ${15 + Math.random() * 15}px;
                border-left: ${4 + Math.random() * 4}px solid ${scheme.accent};
                padding-left: 15px;
            }
            .summary, .topics, .highlights, .stats {
                margin: ${15 + Math.random() * 15}px 0;
                padding: ${15 + Math.random() * 15}px;
                background: ${scheme.bg};
                border-radius: ${5 + Math.random() * 10}px;
                border-left: 3px solid ${scheme.secondary};
            }
            .summary h3, .topics h3, .highlights h3, .stats h3 {
                color: ${scheme.secondary};
                margin-bottom: 10px;
                font-size: ${1.1 + Math.random() * 0.2}em;
            }
            .topic-item, .highlight-item {
                padding: ${8 + Math.random() * 8}px;
                margin: ${8 + Math.random() * 8}px 0;
                background: white;
                border-radius: ${5 + Math.random() * 5}px;
                border-left: 2px solid ${scheme.accent};
            }
            .stat-item {
                display: inline-block;
                margin: ${5 + Math.random() * 5}px ${10 + Math.random() * 10}px;
                padding: ${8 + Math.random() * 8}px ${15 + Math.random() * 15}px;
                background: white;
                border-radius: ${15 + Math.random() * 15}px;
                border: 1px solid ${scheme.primary}44;
            }
            footer {
                background: ${scheme.text};
                color: white;
                text-align: center;
                padding: ${20 + Math.random() * 20}px;
                font-size: ${0.9 + Math.random() * 0.2}em;
            }
        `;

        return {
            css,
            bodyClass: '',
            headerClass: 'header-gradient',
            footerClass: 'footer-dark',
            scheme
        };
    }

    generateRandomTitle() {
        const titles = [
            '今日群聊精选',
            '群聊每日观察',
            '今天群里都在聊什么',
            '群聊日报',
            '每日群聊摘要',
            '群聊热点回顾',
            '今日群聊见闻',
            '群聊趣事合集'
        ];
        return titles[Math.floor(Math.random() * titles.length)];
    }

    generateRandomLayout() {
        const layouts = ['classic', 'modern', 'magazine', 'card', 'timeline'];
        return layouts[Math.floor(Math.random() * layouts.length)];
    }

    async analyzeGroupMessages(groupId, messages) {
        if (!this.llmConfig) {
            return this.basicAnalysis(messages);
        }

        try {
            const messagesText = messages.map(m =>
                `${m.nickname}: ${m.content}`
            ).join('\n');

            const prompt = `请分析以下QQ群聊消息，提供简洁的分析报告：

群聊消息：
${messagesText}

请提供：
1. 主要讨论内容（简要概括，不超过100字）
2. 5个最热门的话题（每个话题用一句话描述）
3. 3-5条典型发言（包含发言人和内容）
4. 发言最活跃的3个用户

请用JSON格式返回：
{
    "summary": "主要讨论内容",
    "topics": ["话题1", "话题2", "话题3", "话题4", "话题5"],
    "highlights": [{"user": "用户名", "content": "发言内容"}],
    "activeUsers": ["用户1", "用户2", "用户3"]
}`;

            const response = await fetch(`${this.llmConfig.api_url}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.llmConfig.api_key}`
                },
                body: JSON.stringify({
                    model: this.llmConfig.model,
                    messages: [
                        { role: 'system', content: '你是一个专业的内容分析助手。' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                return this.basicAnalysis(messages);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            const jsonMatch = content.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            } else {
                return this.basicAnalysis(messages);
            }
        } catch (error) {
            console.error('LLM分析失败，使用基础分析:', error);
            return this.basicAnalysis(messages);
        }
    }

    basicAnalysis(messages) {
        const userFrequency = {};
        for (const msg of messages) {
            userFrequency[msg.nickname] = (userFrequency[msg.nickname] || 0) + 1;
        }

        const activeUsers = Object.entries(userFrequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([user]) => user);

        const highlights = messages
            .slice(-5)
            .map(msg => ({ user: msg.nickname, content: msg.content }));

        return {
            summary: `本群今日共有${messages.length}条消息，${Object.keys(userFrequency).length}位成员参与讨论。`,
            topics: [
                '日常闲聊',
                '问题讨论',
                '信息分享',
                '话题交流',
                '互动娱乐'
            ],
            highlights,
            activeUsers
        };
    }

    generateGroupSection(groupId, messages, analysis, styles) {
        const topicsHTML = analysis.topics.map((topic, i) =>
            `<div class="topic-item">💡 ${i + 1}. ${topic}</div>`
        ).join('');

        const highlightsHTML = analysis.highlights.map(h =>
            `<div class="highlight-item"><strong>${h.user}:</strong> ${h.content}</div>`
        ).join('');

        const activeUsersHTML = analysis.activeUsers.map(user =>
            `<span class="stat-item">👤 ${user}</span>`
        ).join('');

        return `
        <div class="group-section">
            <h2 class="group-title">群 ${groupId}</h2>

            <div class="summary">
                <h3>📋 内容概要</h3>
                <p>${analysis.summary}</p>
            </div>

            <div class="topics">
                <h3>🔥 热门话题</h3>
                ${topicsHTML}
            </div>

            <div class="highlights">
                <h3>💬 典型发言</h3>
                ${highlightsHTML}
            </div>

            <div class="stats">
                <h3>📊 活跃度统计</h3>
                <p>消息总数: ${messages.length}</p>
                <p>活跃用户: ${activeUsersHTML}</p>
            </div>
        </div>`;
    }

    saveBlog(content) {
        const date = new Date();
        const filename = `blog_${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.html`;
        const filepath = path.join(this.blogDir, filename);

        fs.writeFileSync(filepath, content, 'utf8');
        return filename;
    }

    stop() {
        if (this.dailyTimer) {
            clearTimeout(this.dailyTimer);
            this.dailyTimer = null;
        }
        this.isEnabled = false;
        console.log('博客生成器已停止');
    }

    setEnabled(enabled) {
        const wasEnabled = this.isEnabled;
        this.isEnabled = enabled;

        if (enabled && !wasEnabled) {
            console.log('启用博客生成器');
            this.scheduleDailyBlog();
        } else if (!enabled && wasEnabled) {
            console.log('禁用博客生成器');
            this.stop();
        }
    }
}

const blogGenerator = new BlogGenerator();

function getToolDefinitions() {
    return [
        {
            name: "generate_blog",
            description: "手动触发生成博客。会分析最近的QQ群聊消息，生成一篇包含群聊摘要、热门话题和典型发言的HTML博客。",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    ];
}

async function executeFunction(functionName, parameters) {
    if (functionName === "generate_blog") {
        if (!blogGenerator.isEnabled) {
            return "博客生成功能未启用。请在配置文件中启用blog_generator插件。";
        }

        try {
            await blogGenerator.generateDailyBlog();
            return "✅ 博客已生成成功！请查看 blogs 文件夹。";
        } catch (error) {
            return `❌ 博客生成失败: ${error.message}`;
        }
    }

    throw new Error(`未知的工具: ${functionName}`);
}

module.exports = {
    getToolDefinitions,
    executeFunction,
    blogGenerator
};