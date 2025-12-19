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

        if (!chatInput || !textChatContainer) return;

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
                const toolOffsetX = 300;   // 向右偏移
                const toolOffsetY = 500;   // 向下大幅偏移,定位到身体/下方
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

    // 设置聊天框消息发送
    setupChatInput(voiceChat) {
        const chatInput = document.getElementById('chat-input');
        if (!chatInput) return;

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
    }

    // 设置聊天框显示状态
    setupChatBoxVisibility(ttsEnabled, asrEnabled) {
        const textChatContainer = document.getElementById('text-chat-container');
        if (!textChatContainer) return;

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

        // Alt键切换聊天框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Alt') {
                e.preventDefault();
                const chatContainer = document.getElementById('text-chat-container');
                if (chatContainer) {
                    chatContainer.style.display = chatContainer.style.display === 'none' ? 'block' : 'none';
                }
            }
        });

        return shouldShowChatBox;
    }
}

module.exports = { UIController };
