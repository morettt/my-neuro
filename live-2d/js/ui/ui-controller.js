// ui-controller.js - UI控制模块
const { ipcRenderer } = require('electron');
const { logToTerminal } = require('../api-utils.js');

class UIController {
    constructor(config) {
        this.config = config;
        this.subtitleTimeout = null;
        this.bubbleVisible = false;  // 气泡框显示状态
        this.bubbleUpdateInterval = null;  // 气泡框位置更新定时器

        // 气泡框位置平滑处理
        this.bubbleCurrentX = 0;
        this.bubbleCurrentY = 0;
        this.bubbleTargetX = 0;
        this.bubbleTargetY = 0;
    }

    // 初始化UI控制
    initialize() {
        this.setupMouseIgnore();
        this.setupChatBoxEvents();
    }

    // 设置鼠标穿透
    setupMouseIgnore() {
        const updateMouseIgnore = () => {
            if (!global.currentModel) return;

            const shouldIgnore = !global.currentModel.containsPoint(
                global.pixiApp.renderer.plugins.interaction.mouse.global
            );
            ipcRenderer.send('set-ignore-mouse-events', {
                ignore: shouldIgnore,
                options: { forward: true }
            });
        };

        document.addEventListener('mousemove', updateMouseIgnore);
    }

    // 设置聊天框事件
    setupChatBoxEvents() {
        const chatInput = document.getElementById('chat-input');
        const textChatContainer = document.getElementById('text-chat-container');
        const submitBtn = document.getElementById('chat-send-btn');

        if (!chatInput || !textChatContainer || !submitBtn) return;

        textChatContainer.addEventListener('mouseenter', () => {
            ipcRenderer.send('set-ignore-mouse-events', {
                ignore: false,
                options: { forward: false }
            });
        });

        textChatContainer.addEventListener('mouseleave', () => {
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

    // 显示字幕
    showSubtitle(text, duration = null) {
        // 检查字幕是否启用
        if (this.config && this.config.subtitle_labels && this.config.subtitle_labels.enabled === false) {
            return;
        }

        const container = document.getElementById('subtitle-container');
        const subtitleText = document.getElementById('subtitle-text');

        if (!container || !subtitleText) return;

        // 清除之前的定时器
        if (this.subtitleTimeout) {
            clearTimeout(this.subtitleTimeout);
            this.subtitleTimeout = null;
        }

        subtitleText.textContent = text;
        container.style.display = 'block';
        container.scrollTop = container.scrollHeight;

        // 如果指定了持续时间，设置自动隐藏
        if (duration) {
            this.subtitleTimeout = setTimeout(() => {
                this.hideSubtitle();
            }, duration);
        }
    }

    // 隐藏字幕
    hideSubtitle() {
        const container = document.getElementById('subtitle-container');
        if (container) {
            container.style.display = 'none';
        }

        if (this.subtitleTimeout) {
            clearTimeout(this.subtitleTimeout);
            this.subtitleTimeout = null;
        }
    }

    // 更新气泡框位置，使其跟随模型
    updateBubblePosition() {
        const bubbleContainer = document.getElementById('bubble-container');
        const toolBubblesContainer = document.getElementById('tool-bubbles-container');

        try {
            // 检查模型和PIXI应用是否存在
            if (!global.currentModel || !global.pixiApp) {
                return;
            }

            // 获取canvas元素的屏幕位置和尺寸
            const canvas = document.getElementById('canvas');
            const canvasRect = canvas.getBoundingClientRect();

            // 使用 toGlobal 方法将模型的本地坐标转换为全局坐标
            const modelLocalPos = { x: 0, y: 0 };
            const modelGlobalPos = global.currentModel.toGlobal(modelLocalPos);

            // PIXI Canvas 的内部尺寸和显示尺寸的缩放比例
            const scaleX = canvasRect.width / canvas.width;
            const scaleY = canvasRect.height / canvas.height;

            // 将 PIXI 内部坐标转换为屏幕坐标
            const screenX = canvasRect.left + modelGlobalPos.x * scaleX;
            const screenY = canvasRect.top + modelGlobalPos.y * scaleY;

            // 检查值是否有效
            if (screenX === undefined || screenY === undefined || isNaN(screenX) || isNaN(screenY)) {
                return;
            }

            // 平滑插值系数
            const smoothFactor = 0.2;

            // 更新用户手动气泡框位置（如果可见）
            if (this.bubbleVisible && bubbleContainer) {
                const offsetX = 400;
                const offsetY = 50;
                const targetX = screenX + offsetX;
                const targetY = screenY + offsetY;

                if (!this._bubbleInitialized) {
                    this.bubbleCurrentX = targetX;
                    this.bubbleCurrentY = targetY;
                    this._bubbleInitialized = true;
                } else {
                    this.bubbleCurrentX += (targetX - this.bubbleCurrentX) * smoothFactor;
                    this.bubbleCurrentY += (targetY - this.bubbleCurrentY) * smoothFactor;
                }

                bubbleContainer.style.left = `${this.bubbleCurrentX}px`;
                bubbleContainer.style.top = `${this.bubbleCurrentY}px`;
            }

            // 更新工具气泡堆叠容器位置 (身体下方)
            if (toolBubblesContainer) {
                const toolOffsetX = 100;   // 向右偏移
                const toolOffsetY = 230;   // 向下大幅偏移,定位到身体/下方
                const toolTargetX = screenX + toolOffsetX;
                const toolTargetY = screenY + toolOffsetY;

                if (!this._toolBubblesInitialized) {
                    this.toolBubblesCurrentX = toolTargetX;
                    this.toolBubblesCurrentY = toolTargetY;
                    this._toolBubblesInitialized = true;
                } else {
                    this.toolBubblesCurrentX += (toolTargetX - this.toolBubblesCurrentX) * smoothFactor;
                    this.toolBubblesCurrentY += (toolTargetY - this.toolBubblesCurrentY) * smoothFactor;
                }

                toolBubblesContainer.style.left = `${this.toolBubblesCurrentX}px`;
                toolBubblesContainer.style.top = `${this.toolBubblesCurrentY}px`;
            }

            // 更新歌词气泡位置 (身体左侧或上方)
            const lyricsBubbleContainer = document.getElementById('lyrics-bubble-container');
            if (this.lyricsBubbleVisible && lyricsBubbleContainer) {
                const lyricsOffsetX = -20;  // 再向右移 (原-150)
                const lyricsOffsetY = -20;  // 再向下移 (原-100)
                const lyricsTargetX = screenX + lyricsOffsetX;
                const lyricsTargetY = screenY + lyricsOffsetY;

                if (!this._lyricsBubbleInitialized) {
                    this.lyricsBubbleCurrentX = lyricsTargetX;
                    this.lyricsBubbleCurrentY = lyricsTargetY;
                    this._lyricsBubbleInitialized = true;
                } else {
                    this.lyricsBubbleCurrentX += (lyricsTargetX - this.lyricsBubbleCurrentX) * smoothFactor;
                    this.lyricsBubbleCurrentY += (lyricsTargetY - this.lyricsBubbleCurrentY) * smoothFactor;
                }

                lyricsBubbleContainer.style.left = `${this.lyricsBubbleCurrentX}px`;
                lyricsBubbleContainer.style.top = `${this.lyricsBubbleCurrentY}px`;
            }

        } catch (error) {
            logToTerminal('error', `更新气泡框位置失败: ${error.message}`);
        }
    }

    // 开始气泡框位置追踪
    startBubbleTracking() {
        if (this.bubbleUpdateInterval) {
            clearInterval(this.bubbleUpdateInterval);
        }

        // 每帧更新气泡框位置 (约60fps)
        this.bubbleUpdateInterval = setInterval(() => {
            this.updateBubblePosition();
        }, 16);
    }

    // 停止气泡框位置追踪
    stopBubbleTracking() {
        if (this.bubbleUpdateInterval) {
            clearInterval(this.bubbleUpdateInterval);
            this.bubbleUpdateInterval = null;
        }
    }

    // 显示气泡框
    showBubble() {
        const bubbleContainer = document.getElementById('bubble-container');
        if (!bubbleContainer) {
            logToTerminal('error', '找不到气泡框容器！');
            return;
        }

        this.bubbleVisible = true;
        this._debugLogged = false;
        this._bubbleInitialized = false;  // 重置初始化标志

        // 先立即更新一次位置
        this.updateBubblePosition();

        // 显示气泡框
        bubbleContainer.style.display = 'block';

        // 启动位置追踪
        this.startBubbleTracking();
    }

    // 隐藏气泡框
    hideBubble() {
        const bubbleContainer = document.getElementById('bubble-container');
        if (bubbleContainer) {
            bubbleContainer.style.display = 'none';
            this.bubbleVisible = false;
            this.stopBubbleTracking();  // 停止追踪位置
        }
    }

    // 切换气泡框显示状态
    toggleBubble() {
        if (this.bubbleVisible) {
            this.hideBubble();
        } else {
            this.showBubble();
        }
    }

    // 显示工具调用气泡（堆叠式显示）
    showToolBubble(toolName, parameters = null) {
        const container = document.getElementById('tool-bubbles-container');
        if (!container) return;

        // 启动位置追踪
        if (!this.bubbleUpdateInterval) {
            this.startBubbleTracking();
        }

        // 设置气泡框文本内容
        let displayText = `🔧 调用工具:\n${toolName}`;

        // 如果有参数，显示参数
        if (parameters && Object.keys(parameters).length > 0) {
            // 只显示前2个参数，避免文本过长
            const paramEntries = Object.entries(parameters).slice(0, 2);
            const paramText = paramEntries
                .map(([key, value]) => {
                    // 截断过长的值
                    const valueStr = String(value);
                    const truncated = valueStr.length > 30 ? valueStr.substring(0, 30) + '...' : valueStr;
                    return `${key}: ${truncated}`;
                })
                .join('\n');
            displayText += `\n${paramText}`;
        }

        // 创建新的气泡元素
        const bubble = document.createElement('div');
        bubble.className = 'tool-bubble';
        bubble.textContent = displayText;

        // 添加到容器
        container.appendChild(bubble);

        // 记录工具名称到日志
        logToTerminal('info', `🔧 工具调用: ${toolName}${parameters ? ' 参数: ' + JSON.stringify(parameters) : ''}`);

        // 5秒后移除这个气泡
        setTimeout(() => {
            bubble.classList.add('removing');
            // 等待动画完成后移除DOM
            setTimeout(() => {
                if (bubble.parentNode === container) {
                    container.removeChild(bubble);
                }
            }, 300); // 动画持续时间
        }, 5000);
    }

    // 设置聊天框样式
    setChatStyle(styleNumber) {
        const textChatContainer = document.getElementById('text-chat-container');
        if (!textChatContainer) return;

        // 样式名称映射
        const styleNames = {
            1: '现代毛玻璃',
            2: '可爱卡通',
            3: '极简科技',
            4: '渐变霓虹',
            5: '柔和圆润',
            6: '萌系气泡'
        };

        // 设置data-style属性
        textChatContainer.setAttribute('data-style', styleNumber);

        // 保存到localStorage
        try {
            localStorage.setItem('chatInputStyle', styleNumber);
        } catch (e) {
            console.error('保存聊天框样式失败:', e);
        }

        // 显示提示
        const styleName = styleNames[styleNumber] || '未知';
        this.showSubtitle(`聊天框样式: ${styleName} (样式${styleNumber})`, 2000);

        console.log(`切换到聊天框样式${styleNumber}: ${styleName}`);
    }

    // 设置聊天框可见性
    setupChatBoxVisibility(ttsEnabled, asrEnabled) {
        const textChatContainer = document.getElementById('text-chat-container');
        if (!textChatContainer) return false;

        // 根据配置设置对话框显示状态
        const shouldShowChatBox = this.config.ui && this.config.ui.hasOwnProperty('show_chat_box')
            ? this.config.ui.show_chat_box
            : (!ttsEnabled || !asrEnabled);

        textChatContainer.style.display = shouldShowChatBox ? 'block' : 'none';

        // 如果启用了text_only_mode或者TTS/ASR任一被禁用，自动显示聊天框
        if ((this.config.ui && this.config.ui.text_only_mode) || !ttsEnabled || !asrEnabled) {
            textChatContainer.style.display = 'block';
            console.log('检测到纯文本模式或TTS/ASR禁用，自动显示聊天框');
        }

        // 从localStorage加载保存的样式
        try {
            const savedStyle = localStorage.getItem('chatInputStyle');
            if (savedStyle && savedStyle >= 1 && savedStyle <= 6) {
                textChatContainer.setAttribute('data-style', savedStyle);
                console.log(`加载保存的聊天框样式: ${savedStyle}`);
            } else {
                // 默认样式1
                textChatContainer.setAttribute('data-style', '1');
            }
        } catch (e) {
            console.error('加载聊天框样式失败:', e);
            textChatContainer.setAttribute('data-style', '1');
        }

        // Alt键切换聊天框显示/隐藏
        // Alt+数字键切换样式
        document.addEventListener('keydown', (e) => {
            // Alt键单独按下：切换聊天框显示/隐藏
            if (e.key === 'Alt' && !e.shiftKey && !e.ctrlKey) {
                e.preventDefault();
                const chatContainer = document.getElementById('text-chat-container');
                if (chatContainer) {
                    chatContainer.style.display = chatContainer.style.display === 'none' ? 'block' : 'none';
                }
            }

            // Alt+1~6：切换聊天框样式
            if (e.altKey && !e.shiftKey && !e.ctrlKey) {
                const num = parseInt(e.key);
                if (num >= 1 && num <= 6) {
                    e.preventDefault();
                    this.setChatStyle(num);
                }
            }
        });

        return shouldShowChatBox;
    }

    // 设置聊天框消息发送
    setupChatInput(voiceChat) {
        const chatInput = document.getElementById('chat-input');
        const chatSendBtn = document.getElementById('chat-send-btn');

        if (!chatInput || !chatSendBtn) return;

        const handleSendMessage = () => {
            const message = chatInput.textContent.trim();
            if (!message) return;

            chatInput.textContent = '';

            // 走 inputRouter.handleTextInput，触发插件 hooks（含 memos 记忆注入）
            if (voiceChat.inputRouter) {
                voiceChat.inputRouter.handleTextInput(message);
            } else {
                voiceChat.sendToLLM(message);
            }
        };

        //新的Enter事件注册，不调用preventDefault，会换行
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSendMessage();
            }
        });

        chatSendBtn.addEventListener('click', handleSendMessage);
    }

