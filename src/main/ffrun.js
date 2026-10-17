'use strict';
const { run } = require('./runner');

// Avvia ffmpeg e traduce le righe "time=..." in avanzamento 0..1
function ffmpeg(job, bin, args, { total = 0, log, onProgress, cwd } = {}) {
  return run(job, bin, args, (line) => {
    if (log) log.push(line);
    if (onProgress && total > 0) {
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
      if (m) onProgress(Math.min(((+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3])) / total, 1));
    }
  }, { cwd });
}

// Ultima riga di errore "sensata" dal log di ffmpeg
function lastError(log) {
  const bad = /(error|invalid|no such file|unknown|not found|failed|unrecognized|does not|permission|cannot|unable)/i;
  for (let i = log.length - 1; i >= 0; i--) if (bad.test(log[i]) && !/^\s*(Stream|Metadata)/.test(log[i])) return log[i].trim();
  return (log.filter((l) => !/^\s*(Stream|Metadata|Duration|frame=|size=|Input|Output|Press|configuration|lib)/.test(l)).slice(-1)[0] || '').trim();
}

module.exports = { ffmpeg, lastError };
