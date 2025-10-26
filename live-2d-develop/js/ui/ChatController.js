// js/ui/ChatController.js

const { ipcRenderer } = require('electron');
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');

class ChatController {
    constructor(voiceChat) {
        this.voiceChat = voiceChat;

        this.container = document.getElementById('text-chat-container');
        this.input = document.getElementById('chat-input');

        this.isVisible = false;

        this.handleKeyPress = this.handleKeyPress.bind(this);
        this.handleDocumentClick = this.handleDocumentClick.bind(this);
    }

    async init() {
        this.input.addEventListener('keypress', this.handleKeyPress);
        
        ipcRenderer.on('window-blurred', () => {
            if (this.isVisible) {
                this.hide();
            }
        });

        try {
            const result = await ipcRenderer.invoke('get-layout-config');
            if (result.success && result.config && result.config.chatbox_position) {
                const savedPos = result.config.chatbox_position;
                if (savedPos.left !== null && savedPos.top !== null) {
                    this.container.style.left = 'auto';
                    this.container.style.top = 'auto';
                    this.container.style.right = 'auto';
                    this.container.style.bottom = 'auto';
                    this.container.style.left = `${savedPos.left * window.innerWidth}px`;
                    this.container.style.top = `${savedPos.top * window.innerHeight}px`;
                    console.log('已加载保存的聊天框位置:', { left: this.container.style.left, top: this.container.style.top });
                }
            }
        } catch (error) {
            console.error("加载聊天框位置失败:", error);
        }
    }

    toggleVisibility() {
        this.isVisible = !this.isVisible;
        if (this.isVisible) {
            this.show();
        } else {
            this.hide();
        }
    }

    show() {
        this.isVisible = true;
        // 核心修复：移除此处的 setIgnoreMouseEvents 调用。
        // model-interaction.js 中的 containsPoint 方法已经包含了对聊天框区域的判断，
        // 它会自动处理鼠标进入聊天框区域时的穿透取消。
        // ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
        this.container.classList.add('visible');
        this.input.focus();

        setTimeout(() => document.addEventListener('mousedown', this.handleDocumentClick), 0);
    }

    hide() {
        this.isVisible = false;
        this.container.classList.remove('visible');
        document.removeEventListener('mousedown', this.handleDocumentClick);

        // 核心修复：手动触发一次鼠标移动事件，让 model-interaction.js 重新评估
        // 并根据鼠标是否在模型上，来决定是否恢复鼠标穿透。
        if (global.pixiApp) {
            const interaction = global.pixiApp.renderer.plugins.interaction;
            const event = new MouseEvent('mousemove', {
                clientX: interaction.mouse.global.x,
                clientY: interaction.mouse.global.y,
            });
            document.dispatchEvent(event);
        }
    }

    handleDocumentClick(e) {
        if (this.isVisible && !this.container.contains(e.target)) {
            this.hide();
        }
    }

    sendMessage() {
        const text = this.input.value.trim();
        if (text) {
            this.voiceChat.handleTextMessage(text);
            this.input.value = '';
        }
    }
    
    handleKeyPress(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage();
        }
    }

    savePosition() {
        const rect = this.container.getBoundingClientRect();
        const relativeLeft = rect.left / window.innerWidth;
        const relativeTop = rect.top / window.innerHeight;

        ipcRenderer.send('save-chatbox-position', {
            left: relativeLeft,
            top: relativeTop
        });

        console.log('正在保存聊天框位置到 layout.json:', { left: relativeLeft, top: relativeTop });
    }


    destroy() {
        this.input.removeEventListener('keypress', this.handleKeyPress);
        document.removeEventListener('mousedown', this.handleDocumentClick);
        ipcRenderer.removeAllListeners('window-blurred');
    }
}

module.exports = { ChatController };