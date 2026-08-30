// interaction.js - VRM 交互控制器（v2，由 js/model/vrm-model-interaction.js 迁移）
// v2 变更：所有事件监听统一登记，提供 destroy()（配合形态热切换）；
//         鼠标穿透判定交由 ui-controller 的统一 mousemove 路径 + 本类的拖拽联动。
const { ipcRenderer } = require('electron');

// VRM视口参数（与旧实现一致的实测校准值）
const VRM_VIEWPORT_ASPECT = 1.5;
const VRM_SCALE_FACTOR = 0.896;
const VRM_PADDING_X = 0.104;
const VRM_PADDING_Y = 0.282;
const VRM_CENTER_Y_FRAC = (VRM_PADDING_Y + 0.96) / 2; // 可见区纵向中心在 viewRect 高度上的比例

class VRMInteractionController {
    constructor() {
        this.model = null;
        this.manager = null;
        this.canvas = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.config = null;
        this._listeners = [];
        this._bounceAnim = null;   // 回弹动画句柄（进行中才有值，用于打断）
        this.bounceEnabled = true; // 回弹开关（默认开启，config.ui.model_position.bounce_back 控制）
    }

    init(model, manager, config = null) {
        // 防御：重绑/形态恢复时取消可能仍在进行的回弹动画，
        // 避免旧模型的动画帧继续按过期 startX/dx 改写新模型位置
        this._cancelBounce();
        this.model = model;
        this.manager = manager;
        this.canvas = manager.canvas;
        this.config = config;
        // 回弹开关（默认开启）
        this.bounceEnabled = config?.ui?.model_position?.bounce_back !== false;
        this._teardown();
        this._setupVRMInteractivity();
        this._setupControlPanel();
        this._setupScrollZoom();
        this._setupWindowResize();
        this._setupContextMenu();
    }

    _on(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        this._listeners.push({ target, type, handler, options });
    }

    _teardown() {
        for (const { target, type, handler, options } of this._listeners) {
            try { target.removeEventListener(type, handler, options); } catch (_) {}
        }
        this._listeners = [];
    }

    destroy() {
        this._teardown();
        this._cancelBounce();
        // 隐藏 VRM 控制面板
        const panel = document.getElementById('model-controls');
        if (panel) panel.style.display = 'none';
        this.model = null;
        this.manager = null;
        this.canvas = null;
    }

    // 供 ui-controller 的统一穿透判定
    isPointOverInteractive(clientX, clientY) {
        if (!this.model) return false;
        return this.model.containsPoint({ x: clientX, y: clientY });
    }

