// preferences-store.js - 按模型持久化位置/缩放偏好（主进程与渲染进程均可 require）
// 存储文件: live-2d/model-preferences.json
// 结构: { "<type>:<name>": { position: {x,y,x_dual,y_dual}, scale } }
//   type: live2d | vrm | mmd | pngtuber
//   scale 使用 legacy 语义（与 config.ui.model_scale 一致）
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', '..', 'model-preferences.json');

function _readStore() {
    try {
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    } catch (_) {
        return {};
    }
}

function _writeStore(store) {
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[PreferencesStore] 写入失败:', e);
        return false;
    }
}

function _key(type, name) {
    return `${type}:${name}`;
}

/** 读取某模型的偏好；无记录返回 null */
function getModelPrefs(type, name) {
    if (!name) return null;
    const store = _readStore();
    const entry = store[_key(type, name)];
    return entry && typeof entry === 'object' ? entry : null;
}

/** 合并写入某模型的偏好（position/scale 局部更新） */
function saveModelPrefs(type, name, prefs) {
    if (!name || !prefs) return false;
    const store = _readStore();
    const key = _key(type, name);
    const prev = store[key] && typeof store[key] === 'object' ? store[key] : {};
    const next = { ...prev };
    if (prefs.position && typeof prefs.position === 'object') {
        next.position = { ...(prev.position || {}), ...prefs.position };
    }
    if (Number.isFinite(Number(prefs.scale)) && Number(prefs.scale) > 0) {
        next.scale = Number(prefs.scale);
    }
    store[key] = next;
    return _writeStore(store);
}

module.exports = { STORE_PATH, getModelPrefs, saveModelPrefs };
