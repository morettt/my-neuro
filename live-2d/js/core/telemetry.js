// telemetry.js - 遥测写入器
// 把对话/工具/模块事件以 JSONL 落盘到 live-2d/.runtime/telemetry.jsonl,
// 供 WebUI 总览与图表区聚合展示。
//
// 硬规则:
//   1. 每行一个 JSON,禁止多行
//   2. 递归剥离 api_key / authorization / cookie / token / 消息正文 / 工具 arguments
//   3. title 最长 160 字
//   4. 任何失败一律吞掉,绝不影响对话主流程

const fs = require('fs');
const path = require('path');

const RUNTIME_DIR = path.join(__dirname, '..', '..', '.runtime');
const TELEMETRY_FILE = path.join(RUNTIME_DIR, 'telemetry.jsonl');
const ROTATED_FILE = TELEMETRY_FILE + '.1';
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB 轮转
const MAX_TITLE_LEN = 160;

// 敏感键名(小写比较):命中即整键丢弃
const SENSITIVE_KEYS = new Set([
    'api_key', 'apikey', 'authorization', 'cookie', 'set-cookie',
    'token', 'access_token', 'refresh_token', 'secret', 'password',
    'content', 'text', 'prompt', 'messages', 'arguments', 'body'
]);

/**
 * 递归剥离敏感字段。message/对象里的正文、密钥、工具参数一律丢弃,
 * 只保留数字/枚举类的安全标量。
 */
function sanitize(value, depth) {
    depth = depth || 0;
    if (depth > 6) return undefined;
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === 'number' || t === 'boolean') return value;
    if (t === 'string') return value.length > MAX_TITLE_LEN ? value.slice(0, MAX_TITLE_LEN) : value;
    if (Array.isArray(value)) {
        return value.map(v => sanitize(v, depth + 1)).filter(v => v !== undefined);
    }
    if (t === 'object') {
        const out = {};
        for (const key of Object.keys(value)) {
            if (SENSITIVE_KEYS.has(String(key).toLowerCase())) continue;
            const v = sanitize(value[key], depth + 1);
            if (v !== undefined) out[key] = v;
        }
        return out;
    }
    return undefined;
}

function ensureDir() {
    try {
        if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    } catch (_) { /* 静默 */ }
}

function rotateIfNeeded() {
    try {
        if (!fs.existsSync(TELEMETRY_FILE)) return;
        const size = fs.statSync(TELEMETRY_FILE).size;
        if (size <= MAX_FILE_BYTES) return;
        if (fs.existsSync(ROTATED_FILE)) fs.unlinkSync(ROTATED_FILE);
        fs.renameSync(TELEMETRY_FILE, ROTATED_FILE);
    } catch (_) { /* 静默 */ }
}

/**
 * 追加一条遥测。同步写入(追加一行极快);失败吞掉。
 * @param {object} event - { cat, type, title, level?, pipeline_stage?, metrics?, source? }
 */
function emitTelemetry(event) {
    try {
        if (!event || typeof event !== 'object') return;
        if (!event.cat || !event.type || !event.title) return;

        ensureDir();
        rotateIfNeeded();

        const line = {
            ts: Date.now(),
            cat: String(event.cat).slice(0, 24),
            type: String(event.type).slice(0, 48),
            title: String(event.title).slice(0, MAX_TITLE_LEN),
            level: ['info', 'warn', 'error'].includes(event.level) ? event.level : 'info'
        };
        if (event.pipeline_stage) {
            const s = String(event.pipeline_stage);
            if (['input', 'context', 'llm', 'output', 'idle'].includes(s)) line.pipeline_stage = s;
        }
        if (event.metrics && typeof event.metrics === 'object') {
            const m = sanitize(event.metrics) || {};
            // metrics 只保留数字
            const clean = {};
            for (const k of Object.keys(m)) {
                if (typeof m[k] === 'number' && Number.isFinite(m[k])) clean[k] = m[k];
            }
            if (Object.keys(clean).length > 0) line.metrics = clean;
        }
        if (event.source) line.source = String(event.source).slice(0, 64);

        fs.appendFileSync(TELEMETRY_FILE, JSON.stringify(line) + '\n', 'utf8');
    } catch (_) { /* 静默:遥测绝不能影响对话 */ }
}

/**
 * 订阅 eventBus 上的现有事件并落盘。只补落盘,不改任何播放/业务逻辑。
 * @param {object} eventBus - core/event-bus.js 单例
 * @param {object} Events   - core/events.js 的 Events 常量
 */
function startTelemetryBridge(eventBus, Events) {
    if (!eventBus || !Events) return;

    const safe = (cat, type, title, extra) => () => emitTelemetry({ cat, type, title, ...(extra || {}) });

    // 用户输入 / 语音
    eventBus.on(Events.USER_MESSAGE_RECEIVED, safe('dialogue', 'user.input', '收到用户输入', { pipeline_stage: 'input' }));
    eventBus.on(Events.ASR_TEXT_RECOGNIZED, safe('dialogue', 'asr.text', '语音识别完成', { pipeline_stage: 'input' }));

    // 输出阶段
    eventBus.on(Events.TTS_START, safe('dialogue', 'tts.start', 'TTS 开始播放', { pipeline_stage: 'output' }));
    eventBus.on(Events.TTS_END, safe('dialogue', 'tts.end', 'TTS 播放结束', { pipeline_stage: 'idle' }));
    eventBus.on(Events.TTS_INTERRUPTED, safe('dialogue', 'tts.interrupted', 'TTS 被中断', { level: 'warn', pipeline_stage: 'idle' }));

    // 配置与生命周期
    eventBus.on(Events.CONFIG_CHANGED, safe('config', 'config.reload', '配置已更新'));
    eventBus.on(Events.APP_READY, safe('system', 'app.ready', '应用就绪'));
    eventBus.on(Events.APP_ERROR, (data) => emitTelemetry({
        cat: 'system',
        type: 'app.error',
        title: '应用错误: ' + String((data && (data.message || data.error)) || '未知').slice(0, 120),
        level: 'error'
    }));
}

module.exports = { emitTelemetry, startTelemetryBridge, sanitize };
