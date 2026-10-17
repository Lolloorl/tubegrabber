'use strict';
// Carica gli strumenti a ricetta: online (se possibile), altrimenti ultima copia salvata, altrimenti quelli inclusi.
const fs = require('fs');
const path = require('path');
const R = require('../shared/recipes');

function parseList(text, where) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return { tools: [], problems: [{ id: where, errors: ['File non valido: ' + e.message] }] }; }
  const list = Array.isArray(j) ? j : (j && Array.isArray(j.tools) ? j.tools : null);
  if (!list) return { tools: [], problems: [{ id: where, errors: ['Il file deve contenere {"tools": [ ... ]}.'] }] };
  const tools = [], problems = [];
  for (const r of list) {
    if (r && r.disabled === true) { tools.push({ id: r.id, disabled: true }); continue; }
    const errors = R.validate(r);
    if (errors.length) problems.push({ id: (r && r.id) || '(senza id)', errors }); else tools.push(r);
  }
  return { tools, problems };
}

async function loadAll({ bundledFile, remoteUrl, cacheFile, fetchFn, useRemote = true, timeoutMs = 8000 }) {
  let bundled = { tools: [], problems: [] };
  try { bundled = parseList(fs.readFileSync(bundledFile, 'utf8'), 'strumenti inclusi'); } catch (_) { /* nessun file incluso */ }
  let remote = null, source = 'inclusi';
  if (useRemote && remoteUrl && !/TUO-UTENTE/.test(remoteUrl)) {
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
      const res = await fetchFn(remoteUrl, ctl ? { signal: ctl.signal } : undefined);
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      remote = parseList(text, 'strumenti online'); source = 'online';
      try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, text); } catch (_) { /* non critico */ }
    } catch (_) {
      try { remote = parseList(fs.readFileSync(cacheFile, 'utf8'), 'strumenti salvati'); source = 'salvati'; } catch (__) { /* nessuna copia */ }
    }
  }
  const tools = R.merge(bundled.tools.filter((t) => !t.disabled), remote ? remote.tools : []);
  return { tools, problems: [...bundled.problems, ...(remote ? remote.problems : [])], source };
}

module.exports = { loadAll, parseList };
