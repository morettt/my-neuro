'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyEntry, classifyAll, satisfiesRange } = require('../lib/compatibility-classifier.js');

function plugin(overrides = {}) {
    return {
        id: 'demo',
        type: 'plugin',
        sdk_supported: '>=0.1.0,<0.3.0',
        store_enabled: false,
        ui_enabled: false,
        entries: [],
        ...overrides
    };
}

function entry(overrides = {}) {
    return {
        id: 'search',
        name: 'Search',
        timeout: 30,
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
        metadata: {},
        ...overrides
    };
}

test('semver 范围: 0.1.0 落在 >=0.1.0,<0.3.0', () => {
    assert.equal(satisfiesRange('0.1.0', '>=0.1.0,<0.3.0'), true);
    assert.equal(satisfiesRange('0.3.0', '>=0.1.0,<0.3.0'), false);
    assert.equal(satisfiesRange('0.0.9', '>=0.1.0,<0.3.0'), false);
});

test('规则1: type != plugin -> C5', () => {
    const p = plugin({ type: 'adapter', entries: [entry()] });
    assert.equal(classifyEntry(p, p.entries[0]).level, 'C5');
    assert.equal(classifyEntry(p, p.entries[0]).rule, 1);
});

test('规则1 反例: type=plugin 不因规则1命中', () => {
    const p = plugin({ entries: [entry()] });
    assert.notEqual(classifyEntry(p, p.entries[0]).rule, 1);
});

test('规则2: SDK 不匹配 -> C0', () => {
    const p = plugin({ sdk_supported: '>=0.2.0,<0.3.0', entries: [entry()] });
    const result = classifyEntry(p, p.entries[0], { sdkVersion: '0.1.0' });
    assert.equal(result.level, 'C0');
    assert.equal(result.rule, 2);
});

test('规则2 反例: SDK 匹配', () => {
    const p = plugin({ entries: [entry()] });
    assert.notEqual(classifyEntry(p, p.entries[0], { sdkVersion: '0.1.0' }).rule, 2);
});

test('规则3: 无 entries / 缺 id -> C0', () => {
    assert.equal(classifyEntry(plugin({ entries: [] }), entry()).rule, 3);
    const p = plugin({ entries: [entry({ id: '' })] });
    assert.equal(classifyEntry(p, p.entries[0]).rule, 3);
});

test('规则3 反例: 有 id 的 entry', () => {
    const p = plugin({ entries: [entry()] });
    assert.notEqual(classifyEntry(p, p.entries[0]).rule, 3);
});

test('规则4: llm_tool -> C5', () => {
    const item = entry({ id: '__llm_tool__chat' });
    const p = plugin({ entries: [item] });
    const result = classifyEntry(p, item);
    assert.equal(result.level, 'C5');
    assert.equal(result.rule, 4);
});

test('规则4 反例: 普通 plugin_entry', () => {
    const p = plugin({ entries: [entry()] });
    assert.notEqual(classifyEntry(p, p.entries[0]).rule, 4);
});

test('规则5: UI 动作 -> C5', () => {
    const item = entry({ id: 'open_panel', metadata: { ui: true } });
    const p = plugin({ ui_enabled: true, entries: [item] });
    const result = classifyEntry(p, item);
    assert.equal(result.level, 'C5');
    assert.equal(result.rule, 5);
});

test('规则5 反例: 有 UI 但 entry 不是 UI 动作', () => {
    const p = plugin({ ui_enabled: true, entries: [entry()] });
    assert.notEqual(classifyEntry(p, p.entries[0]).rule, 5);
});

test('规则6: 副作用关键词 -> B0', () => {
    const item = entry({ id: 'launch_game', name: 'Launch' });
    const p = plugin({ entries: [item] });
    const result = classifyEntry(p, item);
    assert.equal(result.level, 'B0');
    assert.equal(result.rule, 6);
});

test('规则6 反例: search 不命中关键词', () => {
    const p = plugin({ entries: [entry()] });
    assert.notEqual(classifyEntry(p, p.entries[0]).rule, 6);
});

test('规则7: 凭据键 -> C3', () => {
    const p = plugin({ api_key: '', entries: [entry()] });
    const result = classifyEntry(p, p.entries[0]);
    assert.equal(result.level, 'C3');
    assert.equal(result.rule, 7);
});

test('规则7 反例: 无凭据键', () => {
    const p = plugin({ entries: [entry()] });
    assert.notEqual(classifyEntry(p, p.entries[0]).rule, 7);
});

test('规则8: store -> C3', () => {
    const p = plugin({ store_enabled: true, entries: [entry()] });
    const result = classifyEntry(p, p.entries[0]);
    assert.equal(result.level, 'C3');
    assert.equal(result.rule, 8);
});

test('规则8 反例: store 关闭', () => {
    const p = plugin({ store_enabled: false, entries: [entry()] });
    assert.notEqual(classifyEntry(p, p.entries[0]).rule, 8);
});

test('规则9: 坏 input_schema -> C1', () => {
    const item = entry({ input_schema: { type: 'string' } });
    const p = plugin({ entries: [item] });
    const result = classifyEntry(p, item);
    assert.equal(result.level, 'C1');
    assert.equal(result.rule, 9);
});

test('规则9 反例: type=object', () => {
    const p = plugin({ entries: [entry()] });
    assert.notEqual(classifyEntry(p, p.entries[0]).rule, 9);
});

test('规则10: timeout 缺失或大于 120 -> C4', () => {
    const missing = entry({ timeout: null });
    const long = entry({ timeout: 180 });
    assert.equal(classifyEntry(plugin({ entries: [missing] }), missing).rule, 10);
    assert.equal(classifyEntry(plugin({ entries: [long] }), long).rule, 10);
    assert.equal(classifyEntry(plugin({ entries: [missing] }), missing).level, 'C4');
});

test('规则10 反例: timeout=30', () => {
    const p = plugin({ entries: [entry({ timeout: 30 })] });
    assert.notEqual(classifyEntry(p, p.entries[0]).rule, 10);
});

test('规则11: 其余为 C2', () => {
    const p = plugin({ entries: [entry()] });
    const result = classifyEntry(p, p.entries[0]);
    assert.equal(result.level, 'C2');
    assert.equal(result.rule, 11);
});

test('规则优先级: adapter + 副作用仍是规则1', () => {
    const item = entry({ id: 'launch_app' });
    const p = plugin({ type: 'adapter', entries: [item] });
    assert.equal(classifyEntry(p, item).rule, 1);
});

test('classifyAll 为无 entries 的插件生成 C0', () => {
    const rows = classifyAll([plugin({ id: 'empty', entries: [] })]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].level, 'C0');
    assert.equal(rows[0].rule, 3);
});
