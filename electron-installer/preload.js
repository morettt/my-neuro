const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('installer', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  // 本地版显卡检测接口，暂时停用：
  // inspectSystem: () => ipcRenderer.invoke('inspect-system'),
  getDefaultInstallDir: () => ipcRenderer.invoke('get-default-install-dir'),
  chooseInstallDir: currentDir => ipcRenderer.invoke('choose-install-dir', currentDir),
  start: components => ipcRenderer.invoke('start-install', components),
  onStatus: callback => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('install-status', handler);
    return () => ipcRenderer.removeListener('install-status', handler);
  }
});
