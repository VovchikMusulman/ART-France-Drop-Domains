const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('artfrance', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  loginSemrush: (options) => ipcRenderer.invoke('semrush:login', options || {}),
  logoutSemrush: () => ipcRenderer.invoke('semrush:logout'),
  startJob: (options) => ipcRenderer.invoke('job:start', options),
  stopJob: () => ipcRenderer.invoke('job:stop'),
  exportCsv: (payload) => ipcRenderer.invoke('export:csv', payload),
  pickResultsDir: () => ipcRenderer.invoke('dialog:pickResultsDir'),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  lookupCheckTrust: (payload) => ipcRenderer.invoke('checktrust:lookup', payload),
  startCapture: (options) => ipcRenderer.invoke('capture:start', options),
  stopCapture: () => ipcRenderer.invoke('capture:stop'),
  onProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('job:progress', listener);
    return () => ipcRenderer.removeListener('job:progress', listener);
  },
  onLog: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('job:log', listener);
    return () => ipcRenderer.removeListener('job:log', listener);
  },
  onCaptureProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('capture:progress', listener);
    return () => ipcRenderer.removeListener('capture:progress', listener);
  },
  onCaptureLog: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('capture:log', listener);
    return () => ipcRenderer.removeListener('capture:log', listener);
  },
});
