'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildToolName, buildToolDef, registerTools } = require('../lib/tool-registry.js');

test('命名规范化替换非法字符', () => {
    const result = buildToolName('web-search', 'do.thing');
    assert.equal(result.name, 'neko__web_search__do_thing');
});

test('规范化后撞名拒绝第二个', () => {
    const rows = [
        { plugin_id: 'a-b', entry_id: 'x', entry: { description: 'one', input_schema: { type: 'object', properties: {} } } },
        { plugin_id: 'a_b', entry_id: 'x', entry: { description: 'two', input_schema: { type: 'object', properties: {} } } }
    ];
    const result = registerTools(rows);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /撞名/);
});

test('超长名称截断并追加 4 位哈希', () => {
    const pluginId = 'very_long_plugin_name_that_keeps_going';
    const entryId = 'very_long_entry_name_that_also_keeps_going';
    const result = buildToolName(pluginId, entryId);
    assert.equal(result.truncated, true);
    assert.ok(result.name.length <= 64);
    assert.match(result.name, /^neko__/);
    assert.match(result.name, /_[0-9a-f]{4}$/);
});

test('本地撞名自查：同一批次内第二项被拒绝', () => {
    const row = {
        plugin_id: 'web_search',
        entry_id: 'search',
        entry: { description: 'search', input_schema: { type: 'object', properties: {} } }
    };
    const result = registerTools([row, { ...row }]);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.rejected.length, 1);
});

test('工具定义带 neko__ 前缀和 OpenAI function 结构', () => {
    const def = buildToolDef({
        plugin_id: 'web_search',
        entry_id: 'search',
        entry: {
            description: '联网搜索',
            input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
        }
    });
    assert.equal(def.name, 'neko__web_search__search');
    assert.equal(def.function.name, 'neko__web_search__search');
    assert.equal(def.function.parameters.type, 'object');
    assert.equal(def._neko.plugin_id, 'web_search');
});
