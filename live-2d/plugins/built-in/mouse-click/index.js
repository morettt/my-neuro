const { Plugin } = require('../../../js/core/plugin-base.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class MouseClickPlugin extends Plugin {

    getTools() {
        return [{
            type: 'function',
            function: {
                name: 'click_mouse',
                description: '点击鼠标当前位置',
                parameters: { type: 'object', properties: {}, required: [] }
            }
        }];
    }

    async executeTool(name, params) {
        if (name === 'click_mouse') return await this._clickMouse();
        throw new Error(`[mouse-click] 不支持的工具: ${name}`);
    }

    async _clickMouse() {
        return new Promise((resolve, reject) => {
            const timestamp = Date.now();
            const tempScriptPath = path.join(__dirname, `temp_click_${timestamp}.py`);
            const code = `# -*- coding: utf-8 -*-\nimport pyautogui\npyautogui.click()\nprint("点击完成")\n`;
            fs.writeFileSync(tempScriptPath, code);

            const isWindows = process.platform === 'win32';
            const command = isWindows
                ? `call conda activate my-neuro && python "${tempScriptPath}"`
                : `source activate my-neuro && python "${tempScriptPath}"`;

            exec(command, { timeout: 10000, shell: isWindows ? 'cmd.exe' : '/bin/bash', env: { ...process.env, CONDA_DLL_SEARCH_MODIFICATION_ENABLE: '1' } }, (error, stdout) => {
                try { fs.unlinkSync(tempScriptPath); } catch (e) {}
                if (error) reject(new Error(`执行失败: ${error.message}`));
                else resolve(stdout.trim() || '点击完成');
            });
        });
    }
}

module.exports = MouseClickPlugin;
