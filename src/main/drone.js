'use strict';
// Drone Sync: unisce un video e un audio SENZA mai accorciare il video.
//
// BUG ORIGINALE: il comando usava "-shortest", che ferma l'output alla traccia piu corta.
// Con un audio piu corto del video, il filmato veniva troncato.
//
// NUOVA LOGICA (durate lette dai file):
//  - audio piu corto  -> la traccia audio viene allungata con silenzio fino alla fine del video
//  - audio piu lungo  -> l'audio viene tagliato alla durata del video
//  - durata ignota    -> nessun taglio (l'output dura quanto lo stream piu lungo)
const path = require('path');
const { execFile } = require('child_process');

const VIDEO_EXT = ['.mp4', '.mov', '.avi', '.mkv', '.m4v'];
const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma'];

function kindOf(file) {
  const e = path.extname(file).toLowerCase();
  if (VIDEO_EXT.includes(e)) return 'video';
  if (AUDIO_EXT.includes(e)) return 'audio';
  return 'other';
}

function parseDuration(text) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text || '');
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

function probeDuration(ffmpeg, file) {
  return new Promise((resolve) => {
    // "ffmpeg -i file" senza output esce con errore ma stampa la durata su stderr
    execFile(ffmpeg, ['-hide_banner', '-i', file], { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve(parseDuration(String(stderr || '') + String(stdout || ''))));
  });
}

// Abbina video e audio con lo stesso nome (senza estensione, maiuscole ignorate).
// Se non c'e nessun abbinamento ma ci sono esattamente 1 video e 1 audio, li abbina comunque.
function pairFiles(files) {
  const videos = [], audios = [], others = [];
  for (const f of files) {
    const k = kindOf(f);
    (k === 'video' ? videos : k === 'audio' ? audios : others).push(f);
  }
  const base = (f) => path.basename(f, path.extname(f)).toLowerCase();
  const used = new Set(), pairs = [], noAudio = [];
  for (const v of videos) {
    const a = audios.find((x) => !used.has(x) && base(x) === base(v));
    if (a) { used.add(a); pairs.push({ video: v, audio: a }); } else noAudio.push(v);
  }
  if (pairs.length === 0 && videos.length === 1 && audios.length === 1) {
    pairs.push({ video: videos[0], audio: audios[0] });
    used.add(audios[0]); noAudio.length = 0;
  }
  const unmatched = audios.filter((a) => !used.has(a));
  return { pairs, noAudio, unmatched, others };
}

const r3 = (n) => Math.round(n * 1000) / 1000;

function buildSyncArgs({ video, audio, out, vDur, aDur }) {
  const args = ['-hide_banner', '-y', '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k'];
  if (vDur > 0) {
    if (aDur > 0 && aDur < vDur) args.push('-af', `apad=whole_dur=${r3(vDur)}`);
    args.push('-t', String(r3(vDur + 0.02)));   // il video non puo essere piu lungo di se stesso
  }
  if (/\.(mp4|mov|m4v)$/i.test(out)) args.push('-movflags', '+faststart');
  args.push(out);
  return args;
}

module.exports = { VIDEO_EXT, AUDIO_EXT, kindOf, parseDuration, probeDuration, pairFiles, buildSyncArgs };
