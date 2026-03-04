// MoodChatModule.js - 基于心情系统的智能主动对话模块
const fs = require('fs');
const path = require('path');
const { appState } = require('../core/app-state.js');
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');
const { logToTerminal } = require('../api-utils.js');

class MoodChatModule {
    constructor(config) {
        this.config = config;
        this.enabled = config.enabled || false;

        // 从配置读取参数
        const moodConfig = config;

        // 对话间隔配置（秒）
        this.intervals = {
            excited: (moodConfig.intervals?.excited || 5) * 1000,      // 默认5秒
            normal: (moodConfig.intervals?.normal || 30) * 1000,       // 默认30秒
            low: (moodConfig.intervals?.low || 120) * 1000,            // 默认120秒
            silent: moodConfig.intervals?.silent || -1                 // 默认-1（不对话）
        };

        // 心情阈值配置
        this.thresholds = {
            excited: moodConfig.thresholds?.excited || 90,
            normal: moodConfig.thresholds?.normal || 80,
            low: moodConfig.thresholds?.low || 60
        };

        // 心情变化配置
        this.moodChanges = {
            userResponse: moodConfig.mood_changes?.user_response || 5,
            noResponse: moodConfig.mood_changes?.no_response || -10,
            regressionTarget: moodConfig.mood_changes?.regression_target || 80,
            regressionInterval: moodConfig.mood_changes?.regression_interval || 60000
        };

        // 响应超时配置（毫秒）
        this.responseTimeout = moodConfig.response_timeout || 10000;

        // 主动对话提示词配置（统一提示词）
        this.prompt = moodConfig.prompt || "请主动根据上下文说些什么。";

        // 当前状态
        this.moodScore = this.moodChanges.regressionTarget; // 初始心情=回归目标
        this.stableMood = this.moodChanges.regressionTarget; // 稳定心情分数
        this.isProcessing = false;
        this.waitingForResponse = false;
        this.responseTimer = null;
        this.chatTimer = null;
        this.regressionTimer = null;
        this.lastChatTime = Date.now();

        // 心情评估配置
        this.moodEvaluationPrompt = moodConfig.evaluation_prompt ||
            "请根据以下内容，评估fake neuro（肥牛）今天的心情分数（0-100分）。只返回一个数字，不要其他内容。";
    }

    /**
     * 启动心情对话系统
     */
    start() {
        if (!this.enabled) {
            return;
        }

        // 监听用户回应事件
        eventBus.on(Events.USER_MESSAGE_RECEIVED, () => {
            this.onUserResponse();
        });

        // 启动心情回归机制（每分钟调整1分）
        this.startMoodRegression();

        // 启动心情分文件同步
        this.startMoodFileSync();

        // 异步评估初始心情（评估完成后才安排对话）
        this.evaluateInitialMood().catch(err => {
            logToTerminal('error', `初始心情评估失败: ${err.message}`);
            // 评估失败时，用默认心情启动对话
            this.scheduleNextChat();
        });
    }

    /**
     * 停止心情对话系统
     */
    stop() {
        logToTerminal('info', '🛑 停止心情对话系统');

        if (this.chatTimer) {
            clearTimeout(this.chatTimer);
            this.chatTimer = null;
        }

        if (this.responseTimer) {
            clearTimeout(this.responseTimer);
            this.responseTimer = null;
        }

        if (this.regressionTimer) {
            clearInterval(this.regressionTimer);
            this.regressionTimer = null;
        }

        // 停止心情分文件同步
        this.stopMoodFileSync();

        eventBus.off(Events.USER_MESSAGE_RECEIVED);
        this.isProcessing = false;
        this.waitingForResponse = false;
    }

