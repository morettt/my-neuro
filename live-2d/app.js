// 导入所需模块
const { EnhancedTextProcessor } = require('./js/tts-processor.js');
const { ModelInteractionController } = require('./js/model-interaction.js');
const { VoiceChatInterface } = require('./js/voice-chat.js');
const { configLoader } = require('./js/config-loader.js');
const { LiveStreamModule } = require('./js/LiveStreamModule.js');
const { AutoChatModule } = require('./js/auto-chat.js');
const { EmotionMotionMapper } = require('./js/emotion-motion-mapper.js');
const { LocalToolManager } = require('./js/local-tool-manager.js');
const { MCPManager } = require('./js/mcp-manager.js');
const { MusicPlayer } = require('./js/music-player.js');

// 设置全局变量，用于模块间共享状态
global.isPlayingTTS = false;
global.isProcessingBarrage = false;
global.isProcessingUserInput = false;

const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 监听中断信号
ipcRenderer.on('interrupt-tts', () => {
    console.log('接收到中断信号');
    logToTerminal('info', '接收到中断信号');
    if (ttsProcessor) {
        ttsProcessor.interrupt();
    }
    global.isPlayingTTS = false;
    global.isProcessingUserInput = false;
    global.isProcessingBarrage = false;

    // 重置弹幕状态机
    barrageScheduler.state = BarrageState.IDLE;
    barrageScheduler.currentBarrage = null;
    barrageScheduler.retryCount = 0;
    console.log('弹幕状态机已重置');
    logToTerminal('info', '弹幕状态机已重置');
    if (voiceChat && voiceChat.asrProcessor && config.asr.enabled) {
        setTimeout(() => {
            voiceChat.resumeRecording();
            console.log('ASR录音已恢复');
            logToTerminal('info', 'ASR录音已恢复');
        }, 200);
    }
    console.log('系统已复位，可以继续对话');
    logToTerminal('info', '系统已复位，可以继续对话');
});

// 其他ipcRenderer监听器保持不变...
ipcRenderer.on('trigger-motion-hotkey', (event, motionIndex) => {
    if (emotionMapper) {
        emotionMapper.playMotion(motionIndex);
    }
});

ipcRenderer.on('stop-all-motions', () => {
    if (currentModel && currentModel.internalModel && currentModel.internalModel.motionManager) {
        currentModel.internalModel.motionManager.stopAllMotions();
        if (emotionMapper) {
            emotionMapper.playDefaultMotion();
        }
    }
});

// 添加音乐播放快捷键监听
ipcRenderer.on('trigger-music-play', () => {
    if (emotionMapper && global.musicPlayer) {
        emotionMapper.playMotion(8);
        console.log('触发麦克风动作并开始随机播放音乐');
        global.musicPlayer.playRandomMusic();
    }
});

ipcRenderer.on('trigger-music-stop-with-motion', () => {
    if (emotionMapper && global.musicPlayer) {
        global.musicPlayer.stop();
        console.log('音乐已停止');
        emotionMapper.playMotion(7);
        console.log('触发赌气动作，音乐播放结束');
    }
});

// 终端日志记录函数
function logToTerminal(level, message) {
    const timestamp = new Date().toISOString();
    const formattedMsg = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    if (level === 'error') {
        process.stderr.write(formattedMsg + '\n');
    } else {
        process.stdout.write(formattedMsg + '\n');
    }

    if (level === 'error') {
        console.error(message);
    } else if (level === 'warn') {
        console.warn(message);
    } else {
        console.log(message);
    }

    try {
        const fs = require('fs');
        const path = require('path');
        fs.appendFileSync(path.join(__dirname, 'runtime.log'), formattedMsg + '\n', 'utf8');
    } catch (e) {
        // 忽略文件写入错误
    }
}

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

// 字幕管理
let subtitleTimeout = null;

// 更新鼠标穿透状态
function updateMouseIgnore() {
    const shouldIgnore = !this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global);
    ipcRenderer.send('set-ignore-mouse-events', {
        ignore: shouldIgnore,
        options: { forward: true }
    });
}

document.addEventListener('mousemove', updateMouseIgnore);

// 聊天框相关事件监听
const chatInput = document.getElementById('chat-input');
if (chatInput) {
    document.getElementById('text-chat-container').addEventListener('mouseenter', () => {
        ipcRenderer.send('set-ignore-mouse-events', {
            ignore: false,
            options: { forward: false }
        });
    });

    document.getElementById('text-chat-container').addEventListener('mouseleave', () => {
        ipcRenderer.send('set-ignore-mouse-events', {
            ignore: true,
            options: { forward: true }
        });
    });

    chatInput.addEventListener('focus', () => {
        ipcRenderer.send('set-ignore-mouse-events', {
            ignore: false,
            options: { forward: false }
        });
    });

    chatInput.addEventListener('blur', () => {
        ipcRenderer.send('set-ignore-mouse-events', {
            ignore: true,
            options: { forward: true }
        });
    });
}

function showSubtitle(text, duration = null) {
    // 检查字幕是否启用
    if (config && config.subtitle_labels && config.subtitle_labels.enabled === false) {
        return; // 如果字幕被禁用，直接返回不显示
    }

    const container = document.getElementById('subtitle-container');
    const subtitleText = document.getElementById('subtitle-text');

    // 清除之前的定时器
    if (subtitleTimeout) {
        clearTimeout(subtitleTimeout);
        subtitleTimeout = null;
    }

    subtitleText.textContent = text;
    container.style.display = 'block';
    container.scrollTop = container.scrollHeight;

    // 如果指定了持续时间，设置自动隐藏
    if (duration) {
        subtitleTimeout = setTimeout(() => {
            hideSubtitle();
        }, duration);
    }
}

function hideSubtitle() {
    const container = document.getElementById('subtitle-container');
    container.style.display = 'none';
    if (subtitleTimeout) {
        clearTimeout(subtitleTimeout);
        subtitleTimeout = null;
    }
}

// 创建模型交互控制器
const modelController = new ModelInteractionController();
let currentModel = null;
const INTRO_TEXT = config.ui.intro_text || "你好，我叫fake neuro。";
let voiceChat = null;
let liveStreamModule = null;
let autoChatModule = null;
let emotionMapper = null;
let localToolManager = null;
let mcpManager = null;
let ttsProcessor = null;

// 弹幕队列管理 - 原子化调度器设计
let barrageQueue = [];

// 弹幕处理状态机
const BarrageState = {
    IDLE: 'idle',           // 空闲状态
    PROCESSING: 'processing', // 正在处理中
    WAITING_TTS: 'waiting_tts', // 等待TTS完成
    ERROR: 'error'          // 错误状态
};

