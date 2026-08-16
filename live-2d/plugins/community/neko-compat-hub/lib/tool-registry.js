'use strict';

const crypto = require('crypto');
const { TOOL_NAME_MAX } = require('./constants.js');

function sanitizeToken(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

function shortHash(value) {
    return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 4);
}

function buildToolName(pluginId, entryId) {
    const plugin = sanitizeToken(pluginId);
    const entry = sanitizeToken(entryId);
    const raw = `neko__${plugin}__${entry}`;
    if (raw.length <= TOOL_NAME_MAX) {
        return { name: raw, truncated: false, original: raw };
    }
    const hash = shortHash(`${pluginId}::${entryId}`);
    const suffix = `_${hash}`;
    const innerBudget = TOOL_NAME_MAX - 'neko__'.length - 2 - suffix.length;
    const pluginBudget = Math.max(4, Math.floor(innerBudget / 2));
    const entryBudget = Math.max(4, innerBudget - pluginBudget);
    const name = `neko__${plugin.slice(0, pluginBudget)}__${entry.slice(0, entryBudget)}${suffix}`;
    return { name, truncated: true, original: raw };
}

function mapInputSchema(schema) {
    if (!schema || typeof schema !== 'object') {
        return { type: 'object', properties: {} };
    }
    const mapped = { ...schema };
    if (mapped.type !== 'object') mapped.type = 'object';
    if (!mapped.properties || typeof mapped.properties !== 'object') {
        mapped.properties = {};
    }
    return mapped;
}

function buildToolDef(row) {
    const naming = buildToolName(row.plugin_id, row.entry_id);
    const descriptionParts = [
        row.entry && row.entry.description ? String(row.entry.description) : '',
        `N.E.K.O 插件 ${row.plugin_id}/${row.entry_id}。结果由肥牛转述，不是第二个角色。`
    ].filter(Boolean);
    return {
        type: 'function',
        name: naming.name,
        function: {
            name: naming.name,
            description: descriptionParts.join('\n'),
            parameters: mapInputSchema(row.entry && row.entry.input_schema)
        },
        _neko: {
            plugin_id: row.plugin_id,
            entry_id: row.entry_id,
            llm_result_fields: (row.entry && row.entry.llm_result_fields) || [],
            original_name: naming.original,
            truncated: naming.truncated
        }
    };
}

function registerTools(rows, options = {}) {
    const seen = new Map();
    const accepted = [];
    const rejected = [];
    for (const row of rows) {
        const def = buildToolDef(row);
        if (seen.has(def.name)) {
            rejected.push({
                plugin_id: row.plugin_id,
                entry_id: row.entry_id,
                tool_name: def.name,
                reason: `规范化后与 ${seen.get(def.name)} 撞名，拒绝注册第二个`
            });
            continue;
        }
        seen.set(def.name, `${row.plugin_id}:${row.entry_id}`);
        accepted.push(def);
    }

    const register = options.register;
    if (typeof options.clear === 'function') options.clear();
    if (typeof register === 'function') {
        for (const def of accepted) register(def);
    }

    const missing = [];
    if (typeof options.getMergedToolsList === 'function') {
        try {
            const merged = options.getMergedToolsList() || [];
            const names = new Set(
                merged.map((tool) => (tool && (tool.function && tool.function.name || tool.name)) || '')
            );
            for (const def of accepted) {
                if (!names.has(def.name)) missing.push(def.name);
            }
        } catch (error) {
            missing.push(`getMergedToolsList_failed:${error.message}`);
        }
    }

    return { accepted, rejected, missing, seen };
}

function clearDynamicTools(pluginManager, pluginKeys) {
    if (!pluginManager || !pluginManager._dynamicTools) return;
    for (const key of pluginKeys) {
        pluginManager._dynamicTools.set(key, []);
    }
}

module.exports = {
    sanitizeToken,
    buildToolName,
    mapInputSchema,
    buildToolDef,
    registerTools,
    clearDynamicTools
};
