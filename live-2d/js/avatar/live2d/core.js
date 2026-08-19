// core.js - Live2D 渲染舞台（PIXI 7）
// Adapted from Project-N-E-K-O/N.E.K.O (Apache-2.0): static/live2d-core.js 的
// PIXI 初始化 / 分辨率策略 / Idle FPS Governor 思路。
//
// 坐标系约定（v2）：
//   舞台坐标 = CSS 像素（resolution + autoDensity 负责高清渲染），
//   不再使用旧实现的 "canvas 内部 2 倍尺寸" hack。
//   为兼容旧消费者（avatar-drop / http-server），window.canvasScaleFactor 恒为 1。
const { logToTerminal } = require('../../api-utils.js');

// 旧实现 canvas 为窗口 2 倍，config.ui.model_scale 的历史语义随之偏大 2 倍。
// 存储层（config/preferences）继续沿用旧语义，应用到模型时除以该系数。
const LEGACY_SCALE_RATIO = 2;

const DEFAULT_RENDER_RESOLUTION = 2; // 与旧实现 2 倍超采样画质对齐
const ACTIVE_FPS = 60;
const IDLE_FPS = 30;
const IDLE_TIMEOUT_MS = 8000;
const IDLE_CHECK_INTERVAL_MS = 2000;

class Live2DStage {
    constructor() {
        this.app = null;
        this.canvas = null;
        this._lastActivityAt = Date.now();
        this._idleTimer = null;
        this._resizeHandler = null;
        this._activeFps = ACTIVE_FPS;
        this._idleFps = IDLE_FPS;
        this._isIdle = false;
    }

    // 初始化 PIXI Application（挂到指定 canvas 上）
    // 注意：形态热切换时不销毁 PIXI/WebGL（destroy 上下文后立刻建 Three 上下文
    // 会在 ANGLE/D3D11 原生层死锁冻结渲染进程），切走用 suspend()，切回用 init() 复用。
    async init(canvasId = 'canvas', config = {}) {
        const { ipcRenderer } = require('electron');

        // 复用路径：app 仍存活时只需恢复 ticker 与尺寸
        if (this.app && this.app.renderer) {
            this.resume();
            return this.app;
        }

        let width = window.innerWidth;
        let height = window.innerHeight;
        try {
            const bounds = await ipcRenderer.invoke('get-window-bounds');
            if (bounds && Number.isFinite(bounds.width) && bounds.width > 0) {
                width = bounds.width;
                height = bounds.height;
            }
        } catch (_) { /* 回退到 window.innerWidth */ }

        const resolution = Number(config?.ui?.render_resolution) > 0
            ? Number(config.ui.render_resolution)
            : DEFAULT_RENDER_RESOLUTION;

        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Live2DStage: 找不到 canvas 元素 #${canvasId}`);
        }

        this.app = new PIXI.Application({
            view: this.canvas,
            autoStart: true,
            backgroundAlpha: 0,
            width,
            height,
            resolution,
            autoDensity: true
        });

        // 兼容旧全局：新坐标系下缩放因子恒为 1
        window.canvasScaleFactor = 1;
        window.actualWindowWidth = width;
        window.actualWindowHeight = height;

        this._resizeHandler = () => {
            if (!this.app || !this.app.renderer) return;
            const w = window.innerWidth;
            const h = window.innerHeight;
            this.app.renderer.resize(w, h);
            window.actualWindowWidth = w;
            window.actualWindowHeight = h;
        };
        window.addEventListener('resize', this._resizeHandler);

        const maxFps = Number(config?.ui?.max_fps);
        if (Number.isFinite(maxFps) && maxFps >= 15) {
            this._activeFps = maxFps;
            this._idleFps = Math.min(IDLE_FPS, maxFps);
        }
        this._startFpsGovernor();

        const diag = `[Live2DStage] 初始化完成: ${width}x${height} CSS px, resolution=${resolution}, maxFPS=${this._activeFps}`;
        console.log(diag);
        logToTerminal('info', diag);
        return this.app;
    }

    get width() {
        return this.app ? this.app.screen.width : window.innerWidth;
    }

    get height() {
        return this.app ? this.app.screen.height : window.innerHeight;
    }

    // 有任何交互/语音活动时调用：恢复满帧率
    notifyActivity() {
        this._lastActivityAt = Date.now();
        if (this._isIdle && this.app) {
            this.app.ticker.maxFPS = this._activeFps;
            this._isIdle = false;
        }
    }

    // Idle FPS Governor：静止一段时间后降帧省 CPU/GPU
    _startFpsGovernor() {
        if (!this.app) return;
        this.app.ticker.maxFPS = this._activeFps;
        this._idleTimer = setInterval(() => {
            if (!this.app) return;
            const idle = Date.now() - this._lastActivityAt > IDLE_TIMEOUT_MS;
            if (idle && !this._isIdle) {
                this.app.ticker.maxFPS = this._idleFps;
                this._isIdle = true;
            } else if (!idle && this._isIdle) {
                this.app.ticker.maxFPS = this._activeFps;
                this._isIdle = false;
            }
        }, IDLE_CHECK_INTERVAL_MS);
    }

    // 挂起舞台（形态切走时调用）：停 ticker、清空舞台，但保留 PIXI app 与 WebGL 上下文
    suspend() {
        if (!this.app) return;
        try {
            this.app.ticker.stop();
            if (this.app.stage) this.app.stage.removeChildren();
            this.app.renderer.clear();
        } catch (e) {
            console.warn('[Live2DStage] 挂起时出现警告:', e);
        }
    }

    // 恢复舞台（形态切回时调用）
    resume() {
        if (!this.app) return;
        try {
            const w = window.innerWidth;
            const h = window.innerHeight;
            this.app.renderer.resize(w, h);
            window.canvasScaleFactor = 1;
            window.actualWindowWidth = w;
            window.actualWindowHeight = h;
            this.app.ticker.start();
            this.notifyActivity();
        } catch (e) {
            console.warn('[Live2DStage] 恢复时出现警告:', e);
        }
    }

    // 彻底销毁（仅应用退出/异常兜底使用；热切换请用 suspend/resume）
    destroy() {
        if (this._idleTimer) {
            clearInterval(this._idleTimer);
            this._idleTimer = null;
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        if (this.app) {
            try {
                this.app.ticker.stop();
                if (this.app.stage) this.app.stage.removeChildren();
                this.app.destroy(false, { children: true, texture: true, baseTexture: true });
            } catch (e) {
                console.warn('[Live2DStage] 销毁 PIXI 应用时出现警告:', e);
            }
            this.app = null;
        }
        this.canvas = null;
    }
}

module.exports = { Live2DStage, LEGACY_SCALE_RATIO };