// 全局弹幕调度器状态
let barrageScheduler = {
    state: BarrageState.IDLE,
    currentBarrage: null,
    schedulerId: null,      // 唯一调度器ID
    retryCount: 0,
    maxRetries: 3
};

// 原子化状态转换函数 - 防止竞态条件的核心
function atomicStateTransition(fromState, toState, operation = null) {
    // 原子检查和转换
    if (barrageScheduler.state !== fromState) {
        console.log(`状态转换失败: 期望${fromState}, 实际${barrageScheduler.state}`);
        return false;
    }

    const oldState = barrageScheduler.state;
    barrageScheduler.state = toState;

    console.log(`弹幕状态: ${oldState} -> ${toState}`);
    logToTerminal('info', `弹幕状态转换: ${oldState} -> ${toState}`);

    // 执行伴随操作
    if (operation) {
        try {
            operation();
        } catch (error) {
            console.error('状态转换操作失败:', error);
            barrageScheduler.state = BarrageState.ERROR;
        }
    }

    return true;
}

// 单一调度入口 - 解决多重调用问题
function scheduleBarrageProcessing() {
    // 生成唯一调度ID，防止重复调度
    const scheduleId = Date.now() + Math.random();

    // 如果当前不是空闲状态，忽略调度请求
    if (barrageScheduler.state !== BarrageState.IDLE) {
        console.log(`调度忽略: 当前状态${barrageScheduler.state}`);
        return;
    }

    // 如果队列为空，忽略调度
    if (barrageQueue.length === 0) {
        return;
    }

    // 【关键修复】用户语音输入具有最高优先级 - 暂停弹幕处理
    if (global.isProcessingUserInput) {
        console.log('用户正在语音输入，暂停弹幕处理，1秒后重试');
        setTimeout(() => scheduleBarrageProcessing(), 1000);
        return;
    }

    // 如果TTS正在播放，延迟调度
    if (global.isPlayingTTS) {
        console.log('TTS播放中，延迟500ms重新调度');
        setTimeout(() => scheduleBarrageProcessing(), 500);
        return;
    }

    // 开始处理
    barrageScheduler.schedulerId = scheduleId;
    processNextBarrage();
}

// 检查是否启用TTS
const ttsEnabled = config.tts?.enabled !== false;
const asrEnabled = config.asr?.enabled !== false;

