'use strict';
// Accorcia un link con un servizio pubblico (is.gd, poi TinyURL come riserva).
// La risposta viene controllata rigidamente: nel QR finisce solo un link breve di quei due servizi.
const { normalizeAlias } = require('../shared/qrtemplates');
const PROVIDERS = [
  { name: 'is.gd', url: (u) => `https://is.gd/create.php?format=simple&url=${encodeURIComponent(u)}`, valid: /^https:\/\/is\.gd\/[A-Za-z0-9_-]{3,40}$/ },
  { name: 'TinyURL', url: (u) => `https://tinyurl.com/api-create.php?url=${encodeURIComponent(u)}`, valid: /^https:\/\/tinyurl\.com\/[A-Za-z0-9_-]{3,40}$/ }
];

const TAKEN = /(already|taken|in use|exists|not available|unavailable|choose|pick)/i;

async function shortenUrl({ url, alias, fetchFn, timeoutMs = 7000 }) {
  url = String(url || '').trim();
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) return { ok: false, error: 'Inserisci un link che inizi con http:// o https://' };
  alias = alias ? normalizeAlias(alias) : '';
  if (alias && (alias.length < 5 || alias.length > 30)) return { ok: false, error: 'il nome deve avere da 5 a 30 caratteri (lettere, numeri e _)' };
  let lastErr = '';
  // con un nome scelto si usa solo is.gd: gli altri servizi darebbero un link casuale
  const providers = alias ? [{ name: 'is.gd', url: (u) => `https://is.gd/create.php?format=simple&url=${encodeURIComponent(u)}&shorturl=${alias}`, valid: new RegExp('^https://is\\.gd/' + alias + '$') }] : PROVIDERS;
  for (const p of providers) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetchFn(p.url(url), ctl ? { signal: ctl.signal } : undefined);
      const text = String(await res.text()).trim();
      if (res.ok && p.valid.test(text)) return { ok: true, url: text, provider: p.name };
      if (alias && /^error/i.test(text) && TAKEN.test(text)) return { ok: false, taken: true, error: 'questo nome è già usato (anche da te in passato): scegline un altro' };
      lastErr = /^error/i.test(text) ? `${p.name}: ${text.replace(/^error:?\s*/i, '').slice(0, 100)}` : `risposta non valida da ${p.name}`;
    } catch (_) {
      lastErr = 'servizio non raggiungibile (serve internet)';
    } finally { if (timer) clearTimeout(timer); }
  }
  return { ok: false, error: lastErr || 'servizio non raggiungibile' };
}

module.exports = { shortenUrl, PROVIDERS };
