// manager.js - VRM 管理器（v2，组合式架构）
// Adapted from Project-N-E-K-O/N.E.K.O (Apache-2.0): static/vrm-manager.js 的
// 组合式结构（manager 持有 adapter/interaction 子模块）、load token 竞态防护与 dispose 清理思路。
// 渲染路径沿用肥牛旧实现的"视口/裁剪局部渲染"（与 viewRect 拖拽/缩放/持久化联动）。
//
// v2 关键变更（相对 js/model/vrm-model-setup.js）：
//   - 支持 VRM 0.x 与 1.0（旧实现直接抛错拒绝 1.0）；1.0 模型自动转向面对相机
//   - 完整 dispose()：rAF 取消、VMC 停止、场景遍历释放 geometry/material/texture、
//     renderer.dispose + forceContextLoss（配合形态热切换不再需要整窗 reload）
//   - 渲染循环带异常保护，单帧异常不再冻结渲染进程
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const { GLTFLoader } = require('../../lib/gltf-loader-bundle.cjs');
const { VRMLoaderPlugin, VRMUtils } = require('@pixiv/three-vrm');
const { VRMModelAdapter } = require('./model-adapter.js');
const { logToTerminal } = require('../../api-utils.js');

const APP_ROOT = path.join(__dirname, '..', '..', '..');

class VRMManager {
    constructor() {
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.canvas = null;
        this.currentModel = null;   // VRMModelAdapter
        this.clock = null;
        this._animationFrameId = null;
        this._disposed = false;
        this._activeLoadToken = 0;
        this._frameErrorCount = 0;
    }

    // renderer 是否存活（供 setup 判断复用）
    isAlive() {
        return !!(this.renderer && !this._disposed);
    }

