const { randomUUID } = require('node:crypto');

// Shared by dialogue and auxiliary requests, and retained across config saves.
const sessionId = `ses_${randomUUID()}`;

function llmRequestHeaders(apiUrl, apiKey) {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey || ''}` };
    try {
        const url = new URL(apiUrl);
        if (url.hostname === 'opencode.ai' && /^\/(?:inference|zen)\/go(?:\/|$)/.test(url.pathname)) {
            headers['x-opencode-session'] = sessionId;
        }
    } catch { /* URL validation belongs to the caller. */ }
    return headers;
}

module.exports = { llmRequestHeaders };
