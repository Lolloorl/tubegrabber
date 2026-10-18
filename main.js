'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu, Notification, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const binaries = require('./src/main/binaries');
const { cancelJob } = require('./src/main/runner');
const jobsFlows = require('./src/main/jobs');
const { checkForUpdate } = require('./src/main/updater');
const { updateYtdlp } = require('./src/main/ytdlp-update');
const { updateFfmpeg } = require('./src/main/ffmpeg-update');
const { createStore } = require('./src/main/settings');
const { mailUrls } = require('./src/main/support');
const { loadAll } = require('./src/main/recipes-load');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'app-config.json'), 'utf8'));
const jobs = new Map();
let win = null, store = null, bins = null, userBin = '';
let recipeMap = new Map(), recipeInfo = { tools: [], problems: [], source: 'inclusi' };
const BG = '#0e1014';

app.setAppUserModelId('it.lorenzoorlandi.tubegrabber');   // necessario per le notifiche di Windows
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const refreshBins = () => { bins = binaries.resolveAll(binaries.binDir(app.isPackaged, process.resourcesPath, __dirname), userBin); return bins; };
async function reloadRecipes() {
  recipeInfo = await loadAll({
    bundledFile: path.join(__dirname, 'recipes', 'strumenti.json'),
    remoteUrl: config.toolsUrl, cacheFile: path.join(app.getPath('userData'), 'strumenti-cache.json'),
    fetchFn: (u, o) => net.fetch(u, { ...(o || {}), cache: 'no-store' }),
    useRemote: store.get().extraTools !== false
  });
  recipeMap = new Map(recipeInfo.tools.map((t) => [t.id, t]));
  return recipeInfo;
}
const notice = (text) => { if (win && !win.isDestroyed()) win.webContents.send('app:notice', text); };

