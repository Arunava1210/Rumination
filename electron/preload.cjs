const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bharat", {
  getSymbols: (refresh = false) => ipcRenderer.invoke("market:get-symbols", { refresh }),
  getCandles: (request) => ipcRenderer.invoke("market:get-candles", request)
});
