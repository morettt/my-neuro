const { Plugin } = require('../../../js/core/plugin-base.js');
const { exec } = require('child_process');
const path = require('path');

const SFX_LIBRARY = {
    '01': '搞啥情况的意思', '02': '突然一惊的意思', '03': '一声巨大的爆炸',
    '04': '一个钢管掉落的嘈杂声', '05': '一声OMG 表示不可思议',
    '06': '一个震撼的管弦乐声音', '07': '一个表示wow 的效果音'
};

class SfxPlugin extends Plugin {

    async onInit() {
        this._sfxDir = path.join(__dirname, 'SFX');
    }

    getTools() {
        return [{
            type: 'function',
            function: {
                name: 'play_sound_effect',
                description: '播放音效来增强对话的趣味性和表现力。01=搞啥情况, 02=突然一惊, 03=巨大爆炸, 04=钢管掉落, 05=OMG不可思议, 06=震撼管弦乐, 07=wow效果音',
                parameters: {
                    type: 'object',
                    properties: {
                        sfx_id: { type: 'string', description: "音效编号(01-07)，或逗号分隔的多个音效，如'01,03'" },
                        repeat: { type: 'integer', description: '连续播放次数(1-10)，默认1次', minimum: 1, maximum: 10, default: 1 }
                    },
                    required: ['sfx_id']
                }
            }
        }];
    }

    async executeTool(name, params) {
        if (name === 'play_sound_effect') return await this._playSfx(params);
        throw new Error(`[sfx] 不支持的工具: ${name}`);
    }

    async _playSfx({ sfx_id, repeat = 1 }) {
        const sfxIds = sfx_id.split(',').map(id => id.trim());
        for (const id of sfxIds) {
            if (!SFX_LIBRARY[id]) throw new Error(`无效的音效ID: ${id}`);
        }
        const playCount = Math.min(Math.max(repeat || 1, 1), 10);

        return new Promise((resolve, reject) => {
            const playSequence = [];
            for (let i = 0; i < playCount; i++) sfxIds.forEach(id => playSequence.push(id));

            const promises = playSequence.map((id, index) => new Promise((res) => {
                setTimeout(() => {
                    const sfxPath = path.join(this._sfxDir, `${id}.wav`);
                    exec(`powershell -c "(New-Object Media.SoundPlayer '${sfxPath}').PlaySync()"`, { timeout: 10000 }, () => res());
                }, index * 250);
            }));

            Promise.all(promises).then(() => resolve('成功播放音效')).catch(reject);
        });
    }
}

module.exports = SfxPlugin;
