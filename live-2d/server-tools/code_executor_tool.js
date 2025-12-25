/**
 * AI代码执行工具 - 动态编写和执行Python代码
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 执行AI生成的Python代码，支持各种编程任务
 * @param {string} code - 要执行的Python代码
 * @param {string} description - 代码功能描述（可选）
 */
async function executeCode({code, description = "执行AI生成的代码"}) {
    if (!code || code.trim() === '') {
        throw new Error('代码内容不能为空');
    }

    return new Promise((resolve, reject) => {
        // 创建临时Python脚本文件
        const timestamp = Date.now();
        const tempScriptPath = path.join(__dirname, `temp_ai_code_${timestamp}.py`);

        try {
            // 添加基础的错误处理和输出格式化
            const wrappedCode = `# -*- coding: utf-8 -*-
import sys
import json
import traceback
import io
import subprocess
import os
from contextlib import redirect_stdout, redirect_stderr

def start_detached(command):
    """
    以分离模式启动程序，不阻塞当前进程

    使用示例：
    # 启动记事本并写入文件
    start_detached('notepad.exe temp.txt')

    # 启动浏览器
    start_detached('start https://www.baidu.com')

    # 启动任何GUI程序
    start_detached('calc.exe')  # 计算器
    """
    if os.name == 'nt':  # Windows
        subprocess.Popen(command, shell=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    else:  # Linux/Mac
        subprocess.Popen(command, shell=True, start_new_session=True)
    print(f"已启动程序: {command}")

def main():
    """用户代码执行主函数"""
${code.split('\n').map(line => `    ${line}`).join('\n')}

if __name__ == '__main__':
    try:
        # 捕获标准输出和错误输出
        stdout_buffer = io.StringIO()
        stderr_buffer = io.StringIO()

        with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
            main()

        # 获取输出内容
        stdout_content = stdout_buffer.getvalue()
        stderr_content = stderr_buffer.getvalue()

        result = {
            "success": True,
            "stdout": stdout_content,
            "stderr": stderr_content,
            "description": "${description}"
        }

        print(json.dumps(result, ensure_ascii=False, indent=2))

    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
            "description": "${description}"
        }
        print(json.dumps(error_result, ensure_ascii=False, indent=2))
`;

            // 写入Python脚本
            fs.writeFileSync(tempScriptPath, wrappedCode);

            // 执行Python脚本 - 支持conda环境
            const isWindows = process.platform === 'win32';
            let command;

            if (isWindows) {
                command = `call conda activate my-neuro && python "${tempScriptPath}"`;
            } else {
                command = `source activate my-neuro && python "${tempScriptPath}"`;
            }

            const execOptions = {
                timeout: 60000, // 60秒超时
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
                    reject(new Error(`代码执行失败: ${error.message}`));
                    return;
                }

                try {
                    const result = JSON.parse(stdout);

                    if (result.success) {
                        let output = `✅ ${result.description}\n`;
                        if (result.stdout) {
                            output += `\n📄 输出内容:\n${result.stdout}`;
                        }
                        if (result.stderr) {
                            output += `\n⚠️ 警告信息:\n${result.stderr}`;
                        }
                        resolve(output);
                    } else {
                        let errorOutput = `❌ 代码执行出错: ${result.error}\n`;
                        if (result.traceback) {
                            errorOutput += `\n🔍 错误详情:\n${result.traceback}`;
                        }
                        resolve(errorOutput);
                    }
                } catch (parseError) {
                    // 如果JSON解析失败，返回原始输出
                    resolve(`✅ 代码执行完成\n\n📄 原始输出:\n${stdout}\n\n⚠️ 错误信息:\n${stderr}`);
                }
            });

        } catch (writeError) {
            reject(new Error(`创建脚本失败: ${writeError.message}`));
        }
    });
}

/**
 * 安装Python包到conda环境
 * @param {string} packages - 要安装的包名，多个包用空格分隔
 */
async function installPackages({packages}) {
    if (!packages || packages.trim() === '') {
        throw new Error('包名不能为空');
    }

    return new Promise((resolve, reject) => {
        const isWindows = process.platform === 'win32';
        let command;

        if (isWindows) {
            command = `call conda activate my-neuro && pip install ${packages}`;
        } else {
            command = `source activate my-neuro && pip install ${packages}`;
        }

        const execOptions = {
            timeout: 300000, // 5分钟超时
            shell: isWindows ? 'cmd.exe' : '/bin/bash',
            env: { ...process.env, CONDA_DLL_SEARCH_MODIFICATION_ENABLE: '1' }
        };

        exec(command, execOptions, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`安装包失败: ${error.message}`));
                return;
            }

            resolve(`✅ 成功安装包: ${packages}\n\n📄 安装日志:\n${stdout}\n${stderr}`);
        });
    });
}

// Function Call兼容接口
function getToolDefinitions() {
    return [
        {
            name: "execute_code",
            description: "执行AI生成的Python代码，支持各种编程任务如数据处理、文件操作、网络请求、计算等",
            parameters: {
                type: "object",
                properties: {
                    code: {
                        type: "string",
                        description: "要执行的Python代码"
                    },
                    description: {
                        type: "string",
                        description: "代码功能描述（可选）"
                    }
                },
                required: ["code"]
            }
        },
        {
            name: "install_packages",
            description: "安装Python包到conda环境中",
            parameters: {
                type: "object",
                properties: {
                    packages: {
                        type: "string",
                        description: "要安装的包名，多个包用空格分隔，如: 'requests pandas numpy'"
                    }
                },
                required: ["packages"]
            }
        }
    ];
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    switch (name) {
        case 'execute_code':
            return await executeCode(parameters);
        case 'install_packages':
            return await installPackages(parameters);
        default:
            throw new Error(`不支持的函数: ${name}`);
    }
}

module.exports = {
    executeCode,
    installPackages,
    getToolDefinitions,
    executeFunction
};