/**
 * 等待工具 - 延迟指定时间
 */

/**
 * 等待指定的时间
 * @param {number} time - 等待时间（秒），最大10秒
 */
async function wait({time}) {
    if (!time || time <= 0) {
        throw new Error('等待时间必须大于0');
    }

    // 限制最大等待时间为10秒
    if (time > 10) {
        time = 10;
    }

    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(`✅ 已等待 ${time} 秒`);
        }, time * 1000);
    });
}

// Function Call兼容接口
function getToolDefinitions() {
    return [
        {
            name: "wait",
            description: "等待指定的时间，用于页面加载、观看视频等场景",
            parameters: {
                type: "object",
                properties: {
                    time: {
                        type: "number",
                        description: "等待时间（秒），最大10秒"
                    }
                },
                required: ["time"]
            }
        }
    ];
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    switch (name) {
        case 'wait':
            return await wait(parameters);
        default:
            throw new Error(`不支持的函数: ${name}`);
    }
}

module.exports = {
    wait,
    getToolDefinitions,
    executeFunction
};
