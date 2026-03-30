const { Plugin } = require('../../../js/core/plugin-base.js');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SUPPORTED_FORMATS = ['.mp3', '.wav', '.m4a', '.ogg'];

class MusicPlugin extends Plugin {

    async onInit() {
        const cfg = this.context.getPluginFileConfig();
        this._port = cfg.port?.value ?? cfg.port ?? 3001;
        this._musicFolder = path.join(__dirname, '../../../song-library/output');
    }

    getTools() {
        return [
            { type: 'function', function: { name: 'play_random_music', description: '使用你的真实声音开始唱一首随机的歌曲', parameters: { type: 'object', properties: {}, required: [] } } },
            { type: 'function', function: { name: 'stop_music', description: '停止你当前的歌曲演唱', parameters: { type: 'object', properties: {}, required: [] } } },
            { type: 'function', function: { name: 'list_music_files', description: '查看你的歌曲库中有哪些可以用声音演唱的歌曲', parameters: { type: 'object', properties: {}, required: [] } } },
            { type: 'function', function: { name: 'play_specific_music', description: '使用你的真实声音唱指定的歌曲', parameters: { type: 'object', properties: { filename: { type: 'string', description: '要唱的歌曲文件名（不需要包含路径与格式）' } }, required: ['filename'] } } }
        ];
    }

    async executeTool(name, params) {
        switch (name) {
            case 'play_random_music':   return await this._playRandom();
            case 'stop_music':          return await this._stop();
            case 'list_music_files':    return this._list();
            case 'play_specific_music': return await this._playSpecific(params.filename);
            default: throw new Error(`[music] 不支持的工具: ${name}`);
        }
    }

    _getMusicFiles() {
        try {
            if (!fs.existsSync(this._musicFolder)) return [];
            return fs.readdirSync(this._musicFolder).filter(f => SUPPORTED_FORMATS.includes(path.extname(f).toLowerCase()));
        } catch { return []; }
    }

    async _request(action, filename = null) {
        return new Promise((resolve) => {
            const postData = JSON.stringify({ action, filename });
            const req = http.request({ hostname: 'localhost', port: this._port, path: '/control-music', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        resolve(result.success ? result.message : `操作失败: ${result.message}`);
                    } catch { resolve('操作完成'); }
                });
            });
            req.on('error', () => resolve('连接音乐控制服务失败，请确保应用已启动'));
            req.write(postData);
            req.end();
        });
    }

    _formatResponse(result) {
        if (typeof result === 'string') return result;
        const { message, metadata } = result;
        if (!metadata) return message;
        let response = `开始演唱：${metadata.title} - ${metadata.artist}。\n`;
        if (metadata.lyrics && metadata.lyrics !== '暂无歌词') {
            response += `歌词内容：\n${metadata.lyrics.split('\n').slice(0, 200).join('\n')}\n`;
        }
        return response;
    }

    async _playRandom() {
        if (this._getMusicFiles().length === 0) return '我的歌曲库中没有找到任何歌曲';
        return this._formatResponse(await this._request('play_random'));
    }

    async _stop() {
        const result = await this._request('stop');
        return result.replace('音乐已停止', '好的，我停止唱歌了');
    }

    _list() {
        const files = this._getMusicFiles();
        if (files.length === 0) return '我的歌曲库中没有找到任何歌曲';
        const names = new Set(files.map(f => f.replace(/\.(mp3|wav|m4a|ogg)$/i, '').replace(/-(Acc|Vocal)$/i, '')));
        const sorted = Array.from(names).sort();
        return `我会唱 ${sorted.length} 首歌:\n${sorted.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }

    async _playSpecific(filename) {
        const files = this._getMusicFiles();
        if (files.length === 0) return '我的歌曲库中没有找到任何歌曲';
        const matched = files.find(f => f.toLowerCase().includes(filename.toLowerCase()) || filename.toLowerCase().includes(f.toLowerCase().replace(/\.[^/.]+$/, '')));
        if (!matched) return `我不会唱这首歌: ${filename}`;
        return this._formatResponse(await this._request('play_specific', matched));
    }
}

module.exports = MusicPlugin;
