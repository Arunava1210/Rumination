const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("screener", {
  load: () => ipcRenderer.invoke("screener:load"),
  refresh: () => ipcRenderer.invoke("screener:refresh"),
  onProgress: callback => ipcRenderer.on("screener:progress", (_event, value) => callback(value)),
  onHistoryReady: callback => ipcRenderer.on("screener:history-ready", (_event, value) => callback(value)),
  onHistoryError: callback => ipcRenderer.on("screener:history-error", (_event, value) => callback(value))
});
