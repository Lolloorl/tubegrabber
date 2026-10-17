'use strict';
// Aggiorna yt-dlp scaricando l'ultima versione ufficiale da GitHub e verificandone il checksum SHA-256.
// La copia aggiornata va nella cartella dati dell'utente (non serve toccare l'installazione).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { compareVersions } = require('./updater');

const ASSET = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' };
const API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const SAFE_PREFIX = 'https://github.com/yt-dlp/yt-dlp/releases/';

function parseSums(text) {
  const map = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (m) map[m[2]] = m[1].toLowerCase();
  }
  return map;
}

const localName = (platform) => (platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

async function fetchLatest(fetchFn) {
  const res = await fetchFn(API, { headers: { 'User-Agent': 'TubeGrabber', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error('GitHub: HTTP ' + res.status);
  return res.json();
}

async function updateYtdlp({ fetchFn, currentVersion, destDir, platform = process.platform, runVersion, force = false }) {
  const assetName = ASSET[platform];
  if (!assetName) return { status: 'unsupported' };
  let rel;
  try { rel = await fetchLatest(fetchFn); } catch (e) { return { status: 'error', message: 'Impossibile contattare GitHub: ' + e.message }; }
  const latest = String(rel.tag_name || '');
  if (!latest) return { status: 'error', message: 'Risposta GitHub non valida.' };
  if (!force && currentVersion && compareVersions(latest, currentVersion) <= 0) return { status: 'up-to-date', version: currentVersion };

  const asset = (rel.assets || []).find((a) => a.name === assetName);
  const sums = (rel.assets || []).find((a) => a.name === 'SHA2-256SUMS');
  if (!asset || !sums) return { status: 'error', message: 'File di aggiornamento non trovato nella release.' };
  if (!String(asset.browser_download_url).startsWith(SAFE_PREFIX) || !String(sums.browser_download_url).startsWith(SAFE_PREFIX)) return { status: 'error', message: 'Indirizzo di download non attendibile.' };

  try {
    const [bin, sumTxt] = await Promise.all([
      fetchFn(asset.browser_download_url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }),
      fetchFn(sums.browser_download_url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    ]);
    const buf = Buffer.from(bin);
    const expected = parseSums(sumTxt)[assetName];
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (!expected || expected !== actual) return { status: 'error', message: 'Controllo di integrità fallito: file scartato.' };

    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, localName(platform)), tmp = dest + '.new';
    fs.writeFileSync(tmp, buf, { mode: 0o755 });
    const v = runVersion ? await runVersion(tmp) : latest;
    if (!v) { fs.rmSync(tmp, { force: true }); return { status: 'error', message: 'Il file scaricato non si avvia.' }; }
    fs.rmSync(dest, { force: true });
    fs.renameSync(tmp, dest);
    return { status: 'updated', version: latest, path: dest };
  } catch (e) { return { status: 'error', message: 'Aggiornamento non riuscito: ' + e.message }; }
}

module.exports = { updateYtdlp, parseSums, localName, ASSET };
