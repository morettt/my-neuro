// DiaryManager.js - AI日记管理模块
const fs = require('fs');
const path = require('path');

class DiaryManager {
    constructor(voiceChatInterface) {
        this.voiceChat = voiceChatInterface;
        this.aiDiaryEnabled = voiceChatInterface.aiDiaryEnabled;
        this.aiDiaryIdleTime = voiceChatInterface.aiDiaryIdleTime;
        this.aiDiaryFile = voiceChatInterface.aiDiaryFile;
        this.aiDiaryPrompt = voiceChatInterface.aiDiaryPrompt;
        this.lastInteractionTime = Date.now();
        this.diaryTimer = null;
    }

    // 启动AI日记定时器
    startTimer() {
        if (this.diaryTimer) {
            clearTimeout(this.diaryTimer);
        }

        this.diaryTimer = setTimeout(() => {
            this.checkAndWriteDiary();
        }, this.aiDiaryIdleTime);

        console.log(`AI日记定时器已启动，${this.aiDiaryIdleTime / 60000}分钟后检查`);
    }

    // 重置日记定时器（用户交互时调用）
    resetTimer() {
        this.lastInteractionTime = Date.now();
        if (this.aiDiaryEnabled) {
            this.startTimer();
        }
    }

    // 检查并写入AI日记
    async checkAndWriteDiary() {
        try {
            console.log('开始检查AI日记条件...');

            // 检查条件1: 达到阈值时间
            const timeSinceLastInteraction = Date.now() - this.lastInteractionTime;
            if (timeSinceLastInteraction < this.aiDiaryIdleTime) {
                console.log('时间未达到阈值，跳过日记写入');
                return;
            }

            // 检查条件2: 记忆库里面有"交互"关键词
            const memoryPath = path.join(__dirname, '..', '..', 'AI记录室', '记忆库.txt');
            if (!fs.existsSync(memoryPath)) {
                console.log('记忆库文件不存在，跳过日记写入');
                return;
            }

            const memoryContent = fs.readFileSync(memoryPath, 'utf8');
            if (!memoryContent.includes('交互')) {
                console.log('记忆库中没有交互记录，跳过日记写入');
                return;
            }

            // 检查条件3: 当天还未记录日记
            const diaryPath = path.join(__dirname, '..', '..', this.aiDiaryFile);
            const today = new Date();
            const todayStr = `${today.getFullYear()}年${String(today.getMonth() + 1).padStart(2, '0')}月${String(today.getDate()).padStart(2, '0')}日`;

            if (fs.existsSync(diaryPath)) {
                const diaryContent = fs.readFileSync(diaryPath, 'utf8');
                if (diaryContent.includes(todayStr)) {
                    console.log('今天已经写过日记，跳过日记写入');
                    return;
                }
            }

            console.log('所有条件满足，开始生成AI日记...');
            await this.generateDiary(memoryContent, todayStr);

        } catch (error) {
            console.error('检查AI日记失败:', error);
        }
    }

    // 生成AI日记
    async generateDiary(memoryContent, dateStr) {
        try {
            // 提取今天的交互记录
            const todayInteractions = this.extractTodayInteractions(memoryContent, dateStr);
            if (!todayInteractions) {
                console.log('没有找到今天的交互记录');
                return;
            }

            console.log('正在生成AI日记...');

            // 构建日记生成的prompt
            const diaryPrompt = `${this.aiDiaryPrompt}

今天的对话记录：
${todayInteractions}

请写一篇日记：`;

            // 调用LLM生成日记
            const response = await fetch(`${this.voiceChat.API_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.voiceChat.API_KEY}`
                },
                body: JSON.stringify({
                    model: this.voiceChat.MODEL,
                    messages: [
                        {
                            role: 'user',
                            content: diaryPrompt
                        }
                    ],
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`API请求失败: ${response.status}`);
            }

            const data = await response.json();
            const diaryContent = data.choices[0].message.content;

            // 保存日记
            await this.saveDiary(diaryContent, dateStr);
            console.log('AI日记生成并保存成功');

        } catch (error) {
            console.error('生成AI日记失败:', error);
        }
    }

    // 提取今天的交互记录
    extractTodayInteractions(memoryContent, dateStr) {
        const lines = memoryContent.split('\n');
        let todaySection = '';
        let inTodaySection = false;

        for (const line of lines) {
            if (line.includes(`[${dateStr}]`)) {
                inTodaySection = true;
                continue;
            }

            if (inTodaySection) {
                if (line.startsWith('------------------------------------')) {
                    // 遇到新的分割线，说明今天的记录结束
                    break;
                }
                todaySection += line + '\n';
            }
        }

        return todaySection.trim() || null;
    }

    // 保存日记
    async saveDiary(diaryContent, dateStr) {
        try {
            const diaryPath = path.join(__dirname, '..', '..', this.aiDiaryFile);

            // 确保AI记录室文件夹存在
            const diaryDir = path.dirname(diaryPath);
            if (!fs.existsSync(diaryDir)) {
                fs.mkdirSync(diaryDir, { recursive: true });
            }

            const diaryEntry = `------------------------------------\n[${dateStr}] 肥牛的日记\n\n${diaryContent}\n\n`;

            fs.appendFileSync(diaryPath, diaryEntry, 'utf8');
            console.log('AI日记已保存到文件');

        } catch (error) {
            console.error('保存AI日记失败:', error);
        }
    }
}

module.exports = { DiaryManager };
