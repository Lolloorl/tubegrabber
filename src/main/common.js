'use strict';
// Funzioni di utilita condivise dai flussi di lavoro.
const fs = require('fs');
const path = require('path');

const missing = (name) => ({ status: 'error', message: `${name} non trovato. Copialo nella cartella bin/ dell'app (vedi README).` });
const fail = (message) => ({ status: 'error', message });
const clip = (s, n = 140) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); return fs.statSync(dir).isDirectory(); } catch (_) { return false; }
}

// Nome libero: se esiste gia, aggiunge " (1)", " (2)"... (non sovrascrive mai file dell'utente)
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 1; i < 1000; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
  return p;
}

function summarize(job, ok, errors, lastErr, what) {
  if (job.cancelled) return { status: 'cancelled', message: `${what} annullata.` };
  if (errors === 0) return { status: 'ok', message: `${what} completata con successo!` };
  if (ok > 0) return { status: 'warn', message: `${ok} riusciti, ${errors} con errori. ${clip(lastErr)}` };
  return { status: 'error', message: `Errore: ${clip(lastErr || 'operazione non riuscita')}` };
}

// Controlli comuni: ffmpeg presente e cartella di output utilizzabile
function checkFfmpegOut(ctx, p) {
  if (!ctx.bins.ffmpeg) return missing('ffmpeg');
  if (!ensureDir(p.outDir)) return fail('La cartella di output non esiste e non si riesce a crearla.');
  return null;
}

const natSort = (arr) => arr.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
const pad2 = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}
function fmtSize(b) {
  return b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
}

// Esegue worker su items con al massimo n lavori in parallelo
async function pool(items, n, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; await worker(items[i], i); }
  });
  await Promise.all(lanes);
}

module.exports = { missing, fail, clip, ensureDir, uniquePath, summarize, checkFfmpegOut, natSort, stamp, fmtSize, pool };
