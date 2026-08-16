'use strict';

const SIDE_EFFECT_KEYWORDS = [
    'launch', 'start_app', 'open_app', 'execute', 'run_command', 'shell', 'cmd',
    'click', 'press', 'key', 'mouse', 'type_text', 'input',
    'write', 'delete', 'remove', 'rename', 'move_file', 'save',
    'send', 'post', 'reply', 'publish', 'comment', 'dm', 'message',
    'login', 'logout', 'auth', 'pay', 'purchase', 'order',
    'install', 'uninstall', 'update_config', 'set_config', 'registry',
    'control', 'operate', 'action', 'move', 'attack', 'craft', 'place', 'build'
];

const CREDENTIAL_KEYS = [
    'api_key', 'apikey', 'token', 'secret', 'password', 'appid', 'app_id',
    'cookie', 'sessdata', 'credential', 'access_key', 'private_key'
];

const FIXTURE_PLUGIN_IDS = new Set(['web_search']);

const DEFAULT_SDK_VERSION = '0.1.0';
const RESULT_MAX_CHARS = 8000;
const PORT_SCAN_MAX = 50;
const DEFAULT_PORT = 48916;
const TOOL_NAME_MAX = 64;

function isFixturePlugin(pluginId) {
    return FIXTURE_PLUGIN_IDS.has(String(pluginId || ''));
}

function redactSensitive(value, depth = 0) {
    if (depth > 6) return '[truncated]';
    if (Array.isArray(value)) {
        return value.map((item) => redactSensitive(item, depth + 1));
    }
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
        const lowered = String(key).toLowerCase();
        if (CREDENTIAL_KEYS.some((token) => lowered.includes(token))) {
            out[key] = '***';
        } else {
            out[key] = redactSensitive(child, depth + 1);
        }
    }
    return out;
}

module.exports = {
    SIDE_EFFECT_KEYWORDS,
    CREDENTIAL_KEYS,
    FIXTURE_PLUGIN_IDS,
    DEFAULT_SDK_VERSION,
    RESULT_MAX_CHARS,
    PORT_SCAN_MAX,
    DEFAULT_PORT,
    TOOL_NAME_MAX,
    isFixturePlugin,
    redactSensitive
};
