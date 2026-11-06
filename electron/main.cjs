const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

let windowRef;

async function keyPath() {
  return path.join(app.getPath("userData"), "bharatstock-key.json");
}

async function readApiKey() {
  try {
    const raw = JSON.parse(await fs.readFile(await keyPath(), "utf8"));
    if (raw.encrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(raw.value, "base64"));
    }
    return String(raw.value || "");
  } catch {
    return "";
  }
}

async function writeApiKey(value) {
  const file = await keyPath();
  let payload;
  if (safeStorage.isEncryptionAvailable()) {
    payload = { encrypted: true, value: safeStorage.encryptString(value).toString("base64") };
  } else {
    payload = { encrypted: false, value };
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    title: "India Stock Screener",
    backgroundColor: "#0b1017",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (app.isPackaged) windowRef.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  else windowRef.loadURL("http://127.0.0.1:5173");
  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://bharatstockapi.com/")) shell.openExternal(url);
    return { action: "deny" };
  });
  windowRef.on("closed", () => { windowRef = null; });
}

ipcMain.handle("screener:get-cache", async () => {
  const { readCache } = await import("./market-data.mjs");
  return readCache(app.getPath("userData"));
});
ipcMain.handle("screener:has-key", async () => Boolean(await readApiKey()));
ipcMain.handle("screener:set-key", async (_event, value) => {
  const key = String(value || "").trim();
  if (key.length < 12) throw new Error("That API key looks too short.");
  await writeApiKey(key);
  return true;
});
ipcMain.handle("screener:sync", async (event) => {
  const apiKey = await readApiKey();
  const { syncScreener } = await import("./market-data.mjs");
  return syncScreener(apiKey, app.getPath("userData"), progress => {
    if (!event.sender.isDestroyed()) event.sender.send("screener:progress", progress);
  });
});
ipcMain.handle("screener:open-url", async (_event, url) => {
  if (url === "https://bharatstockapi.com/") await shell.openExternal(url);
});

app.whenReady().then(() => {
  app.setAppUserModelId("in.bharat.screener");
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