    // VRM控制面板（重置、VMC、渲染开关、穿透、视线）
    _setupControlPanel() {
        const panel = document.getElementById('model-controls');
        if (!panel) return;
        panel.style.display = 'flex';

        const toggleBtn = document.getElementById('btn-toggle-panel');
        const panelButtons = document.getElementById('panel-buttons');
        if (toggleBtn && panelButtons) {
            this._on(toggleBtn, 'click', (e) => {
                e.stopPropagation();
                const isExpanded = panelButtons.classList.toggle('expanded');
                toggleBtn.textContent = isExpanded ? '✕' : '⚙';
                toggleBtn.title = isExpanded ? '收起面板' : '展开控制面板';
            });
        }

        const resetBtn = document.getElementById('btn-reset-position');
        if (resetBtn) {
            resetBtn.style.display = '';
            this._on(resetBtn, 'click', (e) => {
                e.stopPropagation();
                this.model?.resetOrbit();
            });
        }

        // VMC开关（肥牛独有功能，保留）
        const vmcBtn = document.getElementById('btn-toggle-vmc');
        if (vmcBtn) {
            const vmcSender = this.model.getVMCSender && this.model.getVMCSender();
            vmcBtn.classList.toggle('active', !!(vmcSender && vmcSender.enabled));
            this._updateRenderBtnState();

            this._on(vmcBtn, 'click', (e) => {
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

        const renderBtn = document.getElementById('btn-toggle-render');
        if (renderBtn) {
            this._on(renderBtn, 'click', (e) => {
                e.stopPropagation();
                const vmcSender = this.model.getVMCSender && this.model.getVMCSender();
                if (!vmcSender || !vmcSender.enabled) return;
                const nowEnabled = this.model.isRenderingEnabled();
                this.model.setRenderingEnabled(!nowEnabled);
                renderBtn.classList.toggle('active', !nowEnabled);
            });
        }

        const ctBtn = document.getElementById('btn-click-through');
        if (ctBtn) {
            this._on(ctBtn, 'click', (e) => {
                e.stopPropagation();
                const newVal = !this.model.clickThrough;
                this.model.clickThrough = newVal;
                ctBtn.classList.toggle('active', newVal);
            });
        }

        const gazeBtn = document.getElementById('btn-toggle-gaze');
        if (gazeBtn) {
            gazeBtn.classList.toggle('active', this.model._gazeEnabled);
            this._on(gazeBtn, 'click', (e) => {
                e.stopPropagation();
                this.model._gazeEnabled = !this.model._gazeEnabled;
                gazeBtn.classList.toggle('active', this.model._gazeEnabled);
            });
        }

        this._on(panel, 'mouseenter', () => {
            ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
        });
        this._on(panel, 'mouseleave', () => {
            ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } });
        });

        const chatContainer = document.getElementById('text-chat-container');
        if (chatContainer) {
            this._on(chatContainer, 'mouseenter', () => {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
            });
            this._on(chatContainer, 'mouseleave', () => {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } });
            });
        }
    }

    _updateRenderBtnState() {
        const renderBtn = document.getElementById('btn-toggle-render');
        if (!renderBtn || !this.model) return;
        const vmcSender = this.model.getVMCSender && this.model.getVMCSender();
        const vmcEnabled = vmcSender && vmcSender.enabled;
        renderBtn.classList.toggle('disabled', !vmcEnabled);
        if (!vmcEnabled) {
            this.model.setRenderingEnabled(true);
            renderBtn.classList.remove('active');
        }
    }

    _setupVRMInteractivity() {
        const canvas = this.canvas;
        const model = this.model;
        let mouseDownPos = null;
        let isRightDragging = false;
        const rightDragStart = { x: 0, y: 0 };

        // containsPoint：检查client坐标是否在模型/UI元素上（穿透判定用）
        model.containsPoint = (point) => {
            const overFeiniuBoardPanel = () => {
                const boardPanel = document.querySelector('#feiniu-board-game-root .feiniu-panel');
                if (!boardPanel || !boardPanel.isConnected) return false;
                const r = boardPanel.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) return false;
                return point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
            };
            const overRect = (el) => {
                if (!el || el.style.display === 'none') return false;
                const r = el.getBoundingClientRect();
                return point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
            };
            if (!model._interactive || !model._visible) return false;
            if (model._clickThrough) {
                return overRect(document.getElementById('model-controls'))
                    || overRect(document.getElementById('text-chat-container'))
                    || overFeiniuBoardPanel();
            }
            return model.isPointOverModel(point.x, point.y)
                || overRect(document.getElementById('text-chat-container'))
                || overRect(document.getElementById('model-controls'))
                || overFeiniuBoardPanel();
        };

        this._on(canvas, 'mousemove', (e) => {
            if (model._gazeEnabled && model.setMousePosition) {
                model.setMousePosition(e.clientX, e.clientY);
            }
            if (this.isDragging) {
                const vr = model.viewRect;
                vr.x = e.clientX - this.dragOffset.x;
                vr.y = e.clientY - this.dragOffset.y;
                this._maybeExpandPetWindow(vr.x, vr.y);
                return;
            }
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
            if (model.containsPoint({ x: e.clientX, y: e.clientY })) {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
            } else {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } });
            }
            if (model._clickThrough) {
                model.setHoverTransparent(model.isPointOverModel(e.clientX, e.clientY));
            }
        });

        this._on(canvas, 'mousedown', (e) => {
            const isOverModel = model.isPointOverModel(e.clientX, e.clientY);
            if (model._clickThrough) return;
            if (e.button === 0) {
                mouseDownPos = { x: e.clientX, y: e.clientY };
                if (isOverModel) {
                    this.isDragging = true;
                    const vr = model.viewRect;
                    this.dragOffset.x = e.clientX - vr.x;
                    this.dragOffset.y = e.clientY - vr.y;
                    // 开始拖动时取消进行中的回弹动画，避免和用户新拖动互相拉扯
                    this._cancelBounce();
                    ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
                }
            } else if (e.button === 2) {
                if (isOverModel) {
                    isRightDragging = true;
                    rightDragStart.x = e.clientX;
                    rightDragStart.y = e.clientY;
                    ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
                }
            }
        });

        this._on(window, 'mouseup', (e) => {
            if (e.button === 0 && this.isDragging) {
                this.isDragging = false;

                // 点击判定：位移<5px 触发点击表情（与 Live2D 的点击交互对齐）
                if (mouseDownPos && !model._clickThrough) {
                    const dx = e.clientX - mouseDownPos.x;
                    const dy = e.clientY - mouseDownPos.y;
                    if (Math.hypot(dx, dy) < 5 && model.isPointOverModel(e.clientX, e.clientY)) {
                        model.motion('Tap');
                    }
                }

                // 巨窗方案：松手不再整窗切屏。回弹按整块窗口判断。
                this._bounceViewRectIntoWindow();
                setTimeout(() => {
                    if (this.model && !model.containsPoint({ x: e.clientX, y: e.clientY })) {
                        ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } });
                    }
                }, 100);
            }
            if (e.button === 2 && isRightDragging) {
                isRightDragging = false;
                setTimeout(() => {
                    if (this.model && !model.containsPoint({ x: e.clientX, y: e.clientY })) {
                        ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } });
                    }
                }, 100);
            }
            if (e.button === 0) mouseDownPos = null;
        });

        this._on(canvas, 'mouseover', (e) => {
            if (model.containsPoint({ x: e.clientX, y: e.clientY })) {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
            }
        });

        this._on(canvas, 'mouseout', (e) => {
            if (this.isDragging) return;
            const t = e.relatedTarget;
            const root = document.getElementById('feiniu-board-game-root');
            if (t && root && root.contains(t)) return;
            ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } });
        });
    }

    _setupScrollZoom() {
        this._on(window, 'wheel', (e) => {
            if (!this.model || !this.model.isPointOverModel(e.clientX, e.clientY)) return;
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
        this._on(window, 'resize', () => {
            if (this.manager?.renderer) {
                this.manager.renderer.setSize(window.innerWidth, window.innerHeight);
            }
        });
    }

    _setupContextMenu() {
        this._on(window, 'contextmenu', (e) => {
            e.preventDefault();
            return false;
        });
    }

    // 设置嘴部动画（TTS/音乐口型链路）
    setMouthOpenY(v) {
        if (!this.model) return;
        try {
            v = Math.max(0, Math.min(v, 3.0));
            this.model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', v);
        } catch (_) {}
    }

    setupInitialModelProperties() {
        if (!this.model) return;
        const rememberPosition = this.config?.ui?.model_position?.remember_position !== false;
        const savedPos = this.config?.ui?.model_position;
        const savedScale = this.config?.ui?.model_scale;
        if (rememberPosition && savedPos?.x != null && savedPos?.y != null && savedScale && savedScale > 0) {
            this.model.viewRect = this._savedToViewRect(savedPos.x, savedPos.y, savedScale);
        } else {
            this.model.viewRect = this._savedToViewRect(1.35, 0.8, 2.3);
        }
        this._clampViewRect();
    }

    // overrideWidth/Height：跨屏切换时传入“目标显示器的 DIP 尺寸”，避免依赖尚未稳定的 innerWidth。
    saveModelPosition(overrideWidth, overrideHeight) {
        if (!this.model || !this.config) return;
        const vr = this.model.viewRect;
        if (!vr || !this.config.ui?.model_position?.remember_position) return;

        const saved = this._viewRectToSaved(overrideWidth, overrideHeight);
        this.config.ui.model_position.x = saved.x;
        this.config.ui.model_position.y = saved.y;
        this.config.ui.model_scale = saved.scale;

        ipcRenderer.send('save-model-position', {
            ...saved,
            modelName: null   // VRM 位置沿用全局 config 键（与旧行为一致）
        });
    }

    resetModelPosition() {
        if (!this.model) return { success: false };
        const primary = this._getPrimaryWindowOffset();
        const vr = this._savedToViewRectWithSize(1.35, 0.8, 2.3, primary.width, primary.height);
        vr.x += primary.x;
        vr.y += primary.y;
        this.model.viewRect = vr;
        this._clampViewRect();
        this.saveModelPosition();
        return { success: true };
    }

    _savedToViewRect(relX, relY, scale) {
        return this._savedToViewRectWithSize(relX, relY, scale, window.innerWidth, window.innerHeight);
    }

    _savedToViewRectWithSize(relX, relY, scale, iW, iH) {
        const width = scale * VRM_SCALE_FACTOR * iW;
        const height = width * VRM_VIEWPORT_ASPECT;
        return {
            x: relX * iW / 2 - VRM_PADDING_X * width,
            y: relY * iH / 2 - VRM_PADDING_Y * height,
            width,
            height
        };
    }

    _getPrimaryWindowOffset() {
        try {
            const info = ipcRenderer.sendSync('get-screen-info-sync');
            if (info?.primaryDisplay?.bounds && info?.windowBounds) {
                return {
                    x: info.primaryDisplay.bounds.x - info.windowBounds.x,
                    y: info.primaryDisplay.bounds.y - info.windowBounds.y,
                    width: info.primaryDisplay.bounds.width,
                    height: info.primaryDisplay.bounds.height
                };
            }
        } catch (_) { /* ignore */ }
        return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    }

    _maybeExpandPetWindow(x, y) {
        const now = Date.now();
        if (this._lastWindowMoveAt && now - this._lastWindowMoveAt < 200) return;
        const edge = 40;
        const nearEdge = x < edge || y < edge ||
            x > window.innerWidth - edge || y > window.innerHeight - edge;
        if (!nearEdge) return;
        this._lastWindowMoveAt = now;
        ipcRenderer.send('window-move', { mouseX: 0, mouseY: 0 });
    }

    // overrideWidth/Height：跨屏切换时传入“目标显示器的 DIP 尺寸”作基准。
    _viewRectToSaved(overrideWidth, overrideHeight) {
        const vr = this.model.viewRect;
        const iW = overrideWidth || window.innerWidth;
        const iH = overrideHeight || window.innerHeight;
        return {
            x: (vr.x + VRM_PADDING_X * vr.width) * 2 / iW,
            y: (vr.y + VRM_PADDING_Y * vr.height) * 2 / iH,
            scale: vr.width / (VRM_SCALE_FACTOR * iW)
        };
    }

    // 6.55 巨窗下不再整窗切屏。保留空实现，避免旧调用把窗口缩回单屏。
    async checkAndSwitchDisplay() {
        console.log('[VRM] 巨窗方案不再整窗切屏');
        return false;
    }

    // ===== 回弹：以「碰撞箱（getScreenHitBox，骨骼投影的真实可抓取范围）」为判断依据 =====
    // 当碰撞箱在窗口内的可见部分 < 15% 时触发（即模型被拖到几乎抓不到了）。
    // 回弹目标用「碰撞箱」而非「模型整体」——位移精确匹配抓取区出屏量，避免左右回弹距离被放大。
    // 受 bounceEnabled 开关控制（config.ui.model_position.bounce_back，默认开启）。
    _bounceViewRectIntoWindow() {
        if (!this.model || !this.model.viewRect) return;
        if (!this.bounceEnabled) {
            // 回弹关闭：不做动画，但仍走夹紧，避免模型拖出窗口后当前会话抓不回来
            this._clampViewRect();
            this.saveModelPosition();
            return;
        }
        const iW = window.innerWidth;
        const iH = window.innerHeight;
        const margin = 16;

        // 碰撞箱 = 真实屏幕碰撞盒（可抓取范围），降级到 viewRect。
        const hb = this.model.getScreenHitBox ? this.model.getScreenHitBox() : null;
        const boxLeft = hb ? hb.x : this.model.viewRect.x;
        const boxTop = hb ? hb.y : this.model.viewRect.y;
        const boxW = hb ? hb.width : this.model.viewRect.width;
        const boxH = hb ? hb.height : this.model.viewRect.height;
        const boxRight = boxLeft + boxW;
        const boxBottom = boxTop + boxH;

        // 碰撞箱在窗口内的可见部分
        const visW = Math.max(0, Math.min(boxRight, iW) - Math.max(boxLeft, 0));
        const visH = Math.max(0, Math.min(boxBottom, iH) - Math.max(boxTop, 0));

        // 触发阈值：碰撞箱可见部分低于 15%（下限 8px）。
        const minVisX = Math.max(8, boxW * 0.15);
        const minVisY = Math.max(8, boxH * 0.15);
        const needX = visW < minVisX;
        const needY = visH < minVisY;

        if (!needX && !needY) {
            this.saveModelPosition();
            return;
        }

        // 回弹目标：把碰撞箱完整夹回 [margin, iW-margin]×[margin, iH-margin]。
        let targetLeft = boxLeft;
        let targetTop = boxTop;
        if (needX) {
            if (boxW >= iW - margin * 2) targetLeft = (iW - boxW) / 2;
            else if (boxLeft < margin) targetLeft = margin;
            else if (boxRight > iW - margin) targetLeft = iW - margin - boxW;
        }
        if (needY) {
            if (boxH >= iH - margin * 2) targetTop = (iH - boxH) / 2;
            else if (boxTop < margin) targetTop = margin;
            else if (boxBottom > iH - margin) targetTop = iH - margin - boxH;
        }

        // 由碰撞箱位移反推 viewRect.x / viewRect.y 的位移（碰撞箱与 viewRect 同步平移）。
        const dx = targetLeft - boxLeft;
        const dy = targetTop - boxTop;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
            this.saveModelPosition();
            return;
        }

        this._animateBounce(dx, dy);
    }

    // 平滑回弹动画（easeInOutCubic + 轻微 overshoot），期间用户再次按下会由 _cancelBounce 打断。
    _animateBounce(dx, dy) {
        this._cancelBounce();
        const startX = this.model.viewRect.x;
        const startY = this.model.viewRect.y;
        const duration = 340;
        const start = performance.now();
        const step = (now) => {
            if (!this.model || !this.model.viewRect) return;
            if (this.isDragging) { this._cancelBounce(); return; }
            const t = Math.min(1, (now - start) / duration);
            // easeInOutCubic：起止都缓，中段快，配合 overshoot 更顺滑
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            // 仅在中段加入轻微 overshoot（峰值 ~1.04），抵消 easeInOut 的“突然停止感”
            const overshoot = Math.sin(Math.PI * t) * 0.04;
            const s = e + overshoot;
            this.model.viewRect.x = startX + dx * s;
            this.model.viewRect.y = startY + dy * s;
            if (t < 1) {
                this._bounceAnim = requestAnimationFrame(step);
            } else {
                this._bounceAnim = null;
                this.saveModelPosition();
            }
        };
        this._bounceAnim = requestAnimationFrame(step);
    }

    // 取消进行中的回弹动画。
    _cancelBounce() {
        if (this._bounceAnim != null) {
            cancelAnimationFrame(this._bounceAnim);
            this._bounceAnim = null;
        }
    }

    _clampViewRect() {
        if (!this.model) return;
        const vr = this.model.viewRect;
        const iW = window.innerWidth;
        const iH = window.innerHeight;
        const modelLeft = vr.x + VRM_PADDING_X * vr.width;
        const modelRight = vr.x + (1 - VRM_PADDING_X) * vr.width;
        const modelTop = vr.y + VRM_PADDING_Y * vr.height;
        const modelBottom = vr.y + 0.96 * vr.height;
        const margin = 80;
        if (modelRight < margin) vr.x += margin - modelRight;
        if (modelLeft > iW - margin) vr.x -= modelLeft - (iW - margin);
        if (modelBottom < margin) vr.y += margin - modelBottom;
        if (modelTop > iH - margin) vr.y -= modelTop - (iH - margin);
    }
}

module.exports = { VRMInteractionController };
