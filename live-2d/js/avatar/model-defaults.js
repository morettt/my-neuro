// model-defaults.js - 从模型目录推导默认的“表情N / 动作N”配置（纯 fs 实现）
//
// 控制面板主进程（control-main.js）与桌宠情绪引擎（emotion-engine.js）共用这一份逻辑：
// 面板上点“表情3”会原样把键名发给桌宠，两端必须对同一模型生成完全一致的编号。
// 扫描规则与 webui/live2d_manager.py 的 _model_expression_files / _model_motion_groups 保持一致：
//   1) 先按 model3.json 的 FileReferences 顺序；
//   2) 再补充目录递归扫描到、但 model3 未引用的文件（按路径排序）。
// 文件路径一律是相对 model3.json 所在目录的 posix 路径（emotion_*.json 的既有约定）。
const fs = require('fs');
const path = require('path');
const { APP_ROOT, scanLive2DModels } = require('./model-registry.js');

const EMOTIONS = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮'];
const IDLE_PATTERN = /idle|待机|standby|breath/i;

function readJson(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function toPosix(p) {
    return String(p || '').replace(/\\/g, '/');
}

// 去重键：Windows 文件系统不区分大小写，模型里 model3 引用 hiyori_m01 而磁盘文件叫 Hiyori_m01 很常见，
// 若按原样比较会把同一个文件当成两个，面板上出现成对的重复动作/表情。
function fileKey(rel) {
    return toPosix(rel).toLowerCase();
}

function walk(root, suffix, out = []) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return out; }
    for (const entry of entries) {
        const abs = path.join(root, entry.name);
        if (entry.isDirectory()) walk(abs, suffix, out);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) out.push(abs);
    }
    return out;
}

/**
 * 模型目录上下文：目录、model3.json 所在目录（资源基准）、model3 内容。
 * 与桌宠实际加载的 model3 保持一致（同样取自 model-registry 的扫描结果）。
 */
function modelContext(modelName) {
    const modelDir = path.join(APP_ROOT, '2D', String(modelName || ''));
    const entry = modelName ? scanLive2DModels().find(item => item.name === modelName) : null;
    if (!entry) return { modelDir, assetBase: modelDir, model3: {}, exists: fs.existsSync(modelDir) };
    const model3Path = path.join(APP_ROOT, entry.modelPath);
    return { modelDir, assetBase: path.dirname(model3Path), model3: readJson(model3Path) || {}, exists: true };
}

function collectFiles(context, referenced, suffix) {
    const files = [];
    const seen = new Set();
    const add = file => {
        const rel = toPosix(file);
        if (!rel || seen.has(fileKey(rel))) return;
        seen.add(fileKey(rel));
        files.push(rel);
    };
    for (const file of referenced) add(file);
    for (const abs of walk(context.modelDir, suffix).sort()) add(path.relative(context.assetBase, abs));
    return files;
}

function expressionFilesOf(context) {
    const referenced = (context.model3?.FileReferences?.Expressions || [])
        .map(item => item?.File)
        .filter(Boolean);
    return collectFiles(context, referenced, '.exp3.json');
}

/** 模型的全部表情文件（有序、去重） */
function listExpressionFiles(modelName) {
    return expressionFilesOf(modelContext(modelName));
}

/** 模型可作为“动作N”候选的动作文件：优先 TapBody 组（含扫描到的非待机动作），否则全部动作 */
function motionFilesOf(context) {
    const groups = {};
    const seen = new Set();
    // 同一文件可以同时出现在 Idle 和 TapBody 组里，这里只在组内去重；seen 用于过滤扫描结果
    for (const [group, defs] of Object.entries(context.model3?.FileReferences?.Motions || {})) {
        if (!Array.isArray(defs)) continue;
        groups[group] = [];
        for (const item of defs) {
            const rel = toPosix(item?.File);
            if (!rel || groups[group].some(existing => fileKey(existing) === fileKey(rel))) continue;
            seen.add(fileKey(rel));
            groups[group].push(rel);
        }
    }
    for (const abs of walk(context.modelDir, '.motion3.json').sort()) {
        const rel = toPosix(path.relative(context.assetBase, abs));
        if (seen.has(fileKey(rel))) continue;
        seen.add(fileKey(rel));
        const group = IDLE_PATTERN.test(path.basename(rel)) ? 'Idle' : 'TapBody';
        (groups[group] ||= []).push(rel);
    }
    const tap = groups.TapBody || [];
    return tap.length ? tap : Object.values(groups).flat();
}

function listMotionFiles(modelName) {
    return motionFilesOf(modelContext(modelName));
}

function assetExists(context, relFile) {
    return fs.existsSync(path.join(context.assetBase, toPosix(relFile).split('/').join(path.sep)));
}

/**
 * 把既有配置与模型目录的实际文件对齐：
 *   - 丢弃磁盘上已不存在的文件引用（具名键因此变空时整键删除）；
 *   - 六情绪键始终存在；
 *   - 目录里有、但还没登记的文件，按空闲的最小编号补成 `${prefix}N`。
 * 既有编号不会被打乱，新文件只会追加。
 * boundIsListed：动作绑定到情绪后会从“未分类”移走，所以被情绪引用就算已登记；
 * 表情绑定后仍保留在可拖拽列表里，所以只有具名键才算登记。
 * @returns {{ config: object, changed: boolean }}
 */
function mergeCatalog(context, existing, files, prefix, boundIsListed) {
    const merged = {};
    let changed = false;
    for (const [key, value] of Object.entries(existing && typeof existing === 'object' ? existing : {})) {
        if (!Array.isArray(value)) continue;
        const kept = value.map(toPosix).filter(file => assetExists(context, file));
        if (kept.length !== value.length) changed = true;
        if (EMOTIONS.includes(key) || kept.length) merged[key] = kept;
    }
    for (const emotion of EMOTIONS) {
        if (!merged[emotion]) { merged[emotion] = []; changed = true; }
    }
    const listed = new Set(Object.entries(merged)
        .filter(([key]) => boundIsListed || !EMOTIONS.includes(key))
        .flatMap(([, value]) => value)
        .map(fileKey));
    let index = 1;
    for (const file of files) {
        if (listed.has(fileKey(file))) continue;
        while (merged[`${prefix}${index}`]) index++;
        merged[`${prefix}${index}`] = [file];
        listed.add(fileKey(file));
        changed = true;
    }
    return { config: merged, changed };
}

function mergeExpressionConfig(modelName, existing) {
    const context = modelContext(modelName);
    return mergeCatalog(context, existing, expressionFilesOf(context), '表情', false);
}

function mergeActionConfig(modelName, existing) {
    const context = modelContext(modelName);
    return mergeCatalog(context, existing, motionFilesOf(context), '动作', true);
}

/** 该名字是否对应 2D 下的一个真实模型目录 */
function isLive2DModelDir(modelName) {
    return modelContext(modelName).exists;
}

module.exports = {
    EMOTIONS,
    listExpressionFiles,
    listMotionFiles,
    mergeExpressionConfig,
    mergeActionConfig,
    isLive2DModelDir
};
