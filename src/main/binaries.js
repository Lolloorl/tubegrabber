'use strict';
// Localizza yt-dlp, ffmpeg e (facoltativo) un runtime JavaScript (deno/node) per yt-dlp.
// Ordine: cartella bin/<piattaforma> dell'app -> PATH di sistema.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { compareVersions } = require('./updater');

const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const exeName = (n) => (process.platform === 'win32' ? n + '.exe' : n);

function binDir(isPackaged, resourcesPath, appRoot) {
  return isPackaged ? path.join(resourcesPath, 'bin', plat) : path.join(appRoot, 'bin', plat);
}

function which(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, exeName(name));
    try { if (fs.statSync(p).isFile()) return p; } catch (_) { /* continua */ }
  }
  return null;
}

function locate(dir, name) {
  const local = path.join(dir, exeName(name));
  if (fs.existsSync(local)) {
    if (process.platform !== 'win32') { try { fs.chmodSync(local, 0o755); } catch (_) { /* sola lettura */ } }
    return local;
  }
  return which(name);
}

function versionOf(exe) {
  const isFf = /ffmpeg(\.exe)?$/i.test(exe);
  try {
    const out = execFileSync(exe, [isFf ? '-version' : '--version'], { timeout: 8000, windowsHide: true, encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    return isFf ? out.replace(/\s+Copyright.*$/, '').replace(/^ffmpeg version\s+/, '') : out;
  } catch (_) { return null; }
}

// yt-dlp: se esiste una copia aggiornata dall'app (cartella dati utente) usa la piu recente fra le due
function pickYtdlp(dir, userDir) {
  const bundled = locate(dir, 'yt-dlp');
  const userCopy = userDir ? path.join(userDir, exeName('yt-dlp')) : null;
  if (!userCopy || !fs.existsSync(userCopy)) return { exe: bundled, version: null };
  const uv = versionOf(userCopy);
  if (!uv) return { exe: bundled, version: null };
  if (!bundled) return { exe: userCopy, version: uv };
  const bv = versionOf(bundled);
  return !bv || compareVersions(uv, bv) >= 0 ? { exe: userCopy, version: uv } : { exe: bundled, version: bv };
}

function resolveAll(dir, userDir) {
  const picked = pickYtdlp(dir, userDir);
  const ytdlp = picked.exe;
  // ffmpeg: se l'utente lo ha aggiornato dall'app, usa quella copia
  const userFf = userDir ? path.join(userDir, exeName('ffmpeg')) : null;
  const ffmpegUser = userFf && fs.existsSync(userFf) && versionOf(userFf) ? userFf : null;
  const ffmpeg = ffmpegUser || locate(dir, 'ffmpeg');
  let jsRuntime = null;
  for (const n of ['deno', 'node']) {
    const p = locate(dir, n);
    if (p) { jsRuntime = `${n}:${p}`; break; }
  }
  return { ytdlp, ytdlpVersion: picked.version || (ytdlp ? versionOf(ytdlp) : null), ffmpeg, ffmpegUpdated: !!ffmpegUser, ffmpegVersion: ffmpeg ? versionOf(ffmpeg) : null, ffmpegDir: ffmpeg ? path.dirname(ffmpeg) : null, jsRuntime, binDir: dir };
}

module.exports = { binDir, resolveAll, versionOf, plat };
