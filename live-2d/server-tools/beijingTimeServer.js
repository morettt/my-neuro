// 定义时间查询工具
const TIME_TOOL = {
    name: "get_current_time",
    description: "查询当前的系统时间",
    parameters: {
        type: "object",
        properties: {
            timezone: {
                type: "string",
                description: "Asia/Shanghai（可选，如Asia/Shanghai，默认使用服务器时区）"
            }
        },
        required: [] // 时区为可选参数，因此无必填项
    }
};

// 执行时间查询的函数
async function getCurrentTime(parameters) {
    const timezone = parameters.timezone || "Asia/Shanghai";
    // 获取当前时间
    const now = new Date();
    // 格式化时间为年月日时分秒
    const formattedTime = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    // 返回结果
    return `当前${timezone}时间：${formattedTime}`;
}

// 导出必要函数
module.exports = {
    getToolDefinitions: () => [TIME_TOOL],
    executeFunction: async (name, parameters) => {
        if (name !== "get_current_time") {
            throw new Error(`不支持此功能: ${name}`);
        }
        return await getCurrentTime(parameters);
    }
};