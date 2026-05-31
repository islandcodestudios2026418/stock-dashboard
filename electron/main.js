const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

let mainWindow;
let nextProcess;
const PORT = 3000;
const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Stock Dashboard",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on("closed", () => { mainWindow = null; });
}

function startNext() {
  const cmd = isDev ? "npm" : "npm";
  const args = isDev ? ["run", "dev"] : ["run", "start"];
  nextProcess = spawn(cmd, args, { cwd: path.join(__dirname, ".."), shell: true, env: { ...process.env, PORT: String(PORT) } });
  nextProcess.stdout?.on("data", (d) => process.stdout.write(d));
  nextProcess.stderr?.on("data", (d) => process.stderr.write(d));
}

function waitForServer(retries = 30) {
  const http = require("http");
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(`http://localhost:${PORT}`, () => resolve(undefined)).on("error", () => {
        if (--retries <= 0) return reject(new Error("Next.js 啟動逾時"));
        setTimeout(check, 1000);
      });
    };
    check();
  });
}

app.whenReady().then(async () => {
  startNext();
  await waitForServer();
  createWindow();
});

app.on("window-all-closed", () => {
  if (nextProcess) nextProcess.kill();
  app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
});
