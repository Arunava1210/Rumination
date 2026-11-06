const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("screener", {
  getCache: () => ipcRenderer.invoke("screener:get-cache"),
  hasKey: () => ipcRenderer.invoke("screener:has-key"),
  setKey: key => ipcRenderer.invoke("screener:set-key", key),
  sync: () => ipcRenderer.invoke("screener:sync"),
  openUrl: url => ipcRenderer.invoke("screener:open-url", url),
  onProgress: callback => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on("screener:progress", handler);
    return () => ipcRenderer.removeListener("screener:progress", handler);
  }
});
