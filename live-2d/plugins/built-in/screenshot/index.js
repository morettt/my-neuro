const { Plugin } = require('../../../js/core/plugin-base.js');
const { ipcRenderer } = require('electron');

class ScreenshotPlugin extends Plugin {

    getTools() {
        return [{
            type: 'function',
            function: {
                name: 'take_screenshot',
                description: '截取当前屏幕并返回图片用于AI分析，可以查看电脑屏幕上的内容',
                parameters: { type: 'object', properties: {}, required: [] }
            }
        }];
    }

    async executeTool(name, params) {
        if (name === 'take_screenshot') return await this._takeScreenshot();
        throw new Error(`[screenshot] 不支持的工具: ${name}`);
    }

    async _takeScreenshot() {
        try {
            const base64Image = await ipcRenderer.invoke('take-screenshot');
            if (!base64Image) throw new Error('截图返回空数据');
            return { _isScreenshot: true, base64: base64Image, message: '截图已完成' };
        } catch (error) {
            return `截图失败: ${error.message}`;
        }
    }
}

module.exports = ScreenshotPlugin;
