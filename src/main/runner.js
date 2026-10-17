'use strict';
// Avvio dei programmi esterni (yt-dlp / ffmpeg) SENZA shell: gli argomenti sono un array,
// quindi link o nomi file con spazi, apici o simboli speciali non possono rompere il comando.
const { spawn } = require('child_process');

function killTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-proc.pid, 'SIGTERM'); // gruppo di processi (yt-dlp + ffmpeg figli)
    }
  } catch (_) {
    try { proc.kill('SIGTERM'); } catch (_) { /* gia terminato */ }
  }
}

function cancelJob(job) {
  job.cancelled = true;
  for (const p of job.procs) killTree(p);
}

function run(job, exe, args, onLine, opts = {}) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(exe, args, {
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: opts.cwd || undefined
      });
    } catch (e) { return resolve({ code: -1, error: e.message }); }

    job.procs.add(proc);
    const makeFeeder = () => {
      let buf = '';
      return {
        push(chunk) {
          buf += chunk.toString('utf8');
          const parts = buf.split(/[\r\n]+/);
          buf = parts.pop();
          for (const l of parts) if (l.trim()) onLine(l);
        },
        flush() { if (buf.trim()) onLine(buf); buf = ''; }
      };
    };
    const fo = makeFeeder(), fe = makeFeeder();
    proc.stdout.on('data', (c) => fo.push(c));
    proc.stderr.on('data', (c) => fe.push(c));
    proc.on('error', (err) => {
      job.procs.delete(proc);
      resolve({ code: -1, error: err.code === 'ENOENT' ? 'ENOENT' : err.message });
    });
    proc.on('close', (code) => {
      fo.flush(); fe.flush();
      job.procs.delete(proc);
      resolve({ code });
    });
  });
}

module.exports = { run, cancelJob, killTree };