    initThreeJS(canvasId = 'vrm-canvas') {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`VRMManager: 找不到 canvas 元素 #${canvasId}`);
        }

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: false,   // 高 DPI 下抗锯齿开销过大（可能触发软件渲染时秒级帧耗时冻结主线程）
            premultipliedAlpha: false,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        // 钳制 pixelRatio：4K/300% 缩放环境下按 devicePixelRatio 全量渲染会拖死渲染进程
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        try {
            const gl = this.renderer.getContext();
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            const glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
            logToTerminal('info', `[VRMManager] WebGL渲染器: ${glRenderer}, pixelRatio=${this.renderer.getPixelRatio()}`);
        } catch (_) {}

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 1.0, 3.0);
        this.camera.lookAt(0, 1.0, 0);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1.0, 1.5, 1.0);
        this.scene.add(directionalLight);

        this.clock = new THREE.Clock();
        this._disposed = false;
    }

    /**
     * 加载 VRM 模型（支持 0.x 与 1.0）
     * @param {string} modelPath 相对 live-2d 根目录，如 "3D/Sample_A.vrm"
     * @param {object} options { gazeEnabled }
     * @returns {VRMModelAdapter}
     */
    async loadModel(modelPath, options = {}) {
        const token = ++this._activeLoadToken;
        const absPath = path.resolve(APP_ROOT, modelPath);
        if (!fs.existsSync(absPath)) {
            throw new Error(`VRM文件不存在: ${absPath}`);
        }

        const fileBuffer = fs.readFileSync(absPath);
        const arrayBuffer = fileBuffer.buffer.slice(
            fileBuffer.byteOffset,
            fileBuffer.byteOffset + fileBuffer.byteLength
        );
        logToTerminal('info', `[VRMManager] 加载 VRM: ${modelPath} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        const resourcePath = path.dirname(absPath) + path.sep;
        const gltf = await new Promise((resolve, reject) => {
            loader.parse(arrayBuffer, resourcePath, resolve, reject);
        });

        if (token !== this._activeLoadToken || this._disposed) {
            throw new Error('VRM 加载已被更新的请求取代');
        }

        const vrm = gltf.userData.vrm;
        if (!vrm) throw new Error('GLTF文件中未找到VRM数据');

        // 优化
        try {
            VRMUtils.removeUnnecessaryJoints(vrm.scene);
            if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(vrm.scene);
        } catch (e) {
            console.warn('[VRMManager] VRM 优化警告:', e.message);
        }
        vrm.scene.traverse((object) => { object.frustumCulled = false; });

        const metaVersion = String(vrm.meta?.metaVersion ?? '0');
        logToTerminal('info', `[VRMManager] VRM 规格版本: ${metaVersion}，表情: ${vrm.expressionManager ? Object.keys(vrm.expressionManager._expressionMap || {}).length : 0} 个`);

        // 卸载旧模型
        await this.removeModel();

        // 包裹 Group（朝向修正）：旧实现的轨道相机在 -Z 侧，VRM0 原生面向 -Z 可直接用；
        // VRM1 规格面向 +Z，旋转 180° 使其面对相机。
        const vrmGroup = new THREE.Group();
        vrmGroup.add(vrm.scene);
        if (metaVersion === '1') {
            vrmGroup.rotation.y = Math.PI;
        }
        this.scene.add(vrmGroup);

        const adapter = new VRMModelAdapter(vrm, this.scene, this.camera, this.renderer, this.canvas, options);
        adapter.vrmGroup = vrmGroup;
        adapter.setModelPath(modelPath);
        this.currentModel = adapter;
        return adapter;
    }

    async removeModel() {
        const adapter = this.currentModel;
        if (!adapter) return;
        this.currentModel = null;
        try { adapter.dispose(); } catch (_) {}
        try {
            if (adapter.vrmGroup) {
                this.scene.remove(adapter.vrmGroup);
                this._disposeObject3D(adapter.vrmGroup);
            }
            if (adapter.vrm && typeof VRMUtils.deepDispose === 'function') {
                VRMUtils.deepDispose(adapter.vrm.scene);
            }
        } catch (e) {
            console.warn('[VRMManager] 卸载模型警告:', e.message);
        }
    }

    // 启动渲染循环（视口/裁剪局部渲染，单帧异常保护）
    startLoop() {
        if (this._animationFrameId) return;
        this._disposed = false;
        if (this.clock) this.clock.getDelta(); // 丢弃挂起期间累计的 delta
        this.renderer.autoClear = false;
        let firstFrameLogged = false;
        const animate = () => {
            if (this._disposed) return;
            this._animationFrameId = requestAnimationFrame(animate);
            try {
                const model = this.currentModel;
                if (!model) return;
                const frameStart = performance.now();
                const delta = this.clock.getDelta();
                model.update(delta);

                this.renderer.setScissorTest(false);
                this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
                this.renderer.clear(true, true, true);

                const vr = model.viewRect;
                const vpY = window.innerHeight - vr.y - vr.height;
                this.renderer.setViewport(vr.x, vpY, vr.width, vr.height);
                this.renderer.setScissor(vr.x, vpY, vr.width, vr.height);
                this.renderer.setScissorTest(true);
                model.updateCameraOrbit();
                this.camera.aspect = vr.width / vr.height;
                this.camera.updateProjectionMatrix();
                this.renderer.render(this.scene, this.camera);
                this._frameErrorCount = 0;

                // 帧耗时观测：首帧 + 每 300 帧汇报一次均值（性能问题定位用）
                const cost = performance.now() - frameStart;
                this._frameCostSum = (this._frameCostSum || 0) + cost;
                this._frameCount = (this._frameCount || 0) + 1;
                if (!firstFrameLogged) {
                    firstFrameLogged = true;
                    const vr = model.viewRect;
                    logToTerminal('info', `[VRMManager] 首帧完成: ${cost.toFixed(1)}ms, viewRect=(${vr.x.toFixed(0)},${vr.y.toFixed(0)},${vr.width.toFixed(0)}x${vr.height.toFixed(0)})`);
                } else if (this._frameCount % 300 === 0) {
                    logToTerminal('info', `[VRMManager] 帧观测: 近300帧均值 ${(this._frameCostSum / 300).toFixed(2)}ms`);
                    this._frameCostSum = 0;
                }
            } catch (e) {
                // 单帧异常不冻结渲染进程；连续异常则停机避免刷屏
                this._frameErrorCount++;
                if (this._frameErrorCount <= 3) {
                    console.error('[VRMManager] 渲染帧异常:', e);
                } else if (this._frameErrorCount === 4) {
                    logToTerminal('error', `[VRMManager] 渲染循环连续异常，已停止: ${e.message}`);
                    this.stopLoop();
                }
            }
        };
        animate();
    }

    stopLoop() {
        if (this._animationFrameId) {
            cancelAnimationFrame(this._animationFrameId);
            this._animationFrameId = null;
        }
    }

    _disposeObject3D(root) {
        root.traverse((object) => {
            if (object.geometry) {
                try { object.geometry.dispose(); } catch (_) {}
            }
            if (object.material) {
                const mats = Array.isArray(object.material) ? object.material : [object.material];
                for (const m of mats) {
                    for (const key of Object.keys(m)) {
                        const v = m[key];
                        if (v && v.isTexture) {
                            try { v.dispose(); } catch (_) {}
                        }
                    }
                    try { m.dispose(); } catch (_) {}
                }
            }
        });
    }

    // 挂起（形态热切换用）：停循环、卸模型，但保留 renderer/scene/WebGL 上下文。
    // 不做 forceContextLoss —— 热切换中销毁上下文后立刻创建新上下文会在
    // ANGLE/D3D11 原生层冻结渲染进程（实测），保留上下文跨切换复用。
    async suspend() {
        this.stopLoop();
        await this.removeModel();
        try {
            // 清一帧为全透明，避免残影
            if (this.renderer) {
                this.renderer.setScissorTest(false);
                this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
                this.renderer.clear(true, true, true);
            }
        } catch (_) {}
        logToTerminal('info', '[VRMManager] 已挂起（保留渲染上下文）');
    }

    // 完整释放（仅应用退出/异常兜底；热切换请用 suspend）
    async dispose() {
        this._disposed = true;
        this.stopLoop();
        await this.removeModel();
        try {
            if (this.scene) {
                this.scene.clear();
            }
        } catch (_) {}
        try {
            if (this.renderer) {
                this.renderer.dispose();
                this.renderer.forceContextLoss();
            }
        } catch (e) {
            console.warn('[VRMManager] renderer 释放警告:', e.message);
        }
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.clock = null;
        logToTerminal('info', '[VRMManager] 已释放 Three.js 资源');
    }
}

module.exports = { VRMManager };
