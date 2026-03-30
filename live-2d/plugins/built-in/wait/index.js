const { Plugin } = require('../../../js/core/plugin-base.js');

class WaitPlugin extends Plugin {

    getTools() {
        return [{
            type: 'function',
            function: {
                name: 'wait',
                description: '等待指定的时间，用于页面加载、观看视频等场景',
                parameters: {
                    type: 'object',
                    properties: {
                        time: { type: 'number', description: '等待时间（秒），最大10秒' }
                    },
                    required: ['time']
                }
            }
        }];
    }

    async executeTool(name, params) {
        if (name === 'wait') return await this._wait(params);
        throw new Error(`[wait] 不支持的工具: ${name}`);
    }

    async _wait({ time }) {
        if (!time || time <= 0) throw new Error('等待时间必须大于0');
        if (time > 10) time = 10;
        return new Promise(resolve => setTimeout(() => resolve(`✅ 已等待 ${time} 秒`), time * 1000));
    }
}

module.exports = WaitPlugin;
