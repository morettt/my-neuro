const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('动作请求已取消'));
        const abort = () => { clearTimeout(timer); reject(new Error('动作请求已取消')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

class MotionService {
    constructor(config, log) {
        this.config = config;
        this.log = log;
        this.url = new URL(config.service_url || 'http://127.0.0.1:17880');
        if (!['http:', 'https:'].includes(this.url.protocol)) throw new Error('动作服务地址必须是 HTTP 或 HTTPS');
        this.timeout = Math.min(300000, Math.max(5000, Number(config.timeout_ms) || 120000));
        this.lifecycle = new AbortController();
    }

    async health() {
        const response = await axios.get(new URL('/api/health', this.url).href, {
            adapter: 'http', proxy: false, timeout: 2000, signal: this.lifecycle.signal,
            maxContentLength: 65536
        });
        if (response.data?.ready !== true) throw new Error('动作服务尚未就绪');
        return response.data;
    }

    ensureReady() {
        if (!this.ready) this.ready = this._ensureReady().catch(error => { this.ready = null; throw error; });
        return this.ready;
    }

    async _ensureReady() {
        try { return await this.health(); } catch (_) {}
        if (this.lifecycle.signal.aborted) throw new Error('插件已停止');
        const cfg = this.config;
        if (!cfg.auto_start) throw new Error(`无法连接动作服务 ${this.url.origin}，请先启动动作 API，并检查插件中的动作服务地址`);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(this.url.hostname)) throw new Error('仅支持自动启动本机服务');
        const directory = path.resolve(cfg.backend_directory || '.');
        const python = cfg.python_executable || '';
        if (!fs.existsSync(path.join(directory, 'web.py')) || !python || !fs.existsSync(python)) {
            throw new Error('请在插件设置中填写有效的本地服务目录和 Python 路径');
        }
        if (!this.child || this.child.exitCode != null) {
            const runtime = path.join(directory, '.runtime', 'python');
            const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' };
            if (fs.existsSync(runtime)) env.PYTHONPATH = runtime + path.delimiter + (env.PYTHONPATH || '');
            const device = ['cpu', 'cuda', 'auto'].includes(cfg.device) ? cfg.device : 'cpu';
            this.stderr = '';
            this.spawnError = null;
            this.child = spawn(python, ['web.py', '--device', device, '--port', this.url.port || '17880', '--no-open'], {
                cwd: directory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
            });
            this.child.stdout.on('data', chunk => {
                const text = String(chunk);
                if (text.includes('LOCAL_WEB_READY')) this.log('info', 'Motion 本地服务已就绪');
            });
            this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-2000); });
            this.child.on('error', error => { this.spawnError = error; });
            this.log('info', '正在后台启动动作服务，首次启动可能需要一会儿');
        }
        const started = Date.now();
        while (Date.now() - started < this.timeout) {
            if (this.spawnError) throw this.spawnError;
            if (this.child.exitCode != null) throw new Error(`动作服务进程退出: ${this.stderr.slice(-500)}`);
            await delay(1000, this.lifecycle.signal);
            try { return await this.health(); } catch (_) {}
        }
        throw new Error('动作服务启动超时，请检查运行环境');
    }

    async generate(text, signal) {
        await this.ensureReady();
        const started = Date.now();
        while (true) {
            if (signal.aborted || this.lifecycle.signal.aborted) throw new Error('动作请求已取消');
            try {
                const response = await axios.post(new URL('/api/generate', this.url).href, { text }, {
                    adapter: 'http', proxy: false, timeout: Math.max(1, this.timeout - (Date.now() - started)),
                    signal, maxContentLength: 5 * 1024 * 1024, maxBodyLength: 16384
                });
                return response.data;
            } catch (error) {
                if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)) this.ready = null;
                if (signal.aborted || error.response?.status !== 409 || Date.now() - started >= this.timeout) throw error;
                await delay(750, signal);
            }
        }
    }

    stop() {
        this.lifecycle.abort();
        // Only stop the process this plugin created; existing shared services survive.
        if (this.child && this.child.exitCode == null) this.child.kill();
        this.child = null;
    }
}

module.exports = { MotionService };
