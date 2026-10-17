'use strict';
const fs = require('fs');
const path = require('path');

function createStore(dir, defaults) {
  const file = path.join(dir, 'settings.json');
  let data = { ...defaults };
  try { data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (_) { /* primo avvio */ }
  return {
    get: () => ({ ...data }),
    set(patch) {
      data = { ...data, ...patch };
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (_) { /* non critico */ }
      return { ...data };
    }
  };
}
module.exports = { createStore };
