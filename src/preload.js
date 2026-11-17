const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog:     () => ipcRenderer.invoke('open-file-dialog'),
  readClipboardImage: () => ipcRenderer.invoke('read-clipboard-image'),
  saveBlurredImage:   (data) => ipcRenderer.invoke('save-blurred-image', data),
  copyToClipboard:    (data) => ipcRenderer.invoke('copy-to-clipboard', data),
  triggerSnip:        () => ipcRenderer.send('trigger-snip'),
  completeSnip:       (data) => ipcRenderer.send('snip-completed', data),
  cancelSnip:         () => ipcRenderer.send('snip-canceled'),
  onInitSnipImage:    (cb) => ipcRenderer.on('init-snip-image', (e, data) => cb(data)),
  onScreenshotLoaded: (cb) => ipcRenderer.on('screenshot-loaded', (e, data) => cb(data)),
  ocrRecognize:       (data) => ipcRenderer.invoke('ocr-recognize', data),
  ocrStatus:          () => ipcRenderer.invoke('ocr-status'),
  windowMinimize:     () => ipcRenderer.send('window-minimize'),
  windowMaximize:     () => ipcRenderer.send('window-maximize'),
  windowClose:        () => ipcRenderer.send('window-close'),
});