    /**
     * 异步评估初始心情分数
     */
    async evaluateInitialMood() {
        try {
            // 读取AI日记和记忆库
            const diaryPath = path.join(__dirname, '..', '..', 'AI记录室', 'AI日记.txt');
            const memoryPath = path.join(__dirname, '..', '..', 'AI记录室', '记忆库.txt');

            let contextContent = '';
            let hasDiary = false;
            let hasMemory = false;

            // 检查并读取日记文件
            if (fs.existsSync(diaryPath)) {
                try {
                    const diaryContent = fs.readFileSync(diaryPath, 'utf8');
                    const trimmedContent = diaryContent.trim();
                    if (trimmedContent.length > 0) {
                        const lines = trimmedContent.split('\n').slice(-20).join('\n');
                        contextContent += `最近的日记：\n${lines}\n\n`;
                        hasDiary = true;
                    }
                } catch (err) {
                    logToTerminal('warn', `⚠️ 读取日记文件失败: ${err.message}`);
                }
            }

            // 检查并读取记忆库文件
            if (fs.existsSync(memoryPath)) {
                try {
                    const memoryContent = fs.readFileSync(memoryPath, 'utf8');
                    const trimmedContent = memoryContent.trim();
                    if (trimmedContent.length > 0) {
                        const lines = trimmedContent.split('\n').slice(-20).join('\n');
                        contextContent += `最近的记忆：\n${lines}`;
                        hasMemory = true;
                    }
                } catch (err) {
                    logToTerminal('warn', `⚠️ 读取记忆库文件失败: ${err.message}`);
                }
            }

            // 判断是否有足够的上下文信息
            const voiceChat = global.voiceChat;

            // 情况1：没有日记和记忆（首次使用或文件为空）
            if (!contextContent.trim()) {
                this.moodScore = 80;
                if (!hasDiary && !hasMemory) {
                    logToTerminal('info', `🆕 首次启动，无历史记录，初始心情默认: ${this.moodScore}分`);
                } else {
                    logToTerminal('info', `📝 日记和记忆为空，初始心情默认: ${this.moodScore}分`);
                }
                this.scheduleNextChat();
                return;
            }

            // 情况2：voiceChat不可用
            if (!voiceChat) {
                this.moodScore = 80;
                logToTerminal('warn', `⚠️ LLM不可用，无法评估心情，默认: ${this.moodScore}分`);
                this.scheduleNextChat();
                return;
            }

            // 情况3：有历史记录，开始智能评估
            logToTerminal('info', `🔍 发现历史记录（日记:${hasDiary ? '✓' : '✗'} 记忆:${hasMemory ? '✓' : '✗'}），开始评估心情...`);

            const prompt = `请根据以下内容，评估fake neuro（肥牛）的心情分数（0-100分）。只返回一个数字。\n\n${contextContent}`;

            const response = await fetch(`${voiceChat.API_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${voiceChat.API_KEY}`
                },
                body: JSON.stringify({
                    model: voiceChat.MODEL,
                    messages: [{ role: 'user', content: prompt }],
                    stream: false,
                    temperature: 1.5  // 高随机性，每次评估都不同
                })
            });

            if (!response.ok) throw new Error(`API请求失败: ${response.status}`);

            const data = await response.json();
            const score = parseInt(data.choices[0].message.content.match(/\d+/)?.[0] || '80');
            this.moodScore = Math.max(0, Math.min(100, score));

