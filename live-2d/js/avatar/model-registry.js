// model-registry.js - 四形态模型注册表（纯 fs 实现，主进程与渲染进程均可 require）
// 目录约定：
//   Live2D:   2D/<模型名>/**/*.model3.json
//   VRM:      3D/**/*.vrm            （Phase 7 启用）
//   MMD:      3D/mmd/<模型名>/**/*.pmx（Phase 8 启用）
//   PNGTuber: PNG/<模型名>/pngtuber.json（Phase 9 启用）
const fs = require('fs');
const path = require('path');

// live-2d 应用根目录（本文件位于 js/avatar/ 下）
const APP_ROOT = path.join(__dirname, '..', '..');

function toPosix(p) {
    return p.replace(/\\/g, '/');
}

function walkFiles(rootDir, matcher, results, relBase) {
    let items;
    try { items = fs.readdirSync(rootDir, { withFileTypes: true }); } catch (_) { return; }
    for (const it of items) {
        const abs = path.join(rootDir, it.name);
        const rel = relBase ? `${relBase}/${it.name}` : it.name;
        if (it.isDirectory()) {
            walkFiles(abs, matcher, results, rel);
        } else if (matcher(it.name)) {
            results.push(rel);
        }
    }
}

/**
 * 扫描 Live2D 模型
 * @returns {Array<{ name: string, dir: string, modelPath: string }>}
 *   name: 模型目录名（2D 下的一级目录）
 *   modelPath: 相对 live-2d 根的 posix 路径（可直接给 PIXI 加载）
 */
function scanLive2DModels() {
    const modelsDir = path.join(APP_ROOT, '2D');
    const files = [];
    walkFiles(modelsDir, (n) => n.endsWith('.model3.json'), files, '');
    // 一个模型目录可能包含多份 .model3.json（如主模型+配件），按目录名去重取第一份
    const byName = new Map();
    for (const rel of files) {
        const posix = toPosix(rel);
        const name = posix.split('/')[0];
        if (!byName.has(name)) {
            byName.set(name, {
                name,
                dir: `2D/${name}`,
                modelPath: `2D/${posix}`
            });
        }
    }
    return [...byName.values()];
}

/**
 * 解析启动/切换时要加载的 Live2D 模型
 * 优先级：preferredName（config.ui.live2d_model）> 字母序第一个
 * @returns {{ modelPath: string|null, entry: object|null, all: Array }}
 */
function resolveLive2DModel(preferredName) {
    const all = scanLive2DModels();
    if (all.length === 0) return { modelPath: null, entry: null, all };

    if (preferredName) {
        const hit = all.find(m => m.name === preferredName);
        if (hit) return { modelPath: hit.modelPath, entry: hit, all };
    }

    const sorted = [...all].sort((a, b) => a.modelPath.localeCompare(b.modelPath));
    return { modelPath: sorted[0].modelPath, entry: sorted[0], all };
}

/**
 * 扫描 VRM 模型：3D/**\/*.vrm（排除 3D/mmd/）
 * @returns {Array<{ name, modelPath }>} name = 文件名（不含扩展名）
 */
function scanVRMModels() {
    const dir = path.join(APP_ROOT, '3D');
    const files = [];
    walkFiles(dir, (n) => n.toLowerCase().endsWith('.vrm'), files, '');
    return files
        .map(toPosix)
        .filter(rel => !rel.toLowerCase().startsWith('mmd/'))
        .map(rel => ({
            name: rel.split('/').pop().replace(/\.vrm$/i, ''),
            modelPath: `3D/${rel}`
        }));
}

/**
 * 扫描 MMD 模型：3D/mmd/<模型名>/**\/*.pmx
 * @returns {Array<{ name, dir, modelPath }>}
 */
function scanMMDModels() {
    const dir = path.join(APP_ROOT, '3D', 'mmd');
    const files = [];
    walkFiles(dir, (n) => n.toLowerCase().endsWith('.pmx'), files, '');
    return files.map(toPosix).map(rel => {
        const name = rel.includes('/') ? rel.split('/')[0] : rel.replace(/\.pmx$/i, '');
        return {
            name,
            dir: `3D/mmd/${name}`,
            modelPath: `3D/mmd/${rel}`
        };
    });
}

/**
 * 扫描 PNGTuber 模型：PNG/<模型名>/pngtuber.json
 * @returns {Array<{ name, dir, configPath }>}
 */
function scanPNGTuberModels() {
    const dir = path.join(APP_ROOT, 'PNG');
    const results = [];
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return results; }
    for (const it of items) {
        if (!it.isDirectory()) continue;
        const cfg = path.join(dir, it.name, 'pngtuber.json');
        if (fs.existsSync(cfg)) {
            results.push({
                name: it.name,
                dir: `PNG/${it.name}`,
                configPath: `PNG/${it.name}/pngtuber.json`
            });
        }
    }
    return results;
}

module.exports = {
    APP_ROOT,
    scanLive2DModels, resolveLive2DModel,
    scanVRMModels, scanMMDModels, scanPNGTuberModels
};
