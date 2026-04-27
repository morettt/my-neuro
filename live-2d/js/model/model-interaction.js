const { ipcRenderer } = require('electron');

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
        this._pixelCache = null;
        this._pixelCacheBounds = null;
        this._originalFPS = 60;
        this._motionPaused = false;
    }

    isInInteractionRect(point) {
        return point.x >= this.interactionX &&
            point.x <= this.interactionX + this.interactionWidth &&
            point.y >= this.interactionY &&
            point.y <= this.interactionY + this.interactionHeight;
    }

    applyDragOptimization() {
        const dragOpt = this.config?.ui?.drag_optimization;
        
        if (!dragOpt) return;

        if (dragOpt.stop_motion_on_drag) {
            const model = global.currentModel || this.model;
            if (model?.internalModel) {
                try {
                    // 保存原始的 update 方法
                    if (!this._originalInternalModelUpdate && model.internalModel.update) {
                        this._originalInternalModelUpdate = model.internalModel.update.bind(model.internalModel);
                    }
                    // 替换 update 方法为空函数，暂停动画更新
                    model.internalModel.update = () => {};
                    this._motionPaused = true;
                    
                    // 同时停止所有动作
                    if (model.internalModel.motionManager) {
                        model.internalModel.motionManager.stopAllMotions();
                    }
                } catch (e) {}
            }
        }

        if (dragOpt.lower_fps_on_drag && this.app?.ticker) {
            this._originalFPS = this.app.ticker.maxFPS || 60;
            this.app.ticker.maxFPS = dragOpt.drag_fps || 15;
        }
    }

    restoreAfterDrag() {
        const dragOpt = this.config?.ui?.drag_optimization;
        if (!dragOpt) return;

        if (dragOpt.stop_motion_on_drag) {
            const model = global.currentModel || this.model;
            if (model?.internalModel && this._originalInternalModelUpdate) {
                try {
                    // 恢复原始的 update 方法
                    model.internalModel.update = this._originalInternalModelUpdate;
                    this._motionPaused = false;
                    
                    // 恢复 Idle 动作
                    model.motion("Idle", 0);
                } catch (e) {}
            }
        }

        if (dragOpt.lower_fps_on_drag && this.app?.ticker) {
            this.app.ticker.maxFPS = this._originalFPS;
        }
    }

    buildPixelCache() {
        if (!this.model || !this.app || !this.app.renderer) return;

        const renderer = this.app.renderer;
        const bounds = this.model.getBounds();

        const rt = PIXI.RenderTexture.create({
            width: Math.ceil(bounds.width),
            height: Math.ceil(bounds.height)
        });

        const transform = new PIXI.Matrix();
        transform.translate(-bounds.x, -bounds.y);

        renderer.render(this.model, rt, false, transform);

        const canvas = renderer.plugins.extract.canvas(rt);
        rt.destroy(true);

        this._pixelCache = canvas.getContext('2d');
        this._pixelCacheBounds = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
        };
    }

    clearPixelCache() {
        this._pixelCache = null;
        this._pixelCacheBounds = null;
    }

    pixelHitTest(globalPoint) {
        if (!this.model || !this.app || !this.app.renderer) return true;

        try {
            const bounds = this.model.getBounds();

            const localX = globalPoint.x - bounds.x;
            const localY = globalPoint.y - bounds.y;

            if (localX < 0 || localX >= bounds.width || localY < 0 || localY >= bounds.height) {
                return false;
            }

            if (!this._pixelCache ||
                !this._pixelCacheBounds ||
                Math.abs(bounds.x - this._pixelCacheBounds.x) > 5 ||
                Math.abs(bounds.y - this._pixelCacheBounds.y) > 5 ||
                Math.abs(bounds.width - this._pixelCacheBounds.width) > 5 ||
                Math.abs(bounds.height - this._pixelCacheBounds.height) > 5) {
                this.buildPixelCache();
            }

            if (!this._pixelCache) return true;

            const px = Math.floor(localX);
            const py = Math.floor(localY);

            const pixel = this._pixelCache.getImageData(px, py, 1, 1).data;
            return pixel[3] > 10;
        } catch (e) {
            return true;
        }
    }

    init(model, app, config = null) {
        this.model = model;
        this.app = app;
        this.config = config;
        this.updateInteractionArea();
        this.setupInteractivity();
    }

    updateInteractionArea() {
        if (!this.model) return;

        const bounds = this.model.getBounds();
        this.interactionWidth = bounds.width;
        this.interactionHeight = bounds.height;
        this.interactionX = bounds.x;
        this.interactionY = bounds.y;
    }

    setupInteractivity() {
        if (!this.model) return;

        this.model.interactive = true;

        this.model.containsPoint = (point) => {
            const bounds = this.model.getBounds();
            const shrinkFactor = 0.85;
            const rectX = bounds.x + bounds.width * (1 - shrinkFactor) / 2;
            const rectY = bounds.y + bounds.height * (1 - shrinkFactor) / 2;
            const rectWidth = bounds.width * shrinkFactor;
            const rectHeight = bounds.height * shrinkFactor;

            const isOverModel = global.currentModel &&
                point.x >= rectX &&
                point.x <= rectX + rectWidth &&
                point.y >= rectY &&
                point.y <= rectY + rectHeight;

            const chatContainer = document.getElementById('text-chat-container');
            if (!chatContainer) return isOverModel;

            const pixiView = this.app.renderer.view;
            const canvasRect = pixiView.getBoundingClientRect();
            const chatRect = chatContainer.getBoundingClientRect();

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

        this.model.on('mousedown', (e) => {
            const point = e.data.global;
            this.buildPixelCache();
            if (this.pixelHitTest(point)) {
                this.isDragging = true;
                this.dragOffset.x = point.x - this.model.x;
                this.dragOffset.y = point.y - this.model.y;
                this.applyDragOptimization();
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
            }
        });

        this.model.on('mousemove', (e) => {
            if (this.isDragging) {
                let newX = e.data.global.x - this.dragOffset.x;
                let newY = e.data.global.y - this.dragOffset.y;

                // 限制模型移动范围
                if (this.config && this.config.ui && this.config.ui.screen_extend) {
                    const extend = this.config.ui.screen_extend;
                    if (extend.extend && extend.left) {
                        // 限制在主屏幕范围内 (假设主屏幕在右侧，左侧是扩展屏)
                        // 这里需要根据实际屏幕布局调整，假设主屏幕宽度为 screen.getPrimaryDisplay().size.width
                        // 简单处理：限制 x 不能小于 0
                        if (newX < 0) newX = 0;
                    }
                }

                this.model.position.set(newX, newY);
                this.updateInteractionArea();
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.clearPixelCache();
                this.restoreAfterDrag();
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

        chatContainer.addEventListener('mousedown', (e) => {
            if (e.target === chatContainer || e.target.id === 'chat-messages') {
                this.isDraggingChat = true;
                this.chatDragOffset.x = e.clientX - chatContainer.getBoundingClientRect().left;
                this.chatDragOffset.y = e.clientY - chatContainer.getBoundingClientRect().top;
                e.preventDefault();
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isDraggingChat) {
                chatContainer.style.left = `${e.clientX - this.chatDragOffset.x}px`;
                chatContainer.style.top = `${e.clientY - this.chatDragOffset.y}px`;
            }
        });

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

        this.model.on('mouseover', () => {
            if (this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
            }
        });

        this.model.on('mouseout', () => {
            if (!this.isDragging) {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: true,
                    options: { forward: true }
                });
            }
        });

        this.model.on('click', () => {
            const point = this.app.renderer.plugins.interaction.mouse.global;
            if (this.pixelHitTest(point) && this.model.internalModel) {
                this.model.motion("Tap");
                this.model.expression();
            }
        });

        window.addEventListener('wheel', (e) => {
            const point = this.app.renderer.plugins.interaction.mouse.global;
            this.buildPixelCache();
            if (this.pixelHitTest(point)) {
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
                    
                    setTimeout(() => this.clearPixelCache(), 200);
                }
            }
        }, { passive: false });

        window.addEventListener('resize', () => {
            if (this.app && this.app.renderer) {
                const actualWidth = window.actualWidth || window.innerWidth;
                const actualHeight = window.actualHeight || window.innerHeight;
                const scaleFactor = window.canvasScaleFactor || 2;
                this.app.renderer.resize(actualWidth * scaleFactor, actualHeight * scaleFactor);
                //多屏幕坐标系统，不设置pivot/position,舞台从0,0开始
                this.updateInteractionArea();
            }
        });

        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });

        this.model.on('rightdown', (e) => {
            e.stopPropagation();
        });
    }

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

    setupInitialModelProperties(scaleMultiplier = 2.3) {
        if (!this.model || !this.app) return;

// 使用实际窗口尺寸（如果可用）
        const actualWidth = window.actualWidth || window.innerWidth;
        const actualHeight = window.actualHeight || window.innerHeight;
        const scaleFactor = window.canvasScaleFactor || 2;
        this.model.scale.set(scaleMultiplier);

        if (this.config && this.config.ui && this.config.ui.model_position && this.config.ui.model_position.remember_position) {
            const savedPos = this.config.ui.model_position;
// 验证保存模型位置是否合法
            // 允许负值和大于1的值以支持多屏幕
            // 合理范围：x：-0.5--2.5，y：-0.5--2.0
            const isVlidPosition = savedPos.x !== null && savedPos.y !== null &&
                                savedPos.x >= -0.5 && savedPos.x <= 2.5 &&
                                savedPos.y >= -0.5 && savedPos.y <= 2.0;
            if (isVlidPosition) {
                this.model.x = savedPos.x * actualWidth * scaleFactor;
                this.model.y = savedPos.y * actualHeight * scaleFactor;
                console.log('加载保存的位置:', { 
                    relativePos: savedPos,
                    canvasX: this.model.x,
                    canvasY: this.model.y,
                    scaleFactor
                });
            } else {
                // 位置无效，使用默认位置并重置配置
                console.warn('保存的位置无效，使用默认位置',savedPos);
                this.model.y = actualHeight * 0.5 * scaleFactor;
                this.model.x = actualWidth * 0.5 * scaleFactor;
                // 重置配置中的位置
                this.config.ui.model_position.x = 0.5;
                this.config.ui.model_position.y = 0.5;
                this.saveModelPosition();
            }
        } else {
            // 使用默认位置(canvas坐标系)
            this.model.y = actualHeight * 0.5 * scaleFactor;
            this.model.x = actualWidth * 0.5 * scaleFactor;
        }

        this.updateInteractionArea();
    }

    saveModelPosition() {
        if (!this.model || !this.config) return;

        if (!this.config.ui || !this.config.ui.model_position || !this.config.ui.model_position.remember_position) {
            return;
        }

// 使用实际窗口尺寸计算相对位置
        const actualWidth = window.actualWidth || window.innerWidth;
        const actualHeight = window.actualHeight || window.innerHeight;
        const scaleFactor = window.canvasScaleFactor || 2;

        // 将canvas坐标转换为相对于窗口的坐标，再计算相对位置
        const windowX = this.model.x / scaleFactor;
        const windowY = this.model.y / scaleFactor;

        // 计算相对位置（0-1之间的比例）
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