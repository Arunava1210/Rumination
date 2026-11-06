const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

let mainWindow = null;
let engine = null;
const smokeMode = process.env.BHARAT_SCREENER_SMOKE === "1";

async function createEngine() {
  const { ScreenerDataEngine } = await import("./data-engine.mjs");
  engine = new ScreenerDataEngine(app.getPath("userData"), {
    onProgress: value => mainWindow?.webContents.send("screener:progress", value),
    onHistoryReady: value => mainWindow?.webContents.send("screener:history-ready", value),
    onHistoryError: value => mainWindow?.webContents.send("screener:history-error", value)
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 1050,
    minHeight: 620,
    backgroundColor: "#f4f6f9",
    title: "India Stock Screener",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (app.isPackaged) mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  else mainWindow.loadURL("http://127.0.0.1:5173");

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("closed", () => { mainWindow = null; });
}

ipcMain.handle("screener:load", async () => {
  if (smokeMode) return { rows: [], dataDate: null, reportDate: null, allTimeReady: false, note: "Build smoke test" };
  if (!engine) await createEngine();
  return engine.load();
});

ipcMain.handle("screener:refresh", async () => {
  if (smokeMode) return { rows: [], dataDate: null, reportDate: null, allTimeReady: false, note: "Build smoke test" };
  if (!engine) await createEngine();
  return engine.refresh();
});

app.whenReady().then(() => {
  app.setAppUserModelId("in.bharatscreener.desktop");
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
