// 改进的文本处理器 - 与情绪动作同步，支持翻译LLM
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');

class EnhancedTextProcessor {
   constructor(ttsUrl, onAudioDataCallback, onStartCallback, onEndCallback, config = null) {
       this.config = config || {};
       this.ttsUrl = ttsUrl;
       this.onAudioDataCallback = onAudioDataCallback;
       this.onStartCallback = onStartCallback;
       this.onEndCallback = onEndCallback;
       this.language = this.config.tts?.language || "zh"; // 从配置中获取语言设置

       // 云端TTS配置（从cloud配置读取）
       this.cloudTtsEnabled = this.config.cloud?.tts?.enabled || false;
       this.cloudTtsUrl = this.config.cloud?.tts?.url || "";
       this.cloudApiKey = this.config.cloud?.api_key || "";
       this.cloudTtsModel = this.config.cloud?.tts?.model || "";
       this.cloudTtsVoice = this.config.cloud?.tts?.voice || "";
       this.cloudTtsFormat = this.config.cloud?.tts?.response_format || "mp3";
       this.cloudTtsSpeed = this.config.cloud?.tts?.speed || 1.0;

       console.log(`云端TTS (${this.config.cloud?.provider || '未知'}): ${this.cloudTtsEnabled ? '已启用' : '已禁用'}`);

       // 翻译LLM配置
       this.translationEnabled = this.config.translation?.enabled || false;
       this.translationApiKey = this.config.translation?.api_key || "";
       this.translationApiUrl = this.config.translation?.api_url || "";
       this.translationModel = this.config.translation?.model || "";
       this.translationSystemPrompt = this.config.translation?.system_prompt || "";

       console.log(`翻译功能: ${this.translationEnabled ? '已启用' : '已禁用'}`);

       // 单一队列设计
       this.textSegmentQueue = [];    // 待处理的文本段
       this.audioDataQueue = [];      // 已获得音频数据但尚未播放

       // 处理状态标志
       this.isProcessing = false;     // 正在处理文本段
       this.isPlaying = false;        // 正在播放音频
       this.shouldStop = false;       // 停止标志

       // 新增：用于管理所有进行中的TTS请求
       this.activeRequests = new Set();
       this.requestIdCounter = 0;

       // 音频处理相关
       this.audioContext = null;
       this.analyser = null;
       this.dataArray = null;
       this.currentAudio = null;

       // 标点符号定义
       this.punctuations = [',', '。', '，', '？', '!', '！', '；', ';', '：', ':'];

       // 当前要显示的完整文本
       this.currentFullText = '';

       // 临时存储未处理的文本片段
       this.pendingSegment = '';

       // 文字同步相关
       this.llmFullResponse = '';     // LLM返回的完整回复文本
       this.displayedText = '';       // 当前已经显示的文本
       this.currentSegmentText = '';  // 当前正在播放的音频段落对应的文本
       this.syncTextQueue = [];       // 文本段落队列，与音频段落队列对应

       // 情绪动作同步相关
       this.emotionMapper = null;     // 情绪动作映射器引用
       this.currentEmotionMarkers = []; // 当前段落的情绪标记

       // 用于中断的计时器引用
       this._textAnimInterval = null;
       this._renderFrameId = null;

       // 启动处理线程
       this.startProcessingThread();
       this.startPlaybackThread();
   }

   // 设置情绪动作映射器
   setEmotionMapper(emotionMapper) {
       this.emotionMapper = emotionMapper;
   }

   // 初始化音频上下文
   async initAudioContext() {
       if (!this.audioContext) {
           this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
           this.analyser = this.audioContext.createAnalyser();
           this.analyser.fftSize = 256;
           this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
       }
   }

