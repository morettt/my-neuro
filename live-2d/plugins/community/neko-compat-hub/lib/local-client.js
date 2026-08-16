'use strict';

const http = require('http');
const { URL } = require('url');

function encodeQuery(query) {
    if (!query || typeof query !== 'object') return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        params.set(key, String(value));
    }
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
}

class LocalClient {
    /**
     * @param {object} options
     * @param {string} [options.host]
     * @param {number} options.port
     * @param {number} [options.timeoutMs]
     * @param {typeof http.request} [options.requestImpl]
     */
    constructor(options = {}) {
        this.host = options.host || '127.0.0.1';
        if (this.host !== '127.0.0.1') {
            throw new Error('LocalClient 只允许连接 127.0.0.1');
        }
        this.port = Number(options.port);
        if (!Number.isInteger(this.port) || this.port <= 0) {
            throw new Error('LocalClient 需要有效端口');
        }
        this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
        this._requestImpl = options.requestImpl || http.request;
    }

    async get(pathname, query) {
        return this.request('GET', pathname, { query });
    }

    async post(pathname, body, query) {
        return this.request('POST', pathname, { body, query });
    }

    async request(method, pathname, options = {}) {
        const path = `${pathname.startsWith('/') ? pathname : `/${pathname}`}${encodeQuery(options.query)}`;
        const payload = options.body === undefined ? null : JSON.stringify(options.body);
        const headers = {
            Host: `${this.host}:${this.port}`,
            Accept: 'application/json',
            Connection: 'close'
        };
        if (payload !== null) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }

        return new Promise((resolve, reject) => {
            const req = this._requestImpl({
                host: this.host,
                port: this.port,
                path,
                method,
                headers,
                timeout: this.timeoutMs
            }, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let data = raw;
                    if (raw) {
                        try {
                            data = JSON.parse(raw);
                        } catch {
                            data = raw;
                        }
                    } else {
                        data = null;
                    }
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        data,
                        raw
                    });
                });
            });
            req.on('timeout', () => {
                req.destroy(new Error(`请求超时: ${method} ${path}`));
            });
            req.on('error', reject);
            if (payload !== null) req.write(payload);
            req.end();
        });
    }
}

function createLocalClient(options) {
    return new LocalClient(options);
}

module.exports = { LocalClient, createLocalClient };
