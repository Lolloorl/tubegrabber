'use strict';
// Lettura informazioni dai file (tramite "ffmpeg -i") e calcoli di pianificazione.
const { execFile } = require('child_process');

function parseInfo(text) {
  const info = { duration: null, hasVideo: false, hasAudio: false, hasCover: false, width: 0, height: 0, fps: 0, vcodec: '', acodec: '' };
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text || '');
  if (d) info.duration = (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]);
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/^\s*Stream #/.test(line)) continue;
    if (/: Video:/.test(line)) {
      if (/attached pic/.test(line)) { info.hasCover = true; continue; }
      if (info.hasVideo) continue;                      // solo il primo flusso video
      info.hasVideo = true;
      const after = line.split('Video:')[1] || '';
      const wh = /\b(\d{2,5})x(\d{2,5})\b/.exec(after);
      if (wh) { info.width = +wh[1]; info.height = +wh[2]; }
      const fps = /(\d+(?:\.\d+)?) fps/.exec(after); if (fps) info.fps = parseFloat(fps[1]);
      info.vcodec = (/^\s*(\w+)/.exec(after) || [])[1] || '';
    } else if (/: Audio:/.test(line)) {
      info.hasAudio = true;
      info.acodec = (/Audio:\s*(\w+)/.exec(line) || [])[1] || '';
    }
  }
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(text || '');
  if (rot && Math.abs(parseFloat(rot[1])) % 180 === 90) { const t = info.width; info.width = info.height; info.height = t; }
  return info;
}

function probe(ffmpeg, file) {
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-hide_banner', '-i', file], { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve(parseInfo(String(stderr || '') + String(stdout || ''))));
  });
}

// Piano di compressione a dimensione massima: bitrate video, altezza, audio.
function planCompression({ duration, targetMB, hasAudio, height, fps }) {
  if (!(duration > 0)) return { error: 'Durata del video non leggibile.' };
  const totalKbit = targetMB * 8192 * 0.93;                // 7% di margine per contenitore e imprecisioni
  const audioKbps = hasAudio ? (targetMB <= 10 || duration > 600 ? 96 : 128) : 0;
  const videoKbps = Math.floor(totalKbit / duration - audioKbps);
  if (videoKbps < 60) return { error: `Il video è troppo lungo (${Math.round(duration)} s) per stare in ${targetMB} MB: scegli un limite più alto.` };
  const maxH = videoKbps >= 3500 ? 1080 : videoKbps >= 1500 ? 720 : videoKbps >= 700 ? 480 : 360;
  return { videoKbps, audioKbps, maxHeight: height ? Math.min(maxH, height) : maxH, capFps: fps > 30 };
}

// Tag leggibili da "ffmpeg -f ffmetadata": decodifica i caratteri di escape
function parseFFMetadata(text) {
  const tags = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw || raw.startsWith(';') || raw.startsWith('[') || raw.startsWith('#') || !raw.includes('=')) continue;
    const i = raw.indexOf('='); const k = raw.slice(0, i).toLowerCase();
    tags[k] = raw.slice(i + 1).replace(/\\([=;#\\])/g, '$1');
  }
  return tags;
}

module.exports = { parseInfo, probe, planCompression, parseFFMetadata };
