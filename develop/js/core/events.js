// events.js - 标准事件定义
// 集中定义所有事件名称，避免字符串拼写错误

const Events = {
    // TTS相关事件
    TTS_START: 'tts:start',              // TTS开始播放
    TTS_END: 'tts:end',                  // TTS播放结束
    TTS_INTERRUPTED: 'tts:interrupted',  // TTS被中断

    // ASR相关事件
    ASR_START: 'asr:start',              // 开始录音
    ASR_STOP: 'asr:stop',                // 停止录音
    ASR_SPEECH_DETECTED: 'asr:speech',   // 检测到语音
    ASR_TEXT_RECOGNIZED: 'asr:text',     // 语音识别完成

    // 用户输入相关
    USER_INPUT_START: 'user:input:start',   // 用户开始输入
    USER_INPUT_END: 'user:input:end',       // 用户输入结束
    USER_TEXT_INPUT: 'user:text:input',     // 文字输入
    USER_MESSAGE_RECEIVED: 'user:message:received', // 用户消息已接收（用于心情系统）

    // 弹幕相关
    BARRAGE_RECEIVED: 'barrage:received',   // 收到弹幕
    BARRAGE_START: 'barrage:start',         // 开始处理弹幕
    BARRAGE_END: 'barrage:end',             // 弹幕处理结束

    // LLM相关
    LLM_REQUEST_START: 'llm:request:start', // LLM请求开始
    LLM_REQUEST_END: 'llm:request:end',     // LLM请求结束
    LLM_RESPONSE: 'llm:response',           // LLM返回响应
    LLM_ERROR: 'llm:error',                 // LLM请求错误

    // 工具调用
    TOOL_CALL_START: 'tool:call:start',     // 工具调用开始
    TOOL_CALL_END: 'tool:call:end',         // 工具调用结束

    // UI相关
    SUBTITLE_SHOW: 'ui:subtitle:show',      // 显示字幕
    SUBTITLE_HIDE: 'ui:subtitle:hide',      // 隐藏字幕
    CHAT_BOX_TOGGLE: 'ui:chatbox:toggle',   // 切换聊天框

    // 模型相关
    MODEL_LOADED: 'model:loaded',           // 模型加载完成
    MODEL_MOTION: 'model:motion',           // 播放动作
    MODEL_EXPRESSION: 'model:expression',   // 改变表情

    // 应用生命周期
    APP_READY: 'app:ready',                 // 应用就绪
    APP_ERROR: 'app:error',                 // 应用错误

    // 交互相关
    INTERACTION_UPDATED: 'interaction:updated',  // 任何交互发生时触发(用于自动对话模块)
};

module.exports = { Events };