function writeLog(job) {
  return (name, lines) => {
    job.logLines = lines;
    try {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${name}.log`), lines.slice(-5000).join('\n'));
    } catch (_) { /* non critico */ }
  };
}

let lastErrorDetails = '';
const systemLines = () => {
  const b = bins || {};
  return [
    `TubeGrabber ${app.getVersion()} · ${os.type()} ${os.release()} · ${process.arch}`,
    `yt-dlp: ${b.ytdlpVersion || (b.ytdlp ? 'sì' : 'MANCANTE')} · ffmpeg: ${b.ffmpegVersion || (b.ffmpeg ? 'sì' : 'MANCANTE')} · runtime JS: ${b.jsRuntime ? 'sì' : 'no'}`
  ];
};

// Testo diagnostico da incollare/inviare (il nome utente di Windows viene nascosto)
function buildDetails(tool, payload, result, job) {
  const hide = (t) => String(t).split(os.homedir()).join('~');
  const b = bins || {};
  const params = { ...payload }; delete params.outDir; delete params.openFolder;
  if (Array.isArray(params.links)) params.links = params.links.slice(0, 5);
  if (Array.isArray(params.files)) params.files = params.files.map((f) => path.basename(String(f))).slice(0, 10);
  return hide([
    `TubeGrabber ${app.getVersion()} · ${os.type()} ${os.release()} · ${process.arch}`,
    `yt-dlp: ${b.ytdlpVersion || (b.ytdlp ? 'sì' : 'MANCANTE')} · ffmpeg: ${b.ffmpegVersion || (b.ffmpeg ? 'sì' : 'MANCANTE')} · runtime JS: ${b.jsRuntime ? 'sì' : 'no'}`,
    `Strumento: ${tool} · Esito: ${result.status}`,
    `Messaggio: ${result.message}`,
    `Parametri: ${JSON.stringify(params).slice(0, 600)}`,
    '--- ultime righe del log ---',
    ...((job.logLines || []).slice(-40))
  ].join('\n'));
}

function createWindow() {
  const mac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 880, minHeight: 640,
    backgroundColor: BG, title: 'TubeGrabber — By Lorenzo Orlandi', show: false,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    titleBarStyle: mac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: mac ? false : { color: BG, symbolColor: '#c9ced8', height: 40 },
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { for (const j of jobs.values()) cancelJob(j); win = null; });
}

// ---- aggiornamento programmi (yt-dlp / ffmpeg)
async function updateTool(which, { silent } = {}) {
  if (jobs.size) return { status: 'busy', message: 'Aspetta la fine delle operazioni in corso.' };
  const fetchFn = (u, o) => net.fetch(u, { ...(o || {}), cache: 'no-store' });
  if (which === 'ytdlp') {
    const r = await updateYtdlp({ fetchFn, currentVersion: bins.ytdlpVersion, destDir: userBin, runVersion: async (f) => binaries.versionOf(f) });
    if (r.status === 'updated') { refreshBins(); notice(`yt-dlp aggiornato alla versione ${r.version}.`); }
    else if (!silent && r.status === 'up-to-date') notice('yt-dlp è già aggiornato.');
    return r;
  }
  const r = await updateFfmpeg({ fetchFn, destDir: userBin, runVersion: async (f) => binaries.versionOf(f) });
  if (r.status === 'updated') { refreshBins(); notice('ffmpeg aggiornato.'); }
  return r;
}

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'), {
    outDir: app.getPath('downloads'), openFolder: true, notify: true, autoYtdlp: true, checkUpdates: true,
    ytQuality: 'max', ytAudio: 'mp3', ytCover: true, ytSubs: 'none', lastYtdlpCheck: 0, extraTools: true
  });
  userBin = path.join(app.getPath('userData'), 'bin');
  refreshBins();
  reloadRecipes();
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });

  // controllo automatico di yt-dlp: al massimo una volta ogni 12 ore, in silenzio
  setTimeout(async () => {
    const s = store.get();
    if (!s.autoYtdlp || !bins.ytdlp || Date.now() - s.lastYtdlpCheck < 12 * 3600e3) return;
    store.set({ lastYtdlpCheck: Date.now() });
    updateTool('ytdlp', { silent: true });
  }, 6000);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { for (const j of jobs.values()) cancelJob(j); });

// ------------------------------------------------------------------ IPC
const toolStatus = () => ({ ytdlp: !!bins.ytdlp, ytdlpVersion: bins.ytdlpVersion, ffmpeg: !!bins.ffmpeg, ffmpegVersion: bins.ffmpegVersion, ffmpegUpdated: bins.ffmpegUpdated, jsRuntime: !!bins.jsRuntime, canUpdateFfmpeg: process.platform === 'win32' });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: binaries.plat, bins: toolStatus(), supportEmail: config.supportEmail || '' }));
ipcMain.handle('settings:get', () => store.get());
ipcMain.handle('settings:set', (_e, patch) => store.set(patch || {}));
ipcMain.handle('recipes:list', () => recipeInfo);
ipcMain.handle('recipes:refresh', () => reloadRecipes());
ipcMain.handle('tools:status', () => toolStatus());
ipcMain.handle('tools:update', (_e, which) => updateTool(which === 'ffmpeg' ? 'ffmpeg' : 'ytdlp').then((r) => ({ ...r, tools: toolStatus() })));
ipcMain.handle('tools:reset-ffmpeg', () => { try { fs.rmSync(path.join(userBin, 'ffmpeg.exe'), { force: true }); } catch (_) { /* ok */ } refreshBins(); return toolStatus(); });

ipcMain.handle('dialog:files', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: opts.filters });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:folder', async (_e, current) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: current });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('job:start', (e, { id, tool, payload }) => {
  const flow = Object.prototype.hasOwnProperty.call(jobsFlows, tool) ? jobsFlows[tool] : null;
  if (!flow) return { ok: false, error: 'Strumento sconosciuto' };
  if (jobs.has(id)) return { ok: false, error: 'Operazione già in corso in questa scheda' };
  const job = { id, cancelled: false, procs: new Set(), logLines: [] };
  jobs.set(id, job);
  const send = (ev) => { if (!e.sender.isDestroyed()) e.sender.send('job:event', { id, ...ev }); };
  (async () => {
    let result;
    try { result = await flow(job, payload || {}, send, { bins: bins, writeLog: writeLog(job), recipes: recipeMap }); }
    catch (err) { result = { status: 'error', message: 'Errore imprevisto: ' + (err && err.message || err) }; }
    jobs.delete(id);
    const ok = result.status === 'ok' || result.status === 'warn';
    if (payload && payload.openFolder && ok && payload.outDir) shell.openPath(payload.outDir);
    // notifica di sistema solo se l'utente non sta guardando la finestra
    if (store.get().notify && result.status !== 'cancelled' && Notification.isSupported() && win && !win.isDestroyed() && !win.isFocused()) {
      const n = new Notification({ title: result.status === 'ok' ? 'TubeGrabber · Fatto!' : 'TubeGrabber · Attenzione', body: String(result.message || '').slice(0, 200), silent: false });
      n.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
      n.show();
    }
    const details = result.status === 'error' || result.status === 'warn' ? buildDetails(tool, payload || {}, result, job) : undefined;
    if (details) lastErrorDetails = details;
    send({ type: 'done', ...result, details });
  })();
  return { ok: true };
});
ipcMain.handle('job:cancel', (_e, id) => { const j = jobs.get(id); if (j) cancelJob(j); return !!j; });

ipcMain.handle('update:check', () => checkForUpdate({
  url: config.updateUrl, currentVersion: app.getVersion(), platform: binaries.plat,
  fetchFn: (u) => net.fetch(u, { cache: 'no-store' })
}));

// ---- segnalazione problema
ipcMain.handle('support:copy', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('support:base', () => {
  const hide = (t) => String(t).split(os.homedir()).join('~');
  return hide([...systemLines(), ...(lastErrorDetails ? ['', 'Ultimo errore:', lastErrorDetails] : [])].join('\n'));
});
ipcMain.handle('support:send', (_e, { kind, subject, text }) => {
  const to = config.supportEmail || '';
  clipboard.writeText(String(text || ''));            // il testo completo e sempre negli appunti
  if (kind === 'copy' || !to) return { ok: true, to };
  const urls = mailUrls({ to, subject: subject || 'Problema con TubeGrabber', text });
  shell.openExternal(kind === 'gmail' ? urls.gmail : urls.mailto);
  return { ok: true, to };
});

ipcMain.handle('shell:openExternal', (_e, url) => { if (/^https:\/\//i.test(url)) { shell.openExternal(url); return true; } return false; });
ipcMain.handle('shell:openFolder', (_e, dir) => (dir ? shell.openPath(dir) : false));

ipcMain.handle('file:saveImage', async (_e, { dataUrl, defaultName }) => {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!m) return { ok: false, error: 'Immagine non valida' };
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(store.get().outDir, defaultName || 'QRCode.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, Buffer.from(m[1], 'base64'));
  return { ok: true, path: r.filePath };
});
