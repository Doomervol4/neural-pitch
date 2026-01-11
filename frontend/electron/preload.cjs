const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    startDrag: (filePath) => ipcRenderer.invoke('start-drag', filePath)
});
