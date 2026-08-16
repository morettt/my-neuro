'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseEntryList, decideExposure, mergePackApprovals } = require('../lib/authorization.js');
const { listBlockedPackIds } = require('../lib/steam-official-packs.js');

function merge(text, packFlags) {
    return mergePackApprovals(parseEntryList(text), packFlags, {
        blockedPackIds: listBlockedPackIds()
    });
}

function expose(row, approved, extra = {}) {
    return decideExposure(row, {
        approved,
        forceAllow: parseEntryList('', { allowWildcard: false }),
        ...extra
    });
}

test('全部 pack 为 false + 空 text → 0 wildcard', () => {
    const approved = merge('', {
        memo_reminder: false,
        web_search: false,
        mcp_adapter: false
    });
    assert.equal(approved.wildcards.size, 0);
    assert.equal(approved.exact.size, 0);
    assert.equal(approved.deniedAll, false);
});

test('只勾 pack_memo_reminder → 只放行该插件 C2，B0 仍拒', () => {
    const approved = merge('', { memo_reminder: true });
    assert.deepEqual([...approved.wildcards], ['memo_reminder']);
    assert.equal(
        expose({ plugin_id: 'memo_reminder', entry_id: 'list', level: 'C2' }, approved).ok,
        true
    );
    assert.equal(
        expose({ plugin_id: 'memo_reminder', entry_id: 'write', level: 'B0' }, approved).ok,
        false
    );
    assert.equal(
        expose({ plugin_id: 'lifekit', entry_id: 'ping', level: 'C2' }, approved).ok,
        false
    );
});

test('勾 pack_mcp_adapter → wildcards 不含 mcp_adapter，有 warning', () => {
    const approved = merge('', { mcp_adapter: true, memo_reminder: false });
    assert.equal(approved.wildcards.has('mcp_adapter'), false);
    assert.equal(approved.wildcards.size, 0);
    assert.ok(approved.warnings.some((line) => line.includes('pack_mcp_adapter') && line.includes('已忽略')));
    assert.equal(
        expose({ plugin_id: 'mcp_adapter', entry_id: 'list_tools', level: 'C5' }, approved).ok,
        false
    );
});

test('勾 pack_web_search → web_search C2 在 exposeFixture=false 时也能过', () => {
    const approved = merge('', { web_search: true });
    const decision = expose(
        { plugin_id: 'web_search', entry_id: 'search', level: 'C2' },
        approved,
        { exposeFixture: false, isFixture: true, liftFixture: true }
    );
    assert.equal(decision.ok, true);
    assert.ok(approved.wildcards.has('web_search'));
});

test('不勾 pack_web_search、只在 text 写 web_search:search、exposeFixture=false → 仍 fixture_hidden', () => {
    const approved = merge('web_search:search', { web_search: false });
    const hidden = expose(
        { plugin_id: 'web_search', entry_id: 'search', level: 'C2' },
        approved,
        { exposeFixture: false, isFixture: true }
    );
    assert.equal(hidden.ok, false);
    assert.equal(hidden.reason, 'fixture_hidden');
});

test('text 解析 deniedAll 时，即使勾了若干 pack，仍全拒', () => {
    const broken = parseEntryList({ toString() { throw new Error('boom'); } });
    const approved = mergePackApprovals(broken, { memo_reminder: true, web_search: true }, {
        blockedPackIds: listBlockedPackIds()
    });
    assert.equal(approved.deniedAll, true);
    assert.equal(approved.wildcards.size, 0);
    const decision = expose(
        { plugin_id: 'memo_reminder', entry_id: 'list', level: 'C2' },
        approved
    );
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, 'authorization_parse_failed');
});

test('text 精确条目与勾选通配并存，互不覆盖', () => {
    const approved = merge('neko_warthunder:foo', { lifekit: true });
    assert.equal(approved.exact.has('neko_warthunder:foo'), true);
    assert.equal(approved.wildcards.has('lifekit'), true);
    assert.equal(approved.wildcards.has('neko_warthunder'), false);
    assert.equal(
        expose({ plugin_id: 'neko_warthunder', entry_id: 'foo', level: 'C2' }, approved).ok,
        true
    );
    assert.equal(
        expose({ plugin_id: 'neko_warthunder', entry_id: 'bar', level: 'C2' }, approved).ok,
        false
    );
    assert.equal(
        expose({ plugin_id: 'lifekit', entry_id: 'ping', level: 'C2' }, approved).ok,
        true
    );
});
