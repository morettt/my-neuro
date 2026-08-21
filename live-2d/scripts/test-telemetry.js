// test-telemetry.js - 遥测写入器单元测试
// 用法: node live-2d/scripts/test-telemetry.js
// 覆盖: sanitize 剥敏感字段、emitTelemetry 落盘格式、超长 title 截断、非法输入静默

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { emitTelemetry, sanitize } = require('../js/core/telemetry.js');

const TELEMETRY_FILE = path.join(__dirname, '..', '.runtime', 'telemetry.jsonl');

let passed = 0;
function ok(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`);
        process.exitCode = 1;
    }
}

// ---- sanitize ----
ok('sanitize 剥掉 api_key / token / authorization / cookie', () => {
    const out = sanitize({ api_key: 'sk-xxx', token: 't', Authorization: 'b', cookie: 'c', keep: 1 });
    assert.strictEqual(out.api_key, undefined);
    assert.strictEqual(out.token, undefined);
    assert.strictEqual(out.Authorization, undefined);
    assert.strictEqual(out.cookie, undefined);
    assert.strictEqual(out.keep, 1);
});

ok('sanitize 递归剥嵌套敏感字段', () => {
    const out = sanitize({ nested: { deep: { api_key: 'x', safe: 'y' } } });
    assert.strictEqual(out.nested.deep.api_key, undefined);
    assert.strictEqual(out.nested.deep.safe, 'y');
});

ok('sanitize 剥掉消息正文与工具参数', () => {
    const out = sanitize({ content: '用户原话', prompt: '系统提示', messages: [1, 2], arguments: '{"a":1}' });
    assert.strictEqual(out.content, undefined);
    assert.strictEqual(out.prompt, undefined);
    assert.strictEqual(out.messages, undefined);
    assert.strictEqual(out.arguments, undefined);
});

// ---- emitTelemetry ----
ok('emitTelemetry 写入合法 JSONL 行', () => {
    if (fs.existsSync(TELEMETRY_FILE)) fs.unlinkSync(TELEMETRY_FILE);
    emitTelemetry({ cat: 'dialogue', type: 'llm.complete', title: 'LLM 完成 (1.2s, 42 tokens)', metrics: { duration_ms: 1200, output_tokens: 42 } });
    const lines = fs.readFileSync(TELEMETRY_FILE, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 1);
    const row = JSON.parse(lines[0]);
    assert.strictEqual(row.cat, 'dialogue');
    assert.strictEqual(row.type, 'llm.complete');
    assert.strictEqual(row.level, 'info');
    assert.strictEqual(row.metrics.duration_ms, 1200);
    assert.strictEqual(row.metrics.output_tokens, 42);
    assert.ok(typeof row.ts === 'number' && row.ts > 0);
});

ok('metrics 只保留数字,敏感键丢弃', () => {
    if (fs.existsSync(TELEMETRY_FILE)) fs.unlinkSync(TELEMETRY_FILE);
    emitTelemetry({ cat: 'tool', type: 'tool.end', title: 't', metrics: { duration_ms: 5, api_key: 'leak', note: 'str' } });
    const row = JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf8').trim());
    assert.deepStrictEqual(row.metrics, { duration_ms: 5 });
});

ok('title 超长截断到 160 字', () => {
    if (fs.existsSync(TELEMETRY_FILE)) fs.unlinkSync(TELEMETRY_FILE);
    emitTelemetry({ cat: 'system', type: 'x', title: 'A'.repeat(300) });
    const row = JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf8').trim());
    assert.strictEqual(row.title.length, 160);
});

ok('缺 cat/type/title 的行不写,非法 level 归一为 info', () => {
    if (fs.existsSync(TELEMETRY_FILE)) fs.unlinkSync(TELEMETRY_FILE);
    emitTelemetry({ cat: 'system' });               // 缺 type/title
    emitTelemetry(null);                            // 完全非法
    emitTelemetry({ cat: 'system', type: 'x', title: 'y', level: 'bogus' });
    const lines = fs.readFileSync(TELEMETRY_FILE, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(JSON.parse(lines[0]).level, 'info');
});

ok('pipeline_stage 非法值被丢弃', () => {
    if (fs.existsSync(TELEMETRY_FILE)) fs.unlinkSync(TELEMETRY_FILE);
    emitTelemetry({ cat: 'dialogue', type: 'x', title: 'y', pipeline_stage: 'hack' });
    emitTelemetry({ cat: 'dialogue', type: 'x', title: 'y', pipeline_stage: 'llm' });
    const rows = fs.readFileSync(TELEMETRY_FILE, 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(rows[0].pipeline_stage, undefined);
    assert.strictEqual(rows[1].pipeline_stage, 'llm');
});

ok('telemetry.enabled=false 时不写盘', () => {
    const original = global.live2dRuntime;
    global.live2dRuntime = { config: { telemetry: { enabled: false } } };
    try {
        if (fs.existsSync(TELEMETRY_FILE)) fs.unlinkSync(TELEMETRY_FILE);
        emitTelemetry({ cat: 'dialogue', type: 'x', title: 'y' });
        assert.strictEqual(fs.existsSync(TELEMETRY_FILE), false);
    } finally {
        global.live2dRuntime = original;
    }
});

// 清理测试产物
try { if (fs.existsSync(TELEMETRY_FILE)) fs.unlinkSync(TELEMETRY_FILE); } catch (_) {}

console.log(`\n${passed}/9 通过`);
