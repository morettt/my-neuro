'use strict';

const crypto = require('crypto');

const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'timeout']);

function sleep(ms, sleeper) {
    const wait = sleeper || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
    return wait(ms);
}

class Semaphore {
    constructor(max) {
        this.max = Math.max(1, Number(max) || 1);
        this.active = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.active < this.max) {
            this.active += 1;
            return;
        }
        await new Promise((resolve) => this.queue.push(resolve));
        this.active += 1;
    }

    release() {
        this.active = Math.max(0, this.active - 1);
        const next = this.queue.shift();
        if (next) next();
    }
}

class RunClient {
    constructor(options = {}) {
        this.client = options.client;
        this.pollIntervalMs = Number(options.pollIntervalMs) || 500;
        this.totalTimeoutSeconds = Number(options.totalTimeoutSeconds) || 120;
        this.exportLimit = Number(options.exportLimit) || 200;
        this._sleep = options.sleep || sleep;
        this._now = options.now || (() => Date.now());
        this._semaphore = new Semaphore(options.maxConcurrent || 2);
    }

    async execute(spec) {
        await this._semaphore.acquire();
        try {
            return await this._executeInner(spec);
        } finally {
            this._semaphore.release();
        }
    }

    async _executeInner(spec) {
        const started = this._now();
        const deadline = started + this.totalTimeoutSeconds * 1000;
        const create = await this.client.post('/runs', {
            plugin_id: spec.pluginId,
            entry_id: spec.entryId,
            args: spec.args && typeof spec.args === 'object' ? spec.args : {},
            trace_id: spec.traceId || crypto.randomUUID(),
            idempotency_key: spec.idempotencyKey || crypto.randomUUID()
        });
        if (create.status >= 400 || !create.data || !create.data.run_id) {
            return {
                ok: false,
                reason: 'create_failed',
                statusCode: create.status,
                error: create.data
            };
        }
        const runId = create.data.run_id;
        let record = create.data;

        while (!TERMINAL.has(record.status)) {
            if (this._now() >= deadline) {
                await this._cancel(runId, 'hub_timeout');
                return { ok: false, reason: 'timeout', runId, record };
            }
            await this._sleep(this.pollIntervalMs);
            const polled = await this.client.get(`/runs/${encodeURIComponent(runId)}`);
            if (polled.status >= 400 || !polled.data) {
                return { ok: false, reason: 'poll_failed', runId, statusCode: polled.status, error: polled.data };
            }
            record = polled.data;
        }

        if (record.status !== 'succeeded') {
            return {
                ok: false,
                reason: `run_${record.status}`,
                runId,
                record,
                error: record.error || null
            };
        }

        const items = await this._collectExport(runId);
        return { ok: true, runId, record, items };
    }

    async _cancel(runId, reason) {
        try {
            await this.client.post(`/runs/${encodeURIComponent(runId)}/cancel`, { reason });
        } catch {
            // best-effort
        }
    }

    async _collectExport(runId) {
        const items = [];
        let after = '';
        for (let page = 0; page < 50; page += 1) {
            const query = { limit: this.exportLimit };
            if (after) query.after = after;
            const response = await this.client.get(`/runs/${encodeURIComponent(runId)}/export`, query);
            if (response.status >= 400 || !response.data) {
                throw new Error(`GET /export 失败: HTTP ${response.status}`);
            }
            const batch = Array.isArray(response.data.items) ? response.data.items : [];
            items.push(...batch);
            const next = response.data.next_after;
            if (!next || batch.length === 0) break;
            after = next;
        }
        return items;
    }
}

function isTerminalStatus(status) {
    return TERMINAL.has(status);
}

module.exports = { RunClient, isTerminalStatus, TERMINAL };
