const { ipcRenderer } = require('electron');

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
        this.isDraggingChat = false;
        this.dragOffset = { x: 0, y: 0 };
        this.chatDragOffset = { x: 0, y: 0 };
        this.config = null;
    }

    // 初始化模型和应用
    init(model, app, config = null) {
        this.model = model;
        this.app = app;
        this.config = config;
        this.updateInteractionArea();
        this.setupInteractivity();
    }

    // 更新交互区域大小和位置
    updateInteractionArea() {
        if (!this.model) return;
        
        this.interactionWidth = this.model.width / 3;
        this.interactionHeight = this.model.height * 0.7;
        this.interactionX = this.model.x + (this.model.width - this.interactionWidth) / 2;
        this.interactionY = this.model.y + (this.model.height - this.interactionHeight) / 2;
    }

    getVisibleBounds() {
        const actualWidth = window.actualWindowWidth || window.innerWidth;
        const actualHeight = window.actualWindowHeight || window.innerHeight;
        const scaleFactor = window.canvasScaleFactor || 2;

        if (!this.model) {
            return {
                minX: 0,
                maxX: actualWidth * scaleFactor,
                minY: 0,
                maxY: actualHeight * scaleFactor
            };
        }

        return {
            minX: -this.model.width * 0.2,
            maxX: Math.max(-this.model.width * 0.2, actualWidth * scaleFactor - this.model.width * 0.35),
            minY: -this.model.height * 0.05,
            maxY: Math.max(-this.model.height * 0.05, actualHeight * scaleFactor - this.model.height * 0.2)
        };
    }

    clampPosition(x, y) {
        const bounds = this.getVisibleBounds();
        return {
            x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
            y: Math.min(bounds.maxY, Math.max(bounds.minY, y))
        };
    }

    getDefaultVisiblePosition() {
        const actualWidth = window.actualWindowWidth || window.innerWidth;
        const actualHeight = window.actualWindowHeight || window.innerHeight;
        const scaleFactor = window.canvasScaleFactor || 2;

        if (!this.model) {
            return {
                x: actualWidth * 0.6 * scaleFactor,
                y: actualHeight * 0.25 * scaleFactor
            };
        }

        const preferredX = actualWidth * scaleFactor - this.model.width * 0.7;
        const preferredY = actualHeight * scaleFactor - this.model.height * 0.92;
        return this.clampPosition(preferredX, preferredY);
    }

    resetToDefaultPosition() {
        if (!this.model) return false;

        const defaultPosition = this.getDefaultVisiblePosition();
        this.model.x = defaultPosition.x;
        this.model.y = defaultPosition.y;
        this.updateInteractionArea();
        this.saveModelPosition();
        return true;
    }

    // 设置交互性
    setupInteractivity() {
        if (!this.model) return;
        
        this.model.interactive = true;

        // 覆盖原始的containsPoint方法，自定义交互区域
        const originalContainsPoint = this.model.containsPoint;
        this.model.containsPoint = (point) => {
            
            const isOverModel = (
                currentModel && // 确保模型已加载
                point.x >= this.interactionX &&
                point.x <= this.interactionX + this.interactionWidth &&
                point.y >= this.interactionY &&
                point.y <= this.interactionY + this.interactionHeight
            );

            // // 检查是否在聊天框内
            const chatContainer = document.getElementById('text-chat-container');
            if (!chatContainer) return isOverModel; // 如果聊天框不存在，仅检查模型

            // 获取PIXI应用的view(DOM canvas元素)
            const pixiView = this.app.renderer.view;
    
            // 计算canvas在页面中的位置
            const canvasRect = pixiView.getBoundingClientRect();
    
            // 获取聊天框的DOM位置
            const chatRect = chatContainer.getBoundingClientRect();
    
            // 将DOM坐标转换为PIXI坐标
            const chatLeftInPixi = (chatRect.left - canvasRect.left) * (pixiView.width / canvasRect.width);
            const chatRightInPixi = (chatRect.right - canvasRect.left) * (pixiView.width / canvasRect.width);
            const chatTopInPixi = (chatRect.top - canvasRect.top) * (pixiView.height / canvasRect.height);
            const chatBottomInPixi = (chatRect.bottom - canvasRect.top) * (pixiView.height / canvasRect.height);

            const isOverChat = (
                point.x >= chatLeftInPixi &&
                point.x <= chatRightInPixi &&
                point.y >= chatTopInPixi &&
                point.y <= chatBottomInPixi
            );

            
            return isOverModel || isOverChat;
        };
        

        // 鼠标按下事件
        this.model.on('mousedown', (e) => {
            const point = e.data.global;
            if (this.model.containsPoint(point)) {
                this.isDragging = true;
                this.dragOffset.x = point.x - this.model.x;
                this.dragOffset.y = point.y - this.model.y;
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
            }
            
        });

        // 鼠标移动事件
        this.model.on('mousemove', (e) => {
            if (this.isDragging) {
                let newX = e.data.global.x - this.dragOffset.x;
                let newY = e.data.global.y - this.dragOffset.y;

                if (this.config && this.config.ui && this.config.ui.screen_extend) {
                    const extend = this.config.ui.screen_extend;
                    if (extend.extend && extend.left) {
                        if (newX < 0) newX = 0;
                    }
                }

                this.model.position.set(newX, newY);
                this.updateInteractionArea();
            }
        });

        // 全局鼠标释放事件
        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                // 保存模型位置
                this.saveModelPosition();
                setTimeout(() => {
                    if (!this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
                        ipcRenderer.send('set-ignore-mouse-events', {
                            ignore: true,
                            options: { forward: true }
                        });
                    }
                }, 100);
            }
        });

        const chatContainer = document.getElementById('text-chat-container');

        // 鼠标按下时开始拖动
        chatContainer.addEventListener('mousedown', (e) => {
            // 仅当点击聊天框背景或消息区域时触发拖动（避免误触输入框和按钮）
            if (e.target === chatContainer || e.target.id === 'chat-messages') {
                this.isDraggingChat = true;
                this.chatDragOffset.x = e.clientX - chatContainer.getBoundingClientRect().left;
                this.chatDragOffset.y = e.clientY - chatContainer.getBoundingClientRect().top;
                e.preventDefault(); // 防止文本选中
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
                
            }
        });

        // 鼠标移动时更新位置
        document.addEventListener('mousemove', (e) => {
            if (this.isDraggingChat) {
                chatContainer.style.left = `${e.clientX - this.chatDragOffset.x}px`;
                chatContainer.style.top = `${e.clientY - this.chatDragOffset.y}px`;
            }
        });

        // 鼠标释放时停止拖动
        document.addEventListener('mouseup', () => {
            if (this.isDraggingChat) {
                this.isDraggingChat = false;
                setTimeout(() => {
                    if (!this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
                        ipcRenderer.send('set-ignore-mouse-events', {
                            ignore: true,
                            options: { forward: true }
                        });
                    }
                }, 100);
            }
        });

        // 鼠标悬停事件
        this.model.on('mouseover', () => {
            if (this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
            }
        });

        // 鼠标离开事件
        this.model.on('mouseout', () => {
            if (!this.isDragging) {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: true,
                    options: { forward: true }
                });
            }
        });

        // 鼠标点击事件
        this.model.on('click', () => {
            if (this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global) && this.model.internalModel) {
                this.model.motion("Tap");
                this.model.expression();
            }
        });

        // 鼠标滚轮事件（缩放功能）
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
                    this.saveModelPosition();
                }
            }
        }, { passive: false });

        // 窗口大小改变事件
        window.addEventListener('resize', () => {
            if (this.app && this.app.renderer) {
                const actualWidth = window.actualWindowWidth || window.innerWidth;
                const actualHeight = window.actualWindowHeight || window.innerHeight;
                const scaleFactor = window.canvasScaleFactor || 2;
                this.app.renderer.resize(actualWidth * scaleFactor, actualHeight * scaleFactor);
                //多屏幕坐标系统，不设置pivot/position,舞台从0,0开始
                this.updateInteractionArea();
            }
        });

        // 禁用右键菜单，防止右键点击导致意外行为
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });

        // 在模型上也禁用右键菜单
        this.model.on('rightdown', (e) => {
            e.stopPropagation();
        });
    }


   // 设置嘴部动画
    setMouthOpenY(v) {
        if (!this.model) return;

        try {
            v = Math.max(0, Math.min(v, 3.0));
            const coreModel = this.model.internalModel.coreModel;

            try {
                coreModel.setParameterValueById('PARAM_MOUTH_OPEN_Y', v);
            } catch (e) {}

            try {
                coreModel.setParameterValueById('ParamMouthOpenY', v);
            } catch (e) {}

            try {
                coreModel.SetParameterValue('PARAM_MOUTH_OPEN_Y', v);
            } catch (e) {}

            try {
                coreModel.SetParameterValue('ParamMouthOpenY', v);
            } catch (e) {}

        } catch (error) {
            console.error('设置嘴型参数失败:', error);
        }
    }

    // 初始化模型位置和大小
    setupInitialModelProperties(scaleMultiplier = 2.3) {
        if (!this.model || !this.app) return;

        const actualWidth = window.actualWindowWidth || window.innerWidth;
        const actualHeight = window.actualWindowHeight || window.innerHeight;
        const scaleFactor = window.canvasScaleFactor || 2;

        this.model.scale.set(scaleMultiplier);

        // 检查是否有保存的位置
        if (this.config && this.config.ui && this.config.ui.model_position && this.config.ui.model_position.remember_position) {
            const savedPos = this.config.ui.model_position;
            // 允许负值和大于1的值以支持多屏幕，合理范围：x：-0.5~2.5，y：-0.5~2.0
            const isValidPosition = savedPos.x !== null && savedPos.y !== null &&
                                savedPos.x >= -0.5 && savedPos.x <= 2.5 &&
                                savedPos.y >= -0.5 && savedPos.y <= 2.0;
            if (isValidPosition) {
                this.model.x = savedPos.x * actualWidth * scaleFactor;
                this.model.y = savedPos.y * actualHeight * scaleFactor;
                console.log('加载保存的位置:', { 
                    relativePos: savedPos,
                    canvasX: this.model.x,
                    canvasY: this.model.y,
                    scaleFactor
                });
            } else {
                console.warn('保存的位置无效，使用默认位置', savedPos);
                const defaultPosition = this.getDefaultVisiblePosition();
                this.model.x = defaultPosition.x;
                this.model.y = defaultPosition.y;
                this.config.ui.model_position.x = 0.5;
                this.config.ui.model_position.y = 0.5;
                this.saveModelPosition();
            }
        } else {
            const defaultPosition = this.getDefaultVisiblePosition();
            this.model.x = defaultPosition.x;
            this.model.y = defaultPosition.y;
        }

        this.updateInteractionArea();
    }

    // 保存模型位置到配置文件
    saveModelPosition() {
        if (!this.model || !this.config) return;

        if (!this.config.ui || !this.config.ui.model_position || !this.config.ui.model_position.remember_position) {
            return;
        }

        const actualWidth = window.actualWindowWidth || window.innerWidth;
        const actualHeight = window.actualWindowHeight || window.innerHeight;
        const scaleFactor = window.canvasScaleFactor || 2;

        // 将canvas坐标转换为相对于窗口的坐标，再计算相对位置
        const windowX = this.model.x / scaleFactor;
        const windowY = this.model.y / scaleFactor;

        const relativeX = windowX / actualWidth;
        const relativeY = windowY / actualHeight;

        this.config.ui.model_position.x = relativeX;
        this.config.ui.model_position.y = relativeY;

        ipcRenderer.send('save-model-position', {
            x: relativeX,
            y: relativeY,
            scale: this.model.scale.x
        });

        console.log('保存模型位置:', { 
            canvasPos: { x: this.model.x, y: this.model.y },
            windowPos: { x: windowX, y: windowY },
            relativePos: { x: relativeX, y: relativeY },
            scaleFactor
        });
    }
}

module.exports = { ModelInteractionController };
