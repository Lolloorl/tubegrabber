'use strict';
// Aggiornamento di ffmpeg (solo Windows): scarica la build ufficiale "gpl" di BtbN e ne verifica il checksum.
// La copia aggiornata va nella cartella dati dell'utente; l'app la usa al posto di quella inclusa.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { parseSums } = require('./ytdlp-update');

const API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest';
const ZIP = 'ffmpeg-master-latest-win64-gpl.zip';
const SAFE = 'https://github.com/BtbN/FFmpeg-Builds/releases/';

function defaultExtract(zip, inner, outDir) {
  // tar.exe (bsdtar) e' incluso in Windows 10/11 e legge gli zip
  return new Promise((resolve, reject) => execFile('tar', ['-xf', zip, '-C', outDir, inner], { windowsHide: true, timeout: 300000 }, (e) => (e ? reject(e) : resolve())));
}

async function updateFfmpeg({ fetchFn, destDir, platform = process.platform, runVersion, extract = defaultExtract }) {
  if (platform !== 'win32') return { status: 'unsupported', message: 'L\'aggiornamento di ffmpeg è disponibile solo su Windows: su Mac arriva con gli aggiornamenti dell\'app.' };
  let rel;
  try {
    const r = await fetchFn(API, { headers: { 'User-Agent': 'TubeGrabber', Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    rel = await r.json();
  } catch (e) { return { status: 'error', message: 'Impossibile contattare GitHub: ' + e.message }; }
  const zip = (rel.assets || []).find((a) => a.name === ZIP), sums = (rel.assets || []).find((a) => a.name === 'checksums.sha256');
  if (!zip || !sums) return { status: 'error', message: 'File ffmpeg non trovato nella release.' };
  if (!String(zip.browser_download_url).startsWith(SAFE) || !String(sums.browser_download_url).startsWith(SAFE)) return { status: 'error', message: 'Indirizzo di download non attendibile.' };

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tg_ffup_'));
  try {
    const [buf, txt] = await Promise.all([
      fetchFn(zip.browser_download_url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }),
      fetchFn(sums.browser_download_url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    ]);
    const data = Buffer.from(buf);
    const expected = parseSums(txt)[ZIP];
    if (!expected || expected !== crypto.createHash('sha256').update(data).digest('hex')) return { status: 'error', message: 'Controllo di integrità fallito: file scartato.' };
    const zipPath = path.join(work, ZIP); fs.writeFileSync(zipPath, data);
    const inner = `${ZIP.replace(/\.zip$/, '')}/bin/ffmpeg.exe`;
    await extract(zipPath, inner, work);
    const extracted = path.join(work, ...inner.split('/'));
    if (!fs.existsSync(extracted)) return { status: 'error', message: 'ffmpeg non trovato nell\'archivio scaricato.' };
    const v = runVersion ? await runVersion(extracted) : 'ok';
    if (!v) return { status: 'error', message: 'Il ffmpeg scaricato non si avvia.' };
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, 'ffmpeg.exe'); fs.copyFileSync(extracted, dest + '.new');
    fs.rmSync(dest, { force: true }); fs.renameSync(dest + '.new', dest);
    return { status: 'updated', path: dest };
  } catch (e) { return { status: 'error', message: 'Aggiornamento non riuscito: ' + e.message }; }
  finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* ok */ } }
}

module.exports = { updateFfmpeg };
