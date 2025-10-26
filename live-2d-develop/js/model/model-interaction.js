// js/model/model-interaction.js
const { ipcRenderer } = require('electron');
const jschardet = require('jschardet');
const fs = require('fs');
// 模型交互控制器类
class ModelInteractionController {
constructor() {
this.model = null;
this.app = null;
this.interactionWidth = 0;
this.interactionHeight = 0;
this.interactionX = 0;
this.interactionY = 0;
this.isDragging = false;
this.isDraggingChat = false; // NEW: Chatbox dragging state
this.dragOffset = { x: 0, y: 0 };
this.chatDragOffset = { x: 0, y: 0 }; // NEW: Chatbox drag offset
this.config = null;
this.isOverInteractiveArea = false; // 新增：用于跟踪鼠标是否在交互区域上
}

// 初始化模型和应用
init(model, app, config = null) {
    this.model = model;
    this.app = app;
    this.config = config;
    this.updateInteractionArea();
    this.setupInteractivity();
}

// --- 图片压缩和缩放辅助函数 ---
_compressAndResizeImage(base64DataUrl, maxSize = 1024, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = base64DataUrl;

        img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = Math.round(height * (maxSize / width));
                    width = maxSize;
                } else {
                    width = Math.round(width * (maxSize / height));
                    height = maxSize;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve(compressedDataUrl);
        };

        img.onerror = (err) => {
            reject(err);
        };
    });
}

// 更新交互区域大小和位置
updateInteractionArea() {
    if (!this.model) return;
    
    this.interactionWidth = this.model.width / 3;
    this.interactionHeight = this.model.height * 0.7;
    this.interactionX = this.model.x + (this.model.width - this.interactionWidth) / 2;
    this.interactionY = this.model.y + (this.model.height - this.interactionHeight) / 2;
}

