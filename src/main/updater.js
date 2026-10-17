'use strict';
// Controllo aggiornamenti "leggero": legge un file JSON pubblicato dall'admin (GitHub, web server, cloud).
function parseVer(v) { return String(v || '0').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0); }
function compareVersions(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function checkForUpdate({ url, currentVersion, platform, fetchFn }) {
  if (!url || /TUO-UTENTE/i.test(url)) return { status: 'not-configured' };
  let data;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return { status: 'error', message: 'Server aggiornamenti: HTTP ' + res.status };
    data = await res.json();
  } catch (e) { return { status: 'error', message: 'Impossibile contattare il server aggiornamenti.' }; }

  if (!data || typeof data.version !== 'string') return { status: 'error', message: 'File versione non valido.' };
  if (compareVersions(data.version, currentVersion) <= 0) return { status: 'up-to-date', current: currentVersion };

  const dl = data.downloads && data.downloads[platform];
  const safe = typeof dl === 'string' && /^https:\/\//i.test(dl) ? dl : null;   // solo https
  const mandatory = !!data.mandatory || (data.minVersion ? compareVersions(currentVersion, data.minVersion) < 0 : false);
  return { status: 'available', current: currentVersion, version: data.version, notes: String(data.notes || ''), mandatory, url: safe, date: data.releaseDate || '' };
}

module.exports = { compareVersions, checkForUpdate };