            logToTerminal('info', `✨ 评估完成，初始心情: ${this.moodScore}分`);
            this.scheduleNextChat();

        } catch (error) {
            logToTerminal('error', `❌ 心情评估失败: ${error.message}，使用默认值80分`);
            this.moodScore = 80;
            this.scheduleNextChat();
        }
    }


    /**
     * 根据心情分数获取对话间隔（毫秒）
     */
    getChatInterval() {
        if (this.moodScore >= this.thresholds.excited) {
            return this.intervals.excited;
        } else if (this.moodScore >= this.thresholds.normal) {
            return this.intervals.normal;
        } else if (this.moodScore >= this.thresholds.low) {
            return this.intervals.low;
        } else {
            return this.intervals.silent === -1 ? Infinity : this.intervals.silent;
        }
    }

    /**
     * 安排下一次主动对话
     */
    scheduleNextChat() {
        if (this.chatTimer) {
            clearTimeout(this.chatTimer);
        }

        const interval = this.getChatInterval();

        if (interval === Infinity) {
            logToTerminal('info', `😔 心情太低(${this.moodScore}分)，暂停主动对话`);
            // 即使暂停，也安排1小时后检查（心情可能会回升）
            this.chatTimer = setTimeout(() => this.scheduleNextChat(), 3600000);
            return;
        }

        const nextTime = new Date(Date.now() + interval).toLocaleTimeString();
        logToTerminal('info', `⏰ 下次主动对话: ${nextTime} (心情${this.moodScore}分, ${interval/1000}秒后)`);

        this.chatTimer = setTimeout(() => {
            this.executeChat();
        }, interval);
    }

    /**
     * 执行主动对话
     */
    async executeChat() {
        if (this.isProcessing) {
            logToTerminal('info', '⏸️ 正在处理中，跳过本次主动对话');
            this.scheduleNextChat();
            return;
        }

        // 检查系统状态
        if (appState.isPlayingTTS() || appState.isProcessingBarrage() || appState.isProcessingUserInput()) {
            logToTerminal('info', '⏸️ 系统繁忙，延迟主动对话');
            setTimeout(() => this.executeChat(), 5000);
            return;
        }

        this.isProcessing = true;
        this.lastChatTime = Date.now();

        try {
            logToTerminal('info', `💬 执行主动对话 (心情${this.moodScore}分)`);

            const voiceChat = global.voiceChat;
            if (!voiceChat) {
                logToTerminal('error', 'voiceChat不可用');
                return;
            }

            // 发送到LLM
            await voiceChat.sendToLLM(this.prompt);

            // 监听TTS结束事件，TTS播放完成后才开始计时
            const ttsEndHandler = () => {
                // TTS播放完成，现在才开始等待用户回应
                this.waitingForResponse = true;
                this.startResponseTimer();
                logToTerminal('info', '🎤 TTS播放完成，开始等待用户回应');
            };

            // 监听TTS结束或被打断
            eventBus.once(Events.TTS_END, ttsEndHandler);
            eventBus.once(Events.TTS_INTERRUPTED, ttsEndHandler);

            // 如果5秒后还没触发TTS事件（TTS可能被禁用），直接开始计时
            setTimeout(() => {
                if (!this.waitingForResponse) {
                    eventBus.off(Events.TTS_END, ttsEndHandler);
                    eventBus.off(Events.TTS_INTERRUPTED, ttsEndHandler);
                    ttsEndHandler();
                }
            }, 5000);

        } catch (error) {
            logToTerminal('error', `❌ 主动对话执行失败: ${error.message}`);
        } finally {
            this.isProcessing = false;
            // 安排下一次对话
            this.scheduleNextChat();
        }
    }


    /**
     * 启动用户响应计时器（10秒）
     */
    startResponseTimer() {
        if (this.responseTimer) {
            clearTimeout(this.responseTimer);
        }

        this.responseTimer = setTimeout(() => {
            if (this.waitingForResponse) {
                logToTerminal('info', `😞 用户${this.responseTimeout/1000}秒内没有回应，心情下降`);
                this.decreaseMood();
                this.waitingForResponse = false;
            }
        }, this.responseTimeout);
    }

    /**
     * 用户回应事件
     */
    onUserResponse() {
        if (!this.waitingForResponse) return;

        logToTerminal('info', '😊 用户有回应，心情提升！');

        // 取消响应计时器
        if (this.responseTimer) {
            clearTimeout(this.responseTimer);
            this.responseTimer = null;
        }

        this.waitingForResponse = false;

        // 提升心情（使用配置的值）
        this.increaseMood();
    }

    /**
     * 降低心情
     */
    decreaseMood() {
        const decrease = Math.abs(this.moodChanges.noResponse); // 从配置读取
        const oldScore = this.moodScore;
        this.moodScore = Math.max(0, this.moodScore - decrease);

        logToTerminal('info', `📉 心情降低: ${oldScore} -> ${this.moodScore}`);

        // 如果心情变化导致对话频率改变，重新安排
        if (this.getChatInterval() !== this.getChatInterval.call({ moodScore: oldScore })) {
            this.scheduleNextChat();
        }
    }

    /**
     * 提升心情
     */
    increaseMood(amount) {
        const increase = amount || this.moodChanges.userResponse; // 从配置读取
        const oldScore = this.moodScore;
        this.moodScore = Math.min(100, this.moodScore + increase);

        logToTerminal('info', `📈 心情提升: ${oldScore} -> ${this.moodScore}`);

        // 如果心情变化导致对话频率改变，重新安排
        if (this.getChatInterval() !== this.getChatInterval.call({ moodScore: oldScore })) {
            this.scheduleNextChat();
        }
    }

    /**
     * 启动心情回归机制（向目标分数靠拢）
     */
    startMoodRegression() {
        this.regressionTimer = setInterval(() => {
            const oldScore = this.moodScore;

            if (this.moodScore < this.stableMood) {
                this.moodScore = Math.min(this.stableMood, this.moodScore + 1);
            } else if (this.moodScore > this.stableMood) {
                this.moodScore = Math.max(this.stableMood, this.moodScore - 1);
            }

            if (this.moodScore !== oldScore) {
                logToTerminal('info', `🔄 心情回归: ${oldScore} -> ${this.moodScore} (目标${this.stableMood})`);
            }
        }, this.moodChanges.regressionInterval);
    }

    /**
     * 获取当前心情状态
     */
    getMoodStatus() {
        return {
            score: this.moodScore,
            stable: this.stableMood,
            interval: this.getChatInterval(),
            waitingResponse: this.waitingForResponse
        };
    }

    /**
     * 将心情分写入文件供外部读取
     */
    saveMoodToFile() {
        try {
            const moodData = {
                score: this.moodScore,
                stable: this.stableMood,
                interval: this.getChatInterval(),
                waitingResponse: this.waitingForResponse,
                timestamp: Date.now()
            };

            const filePath = path.join(__dirname, '..', '..', 'AI记录室', 'mood_status.json');
            fs.writeFileSync(filePath, JSON.stringify(moodData, null, 2), 'utf8');
        } catch (error) {
            // 静默失败，不影响主功能
        }
    }

    /**
     * 启动定期保存心情分到文件（每2秒一次）
     */
    startMoodFileSync() {
        // 立即保存一次
        this.saveMoodToFile();

        // 每2秒保存一次
        this.moodFileSyncTimer = setInterval(() => {
            this.saveMoodToFile();
        }, 2000);
    }

    /**
     * 停止心情分文件同步
     */
    stopMoodFileSync() {
        if (this.moodFileSyncTimer) {
            clearInterval(this.moodFileSyncTimer);
            this.moodFileSyncTimer = null;
        }
    }
}

module.exports = { MoodChatModule };
