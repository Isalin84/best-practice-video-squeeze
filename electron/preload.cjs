const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('videoSqueeze', {
  pathForFile: (file) => webUtils.getPathForFile(file),
  openOutput: (filePath) => ipcRenderer.invoke('open-output', filePath),
  selectVideo: () => ipcRenderer.invoke('select-video'),
  chooseOutputFolder: () => ipcRenderer.invoke('choose-output-folder'),
  analyzeVideo: (filePath) => ipcRenderer.invoke('analyze-video', filePath),
  compressVideo: (payload) => ipcRenderer.invoke('compress-video', payload),
  cancelCompression: () => ipcRenderer.invoke('cancel-compression'),
  revealOutput: (filePath) => ipcRenderer.invoke('reveal-output', filePath),
  openStudio: () => ipcRenderer.invoke('open-studio'),
  getRuntimeInfo: () => ipcRenderer.invoke('get-runtime-info'),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('compression-progress', listener);
    return () => ipcRenderer.removeListener('compression-progress', listener);
  }
});