// 设置交互性 (重构后的版本)
setupInteractivity() {
    if (!this.model) return;

    this.model.interactive = true;
    const chatContainer = document.getElementById('text-chat-container');
    const chatInput = document.getElementById('chat-input'); // 获取输入框元素
    const subtitleHandle = document.getElementById('subtitle-drag-handle');
    const subtitleResizeHandle = document.getElementById('subtitle-resize-handle'); // 新增

    // --- 统一的鼠标移动监听器 (用于穿透和拖拽) ---
    document.addEventListener('mousemove', (event) => {
        const pixiPoint = new PIXI.Point();
        this.app.renderer.plugins.interaction.mapPositionToPoint(pixiPoint, event.clientX, event.clientY);

        // --- 拖拽逻辑 ---
        if (this.isDragging) {
            const newX = pixiPoint.x - this.dragOffset.x;
            const newY = pixiPoint.y - this.dragOffset.y;
            this.model.position.set(newX, newY);
            this.updateInteractionArea();
        }
        if (this.isDraggingChat) {
            chatContainer.style.bottom = 'auto';
            chatContainer.style.right = 'auto';
            chatContainer.style.left = `${event.clientX - this.chatDragOffset.x}px`;
            chatContainer.style.top = `${event.clientY - this.chatDragOffset.y}px`;
        }

        // --- 鼠标穿透逻辑 ---
        if (this.isDragging || this.isDraggingChat) {
            if (!this.isOverInteractiveArea) {
                this.isOverInteractiveArea = true;
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
            }
            return;
        }

        const isOver = this.model.containsPoint(pixiPoint);
        if (isOver !== this.isOverInteractiveArea) {
            this.isOverInteractiveArea = isOver;
            ipcRenderer.send('set-ignore-mouse-events', { ignore: !isOver, options: { forward: true } });
        }
    });

    // --- 核心修复：统一的 Mousedown 处理器，处理事件优先级 ---
    document.addEventListener('mousedown', (e) => {
        // 检查是否点击了字幕拖拽或调整大小的手柄
        if (e.target === subtitleHandle || e.target === subtitleResizeHandle) {
            // 事件由 ui-controller.js 处理，这里直接返回，阻止模型拖拽
            return;
        }

        const pixiPoint = new PIXI.Point();
        this.app.renderer.plugins.interaction.mapPositionToPoint(pixiPoint, e.clientX, e.clientY);

        // 检查是否点击了聊天框
        if (this.isPointInChatbox(pixiPoint)) {
            if (e.target !== chatInput) {
                this.isDraggingChat = true;
                this.chatDragOffset.x = e.clientX - chatContainer.getBoundingClientRect().left;
                this.chatDragOffset.y = e.clientY - chatContainer.getBoundingClientRect().top;
                e.preventDefault();
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
            }
            // 点击聊天框区域后，直接返回，阻止模型拖拽
            return;
        }

        // 如果以上都不是，最后检查是否点击了模型
        if (this.model.containsPoint(pixiPoint)) {
            this.isDragging = true;
            this.dragOffset.x = pixiPoint.x - this.model.x;
            this.dragOffset.y = pixiPoint.y - this.model.y;
            ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
        }
    });

    // --- 全局 mouseup 逻辑 ---
    window.addEventListener('mouseup', () => {
        if (this.isDragging) {
            this.isDragging = false;
            this.saveModelPosition();
        }
        if (this.isDraggingChat) {
            this.isDraggingChat = false;
            if (global.chatController && typeof global.chatController.savePosition === 'function') {
                global.chatController.savePosition();
            }
        }
        
        const event = new MouseEvent('mousemove', {
            clientX: this.app.renderer.plugins.interaction.mouse.global.x,
            clientY: this.app.renderer.plugins.interaction.mouse.global.y
        });
        document.dispatchEvent(event);
    });

    document.addEventListener('dragover', (event) => {
        const pixiPoint = new PIXI.Point();
        this.app.renderer.plugins.interaction.mapPositionToPoint(pixiPoint, event.clientX, event.clientY);

        if (this.model.containsPoint(pixiPoint)) {
            // 当在模型上时，阻止默认行为，允许放置
            event.preventDefault();
            // 确保事件穿透是关闭的，以便可以接收 drop 事件
            if (!this.isOverInteractiveArea) {
                this.isOverInteractiveArea = true;
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
            }
        } else {
            // --- 核心修复：当鼠标离开模型时，重新开启事件穿透 ---
            // 这样拖拽事件就可以传递给下方的窗口（如文件夹）
            if (this.isOverInteractiveArea) {
                this.isOverInteractiveArea = false;
                ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } });
            }
        }
    });

    document.addEventListener('drop', (event) => {
        event.preventDefault();
        const pixiPoint = new PIXI.Point();
        this.app.renderer.plugins.interaction.mapPositionToPoint(pixiPoint, event.clientX, event.clientY);

        if (this.model.containsPoint(pixiPoint) && event.dataTransfer.files.length > 0) {
            const files = Array.from(event.dataTransfer.files);
            
            const processingPromises = files.map(file => new Promise((resolve, reject) => {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onload = async () => {
                        try {
                            const compressedDataUrl = await this._compressAndResizeImage(reader.result);
                            resolve({ type: 'image', content: compressedDataUrl, fileName: file.name });
                        } catch (err) {
                            reject(err);
                        }
                    };
                    reader.onerror = reject;
                } else if (file.type.startsWith('text/') || file.type === '' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
                    const reader = new FileReader();
                    reader.readAsArrayBuffer(file);
                    reader.onload = () => {
                        try {
                            const buffer = Buffer.from(reader.result);
                            const detection = jschardet.detect(buffer);
                            let fileContent = '';
                            let encoding = (detection && detection.encoding && detection.confidence > 0.5) ? detection.encoding.toLowerCase() : 'utf-8';

                            try {
                                fileContent = new TextDecoder(encoding, { fatal: true }).decode(buffer);
                            } catch (e) {
                                fileContent = new TextDecoder('gbk').decode(buffer);
                            }
                            resolve({ type: 'text', content: fileContent, fileName: file.name });
                        } catch (err) {
                            reject(err);
                        }
                    };
                    reader.onerror = reject;
                } else {
                    resolve(null); 
                }
            }));

            Promise.all(processingPromises).then(results => {
                const validFiles = results.filter(Boolean); 

                if (validFiles.length === 0) {
                    global.showSubtitle("唔...拖放的文件类型我还看不懂呢。", 2000);
                    return;
                }

                let counts;
                validFiles.forEach(fileData => {
                    if (global.voiceChat && typeof global.voiceChat.stageFileData === 'function') {
                        counts = global.voiceChat.stageFileData(fileData);
                    }
                });

                if (counts) {
                    let messageParts = [];
                    if (counts.imageCount > 0) messageParts.push(`${counts.imageCount} 张图片`);
                    if (counts.docCount > 0) messageParts.push(`${counts.docCount} 个文档`);
                    const message = messageParts.join('，') + "。请输入说明。";
                    global.showSubtitle(message, 3000);
                }
            }).catch(error => {
                console.error("处理拖放文件时出错:", error);
                global.showSubtitle("处理部分文件时出错了。", 2000);
            });
        }
    });

    // --- 核心修复：重写 containsPoint，包含聊天框和字幕UI元素 ---
    this.model.containsPoint = (point) => {
        // 检查模型
        const isOverModel = (
            currentModel &&
            point.x >= this.interactionX &&
            point.x <= this.interactionX + this.interactionWidth &&
            point.y >= this.interactionY &&
            point.y <= this.interactionY + this.interactionHeight
        );

        // 检查聊天框
        const isOverChat = this.isPointInChatbox(point);
        
        // 检查字幕拖拽手柄
        const isOverSubtitleHandle = this.isPointInElement(point, document.getElementById('subtitle-drag-handle'));
        
        // 新增：检查字幕调整大小手柄
        const isOverSubtitleResize = this.isPointInElement(point, document.getElementById('subtitle-resize-handle'));
        
        return isOverModel || isOverChat || isOverSubtitleHandle || isOverSubtitleResize;
    };
    
    // --- 其他交互 (保持不变) ---
    this.model.on('click', () => {
        if (this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global) && !this.isPointInChatbox(this.app.renderer.plugins.interaction.mouse.global) && this.model.internalModel) {
            this.model.motion("Tap");
            this.model.expression();
        }
    });

    window.addEventListener('wheel', (e) => {
        if (this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
            e.preventDefault();

            const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
            const currentScale = this.model.scale.x;
            const newScale = currentScale * scaleChange;

            const minScale = this.model.scale.x * 0.3;
            const maxScale = this.model.scale.x * 3.0;

            if (newScale >= minScale && newScale <= maxScale) {
                this.model.scale.set(newScale);

                const oldWidth = this.model.width / scaleChange;
                const oldHeight = this.model.height / scaleChange;
                const deltaWidth = this.model.width - oldWidth;
                const deltaHeight = this.model.height - oldHeight;

                this.model.x -= deltaWidth / 2;
                this.model.y -= deltaHeight / 2;
                this.updateInteractionArea();
            }
        }
    }, { passive: false });

    window.addEventListener('resize', () => {
        if (this.app && this.app.renderer) {
            this.app.renderer.resize(window.innerWidth * 2, window.innerHeight * 2);
            this.app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
            this.app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);
            this.updateInteractionArea();
        }
    });
}

