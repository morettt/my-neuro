const { Plugin } = require('../../../js/core/plugin-base.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const PYTHON_SCRIPT = `# -*- coding: utf-8 -*-
import sys, io, json
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
try:
    import pyautogui
except ImportError as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)

direction = sys.argv[1] if len(sys.argv) > 1 else ''
valid = ['up', 'down', 'left', 'right']
if direction not in valid:
    print(json.dumps({"error": f"无效方向: {direction}"}))
    sys.exit(1)

pyautogui.press(direction)
labels = {'up': '上', 'down': '下', 'left': '左', 'right': '右'}
print(json.dumps({"result": f"✅ 已按{labels[direction]}键"}, ensure_ascii=False))
`;

class KeyboardPlugin extends Plugin {

    getTools() {
        return [{
            type: 'function',
            function: {
                name: 'press_arrow',
                description: '按方向键（上下左右）',
                parameters: {
                    type: 'object',
                    properties: {
                        direction: { type: 'string', description: '方向：up(上), down(下), left(左), right(右)' }
                    },
                    required: ['direction']
                }
            }
        }];
    }

    async executeTool(name, params) {
        if (name === 'press_arrow') return await this._pressArrow(params);
        throw new Error(`[keyboard] 不支持的工具: ${name}`);
    }

    async _pressArrow({ direction }) {
        if (!['up', 'down', 'left', 'right'].includes(direction)) throw new Error(`无效的方向: ${direction}`);

        return new Promise((resolve, reject) => {
            const tempScriptPath = path.join(__dirname, 'temp_arrow.py');
            fs.writeFileSync(tempScriptPath, PYTHON_SCRIPT);

            const isWindows = process.platform === 'win32';
            const command = isWindows
                ? `call conda activate my-neuro && python "${tempScriptPath}" ${direction}`
                : `source activate my-neuro && python "${tempScriptPath}" ${direction}`;

            exec(command, { timeout: 10000, shell: isWindows ? 'cmd.exe' : '/bin/bash', env: { ...process.env, CONDA_DLL_SEARCH_MODIFICATION_ENABLE: '1' } }, (error, stdout) => {
                try { fs.unlinkSync(tempScriptPath); } catch (e) {}
                if (error) return reject(new Error(`执行失败: ${error.message}`));
                try {
                    const result = JSON.parse(stdout);
                    result.error ? reject(new Error(result.error)) : resolve(result.result);
                } catch { resolve(stdout || '按键完成'); }
            });
        });
    }
}

module.exports = KeyboardPlugin;