   // 翻译文本方法
   async translateText(text) {
       if (!this.translationEnabled || !text.trim()) {
           return text;
       }

       try {
           console.log(`开始翻译: "${text.substring(0, 50)}..."`);

           const response = await fetch(`${this.translationApiUrl}/chat/completions`, {
               method: 'POST',
               headers: {
                   'Content-Type': 'application/json',
                   'Authorization': `Bearer ${this.translationApiKey}`
               },
               body: JSON.stringify({
                   model: this.translationModel,
                   messages: [
                       {
                           role: 'system',
                           content: this.translationSystemPrompt
                       },
                       {
                           role: 'user',
                           content: text
                       }
                   ],
                   stream: false
               })
           });

           if (!response.ok) {
               throw new Error(`翻译API错误: ${response.status}`);
           }

           const data = await response.json();
           const translatedText = data.choices[0].message.content.trim();

           console.log(`翻译完成: "${translatedText.substring(0, 50)}..."`);
           return translatedText;
       } catch (error) {
           console.error('翻译失败:', error);
           return text; // 翻译失败时返回原文
       }
   }

   // 启动文本处理线程 - 顺序处理文本段
   startProcessingThread() {
       const processNextSegment = async () => {
           if (this.shouldStop) return;

           // 当有文本段待处理且当前没有处理中的文本段时
           if (this.textSegmentQueue.length > 0 && !this.isProcessing) {
               this.isProcessing = true;
               const segment = this.textSegmentQueue.shift();

               try {
                   // 将文本段添加到同步队列，用于后续文本动画显示
                   this.syncTextQueue.push(segment);

                   // 处理单个文本段
                   const audioData = await this.convertTextToSpeech(segment);
                   if (audioData) {
                       // 将音频数据和对应的文本作为一个包加入队列
                       this.audioDataQueue.push({
                           audio: audioData,
                           text: segment
                       });
                   }
               } catch (error) {
                   console.error('TTS处理错误:', error);
               }

               this.isProcessing = false;
           }

           // 继续检查队列
           setTimeout(processNextSegment, 50);
       };

       // 开始处理循环
       processNextSegment();
   }

   // 启动音频播放线程 - 顺序播放音频
   startPlaybackThread() {
       const playNextAudio = async () => {
           if (this.shouldStop) return;

           // 当有音频数据待播放且当前没有播放中的音频时
           if (this.audioDataQueue.length > 0 && !this.isPlaying) {
               const audioPackage = this.audioDataQueue.shift();

               // 设置当前段落的文本，用于文字动画
               this.currentSegmentText = audioPackage.text;

               // 播放音频并同步显示文本
               await this.playAudioWithTextSync(audioPackage.audio);
           }

           // 继续检查队列
           setTimeout(playNextAudio, 50);
       };

       // 开始播放循环
       playNextAudio();
   }

   // 将文本转换为语音（修改版：支持翻译和硅基流动）
   async convertTextToSpeech(text) {
       // 生成请求ID并注册
       const requestId = ++this.requestIdCounter;
       const controller = new AbortController();
       const requestInfo = { id: requestId, controller };
       this.activeRequests.add(requestInfo);

       try {
           // 移除括号内容和星号包裹的内容用于TTS
           const textForTTS = text
               .replace(/<[^>]+>/g, '')     // 不移除情绪标签
               .replace(/（.*?）|\(.*?\)/g, '')  // 移除括号内容
               .replace(/\*.*?\*/g, '');         // 移除星号包裹内容

           // 如果启用翻译，先翻译文本
           let finalTextForTTS = textForTTS;
           if (this.translationEnabled && textForTTS.trim()) {
               finalTextForTTS = await this.translateText(textForTTS);
           }

           // 根据配置选择TTS服务
           if (this.cloudTtsEnabled) {
               // 使用云端TTS
               const response = await fetch(this.cloudTtsUrl, {
                   method: 'POST',
                   headers: {
                       'Content-Type': 'application/json',
                       'Authorization': `Bearer ${this.cloudApiKey}`
                   },
                   body: JSON.stringify({
                       model: this.cloudTtsModel,
                       voice: this.cloudTtsVoice,
                       input: finalTextForTTS,
                       response_format: this.cloudTtsFormat,
                       speed: this.cloudTtsSpeed
                   }),
                   signal: controller.signal
               });

               if (!response.ok) {
                   throw new Error('云端TTS请求失败: ' + response.status);
               }

               return await response.blob();
           } else {
               // 使用本地TTS服务
               const response = await fetch(this.ttsUrl, {
                   method: 'POST',
                   headers: {
                       'Content-Type': 'application/json'
                   },
                   body: JSON.stringify({
                       text: finalTextForTTS,
                       text_language: this.language
                   }),
                   signal: controller.signal
               });

               if (!response.ok) {
                   throw new Error('本地TTS请求失败: ' + response.status);
               }

               return await response.blob();
           }
       } catch (error) {
           // 如果是被中断的请求，不要打印错误
           if (error.name === 'AbortError') {
               return null;
           }
           console.error('TTS转换错误:', error);
           return null;
       } finally {
           // 清理请求记录
           this.activeRequests.delete(requestInfo);
       }
   }

