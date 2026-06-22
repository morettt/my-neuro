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

            // const chatRect = chatContainer.getBoundingClientRect();
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
                // 拖动期间模型自由跟随光标，允许超出当前窗口边缘（会被窗口裁切）；
                // 跨屏判定推迟到松手时的 checkAndSwitchDisplay，不在拖动中限制范围。
                const newX = e.data.global.x - this.dragOffset.x;
                const newY = e.data.global.y - this.dragOffset.y;
                this.model.position.set(newX, newY);
                this.updateInteractionArea();
            }
        });

        // 全局鼠标释放事件
        window.addEventListener('mouseup', async (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                // 松手时若“光标拖到了窗口边缘 + 模型越过该边”，则整窗重定位到那一侧的显示器。
                const switched = await this.checkAndSwitchDisplay(e.clientX, e.clientY);
                if (!switched) {
                    // 未切屏：若模型中心越出当前窗口（目标屏不存在），吸回窗口内，避免模型“走丢”。
                    this._clampModelToWindow();
                    this.saveModelPosition();
                }
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
                // 注意: 拖动聊天框时不需要修改模型位置
            }
        });

        // 鼠标释放时停止拖动
        document.addEventListener('mouseup', () => {
            // this.isDraggingChat = false;
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


// 拖动结束时，再次检查穿透状态
// window.addEventListener('mouseup', () => {
//     if (this.isDraggingChat) {
//         this.isDraggingChat = false;
//         this.updateMouseIgnore(); // 确保拖动结束后状态正确
//     }
// });

// 鼠标离开事件
// document.addEventListener('mouseout', () => {
//     if (!this.isDraggingChat) {
//         ipcRenderer.send('set-ignore-mouse-events', {
//             ignore: true,
//             options: { forward: true }
//         });
//     }
// });

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

        // 窗口大小改变事件（跨屏重定位到不同尺寸的显示器时也会触发）
        window.addEventListener('resize', () => {
            if (this.app && this.app.renderer) {
                const actualWidth = window.actualWidth || window.innerWidth;
                const actualHeight = window.actualHeight || window.innerHeight;
                const scaleFactor = window.canvasScaleFactor || 2;
                this.app.renderer.resize(actualWidth * scaleFactor, actualHeight * scaleFactor);
                // 同步 canvas 的 CSS 尺寸到当前窗口（2x 缓冲区需配对正确的 CSS 尺寸，否则跨屏后会被拉伸）
                if (this.app.view && this.app.view.style) {
                    this.app.view.style.width = actualWidth + 'px';
                    this.app.view.style.height = actualHeight + 'px';
                }
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

    // ===== 跨屏：松手时若“光标拖到窗口边缘 + 模型越过该边”，整窗重定位到那一侧的显示器 =====
    // 触发用“光标贴边(EDGE 内) 且 模型可见区也越过该边”双重确认：光标到边缘=明确要往那侧推出去，
    // 松手在屏幕中间不会误触；光标永远能拖到边缘，故四向、任意抓取点都对称。
    // 坐标约定：canvas 坐标 = 窗口 CSS 坐标 × canvasScaleFactor(=2)，getBounds 返回 canvas 坐标。
    // cursorX/cursorY：松手时光标在当前窗口的 CSS 像素坐标。
    async checkAndSwitchDisplay(cursorX, cursorY) {
        // 仅在 Electron 桥接可用时执行
        if (!window.electronScreen || !window.electronScreen.moveWindowToDisplay) return false;
        if (!this.model) return false;
        if (!Number.isFinite(cursorX) || !Number.isFinite(cursorY)) return false;

        try {
            const displays = await window.electronScreen.getAllDisplays();
            if (!displays || displays.length <= 1) return false;
            const currentDisplay = await window.electronScreen.getCurrentDisplay();
            if (!currentDisplay) return false;

            const sf = window.canvasScaleFactor || 2;
            const W = window.innerWidth, H = window.innerHeight;
            // 模型可见区域在当前窗口 client 像素下的边界（getBounds 是 canvas 坐标，÷sf 回到 client）
            const b = this.model.getBounds();
            const vLeft = b.left / sf, vRight = b.right / sf, vTop = b.top / sf, vBottom = b.bottom / sf;

            // 光标贴到哪条边(EDGE 内) 且 模型也越过该边，就在那侧“边外一点”探测目标显示器；另一轴用光标位置。
            const EDGE = 10;
            const sX = currentDisplay.screenX, sY = currentDisplay.screenY;
            const probes = [];
            if (cursorX <= EDGE && vLeft < 0)       probes.push({ x: sX - 1,      y: sY + cursorY });
            if (cursorX >= W - EDGE && vRight > W)   probes.push({ x: sX + W + 1,  y: sY + cursorY });
            if (cursorY <= EDGE && vTop < 0)        probes.push({ x: sX + cursorX, y: sY - 1 });
            if (cursorY >= H - EDGE && vBottom > H)  probes.push({ x: sX + cursorX, y: sY + H + 1 });

            let targetDisplay = null, probe = null;
            for (const p of probes) {
                for (const d of displays) {
                    if (d.id === currentDisplay.id) continue;
                    if (p.x >= d.screenX && p.x < d.screenX + d.width &&
                        p.y >= d.screenY && p.y < d.screenY + d.height) {
                        targetDisplay = d; probe = p; break;
                    }
                }
                if (targetDisplay) break;
            }
            if (!targetDisplay) return false;

            console.log('[Live2D] 光标拖到屏幕边缘，准备切换到屏幕:', targetDisplay.id);

            const result = await window.electronScreen.moveWindowToDisplay(probe.x, probe.y);
            if (result && result.success && !result.sameDisplay) {
                if (result.scaleRatio && result.scaleRatio !== 1) {
                    console.log('[Live2D] 屏幕缩放比变化:', result.scaleRatio);
                }

                // 以探测点为视觉中心，夹住可见模型完整落入目标屏（目标屏 DIP 尺寸），换算到 canvas 后用 delta 落位。
                const tw = targetDisplay.width, th = targetDisplay.height;
                const halfVisW = (vRight - vLeft) / 2;
                const halfVisH = (vBottom - vTop) / 2;
                const margin = 16;
                let cx = probe.x - targetDisplay.screenX;
                let cy = probe.y - targetDisplay.screenY;
                const loX = margin + halfVisW, hiX = tw - margin - halfVisW;
                const loY = margin + halfVisH, hiY = th - margin - halfVisH;
                cx = hiX >= loX ? Math.min(Math.max(cx, loX), hiX) : tw / 2;
                cy = hiY >= loY ? Math.min(Math.max(cy, loY), hiY) : th / 2;

                const targetCenterX = cx * sf, targetCenterY = cy * sf; // canvas 坐标
                const b2 = this.model.getBounds();
                const curCenterX = (b2.left + b2.right) / 2;
                const curCenterY = (b2.top + b2.bottom) / 2;
                this.model.x += targetCenterX - curCenterX;
                this.model.y += targetCenterY - curCenterY;
                this.updateInteractionArea();

                // 保存：用“目标显示器的 DIP 尺寸”算相对位置，避免依赖跨屏后仍在重申/尚未稳定的 innerWidth。
                this.saveModelPosition(tw, th);
                console.log('[Live2D] 跨屏切换完成，模型新位置:', this.model.x, this.model.y);
                return true;
            }
            return false;
        } catch (error) {
            console.error('[Live2D] 跨屏检测/切换出错:', error);
            return false;
        }
    }

    // 若模型中心越出当前窗口，吸回窗口内（保持中心位于 [0,innerWidth]×[0,innerHeight]，canvas 坐标）。
    _clampModelToWindow() {
        if (!this.model) return;
        const sf = window.canvasScaleFactor || 2;
        const maxX = window.innerWidth * sf;
        const maxY = window.innerHeight * sf;
        const b = this.model.getBounds();
        const cx = (b.left + b.right) / 2;
        const cy = (b.top + b.bottom) / 2;
        const clampedX = Math.min(Math.max(cx, 0), maxX);
        const clampedY = Math.min(Math.max(cy, 0), maxY);
        if (clampedX !== cx || clampedY !== cy) {
            this.model.x += clampedX - cx;
            this.model.y += clampedY - cy;
            this.updateInteractionArea();
        }
    }


   // 设置嘴部动画
    setMouthOpenY(v) {
        if (!this.model) return;

        try {
            v = Math.max(0, Math.min(v, 3.0));
            const coreModel = this.model.internalModel.coreModel;

            // 同时尝试所有可能的组合，不要return，让所有的都执行
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

        //使用实际窗口尺寸（如果可用
        const actualWidth = window.actualWidth || window.innerWidth;
        const actualHeight = window.actualHeight || window.innerHeight;
        const scaleFactor = window.canvasScaleFactor || 2;

        this.model.scale.set(scaleMultiplier);

        // 窗口已由主进程落在“上次所在的显示器”，这里只按当前显示器内的相对位置摆放，
        // 不再依据 isDualRight 切换 x_dual/y_dual。
        const pos = this.config?.ui?.model_position;
        const defaultRelX = pos?.x ?? 0.65;
        const defaultRelY = pos?.y ?? 0.38;

        this.model.x = defaultRelX * actualWidth * scaleFactor;
        this.model.y = defaultRelY * actualHeight * scaleFactor;

        this.updateInteractionArea();
        // 防御：若配置里存了越界的相对位置（例如旧版跨屏 bug 导致的负值），启动时吸回当前窗口内。
        this._clampModelToWindow();
    }

    // 保存模型位置到配置文件
    // 只保存“当前显示器内的相对位置（0~1）”；所在显示器的屏幕原点由主进程附加（save-model-position）。
    saveModelPosition(overrideWidth, overrideHeight) {
        if (!this.model || !this.config) return;

        // 检查是否启用位置记忆
        if (!this.config.ui || !this.config.ui.model_position || !this.config.ui.model_position.remember_position) {
            return;
        }

        // 计算相对位置的基准宽高：跨屏切换时传入“目标显示器的 DIP 尺寸”，避免依赖尚未稳定的 innerWidth。
        const actualWidth = overrideWidth || window.actualWidth || window.innerWidth;
        const actualHeight = overrideHeight || window.actualHeight || window.innerHeight;
        const scaleFactor = window.canvasScaleFactor || 2;

        //将canvas坐标转换为相对于窗口的坐标，再计算相对位置
        const windowX = this.model.x / scaleFactor;
        const windowY = this.model.y / scaleFactor;

        // 计算相对位置（0-1之间的比例）
        const relativeX = windowX / actualWidth;
        const relativeY = windowY / actualHeight;

        // 更新配置对象
        this.config.ui.model_position.x = relativeX;
        this.config.ui.model_position.y = relativeY;

        // 发送IPC消息保存位置（dual 字段已废弃；显示器原点由主进程根据窗口位置写入）
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