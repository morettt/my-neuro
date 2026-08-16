'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('plugin_config.json 字段类型符合计划第 12.2 / 16 节', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin_config.json'), 'utf8'));
    assert.equal(schema.enabled.type, 'bool');
    assert.equal(schema.enabled.default, false);
    assert.equal(schema.runtime_checkout_path.type, 'string');
    assert.equal(schema.runtime_python_path.type, 'string');
    assert.equal(schema.runtime_port.type, 'int');
    assert.equal(schema.runtime_port.default, 48916);
    assert.equal(schema.approved_entries.type, 'text');
    assert.equal(schema.force_allow_entries.type, 'text');
    assert.equal(schema.expose_fixture_tools.type, 'bool');
    assert.equal(schema.expose_fixture_tools.default, false);
    assert.equal(schema.log_level.type, 'select');
    assert.equal(schema.last_report_summary.type, 'text');
    assert.match(schema.enabled.description, /不带鉴权/);
});

test('WebUI 支持 text 类型渲染为 textarea', () => {
    const appPath = path.resolve(__dirname, '..', '..', '..', '..', 'webui', 'static', 'js', 'app.js');
    const app = fs.readFileSync(appPath, 'utf8');
    assert.match(app, /case 'text':/);
    assert.match(app, /createElement\('textarea'\)/);
});

test('Steam 官方套装 19 个勾选框与代码清单一致，默认全关', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin_config.json'), 'utf8'));
    const {
        STEAM_OFFICIAL_PACKS,
        defaultPackDescription
    } = require('../lib/steam-official-packs.js');
    assert.equal(STEAM_OFFICIAL_PACKS.length, 19);
    const packKeys = Object.keys(schema).filter((key) => key.startsWith('pack_'));
    assert.deepEqual(packKeys, STEAM_OFFICIAL_PACKS.map((pack) => pack.field));
    for (const pack of STEAM_OFFICIAL_PACKS) {
        const field = schema[pack.field];
        assert.equal(field.type, 'bool', pack.field);
        assert.equal(field.default, false, pack.field);
        assert.equal(field.value, false, pack.field);
        assert.equal(field.title, pack.title, pack.field);
        assert.equal(field.description, defaultPackDescription(pack), pack.field);
    }
    assert.match(schema.pack_mcp_adapter.description, /忽略|不会暴露/);
    assert.match(schema.pack_web_search.description, /不建议勾选/);
    assert.match(schema.approved_entries.description, /并集/);
});

test('runtime-lock.json 锁定 v0.8.3', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runtime-lock.json'), 'utf8'));
    assert.equal(lock.tag, 'v0.8.3');
    assert.equal(lock.commit, 'eab8da4b521e419d2c36280e7b6fafd08291b640');
    assert.equal(lock.sdk_version_expected, '0.1.0');
    assert.equal(lock.python_requires, '==3.11.*');
});
