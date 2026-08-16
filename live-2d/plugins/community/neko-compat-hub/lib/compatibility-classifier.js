'use strict';

const { SIDE_EFFECT_KEYWORDS, CREDENTIAL_KEYS, DEFAULT_SDK_VERSION } = require('./constants.js');

function parseVersion(text) {
    const match = String(text || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(a, b) {
    for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

function satisfiesRange(versionText, rangeText) {
    const version = parseVersion(versionText);
    if (!version) return false;
    const range = String(rangeText || '').trim();
    if (!range) return false;
    const clauses = range.split(',').map((part) => part.trim()).filter(Boolean);
    if (clauses.length === 0) return false;
    return clauses.every((clause) => {
        const match = clause.match(/^(>=|>|<=|<|==|=)?\s*(\d+\.\d+\.\d+)/);
        if (!match) return false;
        const op = match[1] || '==';
        const other = parseVersion(match[2]);
        if (!other) return false;
        const cmp = compareVersion(version, other);
        if (op === '>=') return cmp >= 0;
        if (op === '>') return cmp > 0;
        if (op === '<=') return cmp <= 0;
        if (op === '<') return cmp < 0;
        return cmp === 0;
    });
}

function collectKeys(node, keys = [], depth = 0) {
    if (!node || typeof node !== 'object' || depth > 5) return keys;
    if (Array.isArray(node)) {
        for (const item of node) collectKeys(item, keys, depth + 1);
        return keys;
    }
    for (const [key, value] of Object.entries(node)) {
        keys.push(String(key));
        if (key === 'entries' || key === 'entries_preview' || key === 'list_actions') continue;
        collectKeys(value, keys, depth + 1);
    }
    return keys;
}

function pluginHasCredentials(plugin) {
    const keys = collectKeys(plugin).map((key) => key.toLowerCase());
    return keys.some((key) => CREDENTIAL_KEYS.some((token) => key.includes(token)));
}

function pluginHasStore(plugin) {
    return Boolean(plugin && plugin.store_enabled);
}

function pluginHasUi(plugin) {
    return Boolean(plugin && plugin.ui_enabled);
}

function isLlmToolEntry(entry) {
    const id = String(entry && entry.id || '');
    const eventKey = String(entry && entry.event_key || '');
    const meta = (entry && entry.metadata) || {};
    return id.startsWith('__llm_tool__')
        || eventKey.includes('__llm_tool__')
        || meta.kind === 'llm_tool'
        || meta.event_type === 'llm_tool'
        || meta.source === 'llm_tool';
}

function isUiAction(plugin, entry) {
    if (!pluginHasUi(plugin)) return false;
    const meta = (entry && entry.metadata) || {};
    if (meta.ui === true || meta.kind === 'ui' || meta.surface === 'ui') return true;
    const actions = []
        .concat(plugin.list_actions || [])
        .concat((plugin.ui && plugin.ui.actions) || [])
        .concat((plugin.plugin_ui && plugin.plugin_ui.actions) || []);
    return actions.some((action) => {
        if (!action || typeof action !== 'object') return false;
        return action.entry === entry.id || action.id === entry.id || action.entry_id === entry.id;
    });
}

function hitSideEffect(entry) {
    const haystack = `${entry.id || ''} ${entry.name || ''}`.toLowerCase();
    const hit = SIDE_EFFECT_KEYWORDS.find((keyword) => haystack.includes(keyword));
    return hit || '';
}

function inputSchemaOk(entry) {
    const schema = entry && entry.input_schema;
    return Boolean(schema && typeof schema === 'object' && schema.type === 'object');
}

function timeoutLooksAsync(entry) {
    if (entry.timeout === undefined || entry.timeout === null || entry.timeout === '') return true;
    const timeout = Number(entry.timeout);
    if (!Number.isFinite(timeout)) return true;
    return timeout > 120;
}

/**
 * 按计划第 9.2 节顺序求值，首个命中即为该级。
 */
function classifyEntry(plugin, entry, options = {}) {
    const sdkVersion = options.sdkVersion || DEFAULT_SDK_VERSION;
    const pluginType = String((plugin && plugin.type) || 'plugin');

    if (pluginType !== 'plugin') {
        return { level: 'C5', rule: 1, reason: `插件 type=${pluginType}，不是 plugin` };
    }
    const supported = plugin && plugin.sdk_supported;
    if (!satisfiesRange(sdkVersion, supported)) {
        return {
            level: 'C0',
            rule: 2,
            reason: `SDK ${sdkVersion} 不在 supported 范围 ${supported || '(缺失)'}`
        };
    }
    if (!plugin || !Array.isArray(plugin.entries) || plugin.entries.length === 0) {
        return { level: 'C0', rule: 3, reason: '插件没有 entries' };
    }
    if (!entry || !entry.id) {
        return { level: 'C0', rule: 3, reason: 'entry 缺少 id' };
    }
    if (isLlmToolEntry(entry)) {
        return { level: 'C5', rule: 4, reason: '该 entry 由 @llm_tool 提供' };
    }
    if (isUiAction(plugin, entry)) {
        return { level: 'C5', rule: 5, reason: '插件启用了 UI 且该 entry 属于 UI 动作' };
    }
    const side = hitSideEffect(entry);
    if (side) {
        return { level: 'B0', rule: 6, reason: `命中副作用关键词: ${side}` };
    }
    if (pluginHasCredentials(plugin)) {
        return { level: 'C3', rule: 7, reason: '插件声明了凭据类配置键' };
    }
    if (pluginHasStore(plugin)) {
        return { level: 'C3', rule: 8, reason: '插件启用了持久化 store' };
    }
    if (!inputSchemaOk(entry)) {
        return { level: 'C1', rule: 9, reason: 'input_schema 缺失或不是 {"type":"object"}' };
    }
    if (timeoutLooksAsync(entry)) {
        return { level: 'C4', rule: 10, reason: `timeout=${entry.timeout} 缺失或大于 120 秒` };
    }
    return { level: 'C2', rule: 11, reason: '普通可调用条目' };
}

function classifyAll(plugins, options = {}) {
    const rows = [];
    for (const plugin of plugins || []) {
        if (!plugin.entries || plugin.entries.length === 0) {
            rows.push({
                plugin_id: plugin.id || '',
                entry_id: '',
                level: 'C0',
                rule: 3,
                reason: '插件没有 entries',
                plugin,
                entry: null
            });
            continue;
        }
        for (const entry of plugin.entries) {
            const result = classifyEntry(plugin, entry, options);
            rows.push({
                plugin_id: plugin.id || '',
                entry_id: entry.id || '',
                plugin_name: plugin.name || plugin.id || '',
                entry_name: entry.name || entry.id || '',
                ...result,
                plugin,
                entry
            });
        }
    }
    return rows;
}

module.exports = {
    parseVersion,
    compareVersion,
    satisfiesRange,
    classifyEntry,
    classifyAll,
    pluginHasCredentials,
    isLlmToolEntry,
    isUiAction
};
