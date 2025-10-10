// 自动对话模块 - 重构版本，复用sendToLLM逻辑
const { appState } = require('../core/app-state.js');
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');

class AutoChatModule {
   constructor(config, ttsProcessor) {
       this.config = config;
       // 注意：ttsProcessor参数保留但不再直接使用，因为sendToLLM已经处理TTS
       this.timeoutId = null;
       this.isRunning = false;
       this.enabled = config.auto_chat.enabled;
       this.idleTimeThreshold = config.auto_chat.idle_time * 1000; // 转换为毫秒
       this.lastInteractionTime = Date.now();
       this.isProcessing = false;

       // 自动截图相关配置
       this.autoScreenshot = config.vision?.auto_screenshot || false;
       this.screenshotEnabled = config.vision?.enabled || false;
   }

   start() {
       if (!this.enabled || this.isRunning) return;

       console.log(`自动对话启动，间隔：${this.idleTimeThreshold}ms`);
       this.isRunning = true;
       this.lastInteractionTime = Date.now();

       // 监听交互更新事件
       eventBus.on(Events.INTERACTION_UPDATED, () => {
           this.updateLastInteractionTime();
       });

       this.scheduleNext();
   }

   stop() {
       if (this.timeoutId) {
           clearTimeout(this.timeoutId);
           this.timeoutId = null;
       }
       this.isRunning = false;
       this.isProcessing = false;

       // 移除事件监听
       eventBus.off(Events.INTERACTION_UPDATED);
   }

   scheduleNext() {
       if (!this.isRunning) return;

       this.timeoutId = setTimeout(() => {
           this.executeChat();
       }, this.idleTimeThreshold);
   }

   // 注意：takeScreenshotBase64方法已移除，现在由sendToLLM统一处理截图

   async executeChat() {
       if (!this.isRunning || this.isProcessing) return;

       // 检查其他活动
       if (appState.isPlayingTTS() || appState.isProcessingBarrage() || appState.isProcessingUserInput()) {
           console.log('有其他活动，延迟5秒重试');
           this.timeoutId = setTimeout(() => this.executeChat(), 5000);
           return;
       }

       this.isProcessing = true;
       console.log('开始自动对话');
       if (typeof logToTerminal === 'function') {
           logToTerminal('info', '🔧 开始自动对话执行');
       }

       try {
           const voiceChat = global.voiceChat;
           if (!voiceChat) {
               console.error('voiceChat不存在');
               return;
           }

           let prompt = `[自动触发] ${this.config.auto_chat.prompt}`;

           // 🎯 核心简化：检查是否需要截图，如果需要则修改prompt让sendToLLM处理
           if (this.screenshotEnabled && this.autoScreenshot) {
               console.log('自动截图模式已开启，主动对话将包含截图');
               // 添加特殊标记，让sendToLLM知道需要截图
               prompt = `${prompt} [需要截图]`;

               // 临时设置标志，让sendToLLM知道要截图
               voiceChat._autoScreenshotFlag = true;
           }

           // 🚀 关键简化：直接使用已有的sendToLLM方法！
           console.log('调用统一的sendToLLM方法...');
           await voiceChat.sendToLLM(prompt);

           // 清除截图标志
           if (voiceChat._autoScreenshotFlag) {
               delete voiceChat._autoScreenshotFlag;
           }

           console.log('自动对话完成');

       } catch (error) {
           console.error('自动对话错误:', error);
           if (typeof logToTerminal === 'function') {
               logToTerminal('error', `❌ 自动对话执行失败: ${error.message}`);
           }
       } finally {
           this.isProcessing = false;
           // 对话完成后，安排下一次
           this.scheduleNext();
       }
   }

   // 注意：waitForTTS方法已移除，因为sendToLLM已经处理了TTS播放

   updateLastInteractionTime() {
       this.lastInteractionTime = Date.now();
       if (this.timeoutId) {
           clearTimeout(this.timeoutId);
           this.scheduleNext();
       }
   }
}

module.exports = { AutoChatModule };