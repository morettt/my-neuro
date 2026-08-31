// model-loader.js - Live2D 模型加载器
// Adapted from Project-N-E-K-O/N.E.K.O (Apache-2.0): static/live2d-model.js 的
// loadModel 加载锁 / load token / 失败回退 / 资源销毁 思路。
const { logToTerminal } = require('../../api-utils.js');
const { LEGACY_SCALE_RATIO } = require('./core.js');

class Live2DModelLoader {
    constructor(stage) {
        this.stage = stage;          // Live2DStage 实例
        this.currentModel = null;
        this.currentModelPath = null;
        this._isLoading = false;
        this._loadToken = 0;
        // 模型加载/卸载后的通知（供 facade 更新 global 引用等）
        this.onModelLoaded = null;   // (model, modelPath) => void
        this.onModelRemoved = null;  // () => void
    }

    isLoading() {
        return this._isLoading;
    }

    /**
     * 加载 Live2D 模型（带加载锁与并发 token）
     * @param {string} modelPath 相对 live-2d 目录的路径，如 "2D/肥牛/肥牛.model3.json"
     * @param {object} options { config, preferences, fallbackPath, notifyLoaded }
     *   - config: 全局 config（读取 ui.model_scale / ui.model_position 作为回退）
     *   - preferences: 该模型的持久化偏好 { position: {x,y,x_dual,y_dual}, scale }（legacy 语义）
     *   - fallbackPath: 加载失败时回退的模型路径
     */
    async loadModel(modelPath, options = {}) {
        if (this._isLoading) {
            throw new Error(`模型正在加载中，忽略重复请求: ${modelPath}`);
        }
        this._isLoading = true;
        const token = ++this._loadToken;
        const previousModel = this.currentModel;
        const previousModelPath = this.currentModelPath;
        let candidate = null;

        try {
            console.log(`[Live2DLoader] 开始加载模型: ${modelPath}`);
            logToTerminal('info', `[Live2DLoader] 开始加载模型: ${modelPath}`);

            candidate = await PIXI.live2d.Live2DModel.from(modelPath, { autoFocus: false, autoInteract: false });

            // token 过期（加载期间被新的加载请求取代）则丢弃本次结果
            if (token !== this._loadToken) {
                await this._destroyModel(candidate);
                candidate = null;
                throw new Error('模型加载已被更新的请求取代');
            }

            this.stage.app.stage.addChild(candidate);
            this.currentModel = candidate;
            this.currentModelPath = modelPath;

            this._applyTransform(candidate, options);

            const showModel = options.config?.ui?.show_model !== false;
            candidate.visible = showModel;

            if (options.notifyLoaded !== false && typeof this.onModelLoaded === 'function') {
                await this.onModelLoaded(candidate, modelPath);
            }

            // Keep the old model alive until loading and renderer-side wiring
            // have succeeded. Replacing it here makes hot-switch failures
            // recoverable instead of leaving an empty stage.
            if (previousModel && previousModel !== candidate) {
                await this._destroyModel(previousModel);
            }

            console.log(`[Live2DLoader] 模型加载完成: ${modelPath}, 位置(${candidate.x.toFixed(0)}, ${candidate.y.toFixed(0)}), 缩放${candidate.scale.x.toFixed(3)}, 可见=${showModel}`);
            logToTerminal('info', `[Live2DLoader] 模型加载完成: ${modelPath}`);
            return candidate;
        } catch (error) {
            const failedCandidate = candidate;
            if (candidate) {
                await this._destroyModel(candidate);
                candidate = null;
            }
            if (this.currentModel === failedCandidate ||
                this.currentModel === previousModel ||
                this.currentModel === null) {
                this.currentModel = previousModel;
                this.currentModelPath = previousModelPath;
            }

            console.error(`[Live2DLoader] 模型加载失败: ${modelPath}`, error);
            logToTerminal('error', `[Live2DLoader] 模型加载失败: ${modelPath} - ${error.message}`);

            // 失败回退：加载 fallbackPath（只回退一次，避免死循环）
            const fallback = options.fallbackPath;
            if (fallback && fallback !== modelPath) {
                console.warn(`[Live2DLoader] 回退到默认模型: ${fallback}`);
                this._isLoading = false;
                return this.loadModel(fallback, { ...options, fallbackPath: null });
            }
            throw error;
        } finally {
            this._isLoading = false;
        }
    }

    async _destroyModel(model) {
        if (!model) return;
        try {
            if (model.parent) model.parent.removeChild(model);
            model.destroy({ children: true, texture: true, baseTexture: true });
        } catch (e) {
            console.warn('[Live2DLoader] 卸载模型时出现警告:', e);
        }
    }

    // 应用初始位置与缩放（CSS 像素坐标系；存储值为 legacy 语义，除以 LEGACY_SCALE_RATIO）
    _applyTransform(model, options = {}) {
        const config = options.config || {};
        const prefs = options.preferences || null;

        const stageW = this.stage.width;
        const stageH = this.stage.height;

        // 缩放：优先 per-model 偏好，回退全局 config
        const legacyScale = Number(prefs?.scale) > 0
            ? Number(prefs.scale)
            : (Number(config.ui?.model_scale) > 0 ? Number(config.ui.model_scale) : 0.24);
        model.scale.set(legacyScale / LEGACY_SCALE_RATIO);

        // 位置：0~1 相对值（与旧实现语义一致），双屏右扩展时用 x_dual/y_dual
        const isDualRight = window.innerWidth > window.screen.width * 1.2 && config.ui?.screen_extend?.right !== false;
        const pos = prefs?.position || config.ui?.model_position || {};
        const relX = isDualRight ? (pos.x_dual ?? 0.825) : (pos.x ?? 0.65);
        const relY = isDualRight ? (pos.y_dual ?? 0.38) : (pos.y ?? 0.38);
        model.x = relX * stageW;
        model.y = relY * stageH;

        const diag = `[Live2DLoader] transform: stage=${stageW}x${stageH}, rel=(${relX.toFixed(3)}, ${relY.toFixed(3)}), legacyScale=${legacyScale.toFixed(4)}, appliedScale=${(legacyScale / LEGACY_SCALE_RATIO).toFixed(4)}, dual=${isDualRight}`;
        console.log(diag);
        logToTerminal('info', diag);
    }

    // 卸载当前模型并释放纹理
    async removeModel() {
        if (!this.currentModel) return;
        const model = this.currentModel;
        this.currentModel = null;
        this.currentModelPath = null;
        await this._destroyModel(model);
        if (typeof this.onModelRemoved === 'function') {
            try { this.onModelRemoved(); } catch (_) {}
        }
    }
}

module.exports = { Live2DModelLoader };
