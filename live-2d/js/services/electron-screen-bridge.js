// electron-screen-bridge.js
// 为渲染端提供 window.electronScreen 桥接，供跨屏逻辑查询显示器 / 重定位窗口。
//
// 本应用使用 nodeIntegration:true / contextIsolation:false，没有 preload，所以这里直接把对象挂到
// window 上即可，渲染端的跨屏逻辑（model-interaction.js / vrm-model-interaction.js）通过它调用主进程。
const { ipcRenderer } = require('electron');

window.electronScreen = {
    getAllDisplays: () => ipcRenderer.invoke('get-all-displays'),
    getCurrentDisplay: () => ipcRenderer.invoke('get-current-display'),
    moveWindowToDisplay: (screenX, screenY) => ipcRenderer.invoke('move-window-to-display', screenX, screenY),
    getPrimaryDisplayInfo: () => ipcRenderer.invoke('get-primary-display-info'),
};

// 缓存当前显示器信息（供需要同步读取的逻辑使用）
window.__petCurrentDisplay = null;
function refreshCurrentDisplay() {
    return window.electronScreen.getCurrentDisplay()
        .then((d) => { window.__petCurrentDisplay = d; return d; })
        .catch(() => null);
}
refreshCurrentDisplay();

// 跨屏重定位后：主进程 setBounds 把窗口移到新屏并广播 'display-changed'。
// 窗口尺寸变化会触发原生 resize 事件（各模型的 resize 处理器据此重建渲染缓冲区）；
// 这里额外把 canvas 的 CSS 尺寸 / 全局尺寸刷新到新屏，避免 2x canvas 的 CSS 尺寸停留在旧屏导致拉伸。
ipcRenderer.on('display-changed', (event, info) => {
    console.log('[electron-screen-bridge] display-changed:', info);
    if (info && info.bounds) {
        window.__petCurrentDisplay = {
            id: info.displayId,
            screenX: info.bounds.x,
            screenY: info.bounds.y,
            width: info.bounds.width,
            height: info.bounds.height,
            scaleFactor: info.scaleFactor,
        };
    }
    // 等窗口实际 resize 落地后再刷新 CSS / 全局尺寸（两帧：一帧给 setBounds，一帧给 resize 事件）
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            window.actualWindowWidth = w;
            window.actualWindowHeight = h;
            const canvas = document.getElementById('canvas');
            if (canvas) {
                canvas.style.width = w + 'px';
                canvas.style.height = h + 'px';
            }
            // 再触发一次 resize，确保各模型 resize 处理器以新屏尺寸重建缓冲区
            window.dispatchEvent(new Event('resize'));
            refreshCurrentDisplay();
        });
    });
});

module.exports = {};
