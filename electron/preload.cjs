const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bharat", {
  getSymbols: (refresh = false) => ipcRenderer.invoke("market:get-symbols", { refresh }),
  getCandles: request => ipcRenderer.invoke("market:get-candles", request),
  getDailyHistory: request => ipcRenderer.invoke("market:get-candles", { ...request, interval: "1D", range: "5Y" })
});