// 新增：通用的检查点是否在HTML元素内的辅助函数
isPointInElement(point, element) {
    if (!element || !element.offsetParent) return false;

    const pixiView = this.app.renderer.view;
    const canvasRect = pixiView.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const scaleX = pixiView.width / canvasRect.width;
    const scaleY = pixiView.height / canvasRect.height;

    const elementLeftInPixi = (elementRect.left - canvasRect.left) * scaleX;
    const elementRightInPixi = (elementRect.right - canvasRect.left) * scaleX;
    const elementTopInPixi = (elementRect.top - canvasRect.top) * scaleY;
    const elementBottomInPixi = (elementRect.bottom - canvasRect.top) * scaleY;

    return (
        point.x >= elementLeftInPixi && point.x <= elementRightInPixi &&
        point.y >= elementTopInPixi && point.y <= elementBottomInPixi
    );
}


// Helper to check if a point is within the chatbox
isPointInChatbox(point) {
    const chatContainer = document.getElementById('text-chat-container');
    if (!chatContainer || chatContainer.style.opacity === '0') return false;

    const pixiView = this.app.renderer.view;
    const canvasRect = pixiView.getBoundingClientRect();
    const chatRect = chatContainer.getBoundingClientRect();
    
    const scaleX = pixiView.width / canvasRect.width;
    const scaleY = pixiView.height / canvasRect.height;

    const chatLeftInPixi = (chatRect.left - canvasRect.left) * scaleX;
    const chatRightInPixi = (chatRect.right - canvasRect.left) * scaleX;
    const chatTopInPixi = (chatRect.top - canvasRect.top) * scaleY;
    const chatBottomInPixi = (chatRect.bottom - canvasRect.top) * scaleY;

    return (
        point.x >= chatLeftInPixi &&
        point.x <= chatRightInPixi &&
        point.y >= chatTopInPixi &&
        point.y <= chatBottomInPixi
    );
}

