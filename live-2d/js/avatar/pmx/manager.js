const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const THREE = require('three');
const { MMDLoader } = require('../../lib/mmd-loader.cjs');
const { MMDParser } = require('../../lib/mmd-parser.cjs');
const { VRMManager } = require('../vrm/manager');
const { PMXModelAdapter } = require('./model-adapter');
const { createPMXMaterials } = require('./materials');
const { OutlineEffect } = require('../../lib/outline-effect.cjs');
const { logToTerminal } = require('../../api-utils');

const APP_ROOT = path.resolve(__dirname, '../../..');

class PMXManager extends VRMManager {
    initThreeJS(canvasId = 'mmd-canvas') {
        super.initThreeJS(canvasId, { antialias: true, pixelRatioLimit: 2 });
        this.outline = new OutlineEffect(this.renderer);
        this.outline.autoClear = false;
        // PMX faces the camera at -Z after the orientation correction. The
        // inherited VRM light at +Z leaves the face in the dim ambient light.
        for (const light of this.scene.children) {
            if (light.isAmbientLight) light.intensity = 0.85;
            if (light.isDirectionalLight) {
                light.position.set(-2, 2.5, -3);
                light.intensity = 3.4;
            }
        }
    }

    async loadModel(modelPath, options = {}) {
        const token = ++this._activeLoadToken;
        const absolute = path.resolve(APP_ROOT, modelPath);
        const bytes = fs.readFileSync(absolute);
        const data = new MMDParser.Parser().parsePmx(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true
        );
        let mesh;
        try {
            await new Promise((resolve, reject) => {
                const loading = new THREE.LoadingManager();
                let failure = null;
                loading.onError = url => { failure = new Error(`PMX 贴图加载失败: ${url}`); };
                loading.onLoad = () => failure ? reject(failure) : resolve();
                // Keep the manager pending even for models without textures.
                loading.itemStart('pmx-build');
                try {
                    const loader = new MMDLoader(loading);
                    const resourcePath = pathToFileURL(path.dirname(absolute) + path.sep).href;
                    mesh = loader.meshBuilder.build(data, resourcePath);
                } catch (error) { failure = error; }
                loading.itemEnd('pmx-build');
            });
            if (token !== this._activeLoadToken || this._disposed) throw new Error('PMX 加载已取消');
            mesh.material = createPMXMaterials(mesh.material, this.renderer);
            mesh.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(mesh);
            const size = box.getSize(new THREE.Vector3());
            if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('PMX 模型尺寸无效');
            const scale = 1.6 / size.y;
            const center = box.getCenter(new THREE.Vector3());
            mesh.scale.setScalar(scale);
            mesh.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
            mesh.frustumCulled = false;
            const group = new THREE.Group();
            group.add(mesh);
            group.rotation.y = Math.PI;
            const adapter = new PMXModelAdapter(mesh, this.scene, this.camera, this.renderer, this.canvas, options);
            adapter.vrmGroup = group;
            adapter.setModelPath(modelPath);
            await this.removeModel();
            this.scene.add(group);
            this.currentModel = adapter;
            if (!adapter.mouthAvailable) logToTerminal('warn', '[PMX] 模型缺少开口表情（あ/mouthOpen），无法驱动口型');
            logToTerminal('info', `[PMX] 已加载 ${modelPath}，口型: ${adapter.mouthAvailable ? '可用' : '不可用'}`);
            return adapter;
        } catch (error) {
            if (mesh) this._disposeObject3D(mesh);
            throw error;
        }
    }

    renderScene() {
        this.outline.render(this.scene, this.camera);
    }

    async removeModel() {
        const model = this.currentModel;
        this.currentModel = null;
        if (!model) return;
        model.dispose();
        this.scene.remove(model.vrmGroup);
        this._disposeObject3D(model.vrmGroup);
    }
}

module.exports = { PMXManager };
