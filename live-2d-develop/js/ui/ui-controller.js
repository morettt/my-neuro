// ui-controller.js - UI控制模块
const { ipcRenderer } = require('electron');

class UIController {
    constructor(config) {
        this.config = config;
        this.subtitleTimeout = null;
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
