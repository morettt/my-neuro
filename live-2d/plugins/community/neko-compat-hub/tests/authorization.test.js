'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseEntryList, decideExposure } = require('../lib/authorization.js');

test('空配置全拒', () => {
    const parsed = parseEntryList('');
    const decision = decideExposure(
        { plugin_id: 'web_search', entry_id: 'search', level: 'C2' },
        { approved: parsed, forceAllow: parseEntryList('', { allowWildcard: false }) }
    );
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, 'not_approved');
});

test('单条授权放行 C2', () => {
    const approved = parseEntryList('web_search:search\n');
    const decision = decideExposure(
        { plugin_id: 'web_search', entry_id: 'search', level: 'C2' },
        { approved, forceAllow: parseEntryList('', { allowWildcard: false }) }
    );
    assert.equal(decision.ok, true);
});

test('通配只放行 C2', () => {
    const approved = parseEntryList('demo:*');
    assert.equal(
        decideExposure({ plugin_id: 'demo', entry_id: 'a', level: 'C2' }, { approved, forceAllow: parseEntryList('', { allowWildcard: false }) }).ok,
        true
    );
    assert.equal(
        decideExposure({ plugin_id: 'demo', entry_id: 'b', level: 'B0' }, { approved, forceAllow: parseEntryList('', { allowWildcard: false }) }).ok,
        false
    );
    assert.equal(
        decideExposure({ plugin_id: 'demo', entry_id: 'c', level: 'C3' }, { approved, forceAllow: parseEntryList('', { allowWildcard: false }) }).ok,
        false
    );
});

test('无法解析的行被跳过，不影响其它行', () => {
    const parsed = parseEntryList('not a line\nweb_search:search\n:::bad');
    assert.equal(parsed.exact.has('web_search:search'), true);
    assert.equal(parsed.warnings.length, 2);
    assert.equal(parsed.deniedAll, false);
});

test('整体解析失败时全拒', () => {
    const parsed = parseEntryList({ toString() { throw new Error('boom'); } });
    assert.equal(parsed.deniedAll, true);
    const decision = decideExposure(
        { plugin_id: 'web_search', entry_id: 'search', level: 'C2' },
        { approved: parsed, forceAllow: parseEntryList('', { allowWildcard: false }) }
    );
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, 'authorization_parse_failed');
});

test('force_allow 不能越过 C0', () => {
    const approved = parseEntryList('demo:x');
    const forceAllow = parseEntryList('demo:x', { allowWildcard: false });
    const decision = decideExposure(
        { plugin_id: 'demo', entry_id: 'x', level: 'C0' },
        { approved, forceAllow }
    );
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, 'c0_blocked');
});

test('force_allow 可解除 B0，但仍需精确写进 approved_entries', () => {
    const forceAllow = parseEntryList('demo:launch_app', { allowWildcard: false });
    const wildcardOnly = parseEntryList('demo:*');
    assert.equal(
        decideExposure({ plugin_id: 'demo', entry_id: 'launch_app', level: 'B0' }, { approved: wildcardOnly, forceAllow }).ok,
        false
    );
    const exact = parseEntryList('demo:launch_app');
    const allowed = decideExposure(
        { plugin_id: 'demo', entry_id: 'launch_app', level: 'B0' },
        { approved: exact, forceAllow }
    );
    assert.equal(allowed.ok, true);
    assert.equal(allowed.forceLifted, true);
});

test('force_allow 不支持 *', () => {
    const parsed = parseEntryList('demo:*', { allowWildcard: false });
    assert.equal(parsed.wildcards.size, 0);
    assert.equal(parsed.warnings.length, 1);
});

test('夹具在 exposeFixture=false 时隐藏', () => {
    const approved = parseEntryList('web_search:search');
    const hidden = decideExposure(
        { plugin_id: 'web_search', entry_id: 'search', level: 'C2' },
        { approved, forceAllow: parseEntryList('', { allowWildcard: false }), exposeFixture: false, isFixture: true }
    );
    assert.equal(hidden.ok, false);
    assert.equal(hidden.reason, 'fixture_hidden');
});
