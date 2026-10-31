const { ipcRenderer } = require('electron');
const { fitViewRect } = require('../platform/window-layout');

const { nativeWayland } = ipcRenderer.sendSync('get-window-mode-sync') || {};
if (nativeWayland) {
    window.__nativeWayland = true;
    document.body.classList.add('native-wayland');
    const toolbar = document.createElement('div');
    toolbar.id = 'native-window-toolbar';
    toolbar.innerHTML = '<span class="native-window-grip" title="拖动此处移动桌宠窗口">⋮⋮ 桌宠</span>'
        + '<button type="button" data-action="fit" title="将模型居中并适应窗口">居中</button>'
        + '<button type="button" data-action="minimize" title="最小化">−</button>'
        + '<button type="button" data-action="close" title="关闭桌宠">×</button>';
    document.body.appendChild(toolbar);
    toolbar.addEventListener('click', event => {
        const action = event.target.closest('button')?.dataset.action;
        if (!action) return;
        if (action !== 'fit') { ipcRenderer.send('native-window-action', action); return; }
        const facade = global.avatarFacade;
        const model = facade?.getModel?.();
        const controller = facade?.getController?.();
        if (model?.viewRect && model._screenHitBox) {
            const fitted = fitViewRect(model.viewRect, model._screenHitBox, innerWidth, innerHeight);
            if (fitted) { model.viewRect = fitted; controller?.saveModelPosition?.(); }
        } else if (model?.scale?.set && model.width > 0 && model.height > 0) {
            const factor = Math.min((innerWidth - 100) / model.width, (innerHeight - 140) / model.height);
            model.scale.set(model.scale.x * factor);
            model.x = (innerWidth - model.width) / 2;
            model.y = (innerHeight - model.height) / 2 + 24;
            controller?.updateInteractionArea?.();
            controller?.saveModelPosition?.();
        }
    });
    // A native client cannot recover input after ignoring the whole surface:
    // there is no global cursor location. Keep this small surface interactive.
    const clickThrough = document.getElementById('btn-click-through');
    if (clickThrough) {
        clickThrough.hidden = true;
        clickThrough.title = '原生 Wayland 窗口保持鼠标交互';
    }
}
