/**
 * Electron shell of the desktop app.
 *
 * The whole application is the Next.js server (`.next/standalone/server.js`),
 * started here in a utility process — Electron's own Node.js, so `node:sqlite`
 * and the rest of the server run unchanged — and listening only on 127.0.0.1.
 * The window is a plain browser pointed at it.
 *
 * Layout of a packaged app (see scripts/desktop/build.ts):
 *   resources/server/      standalone server + .next/static + public + data + drizzle
 *   resources/toolchain/   Windows only: w64devkit GCC for compiling C++
 */
import { existsSync, mkdirSync, renameSync, statSync, createWriteStream, type WriteStream } from "node:fs";
import net from "node:net";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeTheme, shell, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from "electron";

const APP_TITLE = "GESP 备考助手";
/** Fixed so that localStorage (code drafts are kept there) survives restarts; it is per origin, port included. */
const PREFERRED_PORT = 47_831;
const isMac = process.platform === "darwin";

// One copy at a time: a second launch focuses the first window instead of
// starting another server on the same database.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let server: UtilityProcess | null = null;
let serverLog: WriteStream | null = null;
let mainWindow: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let baseUrl = "";
let quitting = false;

// ───────────────────────── paths ─────────────────────────

/** Packaged: inside resources/. Development (`bun run desktop:dev`): dist-desktop/. */
const resourceDir = () => (app.isPackaged ? process.resourcesPath : path.join(__dirname, ".."));
const serverDir = () => path.join(resourceDir(), "server");
const toolchainDir = () => path.join(resourceDir(), "toolchain", "w64devkit");
const dataDir = () => app.getPath("userData");
const logDir = () => path.join(dataDir(), "logs");
const logFile = () => path.join(logDir(), "server.log");

function openLog() {
  mkdirSync(logDir(), { recursive: true });
  // Keep one previous run around; start fresh when the log grows large.
  if (existsSync(logFile()) && statSync(logFile()).size > 2 * 1024 * 1024) renameSync(logFile(), `${logFile()}.old`);
  serverLog = createWriteStream(logFile(), { flags: "a" });
  serverLog.write(`\n──── ${new Date().toISOString()} · v${app.getVersion()} · ${process.platform}-${process.arch} ────\n`);
}

// ───────────────────────── server ─────────────────────────

function portFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function randomPort() {
  return new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Only what the server needs; nothing from a developer's shell leaks in (DATABASE_URL, SETTINGS_SECRET, …). */
function serverEnv(port: number): Record<string, string> {
  const keep = ["PATH", "Path", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR", "SystemRoot", "SystemDrive", "windir", "ComSpec", "PUBLIC", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"];
  const env: Record<string, string> = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k]!;
  Object.assign(env, {
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NEXT_TELEMETRY_DISABLED: "1",
    GESP_DESKTOP: "1",
    GESP_AUTO_BACKUP: "1",
    GESP_DB_PATH: path.join(dataDir(), "gesp.db"),
    JUDGE_PROVIDER: "local",
  });
  if (existsSync(toolchainDir())) env.GESP_TOOLCHAIN_DIR = toolchainDir();
  return env;
}

async function startServer() {
  const entry = path.join(serverDir(), "server.js");
  if (!existsSync(entry)) throw new Error(`程序文件不完整：找不到 ${entry}`);

  const port = (await portFree(PREFERRED_PORT)) ? PREFERRED_PORT : await randomPort();
  baseUrl = `http://127.0.0.1:${port}`;
  openLog();

  server = utilityProcess.fork(entry, [], {
    cwd: serverDir(),
    env: serverEnv(port),
    stdio: "pipe",
    serviceName: "GESP Server",
  });
  server.stdout?.on("data", (d) => serverLog?.write(d));
  server.stderr?.on("data", (d) => serverLog?.write(d));
  server.on("exit", (code) => {
    serverLog?.write(`server exited with code ${code}\n`);
    server = null;
    if (!quitting) void serverCrashed(code);
  });
}

