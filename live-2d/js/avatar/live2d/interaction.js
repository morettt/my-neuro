// interaction.js - Live2D 交互控制器（兼容上游 PIXI 6 运行时）
// Adapted from Project-N-E-K-O/N.E.K.O (Apache-2.0): static/live2d-interaction.js 的
// 指针拖拽 / 鼠标锚点缩放思路。
//
// 对外契约（不可破坏，消费者：app.js / TTSFactory / music-player / http-server / avatar-drop）：
//   init(model, app, config)          - 初始化
//   setupInitialModelProperties(s)    - 兼容旧接口（变换已由 loader 应用，此处仅刷新交互区）
//   setMouthOpenY(v)                  - 口型驱动（Phase 4 升级为 override 机制）
//   updateInteractionArea()           - 刷新交互区缓存
//   interactionX/Y/Width/Height       - 交互区（CSS 像素）
//   saveModelPosition()               - 持久化位置/缩放（存储用 legacy 语义）
//   resetModelPosition()              - 复位（供 HTTP /reset-model-position）
//   isPointOverInteractive(x, y)      - 供 ui-controller 鼠标穿透判定（client 坐标）
const { ipcRenderer } = require('electron');
const { LEGACY_SCALE_RATIO } = require('./core.js');
let _logToTerminal;
try { ({ logToTerminal: _logToTerminal } = require('../../api-utils.js')); } catch (_) { _logToTerminal = (lvl, msg) => console.log(`[${lvl}]`, msg); }

const WHEEL_ZOOM_STEP = 0.08;      // 每档滚轮的缩放比例
const DRAG_SAVE_DEBOUNCE_MS = 300;

class Live2DInteractionController {
    constructor() {
        this.model = null;
        this.app = null;
        this.config = null;
        this.stage = null;   // Live2DStage（可选，用于 notifyActivity）

        this.interactionWidth = 0;
        this.interactionHeight = 0;
        this.interactionX = 0;
        this.interactionY = 0;

        this.isDragging = false;
        this.isDraggingChat = false;
        this.dragOffset = { x: 0, y: 0 };
        this.chatDragOffset = { x: 0, y: 0 };

        this._scaleMin = 0.005;
        this._scaleMax = 4;
        this._saveTimer = null;
        this._listeners = [];   // [{target, type, handler, options}]
        // 口型参数 setter（Phase 4 由 lipsync 模块注入；默认直接写常见参数 ID）
        this._mouthSetter = null;
    }

    init(model, app, config = null, extras = {}) {
        this.model = model;
        this.app = app;
        this.config = config;
        this.stage = extras.stage || this.stage;

        // 缩放钳制范围基于初始应用缩放推导
        const s = model?.scale?.x || 0.1;
        this._scaleMin = s * 0.15;
        this._scaleMax = s * 8;

        this.updateInteractionArea();
        this._teardownListeners();
        this._setupPointerEvents();
        this._setupChatDrag();
        this._setupWindowEvents();
    }

    // ============ 交互区 ============

    updateInteractionArea() {
        if (!this.model) return;
        // 与旧实现一致：取模型中间 1/3 宽、70% 高作为可交互区（避免透明边缘拦截鼠标）
        this.interactionWidth = this.model.width / 3;
        this.interactionHeight = this.model.height * 0.7;
        this.interactionX = this.model.x + (this.model.width - this.interactionWidth) / 2;
        this.interactionY = this.model.y + (this.model.height - this.interactionHeight) / 2;
    }

    // client 坐标（CSS px）是否落在模型交互区
    isPointOverModel(clientX, clientY) {
        if (!this.model) return false;
        return clientX >= this.interactionX &&
            clientX <= this.interactionX + this.interactionWidth &&
            clientY >= this.interactionY &&
            clientY <= this.interactionY + this.interactionHeight;
    }

