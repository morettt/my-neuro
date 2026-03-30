const { Plugin } = require('../../../js/core/plugin-base.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class CodeExecutorPlugin extends Plugin {

    getTools() {
        return [
            { type: 'function', function: { name: 'execute_code', description: '执行AI生成的Python代码，支持各种编程任务如数据处理、文件操作、网络请求、计算等', parameters: { type: 'object', properties: { code: { type: 'string', description: '要执行的Python代码' }, description: { type: 'string', description: '代码功能描述（可选）' } }, required: ['code'] } } },
            { type: 'function', function: { name: 'install_packages', description: '安装Python包到conda环境中', parameters: { type: 'object', properties: { packages: { type: 'string', description: "要安装的包名，多个包用空格分隔，如: 'requests pandas numpy'" } }, required: ['packages'] } } }
        ];
    }

    async executeTool(name, params) {
        if (name === 'execute_code') return await this._executeCode(params);
        if (name === 'install_packages') return await this._installPackages(params);
        throw new Error(`[code-executor] 不支持的工具: ${name}`);
    }

    async _executeCode({ code, description = '执行AI生成的代码' }) {
        if (!code?.trim()) throw new Error('代码内容不能为空');

        return new Promise((resolve, reject) => {
            const timestamp = Date.now();
            const tempScriptPath = path.join(__dirname, `temp_ai_code_${timestamp}.py`);

            const wrappedCode = `# -*- coding: utf-8 -*-
import sys, json, traceback, io, subprocess, os
from contextlib import redirect_stdout, redirect_stderr

def start_detached(command):
    if os.name == 'nt':
        subprocess.Popen(command, shell=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        subprocess.Popen(command, shell=True, start_new_session=True)
    print(f"已启动程序: {command}")

def main():
${code.split('\n').map(line => `    ${line}`).join('\n')}

if __name__ == '__main__':
    try:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            main()
        print(json.dumps({"success": True, "stdout": out.getvalue(), "stderr": err.getvalue(), "description": "${description}"}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "traceback": traceback.format_exc(), "description": "${description}"}, ensure_ascii=False))
`;
            fs.writeFileSync(tempScriptPath, wrappedCode);

            const isWindows = process.platform === 'win32';
            const command = isWindows
                ? `call conda activate my-neuro && python "${tempScriptPath}"`
                : `source activate my-neuro && python "${tempScriptPath}"`;

            exec(command, { timeout: 60000, shell: isWindows ? 'cmd.exe' : '/bin/bash', env: { ...process.env, CONDA_DLL_SEARCH_MODIFICATION_ENABLE: '1' } }, (error, stdout, stderr) => {
                try { fs.unlinkSync(tempScriptPath); } catch (e) {}
                if (error) return reject(new Error(`代码执行失败: ${error.message}`));
                try {
                    const result = JSON.parse(stdout);
                    if (result.success) {
                        let output = `✅ ${result.description}\n`;
                        if (result.stdout) output += `\n📄 输出内容:\n${result.stdout}`;
                        if (result.stderr) output += `\n⚠️ 警告信息:\n${result.stderr}`;
                        resolve(output);
                    } else {
                        resolve(`❌ 代码执行出错: ${result.error}\n\n🔍 错误详情:\n${result.traceback}`);
                    }
                } catch { resolve(`✅ 代码执行完成\n\n📄 原始输出:\n${stdout}`); }
            });
        });
    }

    async _installPackages({ packages }) {
        if (!packages?.trim()) throw new Error('包名不能为空');

        return new Promise((resolve, reject) => {
            const isWindows = process.platform === 'win32';
            const command = isWindows
                ? `call conda activate my-neuro && pip install ${packages}`
                : `source activate my-neuro && pip install ${packages}`;

            exec(command, { timeout: 300000, shell: isWindows ? 'cmd.exe' : '/bin/bash', env: { ...process.env, CONDA_DLL_SEARCH_MODIFICATION_ENABLE: '1' } }, (error, stdout, stderr) => {
                if (error) return reject(new Error(`安装包失败: ${error.message}`));
                resolve(`✅ 成功安装包: ${packages}\n\n📄 安装日志:\n${stdout}${stderr}`);
            });
        });
    }
}

module.exports = CodeExecutorPlugin;