/** Polls the readiness probe; the first hit also migrates and seeds the database. */
async function waitForServer(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (!server) throw new Error("服务进程意外退出");
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(30_000) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && body?.ok) return;
      lastError = body?.error ?? `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`服务启动超时：${lastError}`);
}

async function serverCrashed(code: number | null) {
  const { response } = await dialog.showMessageBox({
    type: "error",
    title: APP_TITLE,
    message: "后台服务意外停止",
    detail: `退出码 ${code}。日志：${logFile()}`,
    buttons: ["重新启动", "打开日志", "退出"],
    defaultId: 0,
  });
  if (response === 0) {
    app.relaunch();
    app.exit(0);
  } else if (response === 1) {
    await shell.openPath(logFile());
    app.exit(1);
  } else {
    app.exit(1);
  }
}

function stopServer() {
  quitting = true;
  server?.kill();
  server = null;
  serverLog?.end();
}

// ───────────────────────── windows ─────────────────────────

const SPLASH_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-user-select:none;user-select:none}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#fff;color:#111}
  @media (prefers-color-scheme:dark){body{background:#0b0b0f;color:#eee}}
  .logo{width:56px;height:56px;border-radius:14px;background:#2f62e0;display:flex;align-items:center;justify-content:center}
  h1{font-size:18px;margin:0;font-weight:600} p{margin:0;font-size:13px;opacity:.6}
  .bar{width:160px;height:3px;border-radius:3px;background:rgba(127,127,127,.2);overflow:hidden}
  .bar i{display:block;width:40%;height:100%;background:#2f62e0;border-radius:3px;animation:s 1.1s ease-in-out infinite}
  @keyframes s{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
</style></head><body>
  <div class="logo"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg></div>
  <h1>${APP_TITLE}</h1><p>正在启动…</p><div class="bar"><i></i></div>
</body></html>`;

function showSplash() {
  splash = new BrowserWindow({
    width: 360,
    height: 240,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    center: true,
    skipTaskbar: false,
    title: APP_TITLE,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0b0f" : "#ffffff",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  splash.once("ready-to-show", () => splash?.show());
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
}

const isAppUrl = (url: string) => url === baseUrl || url.startsWith(`${baseUrl}/`);

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: APP_TITLE,
    autoHideMenuBar: !isMac,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0b0f" : "#ffffff",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });

  // The pages set their own <title>; keep the window title stable for the taskbar.
  win.on("page-title-updated", (e) => e.preventDefault());

  // Anything outside the app — the official GESP site, PDFs — opens in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow" };
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  // Backups downloaded from /admin: ask where to save, starting in Downloads.
  win.webContents.session.on("will-download", (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
  });

  win.once("ready-to-show", () => {
    splash?.destroy();
    splash = null;
    win.show();
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  void win.loadURL(`${baseUrl}/`);
  mainWindow = win;
}

// ───────────────────────── menu ─────────────────────────

function buildMenu() {
  const go = (pathname: string) => () => mainWindow?.loadURL(`${baseUrl}${pathname}`);
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const, label: APP_TITLE }] : []),
    {
      label: "文件",
      submenu: [
        { label: "首页", accelerator: "CmdOrCtrl+Shift+H", click: go("/") },
        { label: "系统设置", click: go("/admin") },
        { type: "separator" },
        { label: "打开数据文件夹", click: () => void shell.openPath(dataDir()) },
        { label: "打开服务日志", click: () => void shell.openPath(logFile()) },
        { type: "separator" },
        isMac ? { role: "close", label: "关闭窗口" } : { role: "quit", label: "退出" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "后退", accelerator: isMac ? "Cmd+[" : "Alt+Left", click: () => mainWindow?.webContents.navigationHistory.goBack() },
        { label: "前进", accelerator: isMac ? "Cmd+]" : "Alt+Right", click: () => mainWindow?.webContents.navigationHistory.goForward() },
        { role: "reload", label: "刷新" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { role: "togglefullscreen", label: "全屏" },
        { type: "separator" },
        { role: "toggleDevTools", label: "开发者工具" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        { label: "GESP 官网 · 真题及解析", click: () => void shell.openExternal("https://gesp.ccf.org.cn/101/1010/index.html") },
        { label: "项目主页", click: () => void shell.openExternal("https://github.com/DrWeiZhou/GESPLearner") },
        { type: "separator" },
        {
          label: `关于 ${APP_TITLE}`,
          click: () =>
            void dialog.showMessageBox({
              type: "info",
              title: APP_TITLE,
              message: `${APP_TITLE} v${app.getVersion()}`,
              detail: `CCF GESP C++ 真题练习、模拟考试、在线评测与 AI 讲解。\n真题版权归 CCF GESP 所有，仅供学习交流。\n\n数据保存在：${dataDir()}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ───────────────────────── lifecycle ─────────────────────────

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopServer);
process.on("exit", stopServer);

app.whenReady().then(async () => {
  buildMenu();
  showSplash();
  try {
    await startServer();
    await waitForServer();
    createMainWindow();
  } catch (err) {
    splash?.destroy();
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: APP_TITLE,
      message: "启动失败",
      detail: `${err instanceof Error ? err.message : String(err)}\n\n日志：${logFile()}`,
      buttons: ["打开日志", "退出"],
    });
    if (response === 0) await shell.openPath(logFile());
    stopServer();
    app.exit(1);
  }
});
