/**
 * Electron main process.
 *
 * The renderer is the ordinary Vite build in dist/ -- a normal multi-file
 * bundle, so assets stream and cache the way they should once there are real
 * ones. It is served over a custom app:// protocol rather than file://, because
 * Chromium refuses ES module scripts from a file:// origin and turning
 * webSecurity off to dodge that would be a worse trade.
 *
 * CommonJS on purpose: the package is type=module for the game code, and the
 * main and preload scripts are the one place that would rather not be.
 */
const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const RENDERER_ROOT = path.join(__dirname, '..', 'dist');
const SCHEME = 'app';

// Must happen before the app is ready. `standard` gives it an origin (so
// modules and storage work), `stream` gives range requests, which is what
// streamed audio and video will want later.
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

// Chromium refuses to execute a module script that does not arrive with a
// JavaScript MIME type, and net.fetch on a file:// URL does not reliably supply
// one. Guessing from the extension here is what makes the module build load at
// all -- and it fails silently without this, which is worse than an error.
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain',
};

/** Only ever serve out of the renderer root, whatever the URL claims. */
function resolveWithin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const candidate = path.resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return null;
  return candidate;
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const target = resolveWithin(RENDERER_ROOT, pathname === '/' ? '/index.html' : pathname);
    if (!target) return new Response('Forbidden', { status: 403 });
    const type = MIME[path.extname(target).toLowerCase()];

    // Preferred path: Chromium opens the file itself, so range requests and
    // streaming work -- which is what large audio and video will want.
    try {
      const response = await net.fetch(pathToFileURL(target).toString());
      if (response.ok) {
        if (!type) return response;
        // Rebuild around the same body stream to keep it streaming.
        const headers = new Headers(response.headers);
        headers.set('Content-Type', type);
        return new Response(response.body, { status: response.status, headers });
      }
    } catch { /* fall through to the asar-aware read */ }

    // Fallback: Electron patches Node's fs to see inside an .asar archive;
    // Chromium's network stack does not. Without this a packaged build with
    // asar enabled serves the HTML and then silently fails to load anything
    // it references.
    try {
      const data = await fs.readFile(target);
      return new Response(data, { headers: type ? { 'Content-Type': type } : {} });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// --- save data -------------------------------------------------------------

function savePath() {
  return path.join(app.getPath('userData'), 'save.json');
}

ipcMain.handle('jsrf:load', async () => {
  try {
    return JSON.parse(await fs.readFile(savePath(), 'utf8'));
  } catch {
    return null;   // no save yet, or a corrupt one: start clean rather than fail
  }
});

ipcMain.handle('jsrf:save', async (_event, data) => {
  const file = savePath();
  const temp = `${file}.tmp`;
  // Write-then-rename, so a crash mid-save cannot leave a half-written file
  // where the only copy of somebody's progress used to be.
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(temp, file);
  return true;
});

ipcMain.handle('jsrf:version', () => app.getVersion());

ipcMain.handle('jsrf:fullscreen', (event, value) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  const next = value === undefined ? !win.isFullScreen() : !!value;
  win.setFullScreen(next);
  return next;
});

ipcMain.handle('jsrf:quit', () => { app.quit(); });

// --- window ----------------------------------------------------------------

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#0b0d16',
    autoHideMenuBar: true,
    show: false,
    title: 'Jet Set Radio Future',
    icon: path.join(__dirname, '..', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Split-screen on a TV means the window is often not the focused one.
      // Throttling the renderer there would stutter the game.
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Nothing in the game should be navigating anywhere; if it tries, it goes to
  // the real browser rather than replacing the game window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) event.preventDefault();
  });

  mainWindow.loadURL(`${SCHEME}://local/index.html`);
}

// --- updates ---------------------------------------------------------------

function checkForUpdates() {
  // electron-updater only works on a packaged app, and only if the build was
  // published somewhere it can read.
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); }
  catch { return; }   // not bundled in this build

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      title: 'Update ready',
      message: `Version ${info.version} is ready to install.`,
      detail: 'It will be applied next time you close the game.',
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.checkForUpdates().catch(() => { });   // offline is not an error
}

// --- lifecycle -------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    registerProtocol();
    createWindow();
    checkForUpdates();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