// 设置嘴部动画
setMouthOpenY(v) {
    if (!this.model) return;
    try {
        v = Math.max(0, Math.min(v, 3.0));
        const coreModel = this.model.internalModel.coreModel;

        try { coreModel.setParameterValueById('PARAM_MOUTH_OPEN_Y', v); } catch (e) {}
        try { coreModel.setParameterValueById('ParamMouthOpenY', v); } catch (e) {}
        try { coreModel.SetParameterValue('PARAM_MOUTH_OPEN_Y', v); } catch (e) {}
        try { coreModel.SetParameterValue('ParamMouthOpenY', v); } catch (e) {}

    } catch (error) {
        console.error('设置嘴型参数失败:', error);
    }
}

// 初始化模型位置和大小
setupInitialModelProperties(scaleMultiplier = 2.3) {
    if (!this.model || !this.app) return;

    const scaleX = (window.innerWidth * scaleMultiplier) / this.model.width;
    const scaleY = (window.innerHeight * scaleMultiplier) / this.model.height;
    this.model.scale.set(Math.min(scaleX, scaleY));

    if (this.config && this.config.ui && this.config.ui.model_position && this.config.ui.model_position.remember_position) {
        const savedPos = this.config.ui.model_position;
        if (savedPos.x !== null && savedPos.y !== null) {
            this.model.x = savedPos.x * window.innerWidth;
            this.model.y = savedPos.y * window.innerHeight;
            console.log('加载保存的模型位置:', { x: this.model.x, y: this.model.y });
        } else {
            this.model.y = window.innerHeight * 0.8;
            this.model.x = window.innerWidth * 1.35;
        }
    } else {
        this.model.y = window.innerHeight * 0.8;
        this.model.x = window.innerWidth * 1.35;
    }

    this.updateInteractionArea();
}

// 保存模型位置到配置文件
saveModelPosition() {
    if (!this.model || !this.config) return;

    if (!this.config.ui || !this.config.ui.model_position || !this.config.ui.model_position.remember_position) {
        return;
    }

    const relativeX = this.model.x / window.innerWidth;
    const relativeY = this.model.y / window.innerHeight;
    
    // --- 核心修复：添加边界检查，防止保存屏幕外的位置 ---
    // 定义一个合理的范围，例如 -0.5 到 1.5，允许模型部分移出屏幕
    const minRatio = -0.5;
    const maxRatio = 1.5;
    
    if (relativeX > minRatio && relativeX < maxRatio && 
        relativeY > minRatio && relativeY < maxRatio) {
        
        this.config.ui.model_position.x = relativeX;
        this.config.ui.model_position.y = relativeY;
        
        ipcRenderer.send('save-model-position', {
            x: relativeX,
            y: relativeY
        });
        console.log('保存模型位置:', { x: relativeX, y: relativeY });
        } 
    else {
        console.warn(`检测到模型位置超出合理范围，已阻止保存。相对位置:`, { x: relativeX, y: relativeY });
        }
    }
}


module.exports = { ModelInteractionController };
