'use strict';
// Lettura dei tag audio tramite ffmpeg (nessuna libreria in piu).
const { execFile } = require('child_process');
const { parseInfo, parseFFMetadata } = require('./media');

function readTags(ffmpeg, file) {
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-hide_banner', '-i', file, '-f', 'ffmetadata', '-'], { timeout: 30000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const t = parseFFMetadata(String(stdout || ''));
        const info = parseInfo(String(stderr || ''));
        resolve({
          path: file, title: t.title || '', artist: t.artist || t.album_artist || '', album: t.album || '',
          track: String(t.track || '').split('/')[0], year: String(t.date || t.year || '').slice(0, 4), genre: t.genre || '',
          hasCover: info.hasCover, ok: !!info.duration || Object.keys(t).length > 0
        });
      });
  });
}
module.exports = { readTags };
