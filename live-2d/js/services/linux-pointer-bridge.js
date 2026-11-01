const { ipcRenderer } = require('electron');

ipcRenderer.on('linux-pointer-position', (_event, point) => {
    if (!Number.isFinite(point?.clientX) || !Number.isFinite(point?.clientY)) return;
    global.uiController?.updateMouseIgnore?.(point);
    const model = global.avatarFacade?.getModel?.() || global.currentModel;
    if (model?._clickThrough && model.setHoverTransparent && model.isPointOverModel) {
        model.setHoverTransparent(model.isPointOverModel(point.clientX, point.clientY));
    }
    if (model?._gazeEnabled !== false) model?.setMousePosition?.(point.clientX, point.clientY);
});
