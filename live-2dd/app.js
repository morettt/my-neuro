// 导入所需模块
const { ModelInteractionController } = require('./js/model-interaction.js');
const { configLoader } = require('./js/config-loader.js');
const { logToTerminal } = require('./js/api-utils.js');
const { AppInitializer } = require('./js/app-initializer.js');

// 设置全局变量，用于模块间共享状态
global.isPlayingTTS = false;
global.isProcessingBarrage = false;
global.isProcessingUserInput = false;

// 加载配置文件
let config;
try {
    config = configLoader.load();
    console.log('配置文件加载成功');
    console.log('MCP配置:', config.mcp);
    logToTerminal('info', '配置文件加载成功');

    // 检查TTS和ASR配置
    const ttsEnabled = config.tts?.enabled !== false;
    const asrEnabled = config.asr?.enabled !== false;

    console.log(`TTS模块: ${ttsEnabled ? '启用' : '禁用'}`);
    console.log(`ASR模块: ${asrEnabled ? '启用' : '禁用'}`);
    logToTerminal('info', `TTS模块: ${ttsEnabled ? '启用' : '禁用'}`);
    logToTerminal('info', `ASR模块: ${asrEnabled ? '启用' : '禁用'}`);

} catch (error) {
    console.error('配置加载失败:', error);
    logToTerminal('error', `配置加载失败: ${error.message}`);
    alert(`配置文件错误: ${error.message}\n请检查config.json格式是否正确。`);
    throw error;
}

// 添加重新加载配置的全局函数
global.reloadConfig = function() {
    try {
        config = configLoader.load();
        console.log('配置文件已重新加载');
        logToTerminal('info', '配置文件已重新加载');
        return true;
    } catch (error) {
        console.error('重新加载配置文件失败:', error);
        logToTerminal('error', `重新加载配置文件失败: ${error.message}`);
        return false;
    }
}

// 创建模型交互控制器
const modelController = new ModelInteractionController();

// 模块实例（在全局作用域，供其他模块访问）
let voiceChat = null;
let ttsProcessor = null;
let barrageManager = null;

// TTS完成回调 - 弹幕专用
function onBarrageTTSComplete() {
    if (barrageManager) {
        barrageManager.onBarrageTTSComplete();
    }
}

// 增强系统提示词（初始化时使用）
function enhanceSystemPrompt() {
    // 只有启用直播功能时才添加提示词
    if (!config.bilibili || !config.bilibili.enabled) {
        return;
    }

    if (voiceChat && voiceChat.messages && voiceChat.messages.length > 0 && voiceChat.messages[0].role === 'system') {
        const originalPrompt = voiceChat.messages[0].content;

        if (!originalPrompt.includes('你可能会收到直播弹幕')) {
            const enhancedPrompt = originalPrompt + "\n\n你可能会收到直播弹幕消息，这些消息会被标记为[接收到了直播间的弹幕]，表示这是来自直播间观众的消息，而不是主人直接对你说的话。当你看到[接收到了直播间的弹幕]标记时，你应该知道这是其他人发送的，但你仍然可以回应，就像在直播间与观众互动一样。";
            voiceChat.messages[0].content = enhancedPrompt;
            console.log('系统提示已增强，添加了直播弹幕相关说明');
            logToTerminal('info', '系统提示已增强，添加了直播弹幕相关说明');
        }
    }
}

// 主初始化函数
(async function main() {
    try {
        // 创建应用初始化器
        const appInitializer = new AppInitializer(
            config,
            modelController,
            onBarrageTTSComplete,
            enhanceSystemPrompt
        );

        // 执行初始化
        const modules = await appInitializer.initialize();

        // 保存模块引用到全局作用域
        voiceChat = modules.voiceChat;
        ttsProcessor = modules.ttsProcessor;
        barrageManager = modules.barrageManager;

    } catch (error) {
        console.error("加载模型错误:", error);
        console.error("错误详情:", error.message);
        logToTerminal('error', `加载模型错误: ${error.message}`);
        if (error.stack) {
            logToTerminal('error', `错误堆栈: ${error.stack}`);
        }
    }
})();
