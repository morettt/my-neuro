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

        // 字幕位置调整
        this.isAdjustingSubtitle = false;
        this.isDraggingSubtitle = false;
        this.subtitleScale = 1.0;
        this._subtitleCenterX = null;
        this._subtitleCenterY = null;
        this._pttCleanup = null;
        this._cancelActivePTT = null;
    }

    // 初始化UI控制
    initialize() {
        this.setupMouseIgnore();
        this.setupChatBoxEvents();
    }

    // 设置鼠标穿透
    setupMouseIgnore() {
        // 这些可交互 UI 容器悬停时必须“不穿透”，否则点击会穿过去。
        // 快捷面板(#quick-settings)原本没被纳入判定，只靠模型命中盒蹭——单屏布局下齿轮落在
        // 命中盒外就点不动了。这里统一把它们纳入：鼠标在这些元素上时保持窗口可交互。
        const INTERACTIVE_UI = '#quick-settings, #text-chat-container, #model-controls';
        const updateMouseIgnore = (e) => {
            if (!global.currentModel) return;
            if (this.isAdjustingSubtitle) return;

            // 鼠标悬在可交互 UI 元素上 → 不穿透
            let overUI = false;
            if (e) {
                const el = document.elementFromPoint(e.clientX, e.clientY);
                if (el && el.closest && el.closest(INTERACTIVE_UI)) overUI = true;
            }

            const overModel = global.currentModel.containsPoint(
                global.pixiApp.renderer.plugins.interaction.mouse.global
            );

            ipcRenderer.send('set-ignore-mouse-events', {
                ignore: !overModel && !overUI,
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

        // 基础定位样式
        textChatContainer.style.setProperty('position', 'fixed', 'important');
        textChatContainer.style.setProperty('z-index', '10000', 'important');
        textChatContainer.style.setProperty('width', '350px', 'important');
        textChatContainer.style.setProperty('height', 'auto', 'important');

        // 初始化时立即根据配置设置可见性，避免先显示再隐藏的闪烁
        const shouldShow = this.config.ui && this.config.ui.hasOwnProperty('show_chat_box')
            ? this.config.ui.show_chat_box
            : true;
        if (shouldShow) {
            textChatContainer.style.setProperty('display', 'block', 'important');
            textChatContainer.style.setProperty('visibility', 'visible', 'important');
            textChatContainer.style.setProperty('opacity', '1', 'important');
        } else {
            textChatContainer.style.setProperty('display', 'none', 'important');
            textChatContainer.style.setProperty('visibility', 'hidden', 'important');
            textChatContainer.style.setProperty('opacity', '0', 'important');
        }

        // 窗口只覆盖“当前显示器”，聊天框/字幕直接锚定到本窗口的右下角即可，
        // 不再需要 get-screen-info-sync 把坐标换算到主屏（那是旧巨型跨屏窗口才需要的）。
        textChatContainer.style.setProperty('left', 'auto', 'important');
        textChatContainer.style.setProperty('right', '20px', 'important');
        textChatContainer.style.setProperty('bottom', '50px', 'important');

        const subtitleContainer = document.getElementById('subtitle-container');
        if (subtitleContainer) {
            subtitleContainer.style.setProperty('position', 'fixed', 'important');
            subtitleContainer.style.setProperty('left', 'auto', 'important');
            subtitleContainer.style.setProperty('right', '20px', 'important');
            subtitleContainer.style.setProperty('bottom', '20px', 'important');
            subtitleContainer.style.setProperty('width', '400px', 'important');
            subtitleContainer.style.setProperty('max-width', '400px', 'important');
            subtitleContainer.style.setProperty('transform', 'none', 'important');
            subtitleContainer.style.setProperty('display', 'block', 'important');
        }

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
        this.applySubtitlePosition();
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
            : true;

        if (shouldShowChatBox) {
            textChatContainer.style.setProperty('display', 'block', 'important');
            textChatContainer.style.setProperty('visibility', 'visible', 'important');
            textChatContainer.style.setProperty('opacity', '1', 'important');
            textChatContainer.style.setProperty('pointer-events', 'auto', 'important');
        } else {
            textChatContainer.style.setProperty('display', 'none', 'important');
            textChatContainer.style.setProperty('visibility', 'hidden', 'important');
            textChatContainer.style.setProperty('opacity', '0', 'important');
            textChatContainer.style.setProperty('pointer-events', 'none', 'important');
        }
        textChatContainer.style.setProperty('z-index', '10000', 'important');

        console.log(`聊天框: ${shouldShowChatBox ? '显示' : '隐藏'}`);

        // 调试：确保对话框在可见范围内
        setTimeout(() => {
            const computedStyle = window.getComputedStyle(textChatContainer);
            console.log('对话框调试信息:', {
                display: computedStyle.display,
                position: computedStyle.position,
                bottom: computedStyle.bottom,
                right: computedStyle.right,
                zIndex: computedStyle.zIndex,
                visibility: computedStyle.visibility,
                opacity: computedStyle.opacity
            });
        }, 1000);


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
                    const isHidden = window.getComputedStyle(chatContainer).display === 'none';
                    chatContainer.style.setProperty('display', isHidden ? 'block' : 'none', 'important');
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

    // 快捷设置面板（齿轮菜单）
    setupQuickPanel(voiceChat, config) {
        const gear = document.getElementById('quick-gear');
        const items = document.getElementById('quick-settings-items');
        const toggleModeBtn = document.getElementById('btn-toggle-mode');
        const toggleChatBtn = document.getElementById('btn-toggle-chat');
        if (!gear || !items) return;

        let panelOpen = false;

        // 初始化按钮激活状态
        const isPTT = voiceChat.asrController?.asrProcessor?.pttModeEnabled || false;
        toggleModeBtn.classList.toggle('active', isPTT);

        const chatContainer = document.getElementById('text-chat-container');
        const chatVisible = chatContainer && window.getComputedStyle(chatContainer).display !== 'none';
        toggleChatBtn.classList.toggle('active', chatVisible);

        gear.addEventListener('click', (e) => {
            e.stopPropagation();
            panelOpen = !panelOpen;
            items.classList.toggle('expanded', panelOpen);
            gear.classList.toggle('open', panelOpen);
        });

        document.addEventListener('click', (e) => {
            if (panelOpen && !e.target.closest('#quick-settings')) {
                panelOpen = false;
                items.classList.remove('expanded');
                gear.classList.remove('open');
            }
        });

        toggleChatBtn.addEventListener('click', () => {
            const chatContainer = document.getElementById('text-chat-container');
            if (!chatContainer) return;
            const visible = window.getComputedStyle(chatContainer).display !== 'none';
            if (visible) {
                chatContainer.style.setProperty('display', 'none', 'important');
                chatContainer.style.setProperty('visibility', 'hidden', 'important');
                chatContainer.style.setProperty('opacity', '0', 'important');
                chatContainer.style.setProperty('pointer-events', 'none', 'important');
            } else {
                chatContainer.style.setProperty('display', 'block', 'important');
                chatContainer.style.setProperty('visibility', 'visible', 'important');
                chatContainer.style.setProperty('opacity', '1', 'important');
                chatContainer.style.setProperty('pointer-events', 'auto', 'important');
            }
            toggleChatBtn.classList.toggle('active', !visible);
        });

        toggleModeBtn.addEventListener('click', () => {
            const proc = voiceChat.asrController?.asrProcessor;
            if (!proc) return;
            const nextPTTMode = !proc.pttModeEnabled;
            if (typeof this._cancelActivePTT === 'function') {
                this._cancelActivePTT('mode-toggle');
            }
            proc.pttModeEnabled = nextPTTMode;
            config.asr = config.asr || {};
            config.asr.ptt_enabled = proc.pttModeEnabled;
            toggleModeBtn.classList.toggle('active', proc.pttModeEnabled);
        });
    }

    // PTT global/local hold-to-talk listener
    setupPTT(voiceChat, config) {
        if (typeof this._pttCleanup === 'function') {
            this._pttCleanup();
        }

        const normalizeKey = (value) => {
            const raw = String(value || '').trim().toLowerCase();
            const aliases = {
                ' ': 'space',
                spacebar: 'space',
                return: 'enter',
                esc: 'escape',
                control: 'ctrl',
                command: 'meta',
                cmd: 'meta',
                win: 'meta',
                windows: 'meta',
                option: 'alt',
                left: 'arrowleft',
                up: 'arrowup',
                right: 'arrowright',
                down: 'arrowdown'
            };
            return aliases[raw] || raw;
        };

        const pttKey = normalizeKey(config.asr?.ptt_key || 'v') || 'v';
        const recordingText = '\u5f55\u97f3\u4e2d...';
        let pttActive = false;
        let pttSource = null;

        const getProcessor = () => voiceChat.asrController?.asrProcessor;
        const isPTTEnabled = () => getProcessor()?.pttModeEnabled || false;
        const matchesPTTKey = (key) => normalizeKey(key) === pttKey;
        const isInputFocused = () => {
            const el = document.activeElement;
            if (!el) return false;
            const tag = el.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
        };
        const shouldSkipForInput = (source) => {
            if (!isInputFocused()) return false;
            return source === 'local' || document.hasFocus();
        };

        const cancelProcessor = (reason) => {
            const proc = getProcessor();
            if (typeof voiceChat.pttCancelRecording === 'function') {
                voiceChat.pttCancelRecording(reason);
                return;
            }
            if (typeof proc?.pttCancelRecording === 'function') {
                proc.pttCancelRecording(reason);
                return;
            }
            if (!proc) return;
            proc.isRecording = false;
            proc.asrLocked = false;
            proc.hasInterruptedThisSession = false;
            if (proc.silenceTimeout) {
                clearTimeout(proc.silenceTimeout);
                proc.silenceTimeout = null;
            }
        };

        const cancelPTT = (reason = 'cancelled') => {
            const wasActive = pttActive;
            pttActive = false;
            pttSource = null;
            if (wasActive) {
                cancelProcessor(reason);
                this.hideSubtitle();
                logToTerminal('info', `[PTT] cancelled: ${reason}`);
            }
            return wasActive;
        };

        const startPTT = (source) => {
            if (!isPTTEnabled()) return false;
            if (pttActive) {
                if (source === 'global') pttSource = 'global';
                return true;
            }
            if (shouldSkipForInput(source)) {
                logToTerminal('info', `[PTT] ${source} keydown ignored because input is focused`);
                return false;
            }

            pttActive = true;
            pttSource = source;
            logToTerminal('info', `[PTT] ${source} keydown, start recording`);
            if (typeof voiceChat.pttStartRecording === 'function') {
                voiceChat.pttStartRecording();
            }
            this.showSubtitle(recordingText, 0);
            return true;
        };

        const stopPTT = (source, reason = 'keyup') => {
            if (!pttActive) return false;
            const activeSource = pttSource;
            pttActive = false;
            pttSource = null;

            if (!isPTTEnabled()) {
                cancelProcessor(reason);
                this.hideSubtitle();
                logToTerminal('info', `[PTT] ${source} ${reason}, mode disabled so recording was cancelled`);
                return true;
            }

            logToTerminal('info', `[PTT] ${source} ${reason}, stop recording from ${activeSource || 'unknown'}`);
            if (typeof voiceChat.pttStopRecording === 'function') {
                voiceChat.pttStopRecording();
            }
            this.hideSubtitle();
            return true;
        };

        const onLocalKeyDown = (e) => {
            if (!matchesPTTKey(e.key) || e.repeat) return;
            startPTT('local');
        };

        const onLocalKeyUp = (e) => {
            if (!matchesPTTKey(e.key)) return;
            stopPTT('local');
        };

        const onGlobalPTT = (_event, payload = {}) => {
            if (!payload || !matchesPTTKey(payload.key)) return;
            if (payload.action === 'down') {
                startPTT('global');
            } else if (payload.action === 'up') {
                stopPTT('global');
            }
        };

        const onWindowBlur = () => {
            setTimeout(() => {
                if (pttActive && pttSource !== 'global') {
                    stopPTT('window-blur', 'blur');
                }
            }, 50);
        };

        const onVisibilityChange = () => {
            if (document.hidden) {
                cancelPTT('visibility-hidden');
            }
        };

        const onBeforeUnload = () => {
            cancelPTT('beforeunload');
        };

        document.addEventListener('keydown', onLocalKeyDown);
        document.addEventListener('keyup', onLocalKeyUp);
        ipcRenderer.on('ptt-global-key', onGlobalPTT);
        window.addEventListener('blur', onWindowBlur);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('beforeunload', onBeforeUnload);

        this._cancelActivePTT = cancelPTT;
        this._pttCleanup = () => {
            document.removeEventListener('keydown', onLocalKeyDown);
            document.removeEventListener('keyup', onLocalKeyUp);
            ipcRenderer.removeListener('ptt-global-key', onGlobalPTT);
            window.removeEventListener('blur', onWindowBlur);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('beforeunload', onBeforeUnload);
            if (this._cancelActivePTT === cancelPTT) {
                this._cancelActivePTT = null;
            }
            this._pttCleanup = null;
        };

        console.log(`PTT listener registered, key: ${pttKey.toUpperCase()} (global + local fallback)`);
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

    // ========== 字幕位置调整 ==========

    // 进入调整模式
    enterSubtitleAdjustMode() {
        if (this.isAdjustingSubtitle) return; // 防止重复进入导致事件重复绑定
        const c = document.getElementById('subtitle-container');
        const t = document.getElementById('subtitle-text');
        if (!c || !t) return;

        this.isAdjustingSubtitle = true;
        this._savedText = t.textContent;
        this._savedDisplay = c.style.display;
        t.textContent = '1.拖动或滚轮缩放调整\n2.复位皮套按钮复位';

        // 加载已有位置或取当前中心点
        const pos = this.config?.ui?.subtitle_position;
        if (pos?.centerX != null) {
            this._subtitleCenterX = pos.centerX;
            this._subtitleCenterY = pos.centerY;
            if (pos.scale != null) this.subtitleScale = pos.scale;
        } else {
            c.style.display = 'block'; c.offsetHeight;
            const r = c.getBoundingClientRect();
            this._subtitleCenterX = r.left + r.width / 2;
            this._subtitleCenterY = r.top + r.height / 2;
        }

        Object.assign(c.style, {
            bottom: 'auto', left: `${this._subtitleCenterX}px`, top: `${this._subtitleCenterY}px`,
            transform: `translate(-50%, -50%) scale(${this.subtitleScale})`, transformOrigin: 'center center'
        });
        c.classList.add('subtitle-adjusting');

        // 创建遮罩
        let overlay = document.getElementById('subtitle-adjust-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'subtitle-adjust-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;background:transparent;cursor:default;';
            document.body.appendChild(overlay);
        }

        // 绑定事件
        this._adjustCleanup = [];

        const onKey = (e) => { if (e.key === 'Escape') this.exitSubtitleAdjustMode(); };
        document.addEventListener('keydown', onKey);
        this._adjustCleanup.push(() => document.removeEventListener('keydown', onKey));

        overlay.addEventListener('mouseenter', () =>
            ipcRenderer.send('set-ignore-mouse-events', { ignore: false, options: { forward: false } }));

        // 拖拽
        const onDragStart = (e) => {
            if (e.target.id === 'subtitle-confirm-btn') return;
            e.preventDefault(); e.stopPropagation();
            this.isDraggingSubtitle = true; c.style.cursor = 'grabbing';
            const sx = e.clientX, sy = e.clientY, scx = this._subtitleCenterX, scy = this._subtitleCenterY;
            const onMove = (ev) => {
                if (!this.isDraggingSubtitle) return;
                ev.preventDefault();
                c.style.left = `${this._subtitleCenterX = scx + ev.clientX - sx}px`;
                c.style.top = `${this._subtitleCenterY = scy + ev.clientY - sy}px`;
            };
            const onUp = () => {
                this.isDraggingSubtitle = false; c.style.cursor = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
        c.addEventListener('mousedown', onDragStart);
        this._adjustCleanup.push(() => c.removeEventListener('mousedown', onDragStart));

        // 滚轮缩放
        const onWheel = (e) => {
            e.preventDefault(); e.stopPropagation();
            this.subtitleScale = Math.max(0.3, Math.min(3.0, this.subtitleScale + (e.deltaY > 0 ? -0.05 : 0.05)));
            c.style.transform = `translate(-50%, -50%) scale(${this.subtitleScale})`;
        };
        c.addEventListener('wheel', onWheel, { passive: false });
        this._adjustCleanup.push(() => c.removeEventListener('wheel', onWheel));

        // 确认按钮
        const confirmBtn = document.getElementById('subtitle-confirm-btn');
        if (confirmBtn) {
            const onConfirm = (e) => { e.stopPropagation(); e.preventDefault(); this.exitSubtitleAdjustMode(); };
            confirmBtn.addEventListener('click', onConfirm);
            this._adjustCleanup.push(() => confirmBtn.removeEventListener('click', onConfirm));
        }

        ipcRenderer.send('set-ignore-mouse-events', { ignore: false, options: { forward: false } });
    }

    // 退出调整模式
    exitSubtitleAdjustMode() {
        const c = document.getElementById('subtitle-container');
        if (!c) return;

        // 保存位置到内存
        if (this.config?.ui) {
            this.config.ui.subtitle_position = {
                centerX: this._subtitleCenterX, centerY: this._subtitleCenterY, scale: this.subtitleScale
            };
        }

        c.classList.remove('subtitle-adjusting');
        c.style.cursor = '';
        const t = document.getElementById('subtitle-text');
        if (t) t.textContent = this._savedText || '';
        if (!this._savedText) c.style.display = this._savedDisplay || 'none';

        // 执行所有清理回调
        this._adjustCleanup?.forEach(fn => fn());
        this._adjustCleanup = null;
        document.getElementById('subtitle-adjust-overlay')?.remove();

        this.isAdjustingSubtitle = this.isDraggingSubtitle = false;
        ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } });
    }

    // 应用保存的字幕位置
    applySubtitlePosition() {
        const c = document.getElementById('subtitle-container');
        if (!c || this.isAdjustingSubtitle) return;
        const pos = this.config?.ui?.subtitle_position;
        if (pos?.centerX != null) {
            Object.assign(c.style, {
                left: `${pos.centerX}px`, top: `${pos.centerY}px`, bottom: 'auto',
                transform: `translate(-50%, -50%) scale(${pos.scale || 1})`, transformOrigin: 'center center'
            });
        }
    }

    // 复位字幕到 CSS 默认位置
    resetSubtitlePosition() {
        const c = document.getElementById('subtitle-container');
        if (!c) return;

        if (this.config?.ui) this.config.ui.subtitle_position = null;
        this._subtitleCenterX = null;
        this._subtitleCenterY = null;
        this.subtitleScale = 1;

        if (this.isAdjustingSubtitle) {
            const tx = window.innerWidth * 0.7, ty = window.innerHeight - 80;
            this._subtitleCenterX = tx; this._subtitleCenterY = ty;
            Object.assign(c.style, {
                left: `${tx}px`, top: `${ty}px`,
                transform: 'translate(-50%, -50%) scale(1)', transformOrigin: 'center center'
            });
        } else {
            Object.assign(c.style, { left: '', top: '', bottom: '', transform: '', transformOrigin: '' });
        }
    }
}

module.exports = { UIController };
