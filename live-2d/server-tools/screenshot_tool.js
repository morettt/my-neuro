/**
 * 截图工具 - 截取当前屏幕供AI分析
 */
const { ipcRenderer } = require('electron');

/**
 * 截取当前屏幕并返回图片用于AI分析
 */
async function takeScreenshot() {
    try {
        console.log('📸 正在截取屏幕...');
        const base64Image = await ipcRenderer.invoke('take-screenshot');

        if (!base64Image) {
            throw new Error('截图返回空数据');
        }

        console.log('✅ 截图成功，准备返回给AI分析');

        // 🔥 关键：返回特殊格式的对象，标记这是需要视觉处理的截图
        return {
            _isScreenshot: true,  // 特殊标记
            base64: base64Image,
            message: '截图已完成'
        };

    } catch (error) {
        console.error('❌ 截图失败:', error.message);
        return `截图失败: ${error.message}`;
    }
}

// Function Call兼容接口
function getToolDefinitions() {
    return [
        {
            name: "take_screenshot",
            description: "截取当前屏幕并返回图片用于AI分析，可以查看电脑屏幕上的内容",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    ];
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    switch (name) {
        case 'take_screenshot':
            return await takeScreenshot(parameters);
        default:
            throw new Error(`不支持的函数: ${name}`);
    }
}

module.exports = {
    takeScreenshot,
    getToolDefinitions,
    executeFunction
};
