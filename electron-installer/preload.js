const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('installer', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  inspectSystem: () => ipcRenderer.invoke('inspect-system'),
  start: components => ipcRenderer.invoke('start-install', components),
  onStatus: callback => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('install-status', handler);
    return () => ipcRenderer.removeListener('install-status', handler);
  }
});
