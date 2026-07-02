/**
 * 晨昏之线 - 时间感知与整点主动问候插件
 *
 * 职能一：环境感知 —— 每次 LLM 请求可在用户消息前注入时区时间、工作日/周末、法定节假日与调休、时段（对齐 AstrBot LLMPerception 思路）
 * 职能二：被动工具 —— 提供时间查询和问候语时间检查
 * 职能三：主动问候 —— 在设定整点智能发起问候，根据对话活跃度选择策略
 *
 * 节假日数据：chinese-workday（国务院放假安排，与 chinese-calendar 数据源同类）
 * 安装：在插件目录执行 npm install
 *
 * 作者：爱熬夜的人形兔
 * 版本：1.1.0
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { Plugin } = require('../../../js/core/plugin-base.js');

const PATCH_ID = 'dawn-dusk-line-greeting';

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 与 LLMPerception / 常用习惯一致：上午/中午/下午/晚上/深夜 */
function timePeriodFromHour(hour) {
    if (hour >= 5 && hour < 12) return '上午';
    if (hour >= 12 && hour < 14) return '中午';
    if (hour >= 14 && hour < 18) return '下午';
    if (hour >= 18 && hour < 22) return '晚上';
    return '深夜';
}

/**
 * 指定 IANA 时区下的日历分量（与 LLMPerception 一致：精确到秒的时间戳 + 用于节假日判断的当地日期）
 */
function getZonedComponents(date, timeZone) {
    const s = new Intl.DateTimeFormat('sv-SE', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(date);
    const [datePart, timePart] = s.split(/[\sT]/);
    const [hh, mm] = (timePart || '00:00:00').split(':');
    const hour = parseInt(hh, 10);
    const minute = parseInt(mm, 10);
    const weekdayMon0 = getWeekdayMon0(date, timeZone);
    return {
        dateKey: datePart,
        timestr: `${datePart} ${timePart || `${hh}:${mm}:00`}`,
        hour,
        minute,
        weekdayMon0
    };
}

/** 周一=0 … 周日=6（按配置时区的日历日） */
function getWeekdayMon0(date, timeZone) {
    const long = new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'long' }).format(date);
    const names = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
    const idx = names.indexOf(long);
    return idx >= 0 ? idx : 0;
}

// 注入系统提示词用：引导 AI 在下次回复中自然融入问候
const GREETING_PROMPTS = {
    0:  '现在是午夜12点了，夜深了。如果你接下来要回复用户，请自然地提醒对方注意休息、早点睡觉，语气温柔关切，不要生硬地报时。',
    8:  '现在是早上8点，新的一天开始了。如果你接下来要回复用户，请自然地说一句早安问候，可以提到早晨的感觉，语气活泼温暖，不要生硬地报时。',
    12: '现在是中午12点，该吃午饭了。如果你接下来要回复用户，请自然地提醒对方吃午饭、休息一下，语气轻松日常，不要生硬地报时。',
    18: '现在是傍晚6点，一天快结束了。如果你接下来要回复用户，请自然地说一句傍晚的问候，可以关心对方今天过得怎么样，语气温和，不要生硬地报时。'
};

// 直接发送用：给 AI 一个情景提示让它自由发挥
const DIRECT_GREETING_HINTS = {
    0:  '（现在是午夜12点，夜深了，关心一下对方是否还没睡，温柔地提醒早点休息）',
    8:  '（现在是早上8点，新的一天，元气满满地跟对方说早安吧）',
    12: '（现在是中午12点了，提醒对方该吃午饭了，关心一下）',
    18: '（现在是傍晚6点，一天快结束了，问问对方今天过得怎么样）'
};

class DawnDuskLinePlugin extends Plugin {

    // ==================== 生命周期 ====================

