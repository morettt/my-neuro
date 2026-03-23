const { ipcRenderer } = require('electron');

// VRM视口参数
const VRM_VIEWPORT_ASPECT = 1.5;   // 视口高宽比（height / width）
// 以下常量将VRM视口坐标映射到与Live2D相同的保存格式（基于实测校准）
const VRM_SCALE_FACTOR = 0.896;    // saved_scale * factor = viewport_width / innerWidth
const VRM_PADDING_X = 0.104;       // 模型左边缘在视口中的水平偏移（占视口宽度比例）
const VRM_PADDING_Y = 0.282;       // 模型顶部在视口中的垂直偏移（占视口高度比例）

// VRM模型交互控制器
class VRMInteractionController {
    constructor() {
        this.model = null;
        this.app = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.config = null;
    }

    // 初始化
    init(model, app, config = null) {
        this.model = model;
        this.app = app;
        this.config = config;
        this._setupVRMInteractivity();
        this._setupControlPanel();
        this._setupScrollZoom();
        this._setupWindowResize();
        this._setupContextMenu();
    }

    // VRM控制面板（重置、VMC、渲染开关、穿透）
    _setupControlPanel() {
        const panel = document.getElementById('model-controls');
        if (!panel) return;

        panel.style.display = 'block';

        // 展开/折叠按钮
        const toggleBtn = document.getElementById('btn-toggle-panel');
        const panelButtons = document.getElementById('panel-buttons');
        if (toggleBtn && panelButtons) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = panelButtons.classList.toggle('expanded');
                toggleBtn.textContent = isExpanded ? '✕' : '⚙';
                toggleBtn.title = isExpanded ? '收起面板' : '展开控制面板';
            });
        }

        // 重置按钮：预留给VRM摄像头距离和旋转重置
        const resetBtn = document.getElementById('btn-reset-position');
        if (resetBtn) {
            resetBtn.style.display = '';
            resetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.model.resetOrbit();
            });
        }

        // VMC开关按钮
        const vmcBtn = document.getElementById('btn-toggle-vmc');
        if (vmcBtn) {
            const vmcSender = this.model.getVMCSender && this.model.getVMCSender();
            const vmcEnabled = vmcSender && vmcSender.enabled;
            vmcBtn.classList.toggle('active', vmcEnabled);
            this._updateRenderBtnState();

            vmcBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sender = this.model.getVMCSender && this.model.getVMCSender();
                if (!sender) return;
                if (sender.enabled) {
                    sender.enabled = false;
                    sender.stop();
                    vmcBtn.classList.remove('active');
                } else {
                    sender.enabled = true;
                    if (!sender.socket) sender.start();
                    vmcBtn.classList.add('active');
                }
                this._updateRenderBtnState();
            });
        }

        // 渲染开关按钮
        const renderBtn = document.getElementById('btn-toggle-render');
        if (renderBtn) {
            renderBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const vmcSender = this.model.getVMCSender && this.model.getVMCSender();
                if (!vmcSender || !vmcSender.enabled) return; // VMC未启用时禁用
                const nowEnabled = this.model.isRenderingEnabled();
                this.model.setRenderingEnabled(!nowEnabled);
                renderBtn.classList.toggle('active', !nowEnabled);
            });
        }

        // 鼠标穿透按钮
        const ctBtn = document.getElementById('btn-click-through');
        if (ctBtn) {
            ctBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newVal = !this.model.clickThrough;
                this.model.clickThrough = newVal;
                ctBtn.classList.toggle('active', newVal);
            });
        }

        // 视线追踪按钮
        const gazeBtn = document.getElementById('btn-toggle-gaze');
        if (gazeBtn) {
            gazeBtn.classList.toggle('active', this.model._gazeEnabled);
            gazeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.model._gazeEnabled = !this.model._gazeEnabled;
                gazeBtn.classList.toggle('active', this.model._gazeEnabled);
            });
        }

        // 鼠标穿透逻辑：控制面板始终可交互
        panel.addEventListener('mouseenter', () => {
            ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
        });
        panel.addEventListener('mouseleave', () => {
            ipcRenderer.send('set-ignore-mouse-events', {
                ignore: true, options: { forward: true }
            });
        });

        // 聊天框在穿透模式下也保持可交互
        const chatContainer = document.getElementById('text-chat-container');
        if (chatContainer) {
            chatContainer.addEventListener('mouseenter', () => {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
            });
            chatContainer.addEventListener('mouseleave', () => {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: true, options: { forward: true }
                });
            });
        }
    }

    // 更新渲染按钮的禁用状态
    _updateRenderBtnState() {
        const renderBtn = document.getElementById('btn-toggle-render');
        if (!renderBtn) return;
        const vmcSender = this.model.getVMCSender && this.model.getVMCSender();
        const vmcEnabled = vmcSender && vmcSender.enabled;
        renderBtn.classList.toggle('disabled', !vmcEnabled);
        if (!vmcEnabled) {
            // VMC关闭时强制启用渲染
            this.model.setRenderingEnabled(true);
            renderBtn.classList.remove('active');
        }
    }

    // VRM模型的交互设置（视口拖拽、缩放、点击表情、鼠标穿透）
    _setupVRMInteractivity() {
        const canvas = this.app.renderer.view;
        const model = this.model;
        let mouseDownPos = null;
        let isRightDragging = false;
        const rightDragStart = { x: 0, y: 0 };

        // containsPoint：检查client坐标是否在视口区域或UI元素上
        model.containsPoint = (point) => {
            if (!model._interactive || !model._visible) return false;
            // 鼠标穿透模式下，模型区域不响应（但UI面板仍响应）
            if (model._clickThrough) {
                const controls = document.getElementById('model-controls');
                if (controls && controls.style.display !== 'none') {
                    const ctrlRect = controls.getBoundingClientRect();
                    if (point.x >= ctrlRect.left && point.x <= ctrlRect.right &&
                        point.y >= ctrlRect.top && point.y <= ctrlRect.bottom) return true;
                }
                const chatContainer = document.getElementById('text-chat-container');
                if (chatContainer && chatContainer.style.display !== 'none') {
                    const chatRect = chatContainer.getBoundingClientRect();
                    if (point.x >= chatRect.left && point.x <= chatRect.right &&
                        point.y >= chatRect.top && point.y <= chatRect.bottom) return true;
                }
                return false;
            }

            // 模型可见区域（使用屏幕空间碰撞盒）
            const isOverModel = model.isPointOverModel(point.x, point.y);

            // 聊天框
            const chatContainer = document.getElementById('text-chat-container');
            let isOverChat = false;
            if (chatContainer && chatContainer.style.display !== 'none') {
                const chatRect = chatContainer.getBoundingClientRect();
                isOverChat = point.x >= chatRect.left && point.x <= chatRect.right &&
                             point.y >= chatRect.top && point.y <= chatRect.bottom;
            }

            // 控制面板
            const controls = document.getElementById('model-controls');
            let isOverControls = false;
            if (controls && controls.style.display !== 'none') {
                const ctrlRect = controls.getBoundingClientRect();
                isOverControls = point.x >= ctrlRect.left && point.x <= ctrlRect.right &&
                                 point.y >= ctrlRect.top && point.y <= ctrlRect.bottom;
            }

            return isOverModel || isOverChat || isOverControls;
        };

        // 鼠标位置跟踪（使用client坐标）
        const mouseGlobal = this.app.renderer.plugins.interaction.mouse.global;

        canvas.addEventListener('mousemove', (e) => {
            mouseGlobal.x = e.clientX;
            mouseGlobal.y = e.clientY;

            // 更新视线追踪鼠标坐标
            if (model._gazeEnabled && model.setMousePosition) {
                model.setMousePosition(e.clientX, e.clientY);
            }

            // 左键拖拽：移动视口
            if (this.isDragging) {
                const vr = model.viewRect;
                vr.x = e.clientX - this.dragOffset.x;
                vr.y = e.clientY - this.dragOffset.y;
                return;
            }

            // 右键拖拽：旋转摄像头
            if (isRightDragging) {
                const dx = e.clientX - rightDragStart.x;
                const dy = e.clientY - rightDragStart.y;
                model._orbitTheta -= dx * 0.005;
                model._orbitPhi += dy * 0.005;
                model._orbitPhi = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, model._orbitPhi));
                rightDragStart.x = e.clientX;
                rightDragStart.y = e.clientY;
                return;
            }

            // 鼠标穿透判定
            if (model.containsPoint({ x: e.clientX, y: e.clientY })) {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
            } else {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: true, options: { forward: true }
                });
            }

            // 穿透模式：鼠标在模型区域上时窗口半透明
            if (model._clickThrough) {
                model.setHoverTransparent(model.isPointOverModel(e.clientX, e.clientY));
            }
        });

        canvas.addEventListener('mousedown', (e) => {
            const isOverModel = model.isPointOverModel(e.clientX, e.clientY);

            // 穿透模式下禁止所有模型交互
            if (model._clickThrough) return;

            if (e.button === 0) {
                // 左键：视口拖拽
                mouseDownPos = { x: e.clientX, y: e.clientY };
                if (isOverModel) {
                    this.isDragging = true;
                    const vr = model.viewRect;
                    this.dragOffset.x = e.clientX - vr.x;
                    this.dragOffset.y = e.clientY - vr.y;
                    ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
                }
            } else if (e.button === 2) {
                // 右键：摄像头旋转
                if (isOverModel) {
                    isRightDragging = true;
                    rightDragStart.x = e.clientX;
                    rightDragStart.y = e.clientY;
                    ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
                }
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 0 && this.isDragging) {
                this.isDragging = false;

                // 判断点击 vs 拖拽（距离 < 5px 视为点击）
                if (mouseDownPos) {
                    const dx = e.clientX - mouseDownPos.x;
                    const dy = e.clientY - mouseDownPos.y;
                    if (Math.sqrt(dx * dx + dy * dy) < 5) {
                        if (model.isPointOverModel(e.clientX, e.clientY)) {
                            model.motion('Tap');
                            model.expression();
                        }
                    }
                }

                this._clampViewRect();
                this.saveModelPosition();

                setTimeout(() => {
                    if (!model.containsPoint({ x: e.clientX, y: e.clientY })) {
                        ipcRenderer.send('set-ignore-mouse-events', {
                            ignore: true, options: { forward: true }
                        });
                    }
                }, 100);
            }

            if (e.button === 2 && isRightDragging) {
                isRightDragging = false;
                setTimeout(() => {
                    if (!model.containsPoint({ x: e.clientX, y: e.clientY })) {
                        ipcRenderer.send('set-ignore-mouse-events', {
                            ignore: true, options: { forward: true }
                        });
                    }
                }, 100);
            }

            if (e.button === 0) mouseDownPos = null;
        });

        canvas.addEventListener('mouseover', (e) => {
            if (model.containsPoint({ x: e.clientX, y: e.clientY })) {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
            }
        });

        canvas.addEventListener('mouseout', () => {
            if (!this.isDragging) {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: true, options: { forward: true }
                });
            }
        });
    }

    // 滚轮缩放视口 / Alt+滚轮调节摄像头距离
    _setupScrollZoom() {
        window.addEventListener('wheel', (e) => {
            if (!this.model.isPointOverModel(e.clientX, e.clientY)) return;
            e.preventDefault();
            if (this.model._clickThrough) return;

            if (e.altKey) {
                const factor = e.deltaY > 0 ? 1.1 : 0.9;
                this.model._orbitDistance = Math.max(0.5, Math.min(20, this.model._orbitDistance * factor));
                return;
            }

            const vr = this.model.viewRect;
            const factor = e.deltaY > 0 ? 0.95 : 1.05;
            const newWidth = vr.width * factor;
            const newHeight = newWidth * VRM_VIEWPORT_ASPECT;

            if (newWidth < 100 || newWidth > window.innerWidth * 5) return;

            const mouseRelX = (e.clientX - vr.x) / vr.width;
            const mouseRelY = (e.clientY - vr.y) / vr.height;

            vr.x -= (newWidth - vr.width) * mouseRelX;
            vr.y -= (newHeight - vr.height) * mouseRelY;
            vr.width = newWidth;
            vr.height = newHeight;

            this._clampViewRect();
            this.saveModelPosition();
        }, { passive: false });
    }

    _setupWindowResize() {
        window.addEventListener('resize', () => {
            if (this.app && this.app._renderer) {
                this.app._renderer.setSize(window.innerWidth, window.innerHeight);
            }
        });
    }

    _setupContextMenu() {
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });
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

    // 初始化VRM视口位置
    setupInitialModelProperties() {
        if (!this.model || !this.app) return;

        const rememberPosition = this.config?.ui?.model_position?.remember_position !== false;
        const savedPos = this.config?.ui?.model_position;
        const savedScale = this.config?.ui?.model_scale;

        if (rememberPosition && savedPos?.x != null && savedPos?.y != null &&
            savedScale && savedScale > 0) {
            this.model.viewRect = this._savedToViewRect(savedPos.x, savedPos.y, savedScale);
            console.log('加载保存的VRM视口位置:', this.model.viewRect);
        } else {
            this.model.viewRect = this._savedToViewRect(1.35, 0.8, 2.3);
            console.log('VRM视口初始化（默认位置）:', this.model.viewRect);
        }
        this._clampViewRect();
    }

    // 保存VRM视口位置（Live2D兼容格式）
    saveModelPosition() {
        if (!this.model || !this.config) return;
        const vr = this.model.viewRect;
        if (!vr || !this.config.ui?.model_position?.remember_position) return;

        const saved = this._viewRectToSaved();
        this.config.ui.model_position.x = saved.x;
        this.config.ui.model_position.y = saved.y;
        this.config.ui.model_scale = saved.scale;

        ipcRenderer.send('save-model-position', saved);
        console.log('保存VRM位置（Live2D格式）:', saved);
    }

    // ===== VRM坐标转换（与Live2D统一坐标系） =====

    // 将Live2D兼容保存值转换为VRM视口矩形
    _savedToViewRect(relX, relY, scale) {
        const iW = window.innerWidth;
        const iH = window.innerHeight;
        const width = scale * VRM_SCALE_FACTOR * iW;
        const height = width * VRM_VIEWPORT_ASPECT;
        return {
            x: relX * iW / 2 - VRM_PADDING_X * width,
            y: relY * iH / 2 - VRM_PADDING_Y * height,
            width: width,
            height: height
        };
    }

    // 将VRM视口矩形转换为Live2D兼容保存值
    _viewRectToSaved() {
        const vr = this.model.viewRect;
        const iW = window.innerWidth;
        const iH = window.innerHeight;
        return {
            x: (vr.x + VRM_PADDING_X * vr.width) * 2 / iW,
            y: (vr.y + VRM_PADDING_Y * vr.height) * 2 / iH,
            scale: vr.width / (VRM_SCALE_FACTOR * iW)
        };
    }

    _clampViewRect() {
        if (!this.model) return;
        const vr = this.model.viewRect;
        const iW = window.innerWidth;
        const iH = window.innerHeight;
        // 模型可见区域边界
        const modelLeft = vr.x + VRM_PADDING_X * vr.width;
        const modelRight = vr.x + (1 - VRM_PADDING_X) * vr.width;
        const modelTop = vr.y + VRM_PADDING_Y * vr.height;
        const modelBottom = vr.y + 0.96 * vr.height;
        const margin = 80;
        // 确保模型可见区域至少margin像素在屏幕内
        if (modelRight < margin) vr.x += margin - modelRight;
        if (modelLeft > iW - margin) vr.x -= modelLeft - (iW - margin);
        if (modelBottom < margin) vr.y += margin - modelBottom;
        if (modelTop > iH - margin) vr.y -= modelTop - (iH - margin);
    }
}

module.exports = { VRMInteractionController };