    // 模型交互区 或 聊天框（窗口穿透判定用；聊天框可见时悬停其上不能穿透）
    isPointOverInteractive(clientX, clientY) {
        if (this.isPointOverModel(clientX, clientY)) return true;
        const chat = document.getElementById('text-chat-container');
        if (chat && chat.style.display !== 'none' && chat.offsetParent !== null) {
            const r = chat.getBoundingClientRect();
            if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
                return true;
            }
        }
        return false;
    }

    // ============ 事件 ============

    _on(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        this._listeners.push({ target, type, handler, options });
    }

    _teardownListeners() {
        for (const { target, type, handler, options } of this._listeners) {
            try { target.removeEventListener(type, handler, options); } catch (_) {}
        }
        this._listeners = [];
    }

    _setupPointerEvents() {
        // 拖拽起点只认 canvas（DOM 浮层如聊天框/棋盘的点击不应拖动模型）
        const isCanvasTarget = (e) => e.target && e.target.tagName === 'CANVAS';

        this._on(window, 'pointerdown', (e) => {
            if (e.button !== 0) return;
            if (!isCanvasTarget(e)) return;
            if (!this.isPointOverModel(e.clientX, e.clientY)) return;
            this.isDragging = true;
            this.dragOffset.x = e.clientX - this.model.x;
            this.dragOffset.y = e.clientY - this.model.y;
            this._pressStart = { x: e.clientX, y: e.clientY, t: performance.now() };
            this._setPassthrough(false);
            this._notifyActivity();
        });

        this._on(window, 'pointermove', (e) => {
            if (!this.isDragging || !this.model) return;
            let newX = e.clientX - this.dragOffset.x;
            let newY = e.clientY - this.dragOffset.y;

            // 多屏限制（与旧实现一致）：左扩展模式下限制 x >= 0
            const extend = this.config?.ui?.screen_extend;
            if (extend?.extend && extend?.left && newX < 0) newX = 0;

            this.model.position.set(newX, newY);
            this.updateInteractionArea();
            this._notifyActivity();
        });

        this._on(window, 'pointerup', (e) => {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.saveModelPosition();

            // 点击判定：位移小且时间短 -> 触发 Tap 动作（旧实现因拖拽误触被整段禁用，
            // 这里用位移阈值解决误触问题后恢复该交互）
            const press = this._pressStart;
            this._pressStart = null;
            if (press) {
                const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
                const elapsed = performance.now() - press.t;
                if (moved < 6 && elapsed < 350) {
                    this._onModelTap();
                }
            }

            // 松手后若指针不在交互区上则恢复穿透
            setTimeout(() => {
                if (!this.isDragging && !this.isPointOverInteractive(e.clientX, e.clientY)) {
                    this._setPassthrough(true);
                }
            }, 100);
        });

        // 滚轮缩放：以鼠标位置为锚点（N.E.K.O 算法），只在模型交互区内生效
        this._on(window, 'wheel', (e) => {
            if (!this.model) return;
            if (!(e.target && e.target.tagName === 'CANVAS')) return;
            if (!this.isPointOverModel(e.clientX, e.clientY)) return;
            e.preventDefault();

            const absDelta = Math.abs(e.deltaY);
            const zoomStep = Math.min(absDelta / 1000, WHEEL_ZOOM_STEP);
            const factor = 1 + zoomStep;
            const oldScale = this.model.scale.x;
            let newScale = e.deltaY < 0 ? oldScale * factor : oldScale / factor;
            newScale = Math.max(this._scaleMin, Math.min(this._scaleMax, newScale));
            if (newScale === oldScale) return;

            // 锚点缩放：保持鼠标下的点不动
            const ratio = newScale / oldScale;
            this.model.x = e.clientX - (e.clientX - this.model.x) * ratio;
            this.model.y = e.clientY - (e.clientY - this.model.y) * ratio;
            this.model.scale.set(newScale);

            this.updateInteractionArea();
            this._scheduleSave();
            this._notifyActivity();
        }, { passive: false });

        this._on(window, 'pointercancel', () => {
            this.isDragging = false;
            this._pressStart = null;
        });
        this._on(window, 'blur', () => {
            this.isDragging = false;
            this._pressStart = null;
        });

        // 禁用右键菜单（与旧实现一致）
        this._on(window, 'contextmenu', (e) => {
            e.preventDefault();
            return false;
        });
    }

    // 聊天框拖拽（保持旧行为：按住聊天框背景/消息区可拖动聊天框）
    _setupChatDrag() {
        const chatContainer = document.getElementById('text-chat-container');
        if (!chatContainer) return;

        this._on(chatContainer, 'mousedown', (e) => {
            if (e.target === chatContainer || e.target.id === 'chat-messages') {
                this.isDraggingChat = true;
                const rect = chatContainer.getBoundingClientRect();
                this.chatDragOffset.x = e.clientX - rect.left;
                this.chatDragOffset.y = e.clientY - rect.top;
                e.preventDefault();
                this._setPassthrough(false);
            }
        });

        this._on(document, 'mousemove', (e) => {
            if (!this.isDraggingChat) return;
            chatContainer.style.setProperty('left', `${e.clientX - this.chatDragOffset.x}px`, 'important');
            chatContainer.style.setProperty('top', `${e.clientY - this.chatDragOffset.y}px`, 'important');
            chatContainer.style.setProperty('bottom', 'auto', 'important');
        });

        this._on(document, 'mouseup', (e) => {
            if (!this.isDraggingChat) return;
            this.isDraggingChat = false;
            setTimeout(() => {
                if (!this.isPointOverInteractive(e.clientX, e.clientY)) {
                    this._setPassthrough(true);
                }
            }, 100);
        });
    }

    _setupWindowEvents() {
        this._on(window, 'resize', () => {
            this.updateInteractionArea();
        });
    }

    _setPassthrough(ignore) {
        ipcRenderer.send('set-ignore-mouse-events', ignore
            ? { ignore: true, options: { forward: true } }
            : { ignore: false });
    }

    _notifyActivity() {
        if (this.stage && typeof this.stage.notifyActivity === 'function') {
            this.stage.notifyActivity();
        }
    }

    // 单击模型：播放随机 Tap 动作（若模型定义了对应动作组）
    _onModelTap() {
        const m = this.model;
        if (!m || !m.internalModel?.settings) return;
        try {
            const motions = m.internalModel.settings.motions || {};
            const group = ['Tap', 'TapBody', 'tap_body', 'Tap@Body'].find(
                g => Array.isArray(motions[g]) && motions[g].length > 0
            );
            if (group) {
                // 不传 index 时 pixi-live2d-display 会在组内随机挑选
                m.motion(group);
                this._notifyActivity();
            }
        } catch (_) {}
    }

    // ============ 口型 ============

    // Phase 4 的 lipsync 模块通过此方法接管口型写入
    setMouthSetter(fn) {
        this._mouthSetter = typeof fn === 'function' ? fn : null;
    }

    setMouthOpenY(v) {
        if (!this.model) return;
        v = Math.max(0, Math.min(Number(v) || 0, 3.0));
        if (this._mouthSetter) {
            this._mouthSetter(v);
            return;
        }
        // 基础实现：直接写常见嘴部参数（Phase 4 替换为缓存 index + override）
        try {
            const coreModel = this.model.internalModel?.coreModel;
            if (!coreModel || typeof coreModel.setParameterValueById !== 'function') return;
            try { coreModel.setParameterValueById('ParamMouthOpenY', v); } catch (_) {}
            try { coreModel.setParameterValueById('PARAM_MOUTH_OPEN_Y', v); } catch (_) {}
        } catch (_) {}
    }

    // ============ 变换持久化 ============

    // 兼容旧接口：变换已由 model-loader 应用，这里只刷新交互区
    setupInitialModelProperties() {
        this.updateInteractionArea();
    }

    _scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this.saveModelPosition();
        }, DRAG_SAVE_DEBOUNCE_MS);
    }

    saveModelPosition() {
        if (!this.model || !this.config) return;
        if (!this.config.ui?.model_position?.remember_position) return;

        const stageW = window.innerWidth || 1;
        const stageH = window.innerHeight || 1;
        const relativeX = this.model.x / stageW;
        const relativeY = this.model.y / stageH;
        const isDualRight = window.innerWidth > window.screen.width * 1.2 && this.config?.ui?.screen_extend?.right;
        // 存储用 legacy 语义（兼容 WebUI 直接读写 config.ui.model_scale）
        const legacyScale = this.model.scale.x * LEGACY_SCALE_RATIO;

        if (isDualRight) {
            this.config.ui.model_position.x_dual = relativeX;
            this.config.ui.model_position.y_dual = relativeY;
        } else {
            this.config.ui.model_position.x = relativeX;
            this.config.ui.model_position.y = relativeY;
        }
        this.config.ui.model_scale = legacyScale;

        ipcRenderer.send('save-model-position', {
            x: relativeX,
            y: relativeY,
            scale: legacyScale,
            dual: isDualRight,
            modelName: this._currentModelName()
        });

        console.log('[Live2DInteraction] 保存模型位置:', {
            rel: { x: relativeX.toFixed(4), y: relativeY.toFixed(4) },
            legacyScale: legacyScale.toFixed(4),
            dual: isDualRight
        });
    }

    _currentModelName() {
        try {
            const url = this.model?.internalModel?.settings?.url || '';
            const m = url.match(/2D\/([^\/]+)\//);
            return m ? decodeURIComponent(m[1]) : null;
        } catch (_) {
            return null;
        }
    }

    // 复位到默认位置与缩放（供 HTTP /reset-model-position）
    resetModelPosition() {
        if (!this.model) return { success: false };
        const isDualRight = window.innerWidth > window.screen.width * 1.2 && this.config?.ui?.screen_extend?.right;
        const relX = isDualRight ? 0.825 : 0.65;
        const relY = 0.38;
        const legacyScale = 0.65;

        this.model.x = relX * window.innerWidth;
        this.model.y = relY * window.innerHeight;
        this.model.scale.set(legacyScale / LEGACY_SCALE_RATIO);
        this.updateInteractionArea();

        ipcRenderer.send('save-model-position', {
            x: relX, y: relY, scale: legacyScale, dual: isDualRight,
            modelName: this._currentModelName()
        });
        return { success: true };
    }

    // 模型热切换时重绑定
    rebind(model) {
        this.model = model;
        const s = model?.scale?.x || 0.1;
        this._scaleMin = s * 0.15;
        this._scaleMax = s * 8;
        this.updateInteractionArea();
    }

    destroy() {
        this._teardownListeners();
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        this.model = null;
        this.app = null;
    }
}

module.exports = { Live2DInteractionController };