    async onInit() {
        const cfg = this.context.getPluginFileConfig();

        const hoursStr = cfg.greetingHours ?? '0,8,12,18';
        this._greetingHours = hoursStr.split(',').map(h => parseInt(h.trim(), 10)).filter(h => !isNaN(h));
        this._quietThreshold  = (cfg.quietThreshold  ?? 10) * 60 * 1000;
        this._activeThreshold = (cfg.activeThreshold  ?? 3)  * 60 * 1000;
        this._deferTimeout    = (cfg.deferTimeout     ?? 30) * 60 * 1000;
        this._checkInterval   = (cfg.checkInterval    ?? 30) * 1000;

        this._timezone = cfg.timezone || 'Asia/Shanghai';
        this._enableHoliday = cfg.enableHolidayPerception !== false;
        this._injectPerception = cfg.injectEnvironmentPerception !== false;
        this._holidayCountry = (cfg.holidayCountry || 'CN').toUpperCase();

        this._lastInteractionTime = Date.now();
        this._firedHours = new Set();
        this._checkTimer = null;
        this._deferredGreeting = null;
        this._deferTimer = null;
        this._patchApplied = false;
        this._cnWorkday = null;

        await this._loadChineseWorkday();
    }

    /**
     * chinese-workday 包为 "type":"module"，其 dist 文件名为 *.cjs.js（仍以 .js 结尾），
     * 在包目录内会被当作 ESM，require 会得到空对象；若改用动态 import(巨大 ESM)，
     * 在 Electron 渲染进程曾触发崩溃（exitCode=-36861）。
     * 做法：将 dist 复制到插件目录下纯 .cjs 后缀缓存文件，再 require。
     */
    async _loadChineseWorkday() {
        try {
            const pluginDir = path.dirname(__filename);
            const bundleSrc = path.join(pluginDir, 'node_modules', 'chinese-workday', 'dist', 'chinese-workday.cjs.js');
            const bundleCjs = path.join(pluginDir, '.chinese-workday-bundle.cjs');
            if (!fs.existsSync(bundleSrc)) {
                this._cnWorkday = null;
                return;
            }
            const needCopy =
                !fs.existsSync(bundleCjs) ||
                fs.statSync(bundleSrc).mtimeMs > fs.statSync(bundleCjs).mtimeMs;
            if (needCopy) {
                fs.copyFileSync(bundleSrc, bundleCjs);
            }
            const req = createRequire(__filename);
            const mod = req(bundleCjs);
            if (mod && typeof mod.isHoliday === 'function' && typeof mod.isWorkday === 'function') {
                this._cnWorkday = mod;
                return;
            }
            this.context.log('warn', '晨昏之线: chinese-workday 加载后 API 异常，节假日将仅按周末判断');
            this._cnWorkday = null;
        } catch (e) {
            this.context.log('warn',
                `晨昏之线: 未加载 chinese-workday（请在插件目录执行 npm install），节假日将仅按周末判断: ${e.message}`);
            this._cnWorkday = null;
        }
    }

    async onStart() {
        this._onInteraction = () => {
            this._lastInteractionTime = Date.now();
        };

        this.context.on('interaction:updated', this._onInteraction);
        this.context.on('user:message:received', this._onInteraction);

        this._onTTSEnd = () => this._tryFlushDeferred();
        this.context.on('tts:end', this._onTTSEnd);

        this._checkTimer = setInterval(() => this._tick(), this._checkInterval);

        const calOk = this._cnWorkday && this._enableHoliday && this._holidayCountry === 'CN';
        this.context.log('info',
            `晨昏之线已启动 | 时区: ${this._timezone} | 注入感知: ${this._injectPerception} | ` +
            `节假日: ${calOk ? 'chinese-workday' : '仅周末'} | 问候时刻: ${this._greetingHours.join(',')}点 | 检查间隔: ${this._checkInterval / 1000}s`);
    }

    async onStop() {
        if (this._checkTimer) { clearInterval(this._checkTimer); this._checkTimer = null; }
        if (this._deferTimer) { clearInterval(this._deferTimer); this._deferTimer = null; }
        if (this._onInteraction) {
            this.context.off('interaction:updated', this._onInteraction);
            this.context.off('user:message:received', this._onInteraction);
        }
        if (this._onTTSEnd) {
            this.context.off('tts:end', this._onTTSEnd);
        }
        this._removePatch();
    }

    // ==================== 感知行（工具 + LLM 注入） ====================

