/**
 * 点击工具
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function clickMouse() {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const tempScriptPath = path.join(__dirname, `temp_click_${timestamp}.py`);

        const code = `# -*- coding: utf-8 -*-
import pyautogui
pyautogui.click()
print("点击完成")
`;

        fs.writeFileSync(tempScriptPath, code);

        const isWindows = process.platform === 'win32';
        const command = isWindows
            ? `call conda activate my-neuro && python "${tempScriptPath}"`
            : `source activate my-neuro && python "${tempScriptPath}"`;

        const execOptions = {
            timeout: 10000,
            shell: isWindows ? 'cmd.exe' : '/bin/bash',
            env: { ...process.env, CONDA_DLL_SEARCH_MODIFICATION_ENABLE: '1' }
        };

        exec(command, execOptions, (error, stdout, stderr) => {
            try { fs.unlinkSync(tempScriptPath); } catch (e) {}

            if (error) {
                reject(new Error(`执行失败: ${error.message}`));
            } else {
                resolve(stdout.trim() || "点击完成");
            }
        });
    });
}

function getToolDefinitions() {
    return [{
        name: "click_mouse",
        description: "点击鼠标当前位置",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }];
}

async function executeFunction(name, parameters) {
    if (name === "click_mouse") {
        return await clickMouse();
    }
}

module.exports = { clickMouse, getToolDefinitions, executeFunction };