    // 显示歌词气泡
    showLyricsBubble(text) {
        const bubbleContainer = document.getElementById('lyrics-bubble-container');
        const bubbleText = document.getElementById('lyrics-bubble-text');

        if (!bubbleContainer || !bubbleText) return;

        bubbleText.textContent = text;
        bubbleContainer.style.display = 'block';

        // 启动位置追踪（复用现有的气泡位置逻辑，或者稍微偏移）
        if (!this.bubbleUpdateInterval) {
            this.startBubbleTracking();
        }

        // 标记歌词气泡可见，以便 updateBubblePosition 更新它的位置
        this.lyricsBubbleVisible = true;
        this.updateBubblePosition();
    }

    // 隐藏歌词气泡
    hideLyricsBubble() {
        const bubbleContainer = document.getElementById('lyrics-bubble-container');
        if (bubbleContainer) {
            bubbleContainer.style.display = 'none';
        }
        this.lyricsBubbleVisible = false;

        // 如果没有其他气泡显示，停止追踪
        if (!this.bubbleVisible && !this.lyricsBubbleVisible) {
            // 注意：这里不能直接停止，因为可能还有工具气泡。
            // 简单起见，只要有任何气泡显示，就保持追踪。
            // 现有的 stopBubbleTracking 逻辑可能需要调整，或者我们暂时保持它运行。
        }
    }
}

module.exports = { UIController };
