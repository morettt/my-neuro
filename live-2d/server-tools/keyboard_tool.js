/**
 * 方向键工具
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Python脚本模板
const PYTHON_SCRIPT_TEMPLATE = `# -*- coding: utf-8 -*-
import sys
import io
import json

# 修复 Windows 编码问题
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

try:
    import pyautogui
except ImportError as e:
    print(json.dumps({"error": f"缺少必需的Python包: {str(e)}. 请在my-neuro环境中安装: pip install pyautogui"}))
    sys.exit(1)

def press_arrow(direction):
    try:
        valid_directions = ['up', 'down', 'left', 'right']
        if direction not in valid_directions:
            return f"无效的方向: {direction}"
        
        pyautogui.press(direction)
        
        direction_text = {
            'up': '上',
            'down': '下',
            'left': '左',
            'right': '右'
        }
        
        return f"✅ 已按{direction_text[direction]}键"
    except Exception as e:
        return f"⚠️ 按键失败: {str(e)}"

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "需要提供方向参数"}))
        sys.exit(1)
    
    direction = sys.argv[1]
    result = press_arrow(direction)
    print(json.dumps({"result": result}, ensure_ascii=False))
`;

/**
 * 按方向键
 * @param {string} direction - 方向：up(上), down(下), left(左), right(右)
 */
async function pressArrow({direction}) {
    if (!direction) {
        throw new Error('缺少方向参数');
    }

    const validDirections = ['up', 'down', 'left', 'right'];
    if (!validDirections.includes(direction)) {
        throw new Error(`无效的方向: ${direction}，只支持 up, down, left, right`);
    }

    return new Promise((resolve, reject) => {
        // 创建临时Python脚本文件
        const tempScriptPath = path.join(__dirname, 'temp_arrow.py');

        try {
            // 写入Python脚本
            fs.writeFileSync(tempScriptPath, PYTHON_SCRIPT_TEMPLATE);

            const isWindows = process.platform === 'win32';
            let command;

            if (isWindows) {
                command = `call conda activate my-neuro && python "${tempScriptPath}" ${direction}`;
            } else {
                command = `source activate my-neuro && python "${tempScriptPath}" ${direction}`;
            }

            const execOptions = {
                timeout: 10000,
                shell: isWindows ? 'cmd.exe' : '/bin/bash',
                env: { ...process.env, CONDA_DLL_SEARCH_MODIFICATION_ENABLE: '1' }
            };

            exec(command, execOptions, (error, stdout, stderr) => {
                // 清理临时文件
                try {
                    fs.unlinkSync(tempScriptPath);
                } catch (cleanupError) {
                    console.warn('清理临时文件失败:', cleanupError.message);
                }

                if (error) {
                    reject(new Error(`执行失败: ${error.message}`));
                    return;
                }

                if (stderr) {
                    console.warn('Python警告:', stderr);
                }

                try {
                    const result = JSON.parse(stdout);
                    if (result.error) {
                        reject(new Error(result.error));
                    } else {
                        resolve(result.result);
                    }
                } catch (parseError) {
                    resolve(stdout || '按键完成');
                }
            });

        } catch (writeError) {
            reject(new Error(`创建脚本失败: ${writeError.message}`));
        }
    });
}

// Function Call兼容接口
function getToolDefinitions() {
    return [
        {
            name: "press_arrow",
            description: "按方向键（上下左右）",
            parameters: {
                type: "object",
                properties: {
                    direction: {
                        type: "string",
                        description: "方向：up(上), down(下), left(左), right(右)"
                    }
                },
                required: ["direction"]
            }
        }
    ];
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    switch (name) {
        case 'press_arrow':
            return await pressArrow(parameters);
        default:
            throw new Error(`不支持的函数: ${name}`);
    }
}

module.exports = {
    pressArrow,
    getToolDefinitions,
    executeFunction
};