'use strict';
const fs = require('fs');
const path = require('path');

function createHistory(dir, max = 300) {
  const file = path.join(dir, 'history.json');
  let list = [];
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j)) list = j; } catch (_) { /* nessuna cronologia */ }
  const save = () => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(list)); } catch (_) { /* non critico */ } };
  return {
    add(entry) { list.unshift({ time: Date.now(), ...entry }); if (list.length > max) list.length = max; save(); },
    get: () => list.slice(),
    clear() { list = []; save(); }
  };
}
module.exports = { createHistory };
