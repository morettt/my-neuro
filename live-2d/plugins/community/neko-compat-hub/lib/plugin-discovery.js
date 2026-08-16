'use strict';

function asText(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
        if (typeof value.zh_CN === 'string') return value.zh_CN;
        if (typeof value.en === 'string') return value.en;
        if (typeof value.default === 'string') return value.default;
    }
    return '';
}

function normalizePlugin(raw) {
    const plugin = raw && typeof raw === 'object' ? raw : {};
    const id = String(plugin.id || plugin.plugin_id || '').trim();
    const entries = Array.isArray(plugin.entries) ? plugin.entries : [];
    return {
        ...plugin,
        id,
        type: String(plugin.type || plugin.plugin_type || 'plugin'),
        sdk_supported: plugin.sdk_supported
            || (plugin.sdk && plugin.sdk.supported)
            || '',
        sdk_recommended: plugin.sdk_recommended
            || (plugin.sdk && plugin.sdk.recommended)
            || '',
        store_enabled: Boolean(
            (plugin.store && plugin.store.enabled)
            || plugin.store_enabled
        ),
        ui_enabled: Boolean(
            (plugin.ui && plugin.ui.enabled)
            || (plugin.plugin_ui && plugin.plugin_ui.enabled)
            || plugin.ui_enabled
        ),
        name: asText(plugin.name) || id,
        description: asText(plugin.description),
        entries: entries.map((entry) => normalizeEntry(entry, id))
    };
}

function normalizeEntry(raw, pluginId) {
    const entry = raw && typeof raw === 'object' ? raw : {};
    return {
        ...entry,
        id: String(entry.id || '').trim(),
        name: asText(entry.name) || String(entry.id || ''),
        description: asText(entry.description),
        plugin_id: pluginId,
        timeout: entry.timeout === undefined || entry.timeout === null || entry.timeout === ''
            ? 30
            : entry.timeout,
        input_schema: entry.input_schema && typeof entry.input_schema === 'object'
            ? entry.input_schema
            : null,
        llm_result_fields: Array.isArray(entry.llm_result_fields) ? entry.llm_result_fields : [],
        metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}
    };
}

async function discoverPlugins(client) {
    const response = await client.get('/plugins', { locale: 'zh-CN' });
    if (response.status !== 200 || !response.data) {
        const detail = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        throw new Error(`GET /plugins 失败: HTTP ${response.status} ${detail || ''}`.trim());
    }
    const rawPlugins = Array.isArray(response.data.plugins) ? response.data.plugins : [];
    const plugins = rawPlugins.map(normalizePlugin);
    return {
        plugins,
        pluginCount: plugins.length,
        entryCount: plugins.reduce((sum, plugin) => sum + plugin.entries.length, 0),
        raw: response.data
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Steam 包装版把插件 HTTP 嵌在 Agent 里：/health 先就绪，但默认不跑 lifecycle，
 * GET /plugins 会返回空数组。需要 POST /plugins/refresh，并在包装模式下
 * 向 Agent POST /agent/flags { user_plugin_enabled: true }。
 */
async function activatePluginCatalog(client, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || 90000;
    const pollIntervalMs = Number(options.pollIntervalMs) || 1000;
    const log = options.log || (() => {});
    const started = Date.now();
    let lastFlagsAt = 0;
    let lastRefreshAt = 0;
    let lastError = '';

    while (Date.now() - started < timeoutMs) {
        const now = Date.now();
        if (now - lastRefreshAt >= 5000) {
            try {
                const refresh = await client.post('/plugins/refresh');
                lastRefreshAt = now;
                log(`POST /plugins/refresh HTTP ${refresh.status}`);
            } catch (error) {
                lastRefreshAt = now;
                lastError = `refresh: ${error.message}`;
                log(`POST /plugins/refresh 失败: ${error.message}`);
            }
        }
        if (options.agentClient && now - lastFlagsAt >= 8000) {
            try {
                const flags = await options.agentClient.post('/agent/flags', {
                    user_plugin_enabled: true,
                    _persist_intent: false
                });
                lastFlagsAt = now;
                log(`POST /agent/flags HTTP ${flags.status}`);
            } catch (error) {
                lastFlagsAt = now;
                lastError = `flags: ${error.message}`;
                log(`POST /agent/flags 失败: ${error.message}`);
            }
        }
        try {
            const discovered = await discoverPlugins(client);
            if (discovered.pluginCount > 0) {
                await sleep(Math.min(pollIntervalMs, 800));
                const confirmed = await discoverPlugins(client);
                if (confirmed.pluginCount > 0) return confirmed;
            } else if (discovered.raw && discovered.raw.message) {
                lastError = String(discovered.raw.message);
            }
        } catch (error) {
            lastError = error.message;
            log(`GET /plugins 失败: ${error.message}`);
        }
        await sleep(pollIntervalMs);
    }
    throw new Error(
        `插件目录在 ${Math.round(timeoutMs / 1000)} 秒内仍为空${lastError ? `：${lastError}` : ''}`
    );
}

module.exports = { discoverPlugins, activatePluginCatalog, normalizePlugin, normalizeEntry };
