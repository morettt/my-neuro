// js/voice/tts-processor.js
// 改进的文本处理器 - (更新版)
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');
const { TTSPlaybackEngine } = require('./tts-playback-engine.js');
const { TTSRequestHandler } = require('./tts-request-handler.js');

class EnhancedTextProcessor {
   constructor(ttsUrl, uiController, onAudioDataCallback, onStartCallback, onEndCallback, config = null) {
       this.config = config || {};
       this.onEndCallback = onEndCallback;

       // 创建请求处理器和播放引擎
       this.requestHandler = new TTSRequestHandler(this.config, ttsUrl);
       this.playbackEngine = new TTSPlaybackEngine(this.config, uiController, onAudioDataCallback, onStartCallback, onEndCallback);

       // 任务队列
       this.textSegmentQueue = [];
       this.audioDataQueue = [];

       // 状态标志
       this.isProcessingApi = false; // 是否正在调用TTS API
       this.isPlaying = false;      // 是否正在播放音频
       this.shouldStop = false;

       // 启动处理循环
       this.startProcessingThread();
       this.startPlaybackThread();
   }

   setEmotionMapper(emotionMapper) {
       this.playbackEngine.setEmotionMapper(emotionMapper);
   }
   
    // 线程1：处理文本队列，调用API转换为音频
   startProcessingThread() {
       const processNextSegment = async () => {
           if (this.shouldStop) return;

           if (this.textSegmentQueue.length > 0 && !this.isProcessingApi) {
               this.isProcessingApi = true;
               const segment = this.textSegmentQueue.shift();
               try {
                   const audioData = await this.requestHandler.convertTextToSpeech(segment);
                   if (audioData) {
                       this.audioDataQueue.push({ audio: audioData, text: segment });
                   }
               } catch (error) {
                   console.error('TTS API处理错误:', error);
               } finally {
                   this.isProcessingApi = false;
               }
           }
           setTimeout(processNextSegment, 50);
       };
       processNextSegment();
   }

    // 线程2：处理音频队列，播放音频和动画
   startPlaybackThread() {
       const playNextAudio = async () => {
           if (this.shouldStop) return;

           if (this.audioDataQueue.length > 0 && !this.isPlaying) {
               this.isPlaying = true;
               const audioPackage = this.audioDataQueue.shift();
               
               await this.playbackEngine.playAudio(audioPackage.audio, audioPackage.text);
               
               this.isPlaying = false;

               // 检查是否所有任务都已完成
               if (this.audioDataQueue.length === 0 && this.textSegmentQueue.length === 0 && !this.isProcessingApi && this.requestHandler.getPendingSegment().trim() === '') {
                   if (this.onEndCallback) this.onEndCallback();
                   eventBus.emit(Events.TTS_END);
               }
           }
           setTimeout(playNextAudio, 50);
       };
       playNextAudio();
   }
   
    // 接收流式文本并分段
   addStreamingText(text) {
       if (this.shouldStop) return;
       this.requestHandler.segmentStreamingText(text, this.textSegmentQueue);
   }
   
    // 结束流式文本
   finalizeStreamingText() {
       this.requestHandler.finalizeSegmentation(this.textSegmentQueue);
   }

    // 处理完整的非流式文本
   async processTextToSpeech(text) {
       if (!text.trim()) return;
       this.reset();
       this.requestHandler.segmentFullText(text, this.textSegmentQueue);
   }

    // 重置所有状态和队列
   reset() {
       this.shouldStop = false;
       this.textSegmentQueue = [];
       this.audioDataQueue = [];
       this.isPlaying = false;
       this.isProcessingApi = false;
       
       this.requestHandler.reset();
       this.playbackEngine.reset();
   }

    // 中断所有操作
   interrupt() {
       console.log('打断TTS播放...');
       eventBus.emit(Events.TTS_INTERRUPTED);
       
       this.shouldStop = true;
       
       this.requestHandler.abortAllRequests();
       this.playbackEngine.stop();
       
       // 清空队列并重置状态
       this.textSegmentQueue = [];
       this.audioDataQueue = [];
       this.isPlaying = false;
       this.isProcessingApi = false;

       // uiController的clear由playbackEngine的reset调用
       if (this.onEndCallback) this.onEndCallback();
       
       // 延迟后完全重置
       setTimeout(() => {
           this.reset();
           console.log('TTS处理器完全重置完成');
       }, 100);
   }

   stop() {
      this.interrupt();
   }

   isPlaying() {
       return this.isPlaying || this.isProcessingApi || this.textSegmentQueue.length > 0 || this.audioDataQueue.length > 0;
   }
}

module.exports = { EnhancedTextProcessor };