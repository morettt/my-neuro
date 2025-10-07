/**
 * 自动打字相关工具函数
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Python脚本模板
const PYTHON_SCRIPT_TEMPLATE = `# -*- coding: utf-8 -*-
import sys
import json
import time

try:
    import pyperclip
    import pyautogui
except ImportError as e:
    print(json.dumps({"error": f"缺少必需的Python包: {str(e)}. 请在my-neuro环境中安装: pip install pyperclip pyautogui"}))
    sys.exit(1)

def type_text(text):
    try:
        # 将文本复制到剪贴板
        pyperclip.copy(text)

        # 等待一小段时间确保复制完成
        time.sleep(0.1)

        # 模拟 Ctrl+V 粘贴
        pyautogui.hotkey('ctrl', 'v')

        return f"成功输出文本：{len(text)} 个字符"

    except Exception as e:
        return f"输出失败: {str(e)}"

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(json.dumps({"error": "需要提供文本参数"}))
        sys.exit(1)

    text = sys.argv[1]
    result = type_text(text)
    print(json.dumps({"result": result}, ensure_ascii=False))
`;

/**
 * 将指定文本复制到剪贴板并自动粘贴输出
 * @param {string} text - 要输出的文本内容
 */
async function typeText({text}) {
    if (!text) {
        throw new Error('缺少文本参数');
    }

    return new Promise((resolve, reject) => {
        // 创建临时Python脚本文件
        const tempScriptPath = path.join(__dirname, 'temp_typing.py');

        try {
            // 写入Python脚本
            fs.writeFileSync(tempScriptPath, PYTHON_SCRIPT_TEMPLATE);

            // 执行Python脚本，使用JSON转义处理特殊字符 - 支持conda环境
            const escapedText = JSON.stringify(text);
            const isWindows = process.platform === 'win32';
            let command;

            if (isWindows) {
                // Windows系统，使用call命令确保conda正确激活
                command = `call conda activate my-neuro && python "${tempScriptPath}" ${escapedText}`;
            } else {
                // 非Windows系统
                command = `source activate my-neuro && python "${tempScriptPath}" ${escapedText}`;
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
                    // 如果JSON解析失败，返回原始输出
                    resolve(stdout || '文本输出完成');
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
            name: "type_text",
            description: "将指定文本复制到剪贴板并自动粘贴输出",
            parameters: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description: "要输出的文本内容"
                    }
                },
                required: ["text"]
            }
        }
    ];
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    switch (name) {
        case 'type_text':
            return await typeText(parameters);
        default:
            throw new Error(`不支持的函数: ${name}`);
    }
}

module.exports = {
    typeText,
    getToolDefinitions,
    executeFunction
};