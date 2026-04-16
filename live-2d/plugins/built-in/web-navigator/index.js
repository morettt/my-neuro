const { Plugin } = require('../../../js/core/plugin-base.js');
const { exec } = require('child_process');

class WebNavigatorPlugin extends Plugin {

    getTools() {
        return [{
            type: 'function',
            function: {
                name: 'open_webpage',
                description: '在默认浏览器中打开指定网址',
                parameters: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: '要打开的网址' }
                    },
                    required: ['url']
                }
            }
        }];
    }

    async executeTool(name, params) {
        if (name === 'open_webpage') return await this._openWebpage(params);
        throw new Error(`[web-navigator] 不支持的工具: ${name}`);
    }

    async _openWebpage({ url }) {
        if (!url || url.trim() === '') throw new Error('网址不能为空');
        if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;

        return new Promise((resolve, reject) => {
            const isWindows = process.platform === 'win32';
            const isMac = process.platform === 'darwin';
            const command = isWindows ? `start "" "${url}"` : isMac ? `open "${url}"` : `xdg-open "${url}"`;

            exec(command, { timeout: 5000, shell: isWindows ? 'cmd.exe' : '/bin/bash' }, (error) => {
                if (error) reject(new Error(`打开网页失败: ${error.message}`));
                else resolve(`✅ 已在浏览器中打开: ${url}`);
            });
        });
    }
}

module.exports = WebNavigatorPlugin;
