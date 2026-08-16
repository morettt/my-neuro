'use strict';

const LINE_PATTERN = /^([A-Za-z0-9_.-]+):(\*|[A-Za-z0-9_.-]+)$/;

function parseEntryList(text, options = {}) {
    const allowWildcard = options.allowWildcard !== false;
    const warnings = [];
    const exact = new Set();
    const wildcards = new Set();
    if (text === undefined || text === null) {
        return { exact, wildcards, warnings, deniedAll: false };
    }
    let source;
    try {
        source = String(text);
    } catch (error) {
        return {
            exact: new Set(),
            wildcards: new Set(),
            warnings: [`授权字段无法解析: ${error.message}`],
            deniedAll: true
        };
    }

    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const raw = lines[index];
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const match = line.match(LINE_PATTERN);
        if (!match) {
            warnings.push(`第 ${index + 1} 行无法解析，已忽略: ${line}`);
            continue;
        }
        const pluginId = match[1];
        const entryId = match[2];
        if (entryId === '*') {
            if (!allowWildcard) {
                warnings.push(`第 ${index + 1} 行使用了 *，此处不允许通配，已忽略`);
                continue;
            }
            wildcards.add(pluginId);
        } else {
            exact.add(`${pluginId}:${entryId}`);
        }
    }
    return { exact, wildcards, warnings, deniedAll: false };
}

function isOriginallyC2(level) {
    return level === 'C2';
}

function decideExposure(row, options = {}) {
    const pluginId = row.plugin_id;
    const entryId = row.entry_id;
    const key = `${pluginId}:${entryId}`;
    const approved = options.approved || { exact: new Set(), wildcards: new Set(), deniedAll: false };
    const forceAllow = options.forceAllow || { exact: new Set() };
    const exposeFixture = options.exposeFixture === true;
    const liftFixture = options.liftFixture === true;
    const isFixture = options.isFixture === true;

    if (approved.deniedAll) {
        return { ok: false, reason: 'authorization_parse_failed' };
    }
    if (isFixture && !exposeFixture && !liftFixture) {
        return { ok: false, reason: 'fixture_hidden' };
    }
    if (row.level === 'C0') {
        return { ok: false, reason: 'c0_blocked' };
    }

    const forceLifted = row.level === 'B0' && forceAllow.exact.has(key);
    const effectiveLevel = forceLifted ? 'C2' : row.level;
    if (effectiveLevel !== 'C2') {
        return { ok: false, reason: `level_${row.level}`, level: row.level, forceLifted: false };
    }

    const exactApproved = approved.exact.has(key);
    const wildcardApproved = isOriginallyC2(row.level) && approved.wildcards.has(pluginId);
    if (!exactApproved && !wildcardApproved) {
        return { ok: false, reason: 'not_approved', level: row.level, forceLifted };
    }
    if (forceLifted && !exactApproved) {
        return { ok: false, reason: 'force_allow_needs_exact_approval', level: row.level, forceLifted };
    }
    return { ok: true, reason: forceLifted ? 'force_allowed' : 'approved', level: 'C2', originalLevel: row.level, forceLifted };
}

function mergePackApprovals(approvedFromText, packFlags, options = {}) {
    const source = approvedFromText && typeof approvedFromText === 'object'
        ? approvedFromText
        : { exact: new Set(), wildcards: new Set(), warnings: [], deniedAll: false };
    const warnings = Array.isArray(source.warnings) ? source.warnings.slice() : [];
    const blockedPackIds = new Set(options.blockedPackIds || []);

    if (source.deniedAll) {
        warnings.push('手写授权解析失败，套装勾选未生效');
        return {
            exact: new Set(),
            wildcards: new Set(),
            warnings,
            deniedAll: true
        };
    }

    const exact = new Set(source.exact || []);
    const wildcards = new Set(source.wildcards || []);
    const flags = packFlags && typeof packFlags === 'object' ? packFlags : {};
    for (const [pluginId, enabled] of Object.entries(flags)) {
        if (!enabled) continue;
        if (blockedPackIds.has(pluginId)) {
            warnings.push(`pack_${pluginId} 已勾选但该插件为 C5/adapter，已忽略`);
            continue;
        }
        wildcards.add(pluginId);
    }
    return { exact, wildcards, warnings, deniedAll: false };
}

module.exports = { parseEntryList, decideExposure, mergePackApprovals };