    _buildPerceptionLine(now = new Date(), tzOverride) {
        const tz = tzOverride || this._timezone;
        const { timestr, hour, dateKey, weekdayMon0 } = getZonedComponents(now, tz);

        const calParts = [WEEKDAY_NAMES[weekdayMon0]];
        const isWeekend = weekdayMon0 >= 5;

        if (this._enableHoliday && this._holidayCountry === 'CN' && this._cnWorkday) {
            const isHol = this._cnWorkday.isHoliday(dateKey);
            const isWork = this._cnWorkday.isWorkday(dateKey);
            let festival = '';
            if (isHol) {
                try {
                    festival = this._cnWorkday.getFestival(dateKey) || '';
                } catch (_) {
                    festival = '';
                }
                if (!festival) festival = '法定节假日';
                calParts.push(isWeekend ? `周末(${festival})` : `法定节假日(${festival})`);
            } else if (isWork) {
                calParts.push(isWeekend ? '调休工作日' : '工作日');
            } else {
                calParts.push('周末');
            }
        } else {
            calParts.push(isWeekend ? '周末' : '工作日');
        }

        calParts.push(timePeriodFromHour(hour));
        return `发送时间: ${timestr} | ${calParts.join(', ')}`;
    }

    _prependToLastUserMessage(messages, prefix) {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role !== 'user') continue;
            const msg = messages[i];
            if (typeof msg.content === 'string') {
                msg.content = prefix + msg.content;
            } else if (Array.isArray(msg.content)) {
                const textBlock = msg.content.find(c => c.type === 'text');
                if (textBlock) {
                    textBlock.text = prefix + (textBlock.text || '');
                } else {
                    msg.content.unshift({ type: 'text', text: prefix });
                }
            }
            return;
        }
    }

    async onLLMRequest(request) {
        if (this._injectPerception && request.messages?.length) {
            const line = this._buildPerceptionLine();
            this._prependToLastUserMessage(request.messages, `[${line}]\n`);
        }
    }

    // ==================== 工具注册（取代 FC 工具） ====================

    getTools() {
        return [
            {
                type: 'function',
                function: {
                    name: 'dawn_dusk_get_time',
                    description: '当用户明确询问当前时间、日期、星期、是否工作日/节假日时调用。返回配置时区的精确时间戳、星期、工作日/调休/法定节假日名称（若已安装依赖）及上午/中午/下午/晚上/深夜。',
                    parameters: {
                        type: 'object',
                        properties: {
                            timezone: {
                                type: 'string',
                                description: 'IANA 时区（可选，默认与插件配置一致，如 Asia/Shanghai）'
                            }
                        },
                        required: []
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'dawn_dusk_greeting_check',
                    description: '当用户使用与时间相关的问候语或道别语时自动调用。例如："早上好", "晚上好", "晚安", "晚上见"',
                    parameters: {
                        type: 'object',
                        properties: {},
                        required: []
                    }
                }
            }
        ];
    }

    async executeTool(name, params) {
        switch (name) {
            case 'dawn_dusk_get_time':
            case 'dawn_dusk_greeting_check': {
                const tz = (params && params.timezone) || this._timezone;
                try {
                    const line = this._buildPerceptionLine(new Date(), tz);
                    return line;
                } catch (e) {
                    return `时间解析失败（请检查时区字符串是否为合法 IANA 时区）: ${e.message}`;
                }
            }
            default:
                throw new Error(`晨昏之线：不支持的工具 ${name}`);
        }
    }

    // ==================== 主动问候系统 ====================

    _tick() {
        const now = new Date();
        const tz = this._timezone;
        const { hour, minute, dateKey: ymd } = getZonedComponents(now, tz);
        const dateKey = `${ymd}-${hour}`;

        const todayPrefix = `${ymd}-`;
        for (const key of this._firedHours) {
            if (!key.startsWith(todayPrefix)) {
                this._firedHours.delete(key);
            }
        }

        if (minute > 5) return;

        if (!this._greetingHours.includes(hour)) return;
        if (this._firedHours.has(dateKey)) return;

        this._firedHours.add(dateKey);
        this._initiateGreeting(hour);
    }

    _initiateGreeting(hour) {
        const elapsed = Date.now() - this._lastInteractionTime;

        try {
            const { appState } = require('../../../js/core/app-state.js');
            if (appState.isPlayingTTS() || appState.isProcessingUserInput()) {
                this.context.log('info', `[晨昏之线] ${hour}点问候 → AI正在说话/处理中，注入提示词`);
                this._injectPatch(hour);
                return;
            }
        } catch (_) {}

        if (elapsed < this._activeThreshold) {
            this.context.log('info', `[晨昏之线] ${hour}点问候 → 对话活跃中(${Math.round(elapsed / 1000)}s前)，注入提示词`);
            this._injectPatch(hour);
        } else if (elapsed >= this._quietThreshold) {
            this.context.log('info', `[晨昏之线] ${hour}点问候 → 静默状态(${Math.round(elapsed / 1000)}s前)，直接主动问候`);
            this._sendDirectGreeting(hour);
        } else {
            this.context.log('info', `[晨昏之线] ${hour}点问候 → 半活跃状态，进入延迟等待`);
            this._deferGreeting(hour);
        }
    }

    async _sendDirectGreeting(hour) {
        const hint = DIRECT_GREETING_HINTS[hour] || `（现在是${hour}点，自然地打个招呼）`;
        try {
            const arbiter = global.proactiveArbiter;
            const externalPolicy = arbiter?.externalSourcePolicy?.('dawn-dusk-line');
            if (externalPolicy === 'block') {
                this.context.log('info', '[晨昏之线] 已被人格导演阻断主动问候');
                return;
            }
            if (arbiter?.submitExternal && externalPolicy === 'collect') {
                await arbiter.submitExternal('dawn-dusk-line', hint, {
                    priority: 0.56,
                    topic: `${hour}点问候`,
                    topic_key: `dawn_dusk_${hour}`,
                    render_hint: '这是晨昏问候意图，保留时间感，但不要像报时机器。'
                });
                return;
            }
            await this.context.sendMessage(hint);
        } catch (e) {
            this.context.log('error', `[晨昏之线] 主动问候发送失败: ${e.message}`);
        }
    }

    _injectPatch(hour) {
        const prompt = GREETING_PROMPTS[hour] || `现在是${hour}点，请在下次回复中自然地融入一句应景的问候。`;
        this.context.addSystemPromptPatch(PATCH_ID, prompt);
        this._patchApplied = true;
    }

    _removePatch() {
        if (this._patchApplied) {
            this.context.removeSystemPromptPatch(PATCH_ID);
            this._patchApplied = false;
        }
    }

    _deferGreeting(hour) {
        if (this._deferredGreeting) return;
        this._deferredGreeting = { hour, startTime: Date.now() };

        this._deferTimer = setInterval(() => {
            if (!this._deferredGreeting) {
                clearInterval(this._deferTimer);
                this._deferTimer = null;
                return;
            }

            const waitedMs = Date.now() - this._deferredGreeting.startTime;
            if (waitedMs > this._deferTimeout) {
                this.context.log('info', `[晨昏之线] 延迟等待超时(${Math.round(waitedMs / 60000)}min)，放弃本次问候`);
                this._deferredGreeting = null;
                clearInterval(this._deferTimer);
                this._deferTimer = null;
                return;
            }

            const elapsed = Date.now() - this._lastInteractionTime;
            if (elapsed >= this._quietThreshold) {
                const h = this._deferredGreeting.hour;
                this._deferredGreeting = null;
                clearInterval(this._deferTimer);
                this._deferTimer = null;
                this.context.log('info', `[晨昏之线] 检测到对话间隙，发送延迟问候`);
                this._sendDirectGreeting(h);
            }
        }, 15000);
    }

    _tryFlushDeferred() {
        if (!this._deferredGreeting) return;
        const elapsed = Date.now() - this._lastInteractionTime;
        if (elapsed >= this._quietThreshold) {
            const h = this._deferredGreeting.hour;
            this._deferredGreeting = null;
            if (this._deferTimer) { clearInterval(this._deferTimer); this._deferTimer = null; }
            this.context.log('info', `[晨昏之线] TTS结束后检测到静默，发送延迟问候`);
            this._sendDirectGreeting(h);
        }
    }

    // ==================== 消息钩子 ====================

    async onLLMResponse(response) {
        if (this._patchApplied) {
            this._removePatch();
        }
    }
}

module.exports = DawnDuskLinePlugin;