// 根据配置创建TTS处理器
if (ttsEnabled) {
    ttsProcessor = new EnhancedTextProcessor(
        config.tts.url,
        (value) => modelController.setMouthOpenY(value),
        () => {
            global.isPlayingTTS = true;
            if (voiceChat && asrEnabled && !config.asr?.voice_barge_in) {
                voiceChat.pauseRecording();
            }
        },
        () => {
            global.isPlayingTTS = false;
            if (voiceChat && asrEnabled && !config.asr?.voice_barge_in) {
                voiceChat.resumeRecording();
            }
            if (global.autoChatModule) {
                global.autoChatModule.updateLastInteractionTime();
            }
            // 调用新的TTS完成回调
            onBarrageTTSComplete();
        },
        config
    );
} else {
    // 创建一个虚拟的TTS处理器，只处理文本显示
    ttsProcessor = {
        reset: () => {},
        processTextToSpeech: (text) => {
            // 直接显示文本，不进行语音合成
            showSubtitle(`Fake Neuro: ${text}`, 3000); // 添加3秒自动消失

            // 添加到聊天记录
            const chatMessages = document.getElementById('chat-messages');
            if (chatMessages) {
                const messageElement = document.createElement('div');
                messageElement.innerHTML = `<strong>Fake Neuro:</strong> ${text}`;
                chatMessages.appendChild(messageElement);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            // 立即调用结束回调，解锁ASR
            if (this.onEndCallback) {
                this.onEndCallback();
            }

            // 模拟TTS结束，延迟3秒后触发其他逻辑
            setTimeout(() => {
                if (global.autoChatModule) {
                    global.autoChatModule.updateLastInteractionTime();
                }
                onBarrageTTSComplete();
            }, 3000); // 改为3秒，与字幕消失时间同步
        },
        addStreamingText: (text) => {
            // 在纯文本模式下，流式文本直接累积显示，带自动消失
            if (!this.accumulatedText) this.accumulatedText = '';
            this.accumulatedText += text;
            showSubtitle(`Fake Neuro: ${this.accumulatedText}`, 3000); // 每次更新都重新设置3秒倒计时
        },
        addStreamingText: (text) => {
            // 在纯文本模式下，流式文本直接累积显示，带自动消失
            if (!this.accumulatedText) this.accumulatedText = '';
            this.accumulatedText += text;
            showSubtitle(`Fake Neuro: ${this.accumulatedText}`, 3000); // 每次更新都重新设置3秒倒计时
        },
        finalizeStreamingText: () => {
            if (this.accumulatedText) {
                // 最终确保字幕会在3秒后消失
                showSubtitle(`Fake Neuro: ${this.accumulatedText}`, 3000);

                // 添加到聊天记录
                const chatMessages = document.getElementById('chat-messages');
                if (chatMessages) {
                    const messageElement = document.createElement('div');
                    messageElement.innerHTML = `<strong>Fake Neuro:</strong> ${this.accumulatedText}`;
                    chatMessages.appendChild(messageElement);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
                this.accumulatedText = '';

                // 立即调用结束回调，解锁ASR
                if (this.onEndCallback) {
                    this.onEndCallback();
                }

                // 3秒后模拟TTS结束的其他逻辑
                setTimeout(() => {
                    if (global.autoChatModule) {
                        global.autoChatModule.updateLastInteractionTime();
                    }
                    onBarrageTTSComplete();
                }, 3000);
            }
        },
        interrupt: () => {
            this.accumulatedText = '';
            hideSubtitle();
            // 立即调用结束回调，确保ASR解锁
            if (this.onEndCallback) {
                this.onEndCallback();
            }
        },
        setEmotionMapper: (mapper) => {
            // 在纯文本模式下也支持情绪映射
            this.emotionMapper = mapper;
        },
        isPlaying: () => false,
        accumulatedText: '',
        onEndCallback: null // 添加回调属性
    };
    console.log('TTS已禁用，使用纯文本模式');
    logToTerminal('info', 'TTS已禁用，使用纯文本模式');
}

// 初始化时增强系统提示词
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

// 新版原子化弹幕处理系统
function addToBarrageQueue(nickname, text) {
    barrageQueue.push({ nickname, text });
    console.log(`弹幕已加入队列: ${nickname}: ${text} (队列长度: ${barrageQueue.length})`);
    logToTerminal('info', `弹幕已加入队列: ${nickname}: ${text} (队列长度: ${barrageQueue.length})`);

    // 触发调度 - 单一入口，避免重复调用
    scheduleBarrageProcessing();
}

// 处理下一条弹幕 - 状态机驱动
async function processNextBarrage() {
    // 原子状态转换：IDLE -> PROCESSING
    if (!atomicStateTransition(BarrageState.IDLE, BarrageState.PROCESSING)) {
        return; // 状态转换失败，可能已有其他处理在进行
    }

    try {
        // 【关键修复】在开始处理前再次检查用户输入优先级
        if (global.isProcessingUserInput) {
            console.log('用户正在语音输入，中止弹幕处理');
            atomicStateTransition(BarrageState.PROCESSING, BarrageState.IDLE);
            setTimeout(() => scheduleBarrageProcessing(), 1000);
            return;
        }

        // 检查队列
        if (barrageQueue.length === 0) {
            atomicStateTransition(BarrageState.PROCESSING, BarrageState.IDLE);
            return;
        }

        // 获取弹幕
        const barrage = barrageQueue.shift();
        barrageScheduler.currentBarrage = barrage;
        barrageScheduler.retryCount = 0;

        console.log(`开始处理弹幕: ${barrage.nickname}: ${barrage.text}`);
        logToTerminal('info', `开始处理弹幕: ${barrage.nickname}: ${barrage.text}`);

        // 处理弹幕
        await executeBarrageMessage(barrage.nickname, barrage.text);

        // 成功处理完成
        barrageScheduler.currentBarrage = null;

        // 更新自动对话模块时间
        if (global.autoChatModule) {
            global.autoChatModule.updateLastInteractionTime();
        }

        // 原子状态转换：PROCESSING -> WAITING_TTS (等待TTS完成)
        atomicStateTransition(BarrageState.PROCESSING, BarrageState.WAITING_TTS);

        // TTS完成后会调用 onBarrageTTSComplete()

    } catch (error) {
        console.error('处理弹幕出错:', error);
        logToTerminal('error', `处理弹幕出错: ${error.message}`);

        // 错误恢复
        barrageScheduler.retryCount++;
        if (barrageScheduler.retryCount < barrageScheduler.maxRetries) {
            console.log(`弹幕处理重试 ${barrageScheduler.retryCount}/${barrageScheduler.maxRetries}`);
            // 重新加入队列头部
            if (barrageScheduler.currentBarrage) {
                barrageQueue.unshift(barrageScheduler.currentBarrage);
            }

            // 延迟重试
            atomicStateTransition(BarrageState.PROCESSING, BarrageState.IDLE);
            setTimeout(() => scheduleBarrageProcessing(), 1000);
        } else {
            console.error('弹幕处理失败，超过最大重试次数');
            barrageScheduler.currentBarrage = null;
            atomicStateTransition(BarrageState.PROCESSING, BarrageState.IDLE);
            // 继续处理下一条
            setTimeout(() => scheduleBarrageProcessing(), 500);
        }
    }
}

// TTS完成回调 - 状态机驱动的继续处理
function onBarrageTTSComplete() {
    if (barrageScheduler.state === BarrageState.WAITING_TTS) {
        console.log('TTS播放完成，准备处理下一条弹幕');
        atomicStateTransition(BarrageState.WAITING_TTS, BarrageState.IDLE);

        // 500ms后继续处理队列
        setTimeout(() => scheduleBarrageProcessing(), 500);
    }
}

// 兼容旧代码的函数 - 重定向到新系统
async function processBarrageQueue() {
    console.log('调用了旧版processBarrageQueue，重定向到新调度系统');
    scheduleBarrageProcessing();
}

// 执行弹幕消息处理 - 新版本，移除状态检查
async function executeBarrageMessage(nickname, text) {
    try {
        if (!voiceChat) {
            throw new Error('VoiceChat未初始化');
        }

        // 重置AI日记定时器
        if (voiceChat.resetDiaryTimer) {
            voiceChat.resetDiaryTimer();
        }

        enhanceSystemPrompt();

        voiceChat.messages.push({
            'role': 'user',
            'content': `[接收到了直播间的弹幕] ${nickname}给你发送了一个消息: ${text}`
        });

        if (voiceChat.enableContextLimit) {
            voiceChat.trimMessages();
        }

        const requestBody = {
            model: voiceChat.MODEL,
            messages: voiceChat.messages,
            stream: false
        };

        // 合并本地Function Call工具和MCP工具（弹幕处理）
        let allTools = [];

        // 添加本地Function Call工具
        if (global.localToolManager && global.localToolManager.isEnabled) {
            const localTools = global.localToolManager.getToolsForLLM();
            if (localTools && localTools.length > 0) {
                allTools.push(...localTools);
            }
        }

        // 添加MCP工具
        if (global.mcpManager && global.mcpManager.isEnabled) {
            const mcpTools = global.mcpManager.getToolsForLLM();
            if (mcpTools && mcpTools.length > 0) {
                allTools.push(...mcpTools);
            }
        }

        if (allTools.length > 0) {
            requestBody.tools = allTools;
        }

        // 【关键修复】在发送AI请求前再次检查用户输入优先级
        if (global.isProcessingUserInput) {
            console.log('用户正在语音输入，中止弹幕AI请求');
            throw new Error('用户语音输入优先，中止弹幕处理');
        }

        const response = await fetch(`${voiceChat.API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${voiceChat.API_KEY}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            // 错误处理保持不变...
            let errorDetail = "";
            try {
                const errorBody = await response.text();
                try {
                    const errorJson = JSON.parse(errorBody);
                    errorDetail = JSON.stringify(errorJson, null, 2);
                } catch (e) {
                    errorDetail = errorBody;
                }
            } catch (e) {
                errorDetail = "无法读取错误详情";
            }

            logToTerminal('error', `API错误 (${response.status} ${response.statusText}):\n${errorDetail}`);

            let errorMessage = "";
            switch (response.status) {
                case 401:
                    errorMessage = "API密钥验证失败，请检查你的API密钥";
                    break;
                case 403:
                    errorMessage = "API访问被禁止，你的账号可能被限制";
                    break;
                case 404:
                    errorMessage = "API接口未找到，请检查API地址";
                    break;
                case 429:
                    errorMessage = "请求过于频繁，超出API限制";
                    break;
                case 500:
                case 502:
                case 503:
                case 504:
                    errorMessage = "服务器错误，AI服务当前不可用";
                    break;
                default:
                    errorMessage = `API错误: ${response.status} ${response.statusText}`;
            }
            throw new Error(`${errorMessage}\n详细信息: ${errorDetail}`);
        }

        const responseData = await response.json();
        const result = responseData.choices[0].message;

        // 工具调用处理（弹幕）
        if (result.tool_calls && result.tool_calls.length > 0) {
            console.log("检测到工具调用:", result.tool_calls);
            logToTerminal('info', `检测到工具调用: ${JSON.stringify(result.tool_calls)}`);

            voiceChat.messages.push({
                'role': 'assistant',
                'content': null,
                'tool_calls': result.tool_calls
            });

            // 尝试不同的工具管理器执行工具调用（弹幕处理）
            let toolResult = null;

            // 首先尝试MCP工具
            if (global.mcpManager && global.mcpManager.isEnabled) {
                try {
                    toolResult = await global.mcpManager.handleToolCalls(result.tool_calls);
                } catch (error) {
                    console.log(`弹幕MCP工具调用失败，尝试本地工具: ${error.message}`);
                }
            }

            // 如果MCP没有处理成功，尝试本地Function Call工具
            if (!toolResult && global.localToolManager && global.localToolManager.isEnabled) {
                try {
                    toolResult = await global.localToolManager.handleToolCalls(result.tool_calls);
                } catch (error) {
                    console.error(`弹幕本地工具调用也失败: ${error.message}`);
                    throw error;
                }
            }

            if (toolResult) {
                console.log("工具调用结果:", toolResult);
                logToTerminal('info', `工具调用结果: ${JSON.stringify(toolResult)}`);

                // 处理多工具调用结果
                if (Array.isArray(toolResult)) {
                    // 多个工具调用结果
                    toolResult.forEach(singleResult => {
                        voiceChat.messages.push({
                            'role': 'tool',
                            'content': singleResult.content,
                            'tool_call_id': singleResult.tool_call_id
                        });
                    });
                } else {
                    // 单个工具调用结果（向后兼容）
                    voiceChat.messages.push({
                        'role': 'tool',
                        'content': toolResult,
                        'tool_call_id': result.tool_calls[0].id
                    });
                }

                const finalRequestOptions = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${voiceChat.API_KEY}`
                    },
                    body: JSON.stringify({
                        model: voiceChat.MODEL,
                        messages: voiceChat.messages,
                        stream: false
                    })
                };

                const finalResponse = await fetch(`${voiceChat.API_URL}/chat/completions`, finalRequestOptions);

                if (!finalResponse.ok) {
                    // 错误处理...
                    let errorDetail = "";
                    try {
                        const errorBody = await finalResponse.text();
                        try {
                            const errorJson = JSON.parse(errorBody);
                            errorDetail = JSON.stringify(errorJson, null, 2);
                        } catch (e) {
                            errorDetail = errorBody;
                        }
                    } catch (e) {
                        errorDetail = "无法读取错误详情";
                    }

                    logToTerminal('error', `API错误 (${finalResponse.status} ${finalResponse.statusText}):\n${errorDetail}`);

                    let errorMessage = "";
                    switch (finalResponse.status) {
                        case 401:
                            errorMessage = "API密钥验证失败，请检查你的API密钥";
                            break;
                        case 403:
                            errorMessage = "API访问被禁止，你的账号可能被限制";
                            break;
                        case 404:
                            errorMessage = "API接口未找到，请检查API地址";
                            break;
                        case 429:
                            errorMessage = "请求过于频繁，超出API限制";
                            break;
                        case 500:
                        case 502:
                        case 503:
                        case 504:
                            errorMessage = "服务器错误，AI服务当前不可用";
                            break;
                        default:
                            errorMessage = `API错误: ${finalResponse.status} ${finalResponse.statusText}`;
                    }
                    throw new Error(`${errorMessage}\n详细信息: ${errorDetail}`);
                }

                const finalResponseData = await finalResponse.json();
                const finalResult = finalResponseData.choices[0].message;

                if (finalResult.content) {
                    voiceChat.messages.push({ 'role': 'assistant', 'content': finalResult.content });

                    // 【关键修复】在TTS播放前检查用户输入优先级
                    if (global.isProcessingUserInput) {
                        console.log('用户正在语音输入，跳过弹幕TTS播放');
                        throw new Error('用户语音输入优先，跳过TTS播放');
                    }

                    ttsProcessor.reset();
                    ttsProcessor.processTextToSpeech(finalResult.content);
                }
            } else {
                console.error("工具调用失败");
                logToTerminal('error', "工具调用失败");
                throw new Error("工具调用失败，无法完成功能扩展");
            }
        } else if (result.content) {
            voiceChat.messages.push({ 'role': 'assistant', 'content': result.content });

            // 【关键修复】在TTS播放前检查用户输入优先级
            if (global.isProcessingUserInput) {
                console.log('用户正在语音输入，跳过弹幕TTS播放');
                throw new Error('用户语音输入优先，跳过TTS播放');
            }

            ttsProcessor.reset();
            ttsProcessor.processTextToSpeech(result.content);
        }

        if (voiceChat.enableContextLimit) {
            voiceChat.trimMessages();
        }
    } catch (error) {
        logToTerminal('error', `处理弹幕消息出错: ${error.message}`);
        if (error.stack) {
            logToTerminal('error', `错误堆栈: ${error.stack}`);
        }

        let errorMessage = "抱歉，处理弹幕出错";

        if (error.message.includes("API密钥验证失败")) {
            errorMessage = "API密钥错误，请检查配置";
        } else if (error.message.includes("API访问被禁止")) {
            errorMessage = "API访问受限，请联系支持";
        } else if (error.message.includes("API接口未找到")) {
            errorMessage = "无效的API地址，请检查配置";
        } else if (error.message.includes("请求过于频繁")) {
            errorMessage = "请求频率超限，请稍后再试";
        } else if (error.message.includes("服务器错误")) {
            errorMessage = "AI服务不可用，请稍后再试";
        } else if (error.message.includes("工具调用失败")) {
            errorMessage = "功能扩展调用失败，请重试";
        } else if (error.name === "TypeError" && error.message.includes("fetch")) {
            errorMessage = "网络连接失败，请检查网络";
        } else if (error.name === "SyntaxError") {
            errorMessage = "解析API响应出错，请重试";
        } else {
            errorMessage = `弹幕处理错误: ${error.message}`;
        }

        logToTerminal('error', `用户显示错误: ${errorMessage}`);

        showSubtitle(errorMessage, 3000);
        if (voiceChat.asrProcessor && asrEnabled) {
            voiceChat.asrProcessor.resumeRecording();
        }
        setTimeout(() => hideSubtitle(), 3000);
    }
}

