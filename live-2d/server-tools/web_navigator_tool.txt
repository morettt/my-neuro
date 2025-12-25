/**
 * 网页导航工具 - 打开指定网址
 */
const { exec } = require('child_process');

/**
 * 在默认浏览器中打开指定网址
 * @param {string} url - 要打开的网址
 */
async function openWebpage({url}) {
    if (!url || url.trim() === '') {
        throw new Error('网址不能为空');
    }

    // 如果没有协议前缀,自动添加 https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    return new Promise((resolve, reject) => {
        const isWindows = process.platform === 'win32';
        const isMac = process.platform === 'darwin';
        
        let command;
        
        if (isWindows) {
            command = `start "" "${url}"`;
        } else if (isMac) {
            command = `open "${url}"`;
        } else {
            command = `xdg-open "${url}"`;
        }

        const execOptions = {
            timeout: 5000,
            shell: isWindows ? 'cmd.exe' : '/bin/bash'
        };

        exec(command, execOptions, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`打开网页失败: ${error.message}`));
                return;
            }

            resolve(`✅ 已在浏览器中打开: ${url}`);
        });
    });
}

// Function Call兼容接口
function getToolDefinitions() {
    return [
        {
            name: "open_webpage",
            description: "在默认浏览器中打开指定网址",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "要打开的网址"
                    }
                },
                required: ["url"]
            }
        }
    ];
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    switch (name) {
        case 'open_webpage':
            return await openWebpage(parameters);
        default:
            throw new Error(`不支持的函数: ${name}`);
    }
}

module.exports = {
    openWebpage,
    getToolDefinitions,
    executeFunction
};