   // 播放单个音频片段，同时实现文本动画同步和情绪动作同步
   async playAudioWithTextSync(audioBlob) {
       if (!audioBlob) return;

       await this.initAudioContext();
       return new Promise((resolve) => {
           if (this.shouldStop) {
               resolve();
               return;
           }

           this.isPlaying = true;
           const audioUrl = URL.createObjectURL(audioBlob);
           const audio = new Audio(audioUrl);
           this.currentAudio = audio;

           // 触发开始回调
           if (this.onStartCallback) {
               this.onStartCallback();
           }

           // 发送TTS开始事件
           eventBus.emit(Events.TTS_START);

           // 创建音频增益节点用于淡出效果
           const gainNode = this.audioContext.createGain();
           gainNode.gain.value = 1.0; // 初始音量

           // 设置音频分析链路：source → gainNode → analyser → destination
           const source = this.audioContext.createMediaElementSource(audio);
           source.connect(gainNode);
           gainNode.connect(this.analyser);
           this.analyser.connect(this.audioContext.destination);

           // 预处理当前段落的文本，提取情绪标记
           let segmentText = this.currentSegmentText;
           let emotionMarkers = [];

           // 如果存在情绪映射器，处理情绪标签
           if (this.emotionMapper) {
               // 使用情绪映射器预处理文本，获取情绪标记
               const processedInfo = this.emotionMapper.prepareTextForTTS(segmentText);
               segmentText = processedInfo.text; // 更新为去除情绪标签的纯文本
               emotionMarkers = processedInfo.emotionMarkers; // 保存情绪标记

               // 保存情绪标记用于后续动作触发
               this.currentEmotionMarkers = [...emotionMarkers];

               console.log(`段落文本: "${segmentText}"`);
               console.log(`情绪标记: ${JSON.stringify(emotionMarkers)}`);
           }

           const segmentLength = segmentText.length;
           let charDisplayIndex = 0;

           // 动态显示文本的计时器
           let textAnimInterval = null;

           // 更新AI的嘴巴动作
           const updateMouth = () => {
               if (this.shouldStop || !this.currentAudio) return;

               this.analyser.getByteFrequencyData(this.dataArray);
               const sampleCount = this.dataArray.length / 2;
               let sum = 0;
               for (let i = 0; i < sampleCount; i++) {
                   sum += this.dataArray[i];
               }
               const average = sum / sampleCount;

               // 使用平方根函数使动画更自然
               const mouthOpenValue = Math.pow((average / 256), 0.8) * 1;

               if (this.onAudioDataCallback) {
                   this.onAudioDataCallback(mouthOpenValue);
               }

               // 持续更新
               if (this.currentAudio && !this.shouldStop) {
                   this._renderFrameId = requestAnimationFrame(updateMouth);
               }
           };

           // 开始文本动画
           const startTextAnimation = () => {
               // 计算每个字符显示的间隔时间（根据音频长度和文本长度）
               const audioDuration = audio.duration * 1000; // 毫秒
               let charInterval = audioDuration / segmentLength;

               // 设置最小和最大字符间隔，以确保动画自然
               charInterval = Math.max(30, Math.min(200, charInterval));

               textAnimInterval = setInterval(() => {
                   if (this.shouldStop) {
                       if (textAnimInterval) {
                           clearInterval(textAnimInterval);
                           textAnimInterval = null;
                       }
                       return;
                   }

                   if (charDisplayIndex < segmentLength) {
                       // 逐步增加显示的文本
                       charDisplayIndex++;

                       // 根据当前显示位置触发情绪动作
                       if (this.emotionMapper && this.currentEmotionMarkers.length > 0) {
                           this.emotionMapper.triggerEmotionByTextPosition(
                               charDisplayIndex,
                               segmentLength,
                               this.currentEmotionMarkers
                           );
                       }

                       // 修改: 完整显示之前所有的文本 + 当前段落的动画部分
                       const currentDisplay = this.displayedText + segmentText.substring(0, charDisplayIndex);

                       // 更新字幕显示
                       if (typeof showSubtitle === 'function') {
                           showSubtitle(`${this.config.subtitle_labels?.ai || 'Fake Neuro'}: ${currentDisplay}`);
                           // 确保滚动到底部
                           document.getElementById('subtitle-container').scrollTop =
                               document.getElementById('subtitle-container').scrollHeight;
                       }
                   }
               }, charInterval);

               // 保存计时器引用以便在中断时清除
               this._textAnimInterval = textAnimInterval;
           };

           audio.oncanplaythrough = () => {
               startTextAnimation();
           };

           audio.onplay = () => {
               updateMouth();

               // 设置淡出效果：在音频即将结束时淡出
               const fadeOutDuration = 0.15; // 淡出时长150ms
               const audioDuration = audio.duration;

               if (audioDuration > fadeOutDuration) {
                   const fadeOutStartTime = audioDuration - fadeOutDuration;

                   // 使用定时器在淡出开始时间触发
                   const fadeOutTimer = setTimeout(() => {
                       if (!this.shouldStop && gainNode) {
                           const currentTime = this.audioContext.currentTime;
                           // 使用exponentialRampToValueAtTime实现平滑淡出
                           gainNode.gain.setValueAtTime(1.0, currentTime);
                           gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + fadeOutDuration);
                       }
                   }, fadeOutStartTime * 1000);

                   // 保存定时器以便清理
                   audio._fadeOutTimer = fadeOutTimer;
               }
           };

            audio.onended = () => {
                // 清除淡出定时器
                if (audio._fadeOutTimer) {
                    clearTimeout(audio._fadeOutTimer);
                    audio._fadeOutTimer = null;
                }

                if (this.onAudioDataCallback) {
                    this.onAudioDataCallback(0); // 关闭嘴巴
                }

                // 清除文本动画计时器
                if (textAnimInterval) {
                    clearInterval(textAnimInterval);
                    textAnimInterval = null;
                    this._textAnimInterval = null;
                }

                // 取消渲染帧
                if (this._renderFrameId) {
                    cancelAnimationFrame(this._renderFrameId);
                    this._renderFrameId = null;
                }

                // 强制触发剩余的情绪标记
                if (this.currentEmotionMarkers && this.currentEmotionMarkers.length > 0) {
                    console.log('音频结束，触发剩余情绪标记:', this.currentEmotionMarkers.map(m => m.emotion));
                    for (const marker of this.currentEmotionMarkers) {
                        if (this.emotionMapper) {
                            this.emotionMapper.playConfiguredEmotion(marker.emotion);
                        }
                    }
                }

                // 音频播放完毕后，将当前段落全部显示
                this.displayedText += segmentText;
                if (typeof showSubtitle === 'function') {
                    showSubtitle(`${this.config.subtitle_labels?.ai || 'Fake Neuro'}: ${this.displayedText}`);
                }

                URL.revokeObjectURL(audioUrl);
                this.currentAudio = null;
                this.isPlaying = false;

                // 清空当前段落的情绪标记
                this.currentEmotionMarkers = [];

                // 检查是否所有文本都已处理和播放完成
                if (this.audioDataQueue.length === 0 &&
                    this.textSegmentQueue.length === 0 &&
                    !this.isProcessing &&
                    this.pendingSegment.trim() === '') {

                    // 修复：播放完成后，设置一个3秒的延迟然后隐藏字幕
                    setTimeout(() => {
                        if (typeof hideSubtitle === 'function') {
                            hideSubtitle();
                        }
                    }, 1000);

                    if (this.onEndCallback) {
                        this.onEndCallback();
                    }

                    // 发送TTS结束事件
                    eventBus.emit(Events.TTS_END);
                }

                resolve();
            };

           audio.onerror = (e) => {
               console.error('音频播放错误:', e);

               // 清除淡出定时器
               if (audio._fadeOutTimer) {
                   clearTimeout(audio._fadeOutTimer);
                   audio._fadeOutTimer = null;
               }

               // 清除文本动画计时器
               if (textAnimInterval) {
                   clearInterval(textAnimInterval);
                   textAnimInterval = null;
                   this._textAnimInterval = null;
               }

               // 🔧 修复：音频错误时也要发送TTS_END事件
               if (this.onAudioDataCallback) {
                   this.onAudioDataCallback(0);
               }

               // 发送TTS结束事件，防止状态卡住
               eventBus.emit(Events.TTS_END);

               // 取消渲染帧
               if (this._renderFrameId) {
                   cancelAnimationFrame(this._renderFrameId);
                   this._renderFrameId = null;
               }

               URL.revokeObjectURL(audioUrl);
               this.currentAudio = null;
               this.isPlaying = false;
               resolve();
           };

           // 播放
           audio.play().catch(error => {
               console.error('播放失败:', error);

               // 清除淡出定时器
               if (audio._fadeOutTimer) {
                   clearTimeout(audio._fadeOutTimer);
                   audio._fadeOutTimer = null;
               }

               // 清除文本动画计时器
               if (textAnimInterval) {
                   clearInterval(textAnimInterval);
                   textAnimInterval = null;
                   this._textAnimInterval = null;
               }

               // 🔧 修复：播放失败时也要关闭嘴部和发送TTS_END事件
               if (this.onAudioDataCallback) {
                   this.onAudioDataCallback(0);
               }

               // 发送TTS结束事件，防止状态卡住
               eventBus.emit(Events.TTS_END);

               // 取消渲染帧
               if (this._renderFrameId) {
                   cancelAnimationFrame(this._renderFrameId);
                   this._renderFrameId = null;
               }

               this.currentAudio = null;
               this.isPlaying = false;
               resolve();
           });
       });
   }

   // 添加流式文本，实时进行分段处理
   addStreamingText(text) {
       if (this.shouldStop) return;

       // 更新LLM的完整响应文本
       this.llmFullResponse += text;

       // 将新文本追加到待处理的段落中
       this.pendingSegment += text;

       // 逐字符处理，只在标点符号处分段
       let processedSegment = '';
       for (let i = 0; i < this.pendingSegment.length; i++) {
           const char = this.pendingSegment[i];
           processedSegment += char;

           // 遇到标点符号时分段
           if (this.punctuations.includes(char) && processedSegment.trim()) {
               this.textSegmentQueue.push(processedSegment);
               processedSegment = '';
           }
       }

       // 保存未处理的文本段
       this.pendingSegment = processedSegment;
   }

   // 完成流式文本处理，确保所有文本都被处理
   finalizeStreamingText() {
       // 添加消息到聊天框
       const chatMessages = document.getElementById('chat-messages');
       if (chatMessages) {
           const messageElement = document.createElement('div');
           messageElement.innerHTML = `<strong>Fake Neuro:</strong> ${this.llmFullResponse}`;
           chatMessages.appendChild(messageElement);
           chatMessages.scrollTop = chatMessages.scrollHeight;
       }

       // 确保任何剩余的文本都被处理
       if (this.pendingSegment.trim()) {
           this.textSegmentQueue.push(this.pendingSegment);
           this.pendingSegment = '';
       }
   }

   // 处理完整文本（兼容旧的调用方式）
   async processTextToSpeech(text) {
       if (!text.trim()) return;

       this.reset();
       this.llmFullResponse = text;

       // 不再直接显示文本，而是等待音频播放时显示

       // 分段处理文本
       let currentSegment = '';
       for (let char of text) {
           currentSegment += char;
           if (this.punctuations.includes(char) && currentSegment.trim()) {
               this.textSegmentQueue.push(currentSegment);
               currentSegment = '';
           }
       }

       // 处理末尾没有标点的文本
       if (currentSegment.trim()) {
           this.textSegmentQueue.push(currentSegment);
       }
   }

   // 重置所有状态
   reset() {
       this.llmFullResponse = '';
       this.displayedText = '';
       this.currentSegmentText = '';
       this.pendingSegment = '';
       this.syncTextQueue = [];
       this.currentEmotionMarkers = [];

       // 停止当前播放
       if (this.currentAudio) {
           this.currentAudio.pause();
           this.currentAudio = null;
       }

       // 清除所有计时器
       if (this._textAnimInterval) {
           clearInterval(this._textAnimInterval);
           this._textAnimInterval = null;
       }

       if (this._renderFrameId) {
           cancelAnimationFrame(this._renderFrameId);
           this._renderFrameId = null;
       }

       // 清空所有队列
       this.textSegmentQueue = [];
       this.audioDataQueue = [];

       // 重置状态
       this.isPlaying = false;
       this.isProcessing = false;
       this.shouldStop = false;

       // 重置嘴部动作
       if (this.onAudioDataCallback) {
           this.onAudioDataCallback(0);
       }
   }

   // 立即打断TTS播放
   interrupt() {
       console.log('打断TTS播放...');

       // 发送TTS中断事件
       eventBus.emit(Events.TTS_INTERRUPTED);

       // 设置打断标志立即生效
       this.shouldStop = true;

       // 取消所有进行中的TTS请求
       this.activeRequests.forEach(requestInfo => {
           requestInfo.controller.abort();
       });
       this.activeRequests.clear();

       // 查找并清除所有可能的动画计时器
       if (this._textAnimInterval) {
           clearInterval(this._textAnimInterval);
           this._textAnimInterval = null;
       }

       // 取消可能正在进行的渲染帧
       if (this._renderFrameId) {
           cancelAnimationFrame(this._renderFrameId);
           this._renderFrameId = null;
       }

       // 立即停止当前音频播放并清除所有事件监听器
       if (this.currentAudio) {
           try {
               // 移除所有事件监听器，防止onended等继续触发
               this.currentAudio.onended = null;
               this.currentAudio.onplay = null;
               this.currentAudio.oncanplaythrough = null;
               this.currentAudio.onerror = null;

               // 暂停并释放音频
               this.currentAudio.pause();
               this.currentAudio.src = ""; // 清空音频源
               this.currentAudio = null;
           } catch (e) {
               console.error('停止音频出错:', e);
           }
       }

       // 清空所有队列和缓冲区
       this.textSegmentQueue = [];
       this.audioDataQueue = [];
       this.pendingSegment = '';
       this.llmFullResponse = '';
       this.displayedText = '';
       this.currentSegmentText = '';
       this.syncTextQueue = [];
       this.currentEmotionMarkers = [];

       // 重置状态标志
       this.isPlaying = false;
       this.isProcessing = false;

       // 恢复嘴形到默认状态
       if (this.onAudioDataCallback) {
           this.onAudioDataCallback(0); // 关闭嘴巴
       }

       // 立即隐藏字幕
       if (typeof hideSubtitle === 'function') {
           hideSubtitle();
       }

       // 执行结束回调，确保系统状态复位
       if (this.onEndCallback) {
           this.onEndCallback();
       }

       // 延迟重置shouldStop标志，确保所有处理都已停止
       setTimeout(() => {
           // 确保可以接收新的输入
           this.shouldStop = false;

           // 重新启动处理线程
           this.startProcessingThread();
           this.startPlaybackThread();

           console.log('TTS处理器完全重置完成');
       }, 300);
   }

   // 立即停止所有处理
   stop() {
       this.shouldStop = true;
       this.reset();

       // 隐藏字幕
       if (typeof hideSubtitle === 'function') {
           hideSubtitle();
       }

       if (this.onEndCallback) {
           this.onEndCallback();
       }
   }

   // 判断是否正在播放
   isPlaying() {
       return this.isPlaying || this.isProcessing || this.textSegmentQueue.length > 0 || this.audioDataQueue.length > 0;
   }
}

// 导出TTS处理器类
module.exports = { EnhancedTextProcessor };