// 兼容旧代码的弹幕处理函数 - 重定向到新系统
async function handleBarrageMessage(nickname, text) {
    console.log('调用了旧版handleBarrageMessage，建议更新为executeBarrageMessage');
    return await executeBarrageMessage(nickname, text);
}

(async function main() {
    try {
        // ===== 第一阶段: 初始化MCP系统 =====
        console.log('🚀 第一阶段: 初始化MCP系统...');
        logToTerminal('info', '🚀 第一阶段: 初始化MCP系统...');

        try {
            mcpManager = new MCPManager(config);
            global.mcpManager = mcpManager;
            logToTerminal('info', `✅ MCPManager创建成功，启用状态: ${mcpManager.isEnabled}`);
        } catch (error) {
            logToTerminal('error', `❌ MCPManager创建失败: ${error.message}`);
            console.error('MCPManager创建失败:', error);
            mcpManager = null;
        }

        // 等待MCP初始化完成
        logToTerminal('info', `🔍 检查MCP状态: mcpManager=${!!mcpManager}, isEnabled=${mcpManager?.isEnabled}`);
        if (mcpManager && mcpManager.isEnabled) {
            console.log('⏳ 等待MCP系统初始化完成...');
            logToTerminal('info', '⏳ 等待MCP系统初始化完成...');
            const mcpStartTime = Date.now();

            try {
                logToTerminal('info', '🔧 开始MCP initialize...');
                await mcpManager.initialize();
                logToTerminal('info', '🔧 开始MCP waitForInitialization...');
                await mcpManager.waitForInitialization();
                const mcpEndTime = Date.now();

                console.log(`✅ MCP系统初始化完成，耗时: ${mcpEndTime - mcpStartTime}ms`);
                logToTerminal('info', `✅ MCP系统初始化完成，耗时: ${mcpEndTime - mcpStartTime}ms`);

                const mcpStats = mcpManager.getStats();
                console.log(`🔧 MCP状态: ${mcpStats.servers}个服务器, ${mcpStats.tools}个工具`);
                logToTerminal('info', `🔧 MCP状态: ${mcpStats.servers}个服务器, ${mcpStats.tools}个工具`);
            } catch (error) {
                logToTerminal('error', `❌ MCP初始化失败: ${error.message}`);
                console.error('MCP初始化失败:', error);
            }
        } else {
            logToTerminal('info', '⚠️ MCP系统未启用或创建失败');
        }

        // ===== 第二阶段: 创建语音聊天接口 =====
        console.log('🚀 第二阶段: 初始化语音系统...');
        voiceChat = new VoiceChatInterface(
            config.asr.vad_url,
            config.asr.asr_url,
            ttsProcessor,
            showSubtitle,
            hideSubtitle,
            config
        );
        global.voiceChat = voiceChat;

        // 新增：语音打断功能配置
        if (config.asr?.voice_barge_in && voiceChat.asrProcessor && ttsProcessor) {
            voiceChat.asrProcessor.setTTSProcessor(ttsProcessor);
            console.log('语音打断功能已配置完成');
        }

        // 如果ASR被禁用，跳过ASR相关的初始化
        if (!asrEnabled) {
            console.log('ASR已禁用，跳过语音识别初始化');
            logToTerminal('info', 'ASR已禁用，跳过语音识别初始化');

            // 修改VoiceChatInterface的方法，禁用ASR相关功能
            voiceChat.startRecording = () => {
                console.log('ASR已禁用，无法开始录音');
            };
            voiceChat.stopRecording = () => {
                console.log('ASR已禁用，无法停止录音');
            };
            voiceChat.pauseRecording = () => {};
            voiceChat.resumeRecording = () => {};
        }

        // 创建PIXI应用
        const app = new PIXI.Application({
            view: document.getElementById("canvas"),
            autoStart: true,
            transparent: true,
            width: window.innerWidth * 2,
            height: window.innerHeight * 2
        });

        app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
        app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);

        // 加载Live2D模型
        const model = await PIXI.live2d.Live2DModel.from("2D/肥牛/hiyori_pro_mic.model3.json");
        currentModel = model;
        app.stage.addChild(model);

        // 初始化模型交互控制器
        modelController.init(model, app, config);
        modelController.setupInitialModelProperties(config.ui.model_scale || 2.3);

        // 创建情绪动作映射器
        emotionMapper = new EmotionMotionMapper(model);
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '惠惠';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '惠惠';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '惠惠';
        global.currentCharacterName = '胡桃';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '胡桃';
        global.currentCharacterName = '惠惠';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '1104100';
        global.currentCharacterName = '1104100';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '1104100';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '1104100';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '1033104';
        global.currentCharacterName = '1033104';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '1033104';
        global.currentCharacterName = '1033104';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = 'a_001';
        global.currentCharacterName = 'a_001';
        global.currentCharacterName = 'a_001';
        global.currentCharacterName = 'a_001';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '惠惠';
        global.currentCharacterName = '8qpt01__l2d_322.u';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '8qpt01__l2d_322.u';
        global.currentCharacterName = '惠惠';
        global.currentCharacterName = '橘色女生 - 副本';
        global.currentCharacterName = '惠惠';
        global.currentCharacterName = '胡桃';
        global.currentCharacterName = '橘色女生 - 副本';
        global.currentCharacterName = '1024100';
        global.currentCharacterName = '橘色女生';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '橘色女生';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '胡桃';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '肥牛';
        global.currentCharacterName = '橘色女生';
        global.emotionMapper = emotionMapper;

        // 将情绪映射器传递给TTS处理器
        if (ttsEnabled && ttsProcessor.setEmotionMapper) {
            ttsProcessor.setEmotionMapper(emotionMapper);
        } else if (!ttsEnabled) {
            // TTS禁用时，设置回调以确保ASR正常工作
            ttsProcessor.onEndCallback = () => {
                global.isPlayingTTS = false;
                if (voiceChat && asrEnabled) {
                    voiceChat.resumeRecording();
                    console.log('TTS模拟结束，ASR已解锁');
                }
            };
            ttsProcessor.setEmotionMapper(emotionMapper);
        }

        const musicPlayer = new MusicPlayer(modelController);
        musicPlayer.setEmotionMapper(emotionMapper);
        global.musicPlayer = musicPlayer;

        // 设置模型和情绪映射器
        voiceChat.setModel(model);
        voiceChat.setEmotionMapper = emotionMapper;

        // 初始化时增强系统提示
        enhanceSystemPrompt();

        // 本地工具管理器初始化...
        try {
            localToolManager = new LocalToolManager(config);
            global.localToolManager = localToolManager;

            const stats = localToolManager.getStats();
            console.log('本地工具管理器初始化成功');
            logToTerminal('info', `本地工具管理器初始化成功: ${stats.modules}个模块, ${stats.tools}个工具`);

                    // 修改VoiceChat的sendToLLM方法，支持工具调用
                    // 这里需要根据TTS/ASR开关状态调整
                    voiceChat.sendToLLM = async function(prompt) {
                        try {
                            // 检查是否正在播放TTS，如果是则先中断
                            if (global.isPlayingTTS) {
                                console.log('检测到TTS正在播放，执行打断操作');
                                logToTerminal('info', '检测到TTS正在播放，执行打断操作');
                                
                                // 发送中断信号
                                if (ttsProcessor) {
                                    ttsProcessor.interrupt();
                                }
                                
                                // 隐藏字幕
                                hideSubtitle();
                                
                                // 等待短暂时间确保中断完成
                                await new Promise(resolve => setTimeout(resolve, 100));
                            }
                            
                            global.isProcessingUserInput = true;

                            this.messages.push({ 'role': 'user', 'content': prompt });

                            if (this.enableContextLimit) {
                                this.trimMessages();
                            }

                            let messagesForAPI = JSON.parse(JSON.stringify(this.messages));
                            const needScreenshot = await this.shouldTakeScreenshot(prompt);

                            if (needScreenshot) {
                                try {
                                    console.log("需要截图");
                                    logToTerminal('info', "需要截图");
                                    const base64Image = await voiceChat.takeScreenshotBase64();

                                    const lastUserMsgIndex = messagesForAPI.findIndex(
                                        msg => msg.role === 'user' && msg.content === prompt
                                    );

                                    if (lastUserMsgIndex !== -1) {
                                        messagesForAPI[lastUserMsgIndex] = {
                                            'role': 'user',
                                            'content': [
                                                { 'type': 'text', 'text': prompt },
                                                { 'type': 'image_url', 'image_url': { 'url': `data:image/jpeg;base64,${base64Image}` } }
                                            ]
                                        };
                                    }
                                } catch (error) {
                                    console.error("截图处理失败:", error);
                                    logToTerminal('error', `截图处理失败: ${error.message}`);
                                    throw new Error("截图功能出错，无法处理视觉内容");
                                }
                            }

                            const requestBody = {
                                model: this.MODEL,
                                messages: messagesForAPI,
                                stream: false
                            };

                            // 合并本地Function Call工具和MCP工具
                            let allTools = [];

                            // 添加本地Function Call工具
                            if (global.localToolManager && global.localToolManager.isEnabled) {
                                const localTools = global.localToolManager.getToolsForLLM();
                                if (localTools && localTools.length > 0) {
                                    allTools.push(...localTools);
                                }
                            }

                            // 添加MCP工具
                            if (global.mcpManager && global.mcpManager.isEnabled) {
                                const mcpTools = global.mcpManager.getToolsForLLM();
                                if (mcpTools && mcpTools.length > 0) {
                                    allTools.push(...mcpTools);
                                }
                            }

                            if (allTools.length > 0) {
                                requestBody.tools = allTools;
                                console.log(`🔧 发送工具列表到LLM: ${allTools.length}个工具`);
                            }

                            logToTerminal('info', `开始发送请求到LLM API: ${this.API_URL}/chat/completions`);
                            const response = await fetch(`${this.API_URL}/chat/completions`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${this.API_KEY}`
                                },
                                body: JSON.stringify(requestBody)
                            });

                            if (!response.ok) {
                                let errorDetail = "";
                                try {
                                    const errorBody = await response.text();
                                    try {
                                        const errorJson = JSON.parse(errorBody);
                                        errorDetail = JSON.stringify(errorJson, null, 2);
                                    } catch (e) {
                                        errorDetail = errorBody;
                                    }
                                } catch (e) {
                                    errorDetail = "无法读取错误详情";
                                }

                                logToTerminal('error', `API错误 (${response.status} ${response.statusText}):\n${errorDetail}`);

                                let errorMessage = "";
                                switch (response.status) {
                                    case 401:
                                        errorMessage = "API密钥验证失败，请检查你的API密钥";
                                        break;
                                    case 403:
                                        errorMessage = "API访问被禁止，你的账号可能被限制";
                                        break;
                                    case 404:
                                        errorMessage = "API接口未找到，请检查API地址";
                                        break;
                                    case 429:
                                        errorMessage = "请求过于频繁，超出API限制";
                                        break;
                                    case 500:
                                    case 502:
                                    case 503:
                                    case 504:
                                        errorMessage = "服务器错误，AI服务当前不可用";
                                        break;
                                    default:
                                        errorMessage = `API错误: ${response.status} ${response.statusText}`;
                                }
                                throw new Error(`${errorMessage}\n详细信息: ${errorDetail}`);
                            }

                            const responseData = await response.json();

                            // 检查API错误响应
                            if (responseData.error) {
                                const errorMsg = responseData.error.message || responseData.error || '未知API错误';
                                logToTerminal('error', `LLM API错误: ${errorMsg}`);
                                throw new Error(`API错误: ${errorMsg}`);
                            }

                            // 检查响应格式，适应不同的API响应结构
                            let choices;
                            if (responseData.choices) {
                                choices = responseData.choices;
                            } else if (responseData.data && responseData.data.choices) {
                                choices = responseData.data.choices;
                            } else {
                                logToTerminal('error', `LLM响应格式异常: ${JSON.stringify(responseData)}`);
                                throw new Error('LLM响应格式异常：缺少choices字段或为空');
                            }

                            if (!choices || choices.length === 0) {
                                logToTerminal('error', `LLM响应格式异常: choices为空`);
                                throw new Error('LLM响应格式异常：choices为空');
                            }

                            const result = choices[0].message;
                            logToTerminal('info', `收到LLM API响应`);

                            if (result.tool_calls && result.tool_calls.length > 0) {
                                console.log("检测到工具调用:", result.tool_calls);
                                logToTerminal('info', `检测到工具调用: ${JSON.stringify(result.tool_calls)}`);

                                this.messages.push({
                                    'role': 'assistant',
                                    'content': null,
                                    'tool_calls': result.tool_calls
                                });

                                logToTerminal('info', `开始执行工具调用`);

                                // 尝试不同的工具管理器执行工具调用
                                let toolResult = null;

                                // 首先尝试MCP工具
                                if (global.mcpManager && global.mcpManager.isEnabled) {
                                    try {
                                        toolResult = await global.mcpManager.handleToolCalls(result.tool_calls);
                                    } catch (error) {
                                        console.log(`MCP工具调用失败，尝试本地工具: ${error.message}`);
                                    }
                                }

                                // 如果MCP没有处理成功，尝试本地Function Call工具
                                if (!toolResult && global.localToolManager && global.localToolManager.isEnabled) {
                                    try {
                                        toolResult = await global.localToolManager.handleToolCalls(result.tool_calls);
                                    } catch (error) {
                                        console.error(`本地工具调用也失败: ${error.message}`);
                                        throw error;
                                    }
                                }

                                if (toolResult) {
                                    console.log("工具调用结果:", toolResult);
                                    logToTerminal('info', `工具调用结果: ${JSON.stringify(toolResult)}`);

                                    // 处理多工具调用结果
                                    if (Array.isArray(toolResult)) {
                                        // 多个工具调用结果
                                        toolResult.forEach(singleResult => {
                                            this.messages.push({
                                                'role': 'tool',
                                                'content': singleResult.content,
                                                'tool_call_id': singleResult.tool_call_id
                                            });
                                        });
                                    } else {
                                        // 单个工具调用结果（向后兼容）
                                        this.messages.push({
                                            'role': 'tool',
                                            'content': toolResult,
                                            'tool_call_id': result.tool_calls[0].id
                                        });
                                    }

                                    logToTerminal('info', `发送工具结果到LLM获取最终回复`);
                                    const finalRequestOptions = {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${this.API_KEY}`
                                        },
                                        body: JSON.stringify({
                                            model: this.MODEL,
                                            messages: this.messages,
                                            stream: false
                                        })
                                    };

                                    const finalResponse = await fetch(`${this.API_URL}/chat/completions`, finalRequestOptions);

                                    if (!finalResponse.ok) {
                                        let errorDetail = "";
                                        try {
                                            const errorBody = await finalResponse.text();
                                            try {
                                                const errorJson = JSON.parse(errorBody);
                                                errorDetail = JSON.stringify(errorJson, null, 2);
                                            } catch (e) {
                                                errorDetail = errorBody;
                                            }
                                        } catch (e) {
                                            errorDetail = "无法读取错误详情";
                                        }

                                        logToTerminal('error', `API错误 (${finalResponse.status} ${finalResponse.statusText}):\n${errorDetail}`);

                                        let errorMessage = "";
                                        switch (finalResponse.status) {
                                            case 401:
                                                errorMessage = "API密钥验证失败，请检查你的API密钥";
                                                break;
                                            case 403:
                                                errorMessage = "API访问被禁止，你的账号可能被限制";
                                                break;
                                            case 404:
                                                errorMessage = "API接口未找到，请检查API地址";
                                                break;
                                            case 429:
                                                errorMessage = "请求过于频繁，超出API限制";
                                                break;
                                            case 500:
                                            case 502:
                                            case 503:
                                            case 504:
                                                errorMessage = "服务器错误，AI服务当前不可用";
                                                break;
                                            default:
                                                errorMessage = `API错误: ${finalResponse.status} ${finalResponse.statusText}`;
                                        }
                                        throw new Error(`${errorMessage}\n详细信息: ${errorDetail}`);
                                    }

                                    const finalResponseData = await finalResponse.json();

                                    // 检查API错误响应 - 只检查明确的错误字段
                                    if (finalResponseData.error) {
                                        const errorMsg = finalResponseData.error.message || finalResponseData.error || '未知API错误';
                                        logToTerminal('error', `LLM API错误: ${errorMsg}`);
                                        throw new Error(`API错误: ${errorMsg}`);
                                    }

                                    // 检查响应格式，适应不同的API响应结构
                                    let choices;
                                    if (finalResponseData.choices) {
                                        choices = finalResponseData.choices;
                                    } else if (finalResponseData.data && finalResponseData.data.choices) {
                                        choices = finalResponseData.data.choices;
                                    } else {
                                        logToTerminal('error', `LLM响应格式异常: ${JSON.stringify(finalResponseData)}`);
                                        throw new Error('LLM响应格式异常：缺少choices字段或为空');
                                    }

                                    if (!choices || choices.length === 0) {
                                        logToTerminal('error', `LLM响应格式异常: choices为空`);
                                        throw new Error('LLM响应格式异常：choices为空');
                                    }

                                    const finalResult = choices[0].message;
                                    logToTerminal('info', `获得最终LLM回复，开始语音输出`);

                                    if (finalResult.content) {
                                        this.messages.push({ 'role': 'assistant', 'content': finalResult.content });

                                        // ===== 保存对话历史 =====
                                        this.saveConversationHistory();

                                        logToTerminal('info', `获得最终LLM回复，开始语音输出`);
                                        this.ttsProcessor.reset();
                                        this.ttsProcessor.processTextToSpeech(finalResult.content);
                                    }
                                } else {
                                    console.error("工具调用失败");
                                    logToTerminal('error', "工具调用失败");
                                    throw new Error("工具调用失败，无法完成功能扩展");
                                }
                            } else if (result.content) {
                                this.messages.push({ 'role': 'assistant', 'content': result.content });

                                // ===== 保存对话历史 =====
                                this.saveConversationHistory();

                                logToTerminal('info', `LLM直接返回回复，开始语音输出`);
                                this.ttsProcessor.reset();
                                this.ttsProcessor.processTextToSpeech(result.content);
                            }

                            if (this.enableContextLimit) {
                                this.trimMessages();
                            }
                        } catch (error) {
                            logToTerminal('error', `LLM处理错误: ${error.message}`);
                            if (error.stack) {
                                logToTerminal('error', `错误堆栈: ${error.stack}`);
                            }

                            let errorMessage = "抱歉，出现了一个错误";

                            if (error.message.includes("API密钥验证失败")) {
                                errorMessage = "API密钥错误，请检查配置";
                            } else if (error.message.includes("API访问被禁止")) {
                                errorMessage = "API访问受限，请联系支持";
                            } else if (error.message.includes("API接口未找到")) {
                                errorMessage = "无效的API地址，请检查配置";
                            } else if (error.message.includes("请求过于频繁")) {
                                errorMessage = "请求频率超限，请稍后再试";
                            } else if (error.message.includes("服务器错误")) {
                                errorMessage = "AI服务不可用，请稍后再试";
                            } else if (error.message.includes("截图功能出错")) {
                                errorMessage = "截图失败，无法处理视觉内容";
                            } else if (error.message.includes("工具调用失败")) {
                                errorMessage = "功能扩展调用失败，请重试";
                            } else if (error.name === "TypeError" && error.message.includes("fetch")) {
                                errorMessage = "网络连接失败，请检查网络和API地址";
                            } else if (error.name === "SyntaxError") {
                                errorMessage = "解析API响应出错，请重试";
                            } else {
                                const shortErrorMsg = error.message.substring(0, 100) +
                                    (error.message.length > 100 ? "..." : "");
                                errorMessage = `未知错误: ${shortErrorMsg}`;
                            }

                            logToTerminal('error', `用户显示错误: ${errorMessage}`);

                            this.showSubtitle(errorMessage, 3000);
                            if (this.asrProcessor && asrEnabled) {
                                this.asrProcessor.resumeRecording();
                            }
                            setTimeout(() => this.hideSubtitle(), 3000);
                        } finally {
                            global.isProcessingUserInput = false;
                        }
                    };
        } catch (error) {
            console.error('本地工具管理器初始化失败:', error);
            logToTerminal('error', `本地工具管理器初始化失败: ${error.message}`);
        }

        // 直播模块初始化
        if (config.bilibili && config.bilibili.enabled) {
            liveStreamModule = new LiveStreamModule({
                roomId: config.bilibili.roomId || '30230160',
                checkInterval: config.bilibili.checkInterval || 5000,
                maxMessages: config.bilibili.maxMessages || 50,
                apiUrl: config.bilibili.apiUrl || 'http://api.live.bilibili.com/ajax/msg',
                onNewMessage: (message) => {
                    console.log(`收到弹幕: ${message.nickname}: ${message.text}`);
                    logToTerminal('info', `收到弹幕: ${message.nickname}: ${message.text}`);
                    addToBarrageQueue(message.nickname, message.text);
                }
            });

            liveStreamModule.start();
            console.log('直播模块已启动，监听房间:', liveStreamModule.roomId);
            logToTerminal('info', `直播模块已启动，监听房间: ${liveStreamModule.roomId}`);
        }

        // 播放欢迎语（如果TTS启用）
        if (ttsEnabled) {
            setTimeout(() => {
                ttsProcessor.processTextToSpeech(INTRO_TEXT);
            }, 1000);
        } else {
            // 如果TTS禁用，显示欢迎语3秒后自动消失
            setTimeout(() => {
                showSubtitle(`Fake Neuro: ${INTRO_TEXT}`, 3000);
            }, 1000);
        }

        // 开始录音（如果ASR启用）
        if (asrEnabled) {
            setTimeout(() => {
                voiceChat.startRecording();
            }, 3000);
        }

        // 自动对话模块初始化
        setTimeout(() => {
            autoChatModule = new AutoChatModule(config, ttsProcessor);
            global.autoChatModule = autoChatModule;
            autoChatModule.start();
            console.log('自动对话模块初始化完成');
            logToTerminal('info', '自动对话模块初始化完成');
        }, 8000);

        // 聊天界面设置
        const chatInput = document.getElementById('chat-input');
        const chatSendBtn = document.getElementById('chat-send-btn');
        const textChatContainer = document.getElementById('text-chat-container');

        // 根据配置设置对话框显示状态
        const shouldShowChatBox = config.ui && config.ui.hasOwnProperty('show_chat_box')
            ? config.ui.show_chat_box
            : (!ttsEnabled || !asrEnabled); // 如果TTS或ASR禁用，默认显示聊天框

        textChatContainer.style.display = shouldShowChatBox ? 'block' : 'none';

        // 如果启用了text_only_mode或者TTS/ASR任一被禁用，自动显示聊天框
        if ((config.ui && config.ui.text_only_mode) || !ttsEnabled || !asrEnabled) {
            textChatContainer.style.display = 'block';
            console.log('检测到纯文本模式或TTS/ASR禁用，自动显示聊天框');
            logToTerminal('info', '检测到纯文本模式或TTS/ASR禁用，自动显示聊天框');
        }

        // Alt键切换聊天框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Alt') {
                e.preventDefault();
                const chatContainer = document.getElementById('text-chat-container');
                chatContainer.style.display = chatContainer.style.display === 'none' ? 'block' : 'none';
            }
        });

        // Enter键发送消息
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const message = chatInput.value.trim();
                if (message) {
                    // 显示用户消息
                    const chatMessages = document.getElementById('chat-messages');
                    if (chatMessages) {
                        const messageElement = document.createElement('div');
                        messageElement.innerHTML = `<strong>你:</strong> ${message}`;
                        chatMessages.appendChild(messageElement);
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }

                    // 发送给LLM处理
                    voiceChat.sendToLLM(message);
                    chatInput.value = '';
                }
            }
        });

        // 模型碰撞检测
        model.hitTest = function(x, y) {
            return x >= interactionX &&
                x <= interactionX + interactionWidth &&
                y >= interactionY &&
                y <= interactionY + interactionHeight;
        };

        logToTerminal('info', '应用初始化完成');

        // 根据配置显示初始化状态
        console.log(`=== 模块状态总结 ===`);
        console.log(`TTS: ${ttsEnabled ? '启用' : '禁用'}`);
        console.log(`ASR: ${asrEnabled ? '启用' : '禁用'}`);
        console.log(`语音打断: ${config.asr?.voice_barge_in ? '启用' : '禁用'}`);
        console.log(`聊天框: ${shouldShowChatBox ? '显示' : '隐藏'}`);
        console.log(`直播模块: ${config.bilibili?.enabled ? '启用' : '禁用'}`);
        console.log(`自动对话: ${config.auto_chat?.enabled ? '启用' : '禁用'}`);
        console.log(`Function Call工具: ${config.tools?.enabled ? '启用' : '禁用'}`);
        console.log(`MCP工具: ${config.mcp?.enabled ? '启用' : '禁用'}`);

        // 显示工具统计信息
        if (localToolManager) {
            const localStats = localToolManager.getStats();
            console.log(`Function Call: ${localStats.tools}个工具`);
        }
        if (mcpManager) {
            const mcpStats = mcpManager.getStats();
            console.log(`MCP: ${mcpStats.tools}个工具`);
        }

        console.log(`==================`);

    } catch (error) {
        console.error("加载模型错误:", error);
        console.error("错误详情:", error.message);
        logToTerminal('error', `加载模型错误: ${error.message}`);
        if (error.stack) {
            logToTerminal('error', `错误堆栈: ${error.stack}`);
        }
    }
})();

// 清理资源
window.onbeforeunload = () => {
    if (voiceChat && asrEnabled) {
        voiceChat.stopRecording();
    }

    if (liveStreamModule && liveStreamModule.isRunning) {
        liveStreamModule.stop();
    }

    if (autoChatModule && autoChatModule.isRunning) {
        autoChatModule.stop();
    }

    if (localToolManager) {
        localToolManager.stop();
    }

    if (mcpManager) {
        mcpManager.stop();
    }

    logToTerminal('info', '应用已关闭，资源已清理');
};